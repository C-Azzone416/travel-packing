import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildIcons } from "../../scripts/build-icons";

// The favicon set (#492): Next.js app-router file conventions in src/app, no manifest, no metadata.icons.
const app = join(process.cwd(), "src/app");
const read = (name: string) => readFileSync(join(app, name));

function icoEntries(ico: Buffer) {
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + 16 * index;
    const size = ico[entry];
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const dib = ico.subarray(offset, offset + length);
    const raw = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const source = 40 + ((size - 1 - y) * size + x) * 4;
        const target = (y * size + x) * 4;
        raw[target] = dib[source + 2];
        raw[target + 1] = dib[source + 1];
        raw[target + 2] = dib[source];
        raw[target + 3] = dib[source + 3];
      }
    }
    return { size, dib, raw };
  });
}

function maxChannelDelta(actual: Buffer, expected: Buffer) {
  expect(actual.length).toBe(expected.length);
  let max = 0;
  for (let index = 0; index < actual.length; index += 1) {
    max = Math.max(max, Math.abs(actual[index] - expected[index]));
  }
  return max;
}

describe("favicon set files", () => {
  it.each(["icon.svg", "favicon.ico", "apple-icon.png"])("%s exists in src/app", (name) => {
    expect(existsSync(join(app, name))).toBe(true);
  });

  it("icon.svg is the master: a 32px SVG with the Ocean tile, the glyph and the gold latch", () => {
    const svg = read("icon.svg").toString();
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain("#142b3b"); // Ocean --dark tile
    expect(svg).toContain("#fff8eb"); // --onDark glyph
    expect(svg).toContain("#d7c095"); // --gold latch
    // Dark browser strips: the tile and glyph swap, the gold latch does not.
    expect(svg).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(svg).not.toMatch(/<(script|foreignObject|image|text)\b/);
  });

  it("favicon.ico carries 16, 32 and 48 px entries, each a 32-bit BMP (DIB) image", () => {
    const ico = read("favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(3); // three images
    const entries = [0, 1, 2].map((i) => {
      const e = 6 + 16 * i;
      const length = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      return {
        size: ico[e],
        bpp: ico.readUInt16LE(e + 6),
        dib: ico.subarray(offset, offset + length),
      };
    });
    expect(entries.map((entry) => entry.size)).toEqual([16, 32, 48]);
    for (const { size, bpp, dib } of entries) {
      expect(bpp).toBe(32);
      expect(dib.readUInt32LE(0)).toBe(40); // BITMAPINFOHEADER
      expect(dib.readInt32LE(4)).toBe(size); // width
      expect(dib.readInt32LE(8)).toBe(size * 2); // height includes the AND mask
      expect(dib.readUInt16LE(14)).toBe(32); // bits per pixel
    }
  });

  it("apple-icon.png is a 180x180 PNG", () => {
    const png = read("apple-icon.png");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });
});

describe("favicon generator", () => {
  const output = mkdtempSync(join(tmpdir(), "travel-packing-icons-"));

  beforeAll(() => buildIcons(output));
  afterAll(() => rmSync(output, { recursive: true, force: true }));

  it("rebuilds every 32-bit BMP favicon entry pixel-identically", () => {
    const generated = icoEntries(readFileSync(join(output, "favicon.ico")));
    const committed = icoEntries(read("favicon.ico"));
    expect(generated.map(({ size }) => size)).toEqual([16, 32, 48]);
    expect(generated).toHaveLength(committed.length);

    generated.forEach(({ size, dib, raw }, index) => {
      expect(dib.readUInt32LE(0)).toBe(40);
      expect(dib.readInt32LE(4)).toBe(size);
      expect(dib.readInt32LE(8)).toBe(size * 2);
      expect(dib.readUInt16LE(14)).toBe(32);
      expect(dib.length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
      expect(dib.subarray(40 + size * size * 4).every((byte) => byte === 0)).toBe(true);
      expect(maxChannelDelta(raw, committed[index].raw)).toBe(0);
    });
  });

  it("rebuilds the full-bleed 180 px Apple icon pixel-identically", async () => {
    const generated = await sharp(join(output, "apple-icon.png")).ensureAlpha().raw().toBuffer();
    const committed = await sharp(join(app, "apple-icon.png")).ensureAlpha().raw().toBuffer();
    expect(maxChannelDelta(generated, committed)).toBe(0);
  });
});
