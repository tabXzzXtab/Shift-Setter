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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SOURCE = "favicon and icon/icon.png";
const OUT = "public";

/** name -> pixel size. 0 would mean 256 in an .ico; nothing here is that big. */
const SIZES = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "apple-touch-icon.png": 180,
  "favicon-32.png": 32,
  "favicon-16.png": 16,
};

/**
 * The Apple touch icon is composited onto the ground colour.
 *
 * iOS ignores transparency and paints whatever is behind it black, so a
 * transparent PNG becomes a dark square on the home screen. #f3f6fd is the
 * app's own ground, which is what the icon was drawn against.
 */
const APPLE_BG = { r: 0xf3, g: 0xf6, b: 0xfd, alpha: 1 };

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

// The source, unresized, for anything that wants the full-resolution mark.
await writeFile(path.join(OUT, "icon.png"), await readFile(SOURCE));

for (const [name, size] of Object.entries(SIZES)) {
  let pipe = sharp(SOURCE).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (name === "apple-touch-icon.png") pipe = pipe.flatten({ background: APPLE_BG });
  await pipe.png().toFile(path.join(OUT, name));
  console.log(`  ${name.padEnd(22)} ${size}x${size}`);
}

const entries = await Promise.all(
  [32, 16].map(async (size) => ({
    size,
    data: await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  })),
);
await writeFile(path.join(OUT, "favicon.ico"), ico(entries));
console.log(`  favicon.ico            ${entries.map((e) => e.size).join(" + ")}`);
