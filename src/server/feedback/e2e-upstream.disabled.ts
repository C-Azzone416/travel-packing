// What `@/server/feedback/e2e-upstream` resolves to in every build made WITHOUT NEXT_PUBLIC_E2E_BUILD=1 (see next.config.ts). It
// can never redirect the Framebriar client, so the real e2e seam is not part of any deployed bundle.

export function e2eUpstreamFetch(): typeof fetch | null {
  return null;
}
