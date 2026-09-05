import { getSupabase } from "./supabase/client";
import { passEndAt } from "./dates";

export type PendingPass = {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  planned_hours: number;
};

export type PendingDay = {
  project_id: string;
  project_name: string;
  work_date: string;
  passes: PendingPass[];
  /** The admin's words, on a day he sent back. Null on a day never rejected. */
  rejection_note: string | null;
  /** What was written last time, so a correction is a correction. */
  vad_vi_gjorde: string;
};

/**
 * The days actually waiting on this arbetsledare, oldest first.
 *
 * ONE definition, used by both the landing page's widget and the Bekräfta Pass
 * page itself. A leader who is shown "3 dagar" and then finds two would stop
 * believing the number, and a preview that disagrees with the page it opens is
 * worse than no preview.
 *
 * A day is waiting when its last shift has ENDED and no confirmation sits on
 * it. Rejection needs no special case: the admin sending a day back removes
 * its confirmation, so it falls into this list on its own.
 *
 * A FLAGGED DAY IS NOT WAITING ON ANYONE HERE. Step 5c: a day that ran with a
 * worker covering, or with nobody, has no stage 1 claim in it to make -- not
 * by the project's other leaders and not by the one taken off it. Invariant
 * 4b's last line, and the database refuses such a confirmation outright; this
 * only keeps the queue from showing a day nobody can answer.
 *
 * Scoping is RLS's, not this function's. The pass policy limits rows to
 * projects the caller leads, so an admin calling it sees every project and an
 * arbetare sees nothing.
 */
export async function pendingDays(): Promise<PendingDay[]> {
  const sb = getSupabase();

  const { data: passes, error } = await sb
    .from("pass")
    .select("id, project_id, work_date, start_time, end_time, planned_hours, project(name)")
    .is("deleted_at", null)
    .order("work_date");

  if (error) throw new Error(error.message);

  const now = Date.now();
  const ended = (passes ?? []).filter(
    (p) => passEndAt(p.work_date, p.start_time, p.end_time).getTime() <= now,
  );
  if (ended.length === 0) return [];

  const { data: days } = await sb
    .from("project_day")
    .select("project_id, work_date, confirmed_at, vad_vi_gjorde, rejected_at, rejection_note, flagged_as");

  const done = new Set(
    (days ?? [])
      .filter((d) => d.confirmed_at || d.flagged_as)
      .map((d) => `${d.project_id}|${d.work_date}`),
  );
  const record = new Map((days ?? []).map((d) => [`${d.project_id}|${d.work_date}`, d]));

  const open = ended.filter((p) => !done.has(`${p.project_id}|${p.work_date}`));

  // Grouped by project and date: one day is one confirmation, however many
  // shifts ran on it.
  const byDay = new Map<string, PendingDay>();
  for (const p of open) {
    const key = `${p.project_id}|${p.work_date}`;
    if (!byDay.has(key)) {
      const r = record.get(key);
      byDay.set(key, {
        project_id: p.project_id,
        project_name: (p.project as { name: string } | null)?.name ?? "Projekt",
        work_date: p.work_date,
        passes: [],
        rejection_note: r?.rejected_at ? (r.rejection_note ?? null) : null,
        vad_vi_gjorde: r?.vad_vi_gjorde ?? "",
      });
    }
    byDay.get(key)!.passes.push({
      id: p.id,
      work_date: p.work_date,
      start_time: p.start_time,
      end_time: p.end_time,
      planned_hours: Number(p.planned_hours),
    });
  }

  // Oldest first, then whichever project comes first on that date.
  return [...byDay.values()].sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) || a.project_id.localeCompare(b.project_id),
  );
}
