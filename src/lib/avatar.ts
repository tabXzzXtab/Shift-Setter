/**
 * Profilbilder -- putting a face on an account.
 *
 * THE BUCKET IS PRIVATE, so nothing here produces a plain URL. A path is
 * signed to be read and the signature expires; the Alla Konton list signs
 * every path it needs in ONE call rather than one per row, because a fifty
 * person company would otherwise open fifty requests to draw one screen.
 *
 * THE BROWSER DOWNSCALES BEFORE IT UPLOADS. A photo taken on a phone on a
 * building site is four megabytes, and there is no server to resize it after
 * the fact (CLAUDE.md: there is no server). 512px is larger than the biggest
 * place the picture is ever drawn, and WebP at 0.82 puts a face under 60 kB.
 * The bucket's own 2 MB ceiling is the backstop for a client that skips this.
 *
 * WHY A RANDOM FILENAME rather than "<account>/avatar.webp": replacing a
 * picture at a fixed path leaves the old bytes in every cache that has already
 * seen them, and the new face silently does not appear. A fresh name per
 * upload cannot be stale. The previous object is removed afterwards, and a
 * failure to remove it leaves an orphan nobody can see rather than a wrong
 * face somebody can.
 */
import { getSupabase } from "@/lib/supabase/client";

export const AVATAR_BUCKET = "avatars";

/** An hour. Long enough for a session on a screen, short enough that a link
 *  copied out of the network tab is not a permanent handle on someone's face. */
const SIGNED_FOR = 3600;

/** Larger than the biggest place the picture is drawn (96px, at 3x). */
const MAX_EDGE = 512;

/**
 * The fallback, and the reason a row with no picture is the same shape as a
 * row with one: initials in a chip, never an empty circle that collapses.
 *
 * ONE tint for everybody, deliberately. A hashed colour per person would make
 * the list read as five categories that mean nothing -- and the name is
 * already there, so the chip is texture, not identification. (The fixed
 * palette rule in CLAUDE.md is about PROJECT colours on the calendar, where
 * telling two sites apart without reading is the entire job.)
 */
export function initials(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0].replace(/[._-]+/g, " ");
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Sign many paths at once.
 *
 * Returns a map from path to URL. A path that cannot be signed -- the object
 * was removed, or the policy declines it -- is simply absent, and the caller
 * draws initials. A missing picture is never an error worth a red panel.
 */
export async function signAvatars(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;

  const { data, error } = await getSupabase()
    .storage.from(AVATAR_BUCKET)
    .createSignedUrls(wanted, SIGNED_FOR);

  if (error || !data) return out;
  for (const row of data) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** One path. The same thing, for the screens that only ever draw one face. */
export async function signAvatar(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  return (await signAvatars([path])).get(path) ?? null;
}

/**
 * Downscale to a square that covers MAX_EDGE, centred.
 *
 * imageOrientation: "from-image" so a portrait photo taken on a phone is not
 * drawn on its side -- the EXIF rotation is applied by the decoder, which is
 * the only place that still knows about it once we are on a canvas.
 */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const edge = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(MAX_EDGE, edge);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte behandla bilden.");

  // Centre crop: the interesting part of a photograph of a person is the
  // middle, and a face squashed into a square is worse than one trimmed.
  ctx.drawImage(
    bitmap,
    (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge,
    0, 0, size, size,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!blob) throw new Error("Kunde inte behandla bilden.");
  return blob;
}

/**
 * Put a new face on an account and record where it went.
 *
 * Returns the new path. The profile row is upserted rather than updated: a
 * profile exists the moment somebody first saves one, and uploading a picture
 * is a first save like any other.
 */
export async function uploadAvatar(accountId: string, file: File, previous: string | null) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Filen är inte en bild.");
  }

  const blob = await toSquareWebp(file);
  const path = `${accountId}/${crypto.randomUUID()}.webp`;
  const sb = getSupabase();

  const { error: upErr } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (upErr) throw upErr;

  const { error: rowErr } = await sb
    .from("profile")
    .upsert({ account_id: accountId, avatar_path: path } as never, { onConflict: "account_id" });
  if (rowErr) {
    // The row is what the app reads. An object nothing points at is litter;
    // an object the row points at that nobody may read is a broken screen.
    await sb.storage.from(AVATAR_BUCKET).remove([path]);
    throw rowErr;
  }

  // Best effort, and last. If this fails the visible result is still correct.
  if (previous && previous !== path) {
    await sb.storage.from(AVATAR_BUCKET).remove([previous]);
  }

  return path;
}

/** Take the face off again. The row first, for the reason above. */
export async function removeAvatar(accountId: string, previous: string | null) {
  const sb = getSupabase();
  const { error } = await sb
    .from("profile")
    .upsert({ account_id: accountId, avatar_path: null } as never, { onConflict: "account_id" });
  if (error) throw error;
  if (previous) await sb.storage.from(AVATAR_BUCKET).remove([previous]);
}
