import "server-only";

import {
  handleAuthProxyRequest,
  NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_SESSION_DATA_COOKIE_NAME,
  parseSetCookies,
} from "@neondatabase/auth/server";
import { cookies, headers } from "next/headers";
import type { NeonCallResult } from "./neon-adapter";

const REVOCATION_PATH = "revoke-other-sessions";
const DELETE_USER_PATH = "delete-user";

interface RevocationConfig {
  baseUrl: string;
  cookieSecret: string;
}

interface RevocationDeps {
  requestHeaders?: () => Promise<Headers>;
  applyCookie?: (
    name: string,
    value: string,
    options: ReturnType<typeof parseSetCookies>[number],
  ) => Promise<void> | void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function boundedResponse(response: Response, data: unknown): NeonCallResult {
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
  return { data, error: null };
}

async function proxyCall(
  config: RevocationConfig,
  path: string,
  body: Record<string, string>,
  deps: RevocationDeps,
  sessionToken?: string,
): Promise<{ response: Response; data: unknown }> {
  const incoming = deps.requestHeaders ? await deps.requestHeaders() : new Headers(await headers());
  incoming.set("content-type", "application/json");
  if (sessionToken !== undefined) {
    if (!sessionToken || /[\r\n;]/.test(sessionToken)) throw new Error("Invalid session token");
    incoming.set("cookie", `${NEON_AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`);
  }
  const response = await handleAuthProxyRequest({
    // The proxy derives Origin from this URL only if the real request lacks Origin and Referer.
    // The deliberately invalid host then makes the provider reject the call, preserving fail-closed behavior.
    request: new Request(`https://account-closure.invalid/api/auth/${path}`, {
      method: "POST",
      headers: incoming,
      body: JSON.stringify(body),
    }),
    path,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    cookieSecret: config.cookieSecret,
  });
  return { response, data: await response.json().catch(() => null) };
}

async function applyConfirmedDeletionCookies(
  response: Response,
  deps: RevocationDeps,
): Promise<boolean> {
  const parsed = response.headers.getSetCookie().flatMap((header) => parseSetCookies(header));
  const allowed = new Set([NEON_AUTH_SESSION_COOKIE_NAME, NEON_AUTH_SESSION_DATA_COOKIE_NAME]);
  if (
    parsed.some(
      (cookie) =>
        !allowed.has(cookie.name) ||
        !(
          cookie.maxAge === 0 ||
          (cookie.expires !== undefined && cookie.expires.getTime() <= Date.now())
        ),
    )
  ) {
    return false;
  }
  const apply =
    deps.applyCookie ??
    (async (name: string, value: string, options: (typeof parsed)[number]) => {
      const jar = await cookies();
      jar.set(name, value, options);
    });
  for (const cookie of parsed) await apply(cookie.name, cookie.value, cookie);
  return true;
}

export interface NeonAccountClosureCalls {
  revokeOtherSessionsWithSession(sessionToken: string): Promise<NeonCallResult>;
  deleteUserWithSession(sessionToken: string, password: string): Promise<NeonCallResult>;
}

/** Bind both destructive calls to the token minted by the closure reauthentication. */
export function createNeonAccountClosureCalls(
  config: RevocationConfig,
  deps: RevocationDeps = {},
): NeonAccountClosureCalls {
  return {
    async revokeOtherSessionsWithSession(sessionToken) {
      const { response, data } = await proxyCall(config, REVOCATION_PATH, {}, deps, sessionToken);
      const result = boundedResponse(response, data);
      if (!result.error && response.headers.get("set-cookie")) {
        return { data: null, error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" } };
      }
      return result;
    },
    async deleteUserWithSession(sessionToken, password) {
      const { response, data } = await proxyCall(
        config,
        DELETE_USER_PATH,
        { password },
        deps,
        sessionToken,
      );
      const result = boundedResponse(response, data);
      const confirmed = record(data)?.success === true && record(data)?.message === "User deleted";
      if (!result.error && confirmed && !(await applyConfirmedDeletionCookies(response, deps))) {
        return { data: null, error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" } };
      }
      return result;
    },
  };
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
    const { response, data } = await proxyCall(config, REVOCATION_PATH, {}, deps);
    const result = boundedResponse(response, data);
    if (result.error) return result;

    // This endpoint keeps the current session and therefore must not mutate its cookies. If an
    // upstream contract changes, leave the durable deletion fence in place instead of continuing.
    if (response.headers.get("set-cookie")) {
      return {
        data: null,
        error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" },
      };
    }
    return result;
  };
}
