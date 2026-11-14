import { getSupabase } from "@/lib/supabase/client";

/**
 * Which Öppna Pass openings this worker has already seen (owner, 2026-10-22).
 *
 * The worker's startsida puts an orange dot on Meny, and on the Öppna Pass row
 * inside it, while the list holds a pass they have not looked at. Opening
 * Öppna Pass counts as looking at all of it: every pass on the screen is
 * remembered as seen, and the dot stays away until a pass appears that was not
 * on the screen then.
 *
 * WHAT IS REMEMBERED IS THE LIST AS IT WAS LAST SEEN, not a growing history.
 * Each visit replaces it with exactly the ids on screen, so it never grows
 * past the length of the list itself.
 *
 * localStorage, per account, so it is per DEVICE -- the same trade as the
 * tour (lib/tour/storage.ts): nothing here is worth a table, and a second
 * phone showing the dot once more costs one look. Every access is wrapped:
 * private mode or blocked storage throws, and a dot that cannot remember must
 * never break the screen it sits on. Unreadable storage shows no dot.
 *
 * The ids come from `open_pass`, the same view the Öppna Pass screen lists,
 * so the dot and the list cannot disagree about what is there.
 */

const key = (accountId: string) => `oppna_pass_seen_${accountId}`;

function seenIds(accountId: string): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(key(accountId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return null;
  }
}

/** Called by Öppna Pass with every pass it has just shown. */
export function markOpenPassesSeen(accountId: string, passIds: string[]) {
  try {
    window.localStorage.setItem(key(accountId), JSON.stringify(passIds));
  } catch {
    /* private mode */
  }
}

/** True when Öppna Pass lists a pass this worker has not seen there. */
export async function hasUnseenOpenPasses(accountId: string): Promise<boolean> {
  const seen = seenIds(accountId);
  if (seen === null) return false;
  const { data, error } = await getSupabase().from("open_pass").select("pass_id");
  if (error || !data) return false;
  return data.some((r) => r.pass_id !== null && !seen.has(r.pass_id));
}
