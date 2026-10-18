// Post-deploy smoke test: every public auth page answers 200 to a signed-out visitor (no owner session needed, so it
// works on the first preview, before any account exists), and a protected page sends a signed-out visitor to sign-in.
// Redirects are not followed, so a bounce is seen as a bounce. Nothing here prints more than the path and status.

import { PUBLIC_PATHS } from "../server/auth/public-paths";

type Fetch = (
  url: string,
  init: { redirect: "manual"; headers: Record<string, string> },
) => Promise<Response>;

export interface SmokeOptions {
  /** Sent as x-vercel-protection-bypass when the preview sits behind Vercel deployment protection. */
  bypassSecret?: string;
}

export interface SmokeResult {
  ok: boolean;
  lines: string[];
}

export async function smokeTest(
  baseUrl: string,
  fetchImpl: Fetch,
  { bypassSecret }: SmokeOptions = {},
): Promise<SmokeResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = bypassSecret
    ? { "x-vercel-protection-bypass": bypassSecret }
    : {};
  const lines: string[] = [];
  let ok = true;

  async function check(path: string, expectation: string, passes: (response: Response) => boolean) {
    try {
      const response = await fetchImpl(`${base}${path}`, { redirect: "manual", headers });
      const pass = passes(response);
      lines.push(`${pass ? "ok  " : "FAIL"} ${path}: ${response.status} (${expectation})`);
      if (!pass) ok = false;
    } catch {
      lines.push(`FAIL ${path}: no response (${expectation})`);
      ok = false;
    }
  }

  // The list the request gate uses, so a sign-up page (#27) is checked as soon as it becomes public.
  for (const path of PUBLIC_PATHS) {
    await check(path, "expected 200", (response) => response.status === 200);
  }
  await check("/", "expected a redirect to /sign-in when signed out", (response) => {
    if (response.status < 300 || response.status > 399) return false;
    const location = response.headers.get("location") ?? "";
    try {
      return new URL(location, base).pathname === "/sign-in";
    } catch {
      return false;
    }
  });
  return { ok, lines };
}
