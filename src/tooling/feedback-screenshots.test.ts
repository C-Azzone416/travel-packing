import { describe, expect, it } from "vitest";
import { screenshotEnvProblems, screenshotsEnabled } from "./feedback-screenshots";

describe("screenshotsEnabled", () => {
  it.each([
    ["no variables (local development, e2e)", {}, true],
    ["a preview deploy", { VERCEL_ENV: "preview" }, true],
    ["a preview deploy switched on", { VERCEL_ENV: "preview", FEEDBACK_SCREENSHOTS: "1" }, true],
    ["development on Vercel", { VERCEL_ENV: "development" }, true],
    ["production", { VERCEL_ENV: "production" }, false],
    [
      "production, even switched on",
      { VERCEL_ENV: "production", FEEDBACK_SCREENSHOTS: "1" },
      false,
    ],
    ["switched off anywhere", { FEEDBACK_SCREENSHOTS: "0" }, false],
    ["switched off with spaces", { FEEDBACK_SCREENSHOTS: " 0 " }, false],
    ["switched off on a preview", { VERCEL_ENV: "preview", FEEDBACK_SCREENSHOTS: "0" }, false],
    ["an empty value", { FEEDBACK_SCREENSHOTS: "" }, true],
    ["any other value is not an off switch", { FEEDBACK_SCREENSHOTS: "false" }, true],
  ])("%s", (_name, env, expected) => {
    expect(screenshotsEnabled(env)).toBe(expected);
  });

  it("reads process.env by default", () => {
    const before = process.env.FEEDBACK_SCREENSHOTS;
    process.env.FEEDBACK_SCREENSHOTS = "0";
    try {
      expect(screenshotsEnabled()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.FEEDBACK_SCREENSHOTS;
      else process.env.FEEDBACK_SCREENSHOTS = before;
    }
  });
});

describe("screenshotEnvProblems", () => {
  it.each([
    ["production", {}],
    ["production", { FEEDBACK_SCREENSHOTS: "" }],
    ["production", { FEEDBACK_SCREENSHOTS: "0" }],
    ["preview", {}],
    ["preview", { FEEDBACK_SCREENSHOTS: "0" }],
    ["preview", { FEEDBACK_SCREENSHOTS: "1" }],
  ] as const)("accepts %s with %j", (target, env) => {
    expect(screenshotEnvProblems(target, env)).toEqual([]);
  });

  it.each(["1", "true", "yes", "2"])("fails production with FEEDBACK_SCREENSHOTS=%s", (value) => {
    expect(screenshotEnvProblems("production", { FEEDBACK_SCREENSHOTS: value })).toEqual([
      "FEEDBACK_SCREENSHOTS must be unset or 0 in a production environment: production never captures screenshots",
    ]);
  });

  it("fails a preview with a value that is neither 0 nor 1, naming the variable but not the value", () => {
    const problems = screenshotEnvProblems("preview", { FEEDBACK_SCREENSHOTS: "maybe" });
    expect(problems).toEqual(["FEEDBACK_SCREENSHOTS, when set, must be 0 or 1"]);
    expect(problems.join()).not.toContain("maybe");
  });
});
