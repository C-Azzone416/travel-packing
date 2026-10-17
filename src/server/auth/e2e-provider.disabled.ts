// What `@/server/auth/e2e-provider` resolves to in every build made WITHOUT NEXT_PUBLIC_E2E_BUILD=1 (see
// next.config.ts). It has the same exports but can never enable anything, so the real e2e-only sign-in is not
// part of any deployed bundle.

import type { AuthProvider } from "./types";

export const E2E_COOKIE = "";

export function e2eAuthEnabled(): boolean {
  return false;
}

export function createE2eAuthProvider(): AuthProvider {
  throw new Error("The e2e sign-in is not compiled into this build");
}
