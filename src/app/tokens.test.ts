import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPEARANCES } from "../domain/appearance";

// The Field Ledger role-token contract (#139 spec §1-§2, #142): all four themes define the identical role set, the
// semantic colours are not themed, and no component or stylesheet outside the token file references a colour literal.

const root = process.cwd();
const tokensCss = readFileSync(join(root, "src/app/ledger-tokens.css"), "utf8");
const globalsCss = readFileSync(join(root, "src/app/globals.css"), "utf8");
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The spec's role map (§1). A theme must define every one of these and nothing else. */
const ROLE_TOKENS = [
  "--bg", "--surface", "--ink", "--muted", "--line", "--line-strong", "--accent", "--link", "--accent-2",
  "--header", "--header-ink", "--header-muted", "--focus-on-header",
  "--action", "--action-ink", "--action-border", "--progress", "--track",
  "--notice", "--notice-ink", "--weather-pill", "--weather-pill-ink", "--complete", "--complete-ink",
  "--control-bg", "--popover", "--selection-surface", "--status-surface", "--detail-surface",
  "--weather-surface", "--ledger-rule", "--ledger-shadow",
].sort(); // prettier-ignore
const SEMANTIC_TOKENS = ["--danger", "--warn", "--success"];

interface Rule {
  selector: string;
  decls: Record<string, string>;
}
function rules(css: string): Rule[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, " "),
    decls: Object.fromEntries(
      [...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]),
    ),
  }));
}
const themeRule = (id: string) =>
  rules(tokensCss).find((rule) => rule.selector.includes(`:root[data-appearance="${id}"]`));

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Field Ledger role tokens", () => {
  it("has one rule per theme, and Base is also the default with no attribute", () => {
    for (const id of APPEARANCES) expect(themeRule(id), id).toBeTruthy();
    expect(
      themeRule("base")
        ?.selector.split(",")
        .map((s) => s.trim()),
    ).toContain(":root");
  });

  it.each(APPEARANCES)("%s defines exactly the spec's role-token set", (id) => {
    expect(Object.keys(themeRule(id)?.decls ?? {}).sort()).toEqual(ROLE_TOKENS);
  });

  it("every theme can also be scoped to a swatch with data-theme-preview", () => {
    for (const id of APPEARANCES) {
      expect(themeRule(id)?.selector).toContain(`[data-theme-preview="${id}"]`);
    }
  });

  it("gives each theme its own values (no theme is a copy of another)", () => {
    const accents = APPEARANCES.map((id) => themeRule(id)?.decls["--accent"]);
    expect(new Set(accents).size).toBe(APPEARANCES.length);
  });

  it("does not theme danger, warn or success: they are defined once, outside every theme", () => {
    for (const id of APPEARANCES) {
      for (const token of SEMANTIC_TOKENS) expect(themeRule(id)?.decls[token]).toBeUndefined();
    }
    const semantic = rules(tokensCss).find(
      (rule) => rule.selector === ":root" && "--danger" in rule.decls,
    );
    for (const token of SEMANTIC_TOKENS) expect(semantic?.decls[token]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("every var(--x) in the stylesheet resolves to a defined token", () => {
    const defined = new Set<string>(["--font-body", "--font-display", "--font-serif"]);
    for (const css of [tokensCss, globalsCss]) {
      for (const m of stripCssComments(css).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    const used = [...stripCssComments(globalsCss).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it.each(APPEARANCES)("%s keeps the contrast the spec's ◆ values were adjusted for", (id) => {
    const t = themeRule(id)?.decls ?? {};
    expect(contrast(t["--muted"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--muted"], t["--surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--link"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--link"], t["--surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--action-ink"], t["--action"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--ink"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--accent-2"], t["--surface"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--accent-2"], t["--bg"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--focus-on-header"], t["--header"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--progress"], t["--track"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--line-strong"], t["--surface"])).toBeGreaterThanOrEqual(3);
  });

  it("the focus ring is a solid 3px --accent-2 outline with a 3px offset", () => {
    expect(stripCssComments(globalsCss)).toMatch(
      /:focus-visible\s*{\s*outline:\s*3px solid var\(--accent-2\);\s*outline-offset:\s*3px;/,
    );
  });

  it("honors reduced motion", () => {
    expect(globalsCss).toContain("prefers-reduced-motion: reduce");
  });
});

// A colour literal: #rgb[a] / #rrggbb[aa] (a bare issue number like #119 is not one), rgb()/rgba()/hsl().
const COLOR_LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|(?=[0-9a-f]{3,4}\b)[0-9a-f]*[a-f][0-9a-f]*)\b|\b(?:rgba?|hsla?)\(/i;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(tsx|css)$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(path);
  }
  return found;
}

describe("no colour literals outside the token file", () => {
  const stripped = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("globals.css binds to roles only", () => {
    expect(stripCssComments(globalsCss).match(COLOR_LITERAL)).toBeNull();
  });

  it("no component or feature stylesheet or .tsx file references a hex or rgb()", () => {
    const offenders = [
      ...sourceFiles(join(root, "src/components")),
      ...sourceFiles(join(root, "src/features")),
    ].filter((path) => COLOR_LITERAL.test(stripped(path)));
    expect(offenders).toEqual([]);
  });
});
