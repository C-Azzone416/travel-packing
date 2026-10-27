// Post-deploy smoke test: every public auth page answers 200 to a signed-out visitor (no owner session needed, so it
// works on the first preview, before any account exists), except the deliberately disabled account-closure page, which
// redirects to Settings. A protected page sends a signed-out visitor to sign-in.
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
  /** True when any answer was Vercel Authentication (deployment protection), not the app. Never a pass. */
  vercelAuthentication: boolean;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function isSameSiteRedirect(response: Response, base: string, pathname: string): boolean {
  if (!REDIRECTS.has(response.status)) return false;
  const location = response.headers.get("location") ?? "";
  try {
    const target = new URL(location, base);
    return target.host === new URL(base).host && target.pathname === pathname;
  } catch {
    return false;
  }
}

/**
 * Is this Vercel Authentication (deployment protection) answering instead of the app? It answers a protected address with a 401
 * page or a redirect to vercel.com's single-sign-on, and sets its nonce cookie. Whatever the status, that is not application
 * behaviour: a generated deployment URL of a protected project says nothing about the app behind it.
 */
export function isVercelAuthentication(response: Response): boolean {
  if (response.status === 401) return true;
  if ((response.headers.get("set-cookie") ?? "").includes("_vercel_sso_nonce")) return true;
  if (REDIRECTS.has(response.status)) {
    const location = response.headers.get("location") ?? "";
    try {
      const target = new URL(location, "https://app.invalid");
      if (target.hostname === "vercel.com" || target.hostname.endsWith(".vercel.com")) return true;
      if (target.pathname.startsWith("/sso-api")) return true;
    } catch {
      return false;
    }
  }
  return false;
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
  let vercelAuthentication = false;

  async function check(path: string, expectation: string, passes: (response: Response) => boolean) {
    try {
      const response = await fetchImpl(`${base}${path}`, { redirect: "manual", headers });
      // Checked first and whatever the check expected: Vercel Authentication is never a pass, not even for a redirect check.
      const blocked = isVercelAuthentication(response);
      const pass = !blocked && passes(response);
      lines.push(`${pass ? "ok  " : "FAIL"} ${path}: ${response.status} (${expectation})`);
      if (blocked) {
        vercelAuthentication = true;
        lines.push(
          "     Vercel Authentication answered, not the app: this address is behind deployment protection",
        );
      }
      if (!pass) {
        ok = false;
        lines.push(...(await diagnostics(response, bypassSecret)));
      }
    } catch {
      lines.push(`FAIL ${path}: no response (${expectation})`);
      ok = false;
    }
  }

  // The list the request gate uses, so a sign-up page (#27) is checked as soon as it becomes public. Account closure is
  // intentionally different while the hosted kill switch is off: accepting a 200 here would silently stop pinning the
  // disabled rollout. Enabling the feature later therefore requires an explicit smoke-contract change after its gates.
  for (const path of PUBLIC_PATHS) {
    if (path === "/close-account") {
      await check(
        path,
        "expected a redirect to /settings while account closure is disabled",
        (response) => isSameSiteRedirect(response, base, "/settings"),
      );
      continue;
    }
    await check(path, "expected 200", (response) => response.status === 200);
  }
  // A signed-out visitor to / is redirected to /sign-in ON THIS SITE: a redirect elsewhere that happens to end in /sign-in is not it.
  await check("/", "expected a redirect to /sign-in when signed out", (response) =>
    isSameSiteRedirect(response, base, "/sign-in"),
  );
  return { ok, lines, vercelAuthentication };
}
