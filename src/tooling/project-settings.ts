// After `vercel pull` (#20): which build settings does the real Vercel project hand `vercel build`? A framework preset, build
// command, output directory, root directory or install command override decides which builder runs, and is invisible in the
// repo. These are project SETTINGS, not secrets, but only these five keys are ever read out of the file (it also holds ids).

export const SETTING_KEYS = [
  "framework",
  "buildCommand",
  "outputDirectory",
  "rootDirectory",
  "installCommand",
] as const;

const MAX_VALUE_CHARS = 120;

function printable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(unset)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, MAX_VALUE_CHARS);
}

/** One `key: value` line per setting, from the `settings` object of `.vercel/project.json` (or the top level). */
export function projectSettingLines(projectJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch {
    return ["project settings: .vercel/project.json is not readable JSON"];
  }
  const root = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const settings = (
    root.settings && typeof root.settings === "object" ? root.settings : root
  ) as Record<string, unknown>;
  return SETTING_KEYS.map((key) => `project setting ${key}: ${printable(settings[key])}`);
}
