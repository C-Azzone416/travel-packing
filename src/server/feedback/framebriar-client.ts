// The server's side of the Framebriar wire protocol (#259): redeem an invitation, refresh an access token, disconnect a family, and
// deliver a report with its optional PNG. The destination is the one fixed, approved Framebriar address below; nothing a request
// carries can change it, so there is nothing to point at an internal host (no SSRF). Every call has a timeout, a response size cap,
// no redirects and no cookies, and every answer is validated before anything trusts it.
// Credentials and invitations are arguments only: they are never logged, never put in an error, and never echoed.
// Protocol facts (reviewed Framebriar v0.4.1 source, to be confirmed against the live service before release): refresh credentials do
// not rotate and the family deadline is fixed; access tokens last at most an hour; a redemption retried with the same attempt id
// inside Framebriar's idempotency window returns the same family.

export const FRAMEBRIAR_ENDPOINT = "https://framebriar-masra91-poc.azurewebsites.net/api";
export const GAME_ID = "travel-packing";
const SCOPE_VERSION = 2;
const TIMEOUT_MS = 8_000;
const MEDIA_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export interface AccessGrant {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

/**
 * ok: Framebriar answered and the answer is well formed.
 * rejected: Framebriar answered with a refusal (the status is a number from its answer; nothing else is kept).
 * uncertain: no usable answer (network, timeout, 5xx, a malformed or oversized body). What the call did upstream is unknown.
 */
export type Outcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "rejected"; status: number; retryAfterSeconds?: number }
  | { kind: "uncertain" };

export interface FramebriarClient {
  redeem(input: { invitation: string; attemptId: string }): Promise<Outcome<AccessGrant>>;
  refresh(refreshToken: string): Promise<Outcome<AccessGrant>>;
  disconnect(refreshToken: string): Promise<Outcome<true>>;
  submitReport(input: {
    accessToken: string;
    report: string;
    media: Uint8Array | null;
  }): Promise<Outcome<{ id: string; gameId: string }>>;
}

interface ClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

async function readCapped(response: Response): Promise<unknown | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

const isoMs = (value: unknown): number | null => {
  if (typeof value !== "string" || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
};

export function createFramebriarClient({
  fetchImpl = fetch,
  now = Date.now,
}: ClientOptions = {}): FramebriarClient {
  async function call<T>(
    path: string,
    init: { method: "POST" | "PUT"; headers: Record<string, string>; body: BodyInit },
    parse: (body: unknown) => T | null,
    timeoutMs = TIMEOUT_MS,
  ): Promise<Outcome<T>> {
    let response: Response;
    try {
      response = await fetchImpl(`${FRAMEBRIAR_ENDPOINT}${path}`, {
        ...init,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: "uncertain" };
    }
    if (response.status >= 500) return { kind: "uncertain" };
    if (response.status < 200 || response.status >= 300) {
      const retry = Number(response.headers.get("retry-after"));
      return {
        kind: "rejected",
        status: response.status,
        ...(Number.isFinite(retry) && retry > 0 && retry <= 3600
          ? { retryAfterSeconds: Math.ceil(retry) }
          : {}),
      };
    }
    const body = await readCapped(response).catch(() => undefined);
    const value = body === undefined ? null : parse(body);
    return value === null ? { kind: "uncertain" } : { kind: "ok", value };
  }

  const json = (payload: unknown) => ({
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });

  function parseGrant(expectedRefresh?: string) {
    return (body: unknown): AccessGrant | null => {
      const grant = body as Record<string, unknown> | null;
      if (typeof grant !== "object" || grant === null) return null;
      if (grant.v !== 1 || grant.gameId !== GAME_ID || grant.scopeVersion !== SCOPE_VERSION)
        return null;
      const { token, refreshToken } = grant;
      const accessExpiresAt = isoMs(grant.expiresAt);
      const refreshExpiresAt = isoMs(grant.refreshExpiresAt);
      if (typeof token !== "string" || token.length < 16 || token.length > 4096) return null;
      if (
        typeof refreshToken !== "string" ||
        refreshToken.length < 16 ||
        refreshToken.length > 4096
      )
        return null;
      if (accessExpiresAt === null || refreshExpiresAt === null) return null;
      // The family deadline is fixed and an access token never outlives it; a refresh must not rotate the credential.
      if (refreshExpiresAt <= now() || accessExpiresAt > refreshExpiresAt) return null;
      if (accessExpiresAt <= now() || accessExpiresAt - now() > 2 * 60 * 60 * 1000) return null;
      if (expectedRefresh !== undefined && refreshToken !== expectedRefresh) return null;
      return { accessToken: token, accessExpiresAt, refreshToken, refreshExpiresAt };
    };
  }

  return {
    redeem: ({ invitation, attemptId }) =>
      call(
        "/v1/access/redeem",
        {
          method: "POST",
          ...json({ v: 1, gameId: GAME_ID, scopeVersion: SCOPE_VERSION, invitation, attemptId }),
        },
        parseGrant(),
      ),
    refresh: (refreshToken) =>
      call(
        "/v1/access/refresh",
        {
          method: "POST",
          ...json({ v: 1, gameId: GAME_ID, scopeVersion: SCOPE_VERSION, refreshToken }),
        },
        parseGrant(refreshToken),
      ),
    disconnect: (refreshToken) =>
      call(
        "/v1/access/disconnect",
        { method: "POST", ...json({ v: 1, gameId: GAME_ID, refreshToken }) },
        (body) => ((body as { v?: unknown } | null)?.v === 1 ? true : null),
      ),
    async submitReport({ accessToken, report, media }) {
      const authorization = { authorization: `Bearer ${accessToken}` };
      const parseReceipt = (body: unknown) => {
        const receipt = body as Record<string, unknown> | null;
        if (typeof receipt !== "object" || receipt === null) return null;
        return typeof receipt.id === "string" && receipt.gameId === GAME_ID
          ? {
              id: receipt.id,
              gameId: receipt.gameId,
              status: receipt.status,
              ticket: receipt.ticket,
            }
          : null;
      };
      const first = await call(
        "/v1/reports",
        {
          method: "POST",
          headers: {
            ...authorization,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: report,
        },
        parseReceipt,
      );
      if (first.kind !== "ok") return first;
      const { id, gameId, status, ticket } = first.value;
      if (status === "ready" && media === null) return { kind: "ok", value: { id, gameId } };
      if (status !== "pending" || media === null || typeof ticket !== "string" || ticket === "")
        return { kind: "uncertain" };
      const uploaded = await call(
        `/v1/reports/${encodeURIComponent(id)}/media`,
        {
          method: "PUT",
          headers: {
            ...authorization,
            "content-type": "image/png",
            "x-upload-ticket": ticket,
            accept: "application/json",
          },
          body: Buffer.from(media),
        },
        parseReceipt,
        MEDIA_TIMEOUT_MS,
      );
      if (uploaded.kind !== "ok") return uploaded;
      return uploaded.value.status === "ready"
        ? { kind: "ok", value: { id: uploaded.value.id, gameId: uploaded.value.gameId } }
        : { kind: "uncertain" };
    },
  };
}
