"use client";

import { getSupabase } from "@/lib/supabase/client";

/**
 * The company's logo: putting one there, showing it back, taking it away.
 *
 * THE READ SIDE IS NOT HERE. src/lib/doc/sender.ts downloads the bytes for the
 * Arbetsdagbok and belongs to the document; this is the screen's half. They
 * share a bucket and nothing else, deliberately -- one uploads and one embeds,
 * and merging them would put a file picker in the generator's import graph.
 *
 * TWO FILENAMES, NOT A UUID. The storage policies admit `logo.png` and
 * `logo.jpg` under the tenancy's own folder and nothing else, and
 * tenant_branding.logo_path is checked against exactly those two. A fresh name
 * per upload -- which is what avatar.ts does, and what I reached for first --
 * is refused by the policy rather than by anything this file could see.
 *
 * The cost of fixed names is that replacing a PNG with a JPEG leaves the old
 * PNG behind under the other name, so both are removed before either is
 * written.
 */

export const BRANDING_BUCKET = "branding";

/** The longest side a logo is stored at. */
const MAX_EDGE = 1200;

/** The bucket's own ceiling. Anything above it is refused by storage. */
const MAX_BYTES = 1024 * 1024;

/**
 * Whatever was picked, as something the document can embed.
 *
 * PNG FIRST, JPEG ONLY IF IT HAS TO BE. pdf-lib embeds PNG and JPEG and
 * nothing else, and the bucket admits the same two -- so a .webp or a .heic
 * off a phone has to become one of them here or it is refused on upload with
 * a message about MIME types that means nothing to the person holding the
 * phone. Drawing it through a canvas converts anything the browser can decode.
 *
 * A logo is flat colour and PNG suits it, but a photographic one can exceed a
 * megabyte as PNG while fitting easily as JPEG. So PNG is tried, and JPEG is
 * the fallback rather than the default -- the transparency matters more often
 * than the bytes do.
 *
 * Aspect ratio is kept. avatar.ts squares its input because a face in a circle
 * is a face; squaring a wordmark makes it a different logo.
 */
async function toEmbeddable(file: File): Promise<{ blob: Blob; ext: "png" | "jpg" }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Filen är inte en bild som går att läsa.");

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte behandla bilden.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const draw = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  const png = await draw("image/png");
  if (png && png.size <= MAX_BYTES) return { blob: png, ext: "png" };

  // Below the ceiling as a JPEG, or not storable at all -- said plainly rather
  // than left to storage to refuse in English.
  const jpg = await draw("image/jpeg", 0.9);
  if (jpg && jpg.size <= MAX_BYTES) return { blob: jpg, ext: "jpg" };

  throw new Error("Bilden är för stor. Välj en mindre logotyp.");
}

/** A URL the browser can show. Null when there is no logo, or it cannot be read. */
export async function signLogo(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await getSupabase()
    .storage.from(BRANDING_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/**
 * Put a logo on the company and record where it went.
 *
 * THE ROW IS WRITTEN LAST AND THE OBJECT IS CLEANED UP IF IT FAILS, the same
 * ordering avatar.ts settled on: the row is what every reader goes through, so
 * an object nothing points at is litter, while a row pointing at an object
 * nobody may read is a broken document.
 */
export async function uploadLogo(tenantId: string, file: File): Promise<string> {
  const { blob, ext } = await toEmbeddable(file);
  const path = `${tenantId}/logo.${ext}`;
  const sb = getSupabase();

  // Both names first. The policy allows exactly two, so a JPEG replacing a PNG
  // would otherwise leave the PNG behind -- unreferenced, unreadable by the
  // screen, and still counting against the company's storage.
  await sb.storage
    .from(BRANDING_BUCKET)
    .remove([`${tenantId}/logo.png`, `${tenantId}/logo.jpg`]);

  const { error: upErr } = await sb.storage
    .from(BRANDING_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: true });
  if (upErr) throw upErr;

  const { error: rowErr } = await sb
    .from("tenant_branding")
    .upsert({ tenant_id: tenantId, logo_path: path }, { onConflict: "tenant_id" });
  if (rowErr) {
    await sb.storage.from(BRANDING_BUCKET).remove([path]);
    throw rowErr;
  }

  return path;
}

/**
 * Take the logo off again.
 *
 * The row first, for the reason above. tenant_branding has no DELETE -- the
 * company still exists and still has an address -- so this nulls the column
 * rather than removing the row.
 */
export async function removeLogo(tenantId: string, previous: string | null): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("tenant_branding")
    .upsert({ tenant_id: tenantId, logo_path: null }, { onConflict: "tenant_id" });
  if (error) throw error;
  if (previous) await sb.storage.from(BRANDING_BUCKET).remove([previous]);
}
