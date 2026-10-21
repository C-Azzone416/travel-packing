// The screenshot-only build switch (#130, Caroline's decision on #127). Feedback itself (notes and approved context codes)
// ships in every environment; only the capture of a screenshot is a build-time choice:
//   - on for Preview deploys, local development and e2e builds (the default);
//   - always off for Production, whatever else is set;
//   - FEEDBACK_SCREENSHOTS=0 turns it off anywhere.
// When off, next.config.ts resolves the capture module to a stub, so the capture code is not in the bundle at all.

type Env = Record<string, string | undefined>;

export function screenshotsEnabled(env: Env = process.env): boolean {
  return env.VERCEL_ENV !== "production" && env.FEEDBACK_SCREENSHOTS?.trim() !== "0";
}

/** What is wrong with FEEDBACK_SCREENSHOTS in a deploy environment (empty when fine). Names only, never values. */
export function screenshotEnvProblems(target: "preview" | "production", env: Env): string[] {
  const value = env.FEEDBACK_SCREENSHOTS?.trim();
  if (value === undefined || value === "") return [];
  if (target === "production" && value !== "0") {
    return [
      "FEEDBACK_SCREENSHOTS must be unset or 0 in a production environment: production never captures screenshots",
    ];
  }
  if (value !== "0" && value !== "1") return ["FEEDBACK_SCREENSHOTS, when set, must be 0 or 1"];
  return [];
}
