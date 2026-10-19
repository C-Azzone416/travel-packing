import { describe, expect, it } from "vitest";
import { projectSettingLines, SETTING_KEYS } from "./project-settings";

describe("projectSettingLines", () => {
  const pulled = JSON.stringify({
    projectId: "prj_secretish123",
    orgId: "team_secretish456",
    projectName: "travel-packing",
    settings: {
      framework: "nextjs",
      buildCommand: null,
      outputDirectory: "public",
      rootDirectory: "apps/web",
      installCommand: "npm ci",
      nodeVersion: "24.x",
      devCommand: "x",
    },
  });

  it("prints exactly the five build settings, in a fixed order, from the settings object", () => {
    expect(projectSettingLines(pulled)).toEqual([
      "project setting framework: nextjs",
      "project setting buildCommand: (unset)",
      "project setting outputDirectory: public",
      "project setting rootDirectory: apps/web",
      "project setting installCommand: npm ci",
    ]);
    expect(SETTING_KEYS).toHaveLength(5);
  });

  it("never prints any other key or value from the file (ids, names, other settings)", () => {
    const text = projectSettingLines(pulled).join("\n");
    expect(text).not.toMatch(/prj_|team_|travel-packing|24\.x|devCommand|nodeVersion/);
  });

  it("reads the keys from the top level when there is no settings object", () => {
    expect(projectSettingLines(JSON.stringify({ framework: "other", projectId: "p" }))[0]).toBe(
      "project setting framework: other",
    );
  });

  it("says (unset) for missing, null and empty values", () => {
    expect(projectSettingLines("{}")).toEqual(
      SETTING_KEYS.map((key) => `project setting ${key}: (unset)`),
    );
    expect(projectSettingLines(JSON.stringify({ settings: { framework: "" } }))[0]).toBe(
      "project setting framework: (unset)",
    );
  });

  it("puts a value on one line and cuts it at 120 characters; non-string values are shown as JSON", () => {
    const lines = projectSettingLines(
      JSON.stringify({
        settings: { buildCommand: `a\nb\t${"x".repeat(300)}`, rootDirectory: { a: 1 } },
      }),
    );
    expect(lines[1]).toBe(`project setting buildCommand: a b ${"x".repeat(116)}`);
    expect(lines[1]).not.toMatch(/\n|\t/);
    expect(lines[3]).toBe('project setting rootDirectory: {"a":1}');
  });

  it("copes with unreadable JSON and with JSON that is not an object", () => {
    expect(projectSettingLines("not json")).toEqual([
      "project settings: .vercel/project.json is not readable JSON",
    ]);
    expect(projectSettingLines("null")).toHaveLength(5);
    expect(projectSettingLines('"text"')).toHaveLength(5);
  });
});
