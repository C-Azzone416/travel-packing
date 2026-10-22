// Request gate for the Next.js Proxy (formerly middleware). Optimistic: it uses the same guard as the data
// layer but must never be the only line of defense (data access calls requireOwner itself).

import { NextResponse, type NextRequest } from "next/server";
import { authorizeOwner } from "./guard";
import { ACCESS_DENIED_PATH, PUBLIC_PATHS, SIGN_IN_PATH } from "./public-paths";
import type { Allowlist } from "./allowlist";
import type { AuthProvider } from "./types";

/**
 * Request header the proxy sets on the public auth screens so the root layout can render them without the app
 * chrome (top bar, nav). A client-supplied copy is always stripped, so only the proxy can set it.
 */
export const AUTH_SCREEN_HEADER = "x-auth-screen";

export { ACCESS_DENIED_PATH, SIGN_IN_PATH };

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname === `${path}/`);
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Pass the request on, with the auth-screen marker set only when `authScreen` and never client-controlled. */
function proceed(request: NextRequest, authScreen: boolean): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(AUTH_SCREEN_HEADER);
  if (authScreen) headers.set(AUTH_SCREEN_HEADER, "1");
  return noStore(NextResponse.next({ request: { headers } }));
}

export async function handleRequest(
  request: NextRequest,
  auth: { provider: AuthProvider; allowlist: Allowlist },
): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return proceed(request, true);

  const decision = await authorizeOwner(auth.provider, auth.allowlist);
  if (decision.status === "ok") return proceed(request, false);

  if (isApiPath(pathname)) {
    return noStore(
      decision.status === "unauthenticated"
        ? NextResponse.json({ error: "Authentication required" }, { status: 401 })
        : NextResponse.json({ error: "Access denied" }, { status: 403 }),
    );
  }
  const target = decision.status === "unauthenticated" ? SIGN_IN_PATH : ACCESS_DENIED_PATH;
  return noStore(NextResponse.redirect(new URL(target, request.url)));
}
