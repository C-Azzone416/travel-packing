import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Self-hosted Field Ledger fonts (#182): the files are committed with their licences, nothing is fetched from Google at
// build time, and the families, weights and display setting are the ones the design uses.

interface LocalFontOptions {
  src: { path: string; weight: string; style: string }[];
  display: string;
  variable: string;
  adjustFontFallback: string;
}
const calls = vi.hoisted(() => [] as unknown[]);
vi.mock("next/font/local", () => ({
  default: (options: { variable: string }) => {
    calls.push(options);
    return { variable: `class-for${options.variable}` };
  },
}));

const APP = join(process.cwd(), "src", "app");
const FILES = join(APP, "font-files");

let loaded: LocalFontOptions[];
let classNames: string;
beforeAll(async () => {
  ({ fontClassNames: classNames } = await import("./fonts"));
  loaded = calls as LocalFontOptions[];
});

describe("the font setup", () => {
  it("declares three families through next/font/local, each with swap display and its own CSS variable", () => {
    expect(loaded.map((font) => font.variable)).toEqual([
      "--font-body",
      "--font-display",
      "--font-serif",
    ]);
    for (const font of loaded) expect(font.display).toBe("swap");
    expect(classNames).toBe("class-for--font-body class-for--font-display class-for--font-serif");
  });

  it("keeps the weights and styles the design uses: Barlow 400/500/600/700, Bricolage 700-800, Literata italic 400", () => {
    const [body, display, serif] = loaded;
    expect(body.src.map((face) => [face.weight, face.style])).toEqual([
      ["400", "normal"],
      ["500", "normal"],
      ["600", "normal"],
      ["700", "normal"],
    ]);
    expect(display.src.map((face) => [face.weight, face.style])).toEqual([["700 800", "normal"]]);
    expect(serif.src.map((face) => [face.weight, face.style])).toEqual([["400", "italic"]]);
  });

  it("matches the metric fallback to each family's kind: sans for Barlow and Bricolage, serif for Literata", () => {
    expect(loaded.map((font) => font.adjustFontFallback)).toEqual([
      "Arial",
      "Arial",
      "Times New Roman",
    ]);
  });

  it("points only at files that exist, and every font file in the folder is used", () => {
    const used = loaded.flatMap((font) => font.src.map((face) => face.path));
    for (const path of used) {
      expect(path.startsWith("./font-files/"), path).toBe(true);
      expect(existsSync(join(APP, path)), path).toBe(true);
    }
    const onDisk = readdirSync(FILES).filter((name) => name.endsWith(".woff2"));
    expect(new Set(used.map((path) => path.replace("./font-files/", "")))).toEqual(new Set(onDisk));
  });
});

describe("the committed files", () => {
  const fonts = readdirSync(FILES).filter((name) => name.endsWith(".woff2"));

  it.each(fonts)("%s is a real woff2 file of a sensible size", (name) => {
    const buffer = readFileSync(join(FILES, name));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(statSync(join(FILES, name)).size).toBeGreaterThan(5_000);
    expect(statSync(join(FILES, name)).size).toBeLessThan(120_000);
  });

  const LICENCES = [
    ["OFL-barlow.txt", "Barlow"],
    ["OFL-bricolage-grotesque.txt", "Bricolage Grotesque"],
    ["OFL-literata.txt", "Literata"],
  ] as const;

  it.each(LICENCES)(
    "%s is the SIL Open Font License 1.1 for %s, with its copyright line",
    (file, family) => {
      const text = readFileSync(join(FILES, file), "utf8");
      expect(text.split("\n")[0]).toMatch(
        new RegExp(`^Copyright \\d{4} The ${family} Project Authors`),
      );
      expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
      expect(text).toContain("PERMISSION & CONDITIONS");
    },
  );

  it("every family that has font files has a licence file next to them", () => {
    for (const family of ["barlow", "bricolage-grotesque", "literata"])
      expect(
        fonts.some((name) => name.startsWith(family)),
        family,
      ).toBe(true);
    for (const [file] of LICENCES) expect(existsSync(join(FILES, file)), file).toBe(true);
  });

  it("documents where they came from and the licence", () => {
    const readme = readFileSync(join(FILES, "README.md"), "utf8");
    expect(readme).toMatch(/SIL Open Font License 1\.1/);
    expect(readme).toMatch(/github\.com\/google\/fonts/);
  });
});

describe("no network fetch for fonts at build time", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(tsx?|css|mjs|json)$/.test(entry.name) ? [path] : [];
    });
  }

  it("nothing in src imports the Google fonts loader or names fonts.googleapis.com", () => {
    const loader = ["next", "font", "google"].join("/");
    const host = ["fonts", "googleapis", "com"].join(".");
    const offenders = sources(join(process.cwd(), "src"))
      .filter((path) => !path.endsWith("fonts.test.ts"))
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return text.includes(loader) || text.includes(host);
      });
    expect(offenders).toEqual([]);
  });
});
