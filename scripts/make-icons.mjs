#!/usr/bin/env node
/**
 * Generate the favicon and PWA icon set from one square source.
 *
 *   node scripts/make-icons.mjs
 *
 * Run when the brand icon changes, not on every build: the outputs are
 * committed, because a static export has no image pipeline and GitHub Pages
 * serves whatever is in out/ verbatim.
 *
 * sharp is already a dependency of Next, so nothing new is installed for this.
 *
 * THE .ICO IS ASSEMBLED HERE rather than by a library. The format is a 6-byte
 * header, one 16-byte directory entry per image, then the images themselves --
 * and PNG-compressed entries have been valid since Vista, so the two PNGs are
 * embedded as they are. That is a dozen lines against a dependency whose only
 * job is those dozen lines.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Ikon 1 · Platt (owner, 2026-10-23). Kept OUT of the repo, like the brand
// images before it -- only what it produces in public/ is committed.
const SOURCE = "App Icon/Ikon 1 · Platt.png";
const OUT = "public";

/**
 * TWO SHAPES FROM ONE DRAWING.
 *
 * The source is the clock on its own pale rounded tile, with a transparent
 * margin and a soft shadow around the tile. Used as it is on a home screen,
 * iOS paints the transparent margin black and rounds the corners itself --
 * a pale tile inside a black square -- and Android shrinks it onto a white
 * plate. So:
 *
 *   TILE  the tile cut out exactly, its hairline border dropped and every
 *         pixel opaque. The phone's own corner mask then lands on the tile's
 *         edge. Home screen, PWA manifest (also as maskable: the clock is
 *         ~62% of the tile, inside Android's 80% safe zone), and icon.png.
 *   MARK  the orange clock face alone, on transparent. The browser tab: at
 *         16 px the pale tile would take half the square and leave the clock
 *         a smudge.
 */
const TILE_SIZES = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "apple-touch-icon.png": 180,
  "icon.png": 1024,
};
const MARK_SIZES = { "favicon-32.png": 32, "favicon-16.png": 16 };

/** Measured off the source: the tile is opaque from 76 to 1099 on both axes. */
const TILE = { left: 76, top: 76, size: 1024 };
/** The tile's own fill at its edge, for everything outside its rounded shape. */
const BG = [255, 254, 253];
/** How far in from the opaque edge the hairline border reaches. */
const BORDER = 4;

async function load() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

/** The tile: opaque, border gone, corners in the tile's own colour. */
async function tile({ data, W, H }) {
  // Inside = fully opaque, then eroded BORDER px to drop the hairline ring.
  let inside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inside[i] = data[i * 4 + 3] === 255 ? 1 : 0;
  for (let k = 0; k < BORDER; k++) {
    const next = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      next[i] = inside[i] && inside[i - 1] && inside[i + 1] && inside[i - W] && inside[i + W] ? 1 : 0;
    }
    inside = next;
  }
  const out = Buffer.alloc(TILE.size * TILE.size * 3);
  for (let y = 0; y < TILE.size; y++) for (let x = 0; x < TILE.size; x++) {
    const sx = x + TILE.left, sy = y + TILE.top, si = (sy * W + sx), o = (y * TILE.size + x) * 3;
    const src = inside[si] ? [data[si * 4], data[si * 4 + 1], data[si * 4 + 2]] : BG;
    out[o] = src[0]; out[o + 1] = src[1]; out[o + 2] = src[2];
  }
  return sharp(out, { raw: { width: TILE.size, height: TILE.size, channels: 3 } }).png().toBuffer();
}

/** The clock face alone: a disc cut from the source, edge antialiased. */
async function mark({ data, W }) {
  const cy = Math.round(TILE.top + TILE.size / 2) - 1;
  // The orange's extent along the centre row gives the centre and radius.
  const orange = (x) => { const i = (cy * W + x) * 4; return data[i + 3] === 255 && data[i] > 200 && data[i + 1] < 160 && data[i + 2] < 120; };
  let l = 0; while (!orange(l)) l++;
  let r = W - 1; while (!orange(r)) r--;
  const cx = (l + r) / 2, R = (r - l + 1) / 2;
  const half = Math.ceil(R) + 2, size = half * 2, x0 = Math.round(cx) - half, y0 = Math.round(cy) - half;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = x0 + x, sy = y0 + y, si = (sy * W + sx) * 4, o = (y * size + x) * 4;
    const d = Math.hypot(sx + 0.5 - (cx + 0.5), sy + 0.5 - (cy + 0.5));
    const a = Math.max(0, Math.min(1, R - d));
    out[o] = data[si]; out[o + 1] = data[si + 1]; out[o + 2] = data[si + 2]; out[o + 3] = Math.round(a * 255);
  }
  console.log(`  clock face: centre ${cx.toFixed(1)},${cy}  radius ${R.toFixed(1)}`);
  return sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0);                 // width
    e.writeUInt8(size, 1);                 // height
    e.writeUInt8(0, 2);                    // palette size, 0 for truecolour
    e.writeUInt8(0, 3);                    // reserved
    e.writeUInt16LE(1, 4);                 // colour planes
    e.writeUInt16LE(32, 6);                // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir(OUT, { recursive: true });

const src = await load();
const tilePng = await tile(src);
const markPng = await mark(src);

for (const [name, size] of Object.entries(TILE_SIZES)) {
  await sharp(tilePng).resize(size, size).png().toFile(path.join(OUT, name));
  console.log(`  ${name.padEnd(22)} ${size}x${size}  tile`);
}
for (const [name, size] of Object.entries(MARK_SIZES)) {
  await sharp(markPng).resize(size, size).png().toFile(path.join(OUT, name));
  console.log(`  ${name.padEnd(22)} ${size}x${size}  clock face`);
}

const entries = await Promise.all(
  [32, 16].map(async (size) => ({ size, data: await sharp(markPng).resize(size, size).png().toBuffer() })),
);
await writeFile(path.join(OUT, "favicon.ico"), ico(entries));
console.log(`  favicon.ico            ${entries.map((e) => e.size).join(" + ")}  clock face`);
