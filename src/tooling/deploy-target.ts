// After `vercel deploy` (#20): did the deployment land in the environment this run meant it to? Vercel assigns a project's
// FIRST deployment to production when no target is given, and the CLI prints which one it made ("Production  https://..." or
// "Preview  https://..."), so a preview run that printed "Production" must stop here, before anything is smoke-tested or
// trusted. Reads only the CLI's own output; prints nothing from it.

type Target = "preview" | "production";

// The CLI colours its labels; strip escape sequences before looking.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** A line the CLI prints for a created deployment: `  Production  https://...` or `  Preview  https://...`. */
function labelled(output: string, label: "Production" | "Preview"): boolean {
  return new RegExp(`^[\\s\\u25b2]*${label}\\s+https?://`, "m").test(output.replace(ANSI, ""));
}

/** Returns what is wrong (empty when the deployment went where the run meant it to). */
export function deployTargetProblems(target: Target, cliOutput: string): string[] {
  const text = cliOutput.replace(ANSI, "");
  const production = labelled(text, "Production");
  const preview = labelled(text, "Preview");
  if (target === "preview") {
    if (production || /assigned to production/i.test(text)) {
      return ["a preview run created a PRODUCTION deployment; stop and check the Vercel project"];
    }
    if (!preview)
      return [
        "the deploy output does not say the deployment is a Preview, so its target is unknown",
      ];
    return [];
  }
  if (preview) return ["a production run created a PREVIEW deployment, not a production one"];
  if (!production)
    return [
      "the deploy output does not say the deployment is Production, so its target is unknown",
    ];
  return [];
}
