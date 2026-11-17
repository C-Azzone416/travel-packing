import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The favicon set (#492): Next.js app-router file conventions in src/app, no manifest, no metadata.icons.
const app = join(process.cwd(), "src/app");
const read = (name: string) => readFileSync(join(app, name));

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
