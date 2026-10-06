import { getSupabase } from "@/lib/supabase/client";
import { stampToTime } from "@/lib/dates";

/**
 * The stamped breaks on a set of assignments, as one line each:
 * "Lunch 11:30–12:05 · 35 min", several breaks comma-separated, one still
 * running as "från 12:10".
 *
 * INFORMATION, NEVER HOURS (invariant 1). This sits beside the stamps on
 * Bekräfta and Granska so the leader and the admin can see what was pressed;
 * the hours field is still what a person types. The one place a break changes
 * a figure is the bristsurvey, in the database (app.lunch_seconds).
 *
 * Read as the caller: stamp_event is readable wherever its assignment is.
 */
export async function lunchLines(tilldelningIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tilldelningIds.length === 0) return out;

  const { data } = await getSupabase()
    .from("stamp_event")
    .select("tilldelning_id, kind, at, id")
    .in("tilldelning_id", tilldelningIds)
    .in("kind", ["lunch_start", "lunch_end"])
    .order("at")
    .order("id");

  const byRow = new Map<string, { kind: string; at: string }[]>();
  for (const e of data ?? []) {
    const list = byRow.get(e.tilldelning_id) ?? [];
    list.push({ kind: e.kind, at: e.at });
    byRow.set(e.tilldelning_id, list);
  }

  for (const [id, events] of byRow) {
    const spans: string[] = [];
    let minutes = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind !== "lunch_start") continue;
      const next = events[i + 1];
      if (next?.kind === "lunch_end") {
        spans.push(`${stampToTime(e.at)}–${stampToTime(next.at)}`);
        minutes += Math.max(0, Math.round((Date.parse(next.at) - Date.parse(e.at)) / 60000));
      } else {
        spans.push(`från ${stampToTime(e.at)}`);
      }
    }
    if (spans.length === 0) continue;
    const total = minutes >= 60
      ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`
      : `${minutes} min`;
    out.set(id, `Lunch ${spans.join(", ")}${minutes > 0 ? ` · ${total}` : ""}`);
  }
  return out;
}
