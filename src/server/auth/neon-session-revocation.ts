import "server-only";

import { handleAuthProxyRequest } from "@neondatabase/auth/server";
import { headers } from "next/headers";
import type { NeonCallResult } from "./neon-adapter";

const REVOCATION_PATH = "revoke-other-sessions";

interface RevocationConfig {
  baseUrl: string;
  cookieSecret: string;
}

interface RevocationDeps {
  requestHeaders?: () => Promise<Headers>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Call the documented Better Auth endpoint through the SDK's public proxy helper.
 *
 * @neondatabase/auth 0.6.0-beta (and the currently published 0.7.0-beta) route
 * `revokeOtherSessions()` to `/revoke-all-sessions`, which is not a Better Auth route. Keeping
 * this narrow compatibility seam here lets the rest of the adapter retain its strict response
 * checks until a published SDK release contains the corrected endpoint mapping.
 */
export function createNeonSessionRevoker(
  config: RevocationConfig,
  deps: RevocationDeps = {},
): () => Promise<NeonCallResult> {
  return async () => {
    const incoming = deps.requestHeaders
      ? await deps.requestHeaders()
      : new Headers(await headers());
    incoming.set("content-type", "application/json");
    const response = await handleAuthProxyRequest({
      request: new Request(`https://account-closure.invalid/api/auth/${REVOCATION_PATH}`, {
        method: "POST",
        headers: incoming,
        body: "{}",
      }),
      path: REVOCATION_PATH,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      cookieSecret: config.cookieSecret,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = record(data);
      return {
        data: null,
        error: {
          status: response.status,
          code: typeof error?.code === "string" ? error.code : "",
        },
      };
    }

    // This endpoint keeps the current session and therefore must not mutate its cookies. If an
    // upstream contract changes, leave the durable deletion fence in place instead of continuing.
    if (response.headers.get("set-cookie")) {
      return {
        data: null,
        error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" },
      };
    }
    return { data, error: null };
  };
}
