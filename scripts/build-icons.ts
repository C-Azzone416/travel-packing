/**
 * Run `npm run icons:build` to rebuild the app icons, or pass `--out <dir>` for a proof copy.
 * The 16 px favicon omits the two interior suitcase straps so the glyph stays legible. The Apple
 * icon uses a square, stroke-free tile rendered at 144 px on a full-bleed 180 px Ocean canvas.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDirectory = join(root, "src/app");
const ocean = "#142b3b";
const faviconSizes = [16, 32, 48] as const;
const straps = '    <path d="M10.5 14 V23 M21.5 14 V23" />\n';
const roundedTile = '  <rect class="tile" x="0.5" y="0.5" width="31" height="31" rx="6.5" />';
const appleTile = '  <rect class="tile" x="0" y="0" width="32" height="32" style="stroke:none" />';

function replaceRequired(source: string, search: string, replacement: string) {
  if (!source.includes(search)) {
    throw new Error(`icon.svg no longer contains the expected fragment: ${search.trim()}`);
  }
  return source.replace(search, replacement);
}

async function renderFavicon(svg: string, size: (typeof faviconSizes)[number]) {
  const source = size === 16 ? replaceRequired(svg, straps, "") : svg;
  const { data, info } = await sharp(Buffer.from(source))
    .resize(size, size)
    .flatten({ background: ocean })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(`Unexpected ${size} px favicon render: ${JSON.stringify(info)}`);
  }
  return data;
}

function encodeDib(raw: Buffer, size: number) {
  const xorBytes = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskBytes = maskRowBytes * size;
  const dib = Buffer.alloc(40 + xorBytes + maskBytes);

  dib.writeUInt32LE(40, 0); // BITMAPINFOHEADER
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8); // ICO height includes the XOR image and AND mask.
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(xorBytes + maskBytes, 20);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = ((size - 1 - y) * size + x) * 4;
      const target = 40 + (y * size + x) * 4;
      dib[target] = raw[source + 2]; // BGRA, bottom row first.
      dib[target + 1] = raw[source + 1];
      dib[target + 2] = raw[source];
      dib[target + 3] = raw[source + 3];
    }
  }

  return dib; // Buffer.alloc leaves the 1-bit AND mask transparent bits cleared.
}

async function buildFavicon(svg: string) {
  const dibs = await Promise.all(
    faviconSizes.map(async (size) => encodeDib(await renderFavicon(svg, size), size)),
  );
  const directoryBytes = 6 + faviconSizes.length * 16;
  const ico = Buffer.alloc(directoryBytes + dibs.reduce((sum, dib) => sum + dib.length, 0));
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(faviconSizes.length, 4);

  let offset = directoryBytes;
  dibs.forEach((dib, index) => {
    const entry = 6 + index * 16;
    ico[entry] = faviconSizes[index];
    ico[entry + 1] = faviconSizes[index];
    ico.writeUInt16LE(1, entry + 4);
    ico.writeUInt16LE(32, entry + 6);
    ico.writeUInt32LE(dib.length, entry + 8);
    ico.writeUInt32LE(offset, entry + 12);
    dib.copy(ico, offset);
    offset += dib.length;
  });
  return ico;
}

async function buildAppleIcon(svg: string) {
  const source = replaceRequired(svg, roundedTile, appleTile);
  return sharp(Buffer.from(source), { density: 405 })
    .resize(144, 144)
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: ocean })
    .png()
    .toBuffer();
}

export async function buildIcons(outputDirectory = appDirectory) {
  const svg = await readFile(join(appDirectory, "icon.svg"), "utf8");
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, "favicon.ico"), await buildFavicon(svg)),
    writeFile(join(outputDirectory, "apple-icon.png"), await buildAppleIcon(svg)),
  ]);
}

function outputDirectory(args: string[]) {
  if (args.length === 0) return appDirectory;
  if (args.length === 2 && args[0] === "--out" && args[1]) return resolve(args[1]);
  throw new Error("Usage: npm run icons:build -- [--out <dir>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildIcons(outputDirectory(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
