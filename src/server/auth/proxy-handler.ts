// Request gate for the Next.js Proxy (formerly middleware). Optimistic: it uses the same guard as the data
// layer but must never be the only line of defense (data access calls requireOwner itself).

import { NextResponse, type NextRequest } from "next/server";
import { authorizeOwner } from "./guard";
import type { Allowlist } from "./allowlist";
import type { AuthProvider } from "./types";

export const SIGN_IN_PATH = "/sign-in";
export const ACCESS_DENIED_PATH = "/access-denied";

/** Pages a signed-out (or denied) visitor may see. Everything else is protected. */
const PUBLIC_PATHS: readonly string[] = [SIGN_IN_PATH, ACCESS_DENIED_PATH];

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

export async function handleRequest(
  request: NextRequest,
  auth: { provider: AuthProvider; allowlist: Allowlist },
): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return noStore(NextResponse.next());

  const decision = await authorizeOwner(auth.provider, auth.allowlist);
  if (decision.status === "ok") return noStore(NextResponse.next());

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
