import type { NextRequest } from "next/server";
import { getAuth } from "@/server/auth/auth-runtime";
import { handleRequest } from "@/server/auth/proxy-handler";

// Optimistic gate for every page and API route; the data layer enforces the allowlist again (requireOwner).
export async function proxy(request: NextRequest) {
  return handleRequest(request, await getAuth());
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)",
  ],
};
