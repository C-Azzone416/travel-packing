// The e2e build's only way to reach a Framebriar that is not the real one (#260). The server's Framebriar client talks to ONE
// fixed, approved address (framebriar-client.ts); in the synthetic e2e build every call to that address is sent instead to the
// local fake service the Playwright run starts (tests/e2e/support/fake-framebriar-server.ts), whose port comes from
// E2E_FRAMEBRIAR_PORT. Nothing else can be reached through it: a URL that is not under the pinned address is refused.
// Like the other e2e-only modules this resolves to a stub that returns null in every build without NEXT_PUBLIC_E2E_BUILD=1
// (next.config.ts), so none of it, and no way to redirect the client, exists in Preview or Production.

import "server-only";
import { FRAMEBRIAR_ENDPOINT } from "./framebriar-client";

/** In every message the seam produces, so a build check can look for the module (a comment would not survive the build). */
export const E2E_UPSTREAM_MARKER = "e2e-framebriar-upstream";

export function e2eUpstreamFetch(
  env: Record<string, string | undefined> = process.env,
): typeof fetch | null {
  const port = env.E2E_FRAMEBRIAR_PORT;
  if (!port || !/^\d{4,5}$/.test(port) || Number(port) > 65535) return null;
  const target = `http://127.0.0.1:${port}/api`;
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${FRAMEBRIAR_ENDPOINT}/`)) {
      return Promise.reject(
        new TypeError(`${E2E_UPSTREAM_MARKER}: only the pinned Framebriar address is reachable`),
      );
    }
    return fetch(`${target}${url.slice(FRAMEBRIAR_ENDPOINT.length)}`, init);
  };
}
