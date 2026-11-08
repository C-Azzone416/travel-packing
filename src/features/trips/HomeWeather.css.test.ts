import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/features/trips/HomeWeather.module.css"), "utf8");

describe("the unavailable stay row (#410)", () => {
  it("uses the dashed 'not live' border of Usual weather, after the solid row rule so it wins", () => {
    const rule = css.match(/\.cityRow\[data-unavailable="true"\]\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/border:\s*2px dashed var\(--line\)/);
    expect(css.indexOf('.cityRow[data-unavailable="true"]')).toBeGreaterThan(
      css.indexOf(".cityRow {"),
    );
  });
});
