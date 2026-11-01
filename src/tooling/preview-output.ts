// The offline Preview build (#259 follow-up). The Preview deploy checks what `vercel build` makes, and a pull request never reaches
// the deploy job, so CI (and `npm run verify`) make the same output here and hold it to the same check. Nothing here talks to
// Vercel: the project is a placeholder, the environment file carries only VERCEL_ENV, and the CLI runs with no token, no login and
// no inherited configuration, so the result cannot depend on whose machine or account ran it.

export const PLACEHOLDER_PROJECT = {
  projectId: "prj_ci",
  orgId: "team_ci",
  settings: { framework: "nextjs" },
} as const;

/** `vercel build` for the preview target reads this file for the build's environment (what `vercel pull` writes in a deploy). */
export const PREVIEW_ENV_FILE = ".vercel/.env.preview.local";
export const PREVIEW_ENV_TEXT = 'VERCEL_ENV="preview"\n';
export const LOCKED_VERCEL = "tools/vercel-cli/node_modules/.bin/vercel";

/**
 * The only environment the CLI is given: a PATH to find node, a HOME that is not the real one (so no login or config is read),
 * and nothing else. In particular no VERCEL_TOKEN and no package registry credential.
 */
export function hermeticEnv(
  env: Record<string, string | undefined>,
  home: string,
): Record<string, string> {
  return { PATH: env.PATH ?? "", HOME: home, CI: "1" };
}

export function projectJson(): string {
  return `${JSON.stringify(PLACEHOLDER_PROJECT)}\n`;
}
