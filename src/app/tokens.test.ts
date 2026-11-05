import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPEARANCES } from "../domain/appearance";

// The Suitcase colour schemes (#380): tokens.css from the design files, verbatim, in scheme-tokens.css. All three schemes
// define the identical palette token set; the older role names that screens still use are aliases onto it; the semantic
// colours are not themed; and no component or stylesheet outside the token file references a colour literal.

const root = process.cwd();
const tokensCss = readFileSync(join(root, "src/app/scheme-tokens.css"), "utf8");
const typeScaleCss = readFileSync(join(root, "src/app/type-scale.css"), "utf8");
const globalsCss = readFileSync(join(root, "src/app/globals.css"), "utf8");
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The palette: exactly the custom properties tokens.css defines in every scheme block. */
const PALETTE_TOKENS = [
  "--dark", "--dark2", "--darkEdge", "--ink", "--muted", "--line", "--line2", "--page", "--paper", "--paper2", "--tint",
  "--accent", "--accentSoft", "--gold", "--goldDeep", "--goldSoft", "--good", "--info", "--onDark", "--onDarkMuted",
  "--ghost", "--sea", "--seaLine", "--coast",
].sort(); // prettier-ignore
/** Role names the pre-redesign screens bind to; each is an alias onto the palette, defined once on :root. */
const ROLE_ALIASES = [
  "--bg", "--surface", "--line-strong", "--link", "--accent-2", "--header", "--header-ink", "--header-muted",
  "--focus-on-header", "--action", "--action-ink", "--action-border", "--progress", "--track", "--notice", "--notice-ink",
  "--weather-pill", "--weather-pill-ink", "--complete", "--complete-ink", "--control-bg", "--popover",
  "--selection-surface", "--status-surface", "--detail-surface", "--weather-surface", "--ledger-rule", "--ledger-shadow",
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
const schemeRule = (id: string) =>
  rules(tokensCss).find((rule) =>
    rule.selector
      .split(",")
      .map((s) => s.trim())
      .includes(`[data-scheme="${id}"]`),
  );

describe("Suitcase colour schemes", () => {
  it("has one rule per scheme, and Ocean is also the default with no attribute", () => {
    for (const id of APPEARANCES) expect(schemeRule(id), id).toBeTruthy();
    expect(
      schemeRule("ocean")
        ?.selector.split(",")
        .map((s) => s.trim()),
    ).toContain(":root");
    for (const id of ["evergreen", "dusk"])
      expect(
        schemeRule(id)
          ?.selector.split(",")
          .map((s) => s.trim()),
      ).not.toContain(":root");
  });

  it.each(APPEARANCES)("%s defines exactly the palette token set", (id) => {
    expect(Object.keys(schemeRule(id)?.decls ?? {}).sort()).toEqual(PALETTE_TOKENS);
  });

  it("keeps the design's values verbatim (spot checks per scheme: dark, page, accent, onDark)", () => {
    const pick = (id: string) => {
      const d = schemeRule(id)?.decls ?? {};
      return [d["--dark"], d["--page"], d["--accent"], d["--onDark"]];
    };
    expect(pick("ocean")).toEqual(["#142b3b", "#dce5e5", "#b66c4d", "#fff8eb"]);
    expect(pick("evergreen")).toEqual(["#1f3a30", "#eeebe0", "#c0612f", "#f6f1e2"]);
    expect(pick("dusk")).toEqual(["#2f2d4f", "#efeaee", "#e06c55", "#fbf3ec"]);
  });

  it("gives each scheme its own values (no scheme is a copy of another)", () => {
    for (const token of PALETTE_TOKENS) {
      const values = APPEARANCES.map((id) => schemeRule(id)?.decls[token]);
      expect(new Set(values).size, token).toBeGreaterThan(1);
    }
  });

  it("defines the role aliases once, on :root, as references onto the palette", () => {
    const aliases = rules(tokensCss).find(
      (rule) => rule.selector === ":root" && "--bg" in rule.decls,
    );
    expect(Object.keys(aliases?.decls ?? {}).sort()).toEqual(ROLE_ALIASES);
    for (const [name, value] of Object.entries(aliases?.decls ?? {}))
      expect(value, name).toMatch(/var\(--/);
    // The colliding names are palette tokens, never aliases (spec #376: never let two files define --line).
    for (const name of ["--ink", "--muted", "--line", "--accent", "--paper"])
      expect(aliases?.decls[name], name).toBeUndefined();
  });

  it("does not theme danger, warn or success: they are defined once, outside every scheme", () => {
    for (const id of APPEARANCES) {
      for (const token of SEMANTIC_TOKENS) expect(schemeRule(id)?.decls[token]).toBeUndefined();
    }
    const semantic = rules(tokensCss).find(
      (rule) => rule.selector === ":root" && "--danger" in rule.decls,
    );
    for (const token of SEMANTIC_TOKENS) expect(semantic?.decls[token]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("no longer carries the Field Ledger themes or the old attribute", () => {
    expect(tokensCss).not.toContain("data-appearance");
    expect(tokensCss).not.toContain("data-theme-preview");
    expect(globalsCss).not.toContain("data-appearance");
    expect(
      rules(tokensCss).some((rule) => "--surface" in rule.decls && rule.selector !== ":root"),
    ).toBe(false);
  });

  it("every var(--x) in the stylesheets resolves to a defined token", () => {
    // The font variables next/font sets on <html> at runtime (fonts.ts); --font-body and --font-display are composed
    // from them in globals.css (#182).
    const defined = new Set<string>([
      "--font-body-latin",
      "--font-body-ext",
      "--font-display-latin",
      "--font-display-ext",
    ]);
    for (const css of [tokensCss, typeScaleCss, globalsCss]) {
      for (const m of stripCssComments(css).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    const used = [...stripCssComments(globalsCss).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
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

describe("Suitcase type scale", () => {
  const phone = rules(typeScaleCss)[0].decls;
  const laptop = rules(typeScaleCss)[1].decls;

  it("defines the phone sizes from the spec as the defaults", () => {
    expect(phone["--fs-page-title"]).toBe("28px");
    expect(phone["--fs-hero"]).toBe("32px");
    expect(phone["--fs-body"]).toBe("18px");
    expect(phone["--fs-eyebrow"]).toBe("11px");
    expect(phone["--min-text"]).toBe("11px");
  });

  it("overrides only the sizes that differ at 1024px and wider", () => {
    expect(typeScaleCss).toMatch(/@media \(min-width: 1024px\)/);
    expect(laptop["--fs-page-title"]).toBe("40px");
    expect(laptop["--fs-hero"]).toBe("72px");
    expect(laptop["--fs-body"]).toBe("17px");
    for (const name of Object.keys(laptop)) expect(phone[name], name).toBeDefined();
  });

  it("never sets a size below the 11px floor", () => {
    for (const decls of [phone, laptop])
      for (const [name, value] of Object.entries(decls))
        if (name.startsWith("--fs-")) expect(parseFloat(value), name).toBeGreaterThanOrEqual(11);
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

describe("Fraunces numerals and the shell page frame (#383)", () => {
  it("sets lining numerals on the root, so every Fraunces role inherits them", () => {
    expect(stripCssComments(typeScaleCss)).toMatch(
      /:root\s*\{[^}]*font-variant-numeric:\s*lining-nums/,
    );
  });

  it("body has no min-width (it made every page overflow at 195px)", () => {
    expect(stripCssComments(globalsCss)).not.toMatch(/body\s*\{[^}]*min-width/);
  });
});
