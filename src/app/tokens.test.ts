import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const plan = readFileSync(join(root, "TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

function cssTokens(): Record<string, string> {
  const block = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

// Rows of the doc §5 palette table: `| \`--token\` | \`#HEX\` | use |`.
function docSimpleTokens(): Record<string, string> {
  return Object.fromEntries(
    [...plan.matchAll(/^\| `(--[\w-]+)` \| `(#[0-9A-Fa-f]{6})` \|/gm)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

// Rows like `| ready background/text/border | \`#D4EADF\` / \`#185B56\` / \`#AED2C0\` | Ready status |`.
function docStatusTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of plan.matchAll(
    /^\| (ready|remaining) background\/text\/border \| `(#[0-9A-Fa-f]{6})` \/ `(#[0-9A-Fa-f]{6})` \/ `(#[0-9A-Fa-f]{6})` \|/gm,
  )) {
    out[`--status-${m[1]}-bg`] = m[2].toLowerCase();
    out[`--status-${m[1]}-text`] = m[3].toLowerCase();
    out[`--status-${m[1]}-border`] = m[4].toLowerCase();
  }
  return out;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Lagoon & Linen tokens (doc §5)", () => {
  const tokens = cssTokens();

  it("parses the expected palette from the doc", () => {
    expect(Object.keys(docSimpleTokens()).sort()).toEqual(
      [
        "--danger",
        "--ink",
        "--line",
        "--linen",
        "--muted",
        "--paper",
        "--seafoam",
        "--seafoam-soft",
        "--teal",
        "--teal-dark",
        "--warm",
      ].sort(),
    );
    expect(Object.keys(docStatusTokens())).toHaveLength(6);
  });

  it.each(Object.entries(docSimpleTokens()))("%s matches the doc value %s", (name, value) => {
    expect(tokens[name]).toBe(value);
  });

  it.each(Object.entries(docStatusTokens()))("%s matches the doc value %s", (name, value) => {
    expect(tokens[name]).toBe(value);
  });

  it("keeps --muted exactly as documented and adds the text-only --muted-text (design #12 gap 2)", () => {
    expect(tokens["--muted"]).toBe("#60777b");
    expect(tokens["--muted-text"]).toBe("#566b6f");
  });

  it("--muted-text meets 4.5:1 for small text on Linen and Seafoam-soft; --muted does not", () => {
    for (const surface of [tokens["--linen"], tokens["--seafoam-soft"]]) {
      expect(contrast(tokens["--muted-text"], surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["--muted"], surface)).toBeLessThan(4.5);
    }
  });

  it("the focus outline color meets 3:1 on Linen (design #12 gap 1)", () => {
    expect(contrast(tokens["--teal"], tokens["--linen"])).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(
      /:focus-visible\s*{\s*outline:\s*3px solid var\(--teal\);\s*outline-offset:\s*2px;/,
    );
  });

  it("status pairs are readable", () => {
    for (const kind of ["ready", "remaining"]) {
      expect(
        contrast(tokens[`--status-${kind}-text`], tokens[`--status-${kind}-bg`]),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses Inter with system fallbacks and honors reduced motion", () => {
    expect(css).toMatch(/font-family:\s*Inter,\s*ui-sans-serif,\s*system-ui/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
