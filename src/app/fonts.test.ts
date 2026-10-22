import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Self-hosted Field Ledger fonts (#182): the files are committed with their licences, nothing is fetched from Google at
// build time, and the families, weights and display setting are the ones the design uses.

interface LocalFontOptions {
  src: { path: string; weight: string; style: string }[];
  display: string;
  variable: string;
  adjustFontFallback: string | false;
  preload?: boolean;
  declarations?: { prop: string; value: string }[];
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

const GLOBALS = readFileSync(join(APP, "globals.css"), "utf8");

describe("the font setup", () => {
  const byVariable = (variable: string) =>
    loaded.find((font) => font.variable === variable) as LocalFontOptions;

  it("declares each family through next/font/local with swap display and its own CSS variable", () => {
    expect(loaded.map((font) => font.variable)).toEqual([
      "--font-body-latin",
      "--font-body-ext",
      "--font-display-latin",
      "--font-display-ext",
      "--font-serif",
    ]);
    for (const font of loaded) expect(font.display).toBe("swap");
    expect(classNames.split(" ")).toEqual(loaded.map((font) => `class-for${font.variable}`));
  });

  it("keeps the weights and styles the design uses: Barlow 400/500/600/700, Bricolage 700-800, Literata italic 400", () => {
    for (const subset of ["latin", "ext"]) {
      expect(
        byVariable(`--font-body-${subset}`).src.map((face) => [face.weight, face.style]),
      ).toEqual([
        ["400", "normal"],
        ["500", "normal"],
        ["600", "normal"],
        ["700", "normal"],
      ]);
      expect(
        byVariable(`--font-display-${subset}`).src.map((face) => [face.weight, face.style]),
      ).toEqual([["700 800", "normal"]]);
    }
    expect(byVariable("--font-serif").src.map((face) => [face.weight, face.style])).toEqual([
      ["400", "italic"],
    ]);
  });

  it("lists the latin-ext faces after latin in one stack, so a page of plain Latin text never fetches latin-ext", () => {
    // The ext families are not preloaded; the stack puts them after the latin family and before the fallback.
    expect(byVariable("--font-body-latin").preload).toBeUndefined();
    // The ext faces carry Google's latin-ext unicode-range, so a symbol the latin face lacks (✓ ← ⌂) never fetches them.
    for (const variable of ["--font-body-ext", "--font-display-ext"]) {
      const range =
        byVariable(variable).declarations?.find((entry) => entry.prop === "unicode-range")?.value ??
        "";
      expect(range, variable).toMatch(/^U\+0100-02BA, /);
      expect(range, variable).toContain("U+1E00-1E9F");
      for (const code of ["U+2713", "U+2190", "U+2302", "U+FF0B"])
        expect(range).not.toContain(code);
    }
    for (const variable of ["--font-body-latin", "--font-display-latin"])
      expect(byVariable(variable).declarations, variable).toBeUndefined();
    expect(byVariable("--font-body-ext").preload).toBe(false);
    expect(byVariable("--font-display-ext").preload).toBe(false);
    expect(GLOBALS).toMatch(
      /--font-body: var\(--font-body-latin\), var\(--font-body-ext\), "Barlow Fallback";/,
    );
    expect(GLOBALS).toMatch(
      /--font-display:\s*var\(--font-display-latin\), var\(--font-display-ext\), "Bricolage Grotesque Fallback";/,
    );
  });

  it("uses no generated fallback inside the composed families, which would draw ł and ń before latin-ext", () => {
    for (const variable of [
      "--font-body-latin",
      "--font-body-ext",
      "--font-display-latin",
      "--font-display-ext",
    ])
      expect(byVariable(variable).adjustFontFallback, variable).toBe(false);
    expect(byVariable("--font-serif").adjustFontFallback).toBe("Times New Roman");
  });

  it("declares the two hand-written fallbacks the stacks end in, metric-matched Arial", () => {
    for (const family of ["Barlow Fallback", "Bricolage Grotesque Fallback"]) {
      const block =
        GLOBALS.match(new RegExp(`@font-face \\{\\s*font-family: "${family}";([^}]*)\\}`))?.[1] ??
        "";
      expect(block, family).toContain('src: local("Arial")');
      for (const property of [
        "ascent-override",
        "descent-override",
        "line-gap-override",
        "size-adjust",
      ])
        expect(block, `${family} ${property}`).toContain(property);
    }
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
