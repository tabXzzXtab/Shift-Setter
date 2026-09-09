import { getSupabase } from "./supabase/client";

export type ReviewDay = {
  project_id: string;
  project_name: string;
  work_date: string;
  /** The leader's account of the day, or blank on a flagged one. */
  vad_vi_gjorde: string;
  /** This day has been rejected before. The record keeps that after re-confirmation. */
  came_back: boolean;
  /** Step 5c: 'worker_ansvarig' or 'ingen_ledare'. Null on an ordinary day. */
  flagged_as: string | null;
};

/**
 * The days waiting on the ADMIN at stage 2, flagged first then oldest first.
 *
 * ONE definition, used by Granska Pass and by Bekräftelser' "Att bekräfta"
 * when an admin is reading it. Exactly the reason lib/pending-days exists for
 * the other stage: an owner shown "3 dagar" who then finds two would stop
 * believing the number, and a queue that disagrees with the page it opens is
 * worse than no queue.
 *
 * TWO KINDS OF DAY, AND THEY ARE NOT THE SAME JOB. A stage 1 day carries a
 * leader's claim and the admin reviews it -- approve, edit and approve, or
 * reject. A flagged day (Step 5c) carries nothing: the day ran with a worker
 * as ansvarig or with nobody, so there was no leader to make a claim and the
 * admin writes the only account there will be. Both are outstanding work for
 * the same person, which is why they are one queue; `flagged_as` is what keeps
 * them apart once opened.
 *
 * A SURVEYED DAY AND AN APPROVED DAY ARE IN NEITHER. The bristsurvey writes
 * straight to admin_confirmed and never enters this queue, and once
 * admin_confirmed nothing edits a day at all (invariant 5).
 *
 * Flagged first, and not merely highlighted: a day nobody was answerable for
 * is the one the owner should be looking at.
 */
export async function reviewDays(): Promise<ReviewDay[]> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("project_day")
    .select("project_id, work_date, vad_vi_gjorde, rejected_at, flagged_as, stage, confirmed_at, project(name)")
    .or("stage.eq.leader_confirmed,and(flagged_as.not.is.null,confirmed_at.is.null)")
    .order("work_date");

  if (error) throw new Error(error.message);

  return [...(data ?? [])]
    .sort((a, b) =>
      Number(Boolean(b.flagged_as)) - Number(Boolean(a.flagged_as)) ||
      a.work_date.localeCompare(b.work_date))
    .map((d) => ({
      project_id: d.project_id,
      project_name: (d.project as { name: string } | null)?.name ?? "Projekt",
      work_date: d.work_date,
      vad_vi_gjorde: d.vad_vi_gjorde ?? "",
      came_back: d.rejected_at !== null,
      flagged_as: d.flagged_as ?? null,
    }));
}

export type ReviewSummary = ReviewDay & {
  /** project|date, the same key the rest of the app groups a day under. */
  key: string;
  /** Everyone still assigned that day, in Swedish collation. */
  workers: string[];
  /**
   * The leader's figures, totalled -- what the admin is being asked to
   * approve. Null where nothing has been typed yet, which is every flagged
   * day: nobody stated hours, so there is no total to show and a 0 would read
   * as a claim that nobody worked.
   */
  hours: number | null;
};

/**
 * The queue with the crew named and the claimed hours totalled, for the list
 * that only PREVIEWS it.
 *
 * The names and figures are read here rather than in the caller because they
 * are the only reason a preview needs a second round trip at all.
 */
export async function reviewSummaries(limit?: number): Promise<ReviewSummary[]> {
  const days = await reviewDays();
  const shown = limit === undefined ? days : days.slice(0, limit);
  if (shown.length === 0) return [];

  const sb = getSupabase();
  const projectIds = [...new Set(shown.map((d) => d.project_id))];
  const dates = [...new Set(shown.map((d) => d.work_date))];

  // Two coarse filters and an exact match in the browser. PostgREST has no
  // tuple IN, and asking per day would be one round trip per row.
  const { data: passes } = await sb
    .from("pass")
    .select("id, project_id, work_date")
    .in("project_id", projectIds)
    .in("work_date", dates)
    .is("deleted_at", null);

  const [{ data: assignments }, { data: roster }] = await Promise.all([
    sb.from("tilldelning")
      .select("pass_id, worker_id, confirmed_hours")
      .in("pass_id", (passes ?? []).map((p) => p.id))
      .is("released_at", null),
    sb.from("worker_roster").select("id, name"),
  ]);

  const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));

  return shown.map((d) => {
    const ids = new Set(
      (passes ?? [])
        .filter((p) => p.project_id === d.project_id && p.work_date === d.work_date)
        .map((p) => p.id),
    );
    const here = (assignments ?? []).filter((a) => ids.has(a.pass_id));
    const typed = here.filter((a) => a.confirmed_hours !== null);

    return {
      ...d,
      key: `${d.project_id}|${d.work_date}`,
      workers: [...new Set(here.map((a) => names.get(a.worker_id) ?? "Okänd"))]
        .sort((a, b) => a.localeCompare(b, "sv")),
      hours: typed.length === 0 ? null : typed.reduce((s, a) => s + Number(a.confirmed_hours), 0),
    };
  });
}
