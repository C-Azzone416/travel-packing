// Post-deploy smoke test: every public auth page answers 200 to a signed-out visitor (no owner session needed, so it
// works on the first preview, before any account exists), and a protected page sends a signed-out visitor to sign-in.
// Redirects are not followed, so a bounce is seen as a bounce. A passing check prints the path and status only. A failing
// one also prints what tells a platform error from an app error: the x-vercel-error and x-vercel-id response headers and
// the first 200 characters of the body. Request headers, the bypass secret and the Location header are never printed.

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

const BODY_PREVIEW_CHARS = 200;

/** Printable form of a header value or body excerpt: one line, no control characters, the bypass secret masked. */
function printable(value: string, bypassSecret?: string): string {
  let text = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (bypassSecret) text = text.split(bypassSecret).join("***");
  return text;
}

/** What a failing response says about itself, to tell a Vercel platform error from the app's own answer. */
async function diagnostics(response: Response, bypassSecret?: string): Promise<string[]> {
  const header = (name: string) =>
    printable(response.headers.get(name) ?? "", bypassSecret) || "(none)";
  let body = "";
  try {
    body = printable((await response.text()).slice(0, BODY_PREVIEW_CHARS), bypassSecret);
  } catch {
    body = "";
  }
  return [
    `     x-vercel-error: ${header("x-vercel-error")}`,
    `     x-vercel-id: ${header("x-vercel-id")}`,
    `     body: ${body === "" ? "(empty)" : body}`,
  ];
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
      if (!pass) {
        ok = false;
        lines.push(...(await diagnostics(response, bypassSecret)));
      }
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
