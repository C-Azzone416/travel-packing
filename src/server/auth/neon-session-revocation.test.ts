import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthServer, NEON_AUTH_SESSION_COOKIE_NAME } from "@neondatabase/auth/server";
import { createNeonAccountClosureCalls, createNeonSessionRevoker } from "./neon-session-revocation";
import { setAuthLogSink } from "./safe-log";

const nextHeaders = vi.fn();
const nextCookies = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => nextHeaders(),
  cookies: () => nextCookies(),
}));

const config = {
  baseUrl: "https://auth.example.test/neondb/auth/",
  cookieSecret: "s".repeat(40),
};

const requestHeaders = async () =>
  new Headers({
    cookie: "__Secure-neon-auth.session_token=synthetic-session; appearance=synthetic-appearance",
    origin: "https://app.example.test",
  });

afterEach(() => {
  setAuthLogSink();
  nextHeaders.mockReset();
  nextCookies.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function capturePreviewDiagnostics() {
  const lines: string[] = [];
  vi.stubEnv("VERCEL_ENV", "preview");
  setAuthLogSink((line) => lines.push(line));
  return lines;
}

describe("Neon account-closure session revocation", () => {
  it("uses the signed Set-Cookie value, not the raw token from the real SDK response contract", async () => {
    const written: { name: string; value: string }[] = [];
    const signedCookie = "raw-body-token.synthetic-signature";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path.endsWith("/sign-in/email")) {
        return Response.json(
          {
            redirect: false,
            token: "raw-body-token",
            user: { id: "synthetic-user", email: "owner@example.test", emailVerified: true },
          },
          {
            headers: {
              "set-cookie": `${NEON_AUTH_SESSION_COOKIE_NAME}=${signedCookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
            },
          },
        );
      }
      return Response.json({ session: null, user: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = createAuthServer({
      baseUrl: config.baseUrl,
      cookieSecret: config.cookieSecret,
      context: async () => ({
        getCookies: () => "",
        setCookie: (name: string, value: string) => void written.push({ name, value }),
        getHeader: () => null,
        getOrigin: () => "https://app.example.test",
        getFramework: () => "synthetic-contract-test",
      }),
    });

    const response = await auth.signIn.email({
      email: "owner@example.test",
      password: "synthetic-password",
    });

    expect(response.data?.token).toBe("raw-body-token");
    expect(written).toContainEqual({
      name: NEON_AUTH_SESSION_COOKIE_NAME,
      value: signedCookie,
    });
    expect(written.find((cookie) => cookie.name === NEON_AUTH_SESSION_COOKIE_NAME)?.value).not.toBe(
      response.data?.token,
    );
  });

  it("uses one explicit fresh session for the whole destructive sequence", async () => {
    const applied: { name: string; value: string; maxAge?: number }[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: true }))
      .mockResolvedValueOnce(
        Response.json(
          { success: true, message: "User deleted" },
          {
            headers: {
              "set-cookie":
                "__Secure-neon-auth.session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const calls = createNeonAccountClosureCalls(config, {
      requestHeaders,
      applyCookie: (name, value, options) => {
        applied.push({
          name,
          value,
          ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
        });
      },
    });

    await expect(calls.revokeOtherSessionsWithSession("fresh.signed-session")).resolves.toEqual({
      data: { status: true },
      error: null,
    });
    await expect(
      calls.deleteUserWithSession("fresh.signed-session", "synthetic-password"),
    ).resolves.toEqual({ data: { success: true, message: "User deleted" }, error: null });

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      path: new URL(url as string).pathname,
      cookie: new Headers((init as RequestInit).headers).get("cookie"),
    }));
    expect(requests).toEqual([
      {
        path: "/neondb/auth/revoke-other-sessions",
        cookie: "__Secure-neon-auth.session_token=fresh.signed-session",
      },
      {
        path: "/neondb/auth/delete-user",
        cookie: "__Secure-neon-auth.session_token=fresh.signed-session",
      },
    ]);
    expect(applied).toEqual(
      expect.arrayContaining([
        { name: "__Secure-neon-auth.session_token", value: "", maxAge: 0 },
        { name: "__Secure-neon-auth.local.session_data", value: "", maxAge: 0 },
      ]),
    );
  });

  it("reads the current signed session cookie from the response cookie store", async () => {
    nextCookies.mockResolvedValue({
      get: (name: string) =>
        name === NEON_AUTH_SESSION_COOKIE_NAME
          ? { name, value: "raw-token.synthetic-signature" }
          : undefined,
    });

    await expect(createNeonAccountClosureCalls(config).readSessionCookie()).resolves.toBe(
      "raw-token.synthetic-signature",
    );
  });

  it.each(["", "bad;cookie", "bad\r\ncookie"])(
    "rejects an unsafe explicit session cookie before fetch: %j",
    async (sessionCookie) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const calls = createNeonAccountClosureCalls(config, { requestHeaders });

      await expect(calls.revokeOtherSessionsWithSession(sessionCookie)).rejects.toThrow(
        "Invalid session cookie",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("encodes cookie metacharacters without changing the signed value", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: true }));
    vi.stubGlobal("fetch", fetchMock);
    const calls = createNeonAccountClosureCalls(config, { requestHeaders });

    await calls.revokeOtherSessionsWithSession("raw=token%signature");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("cookie")).toBe(
      "__Secure-neon-auth.session_token=raw%3Dtoken%25signature",
    );
  });

  it("posts to the documented revoke-other-sessions endpoint with only auth cookies", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
      data: { status: true },
      error: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/neondb/auth/revoke-other-sessions");
    expect(init.method).toBe("POST");
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBe("__Secure-neon-auth.session_token=synthetic-session");
    expect(sent.get("cookie")).not.toContain("appearance");
    expect(sent.get("origin")).toBe("https://app.example.test");
    expect(sent.get("content-type")).toBe("application/json");
    expect(sent.get("x-neon-auth-middleware")).toBe("true");
    expect(await new Request(url, init).text()).toBe("{}");
  });

  it("uses the current request headers when no test seam is supplied", async () => {
    nextHeaders.mockResolvedValue(
      new Headers({
        cookie: "__Secure-neon-auth.session_token=default-path-session",
        origin: "https://default-path.example.test",
      }),
    );
    const fetchMock = vi.fn(async () => Response.json({ status: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createNeonSessionRevoker(config)()).resolves.toEqual({
      data: { status: true },
      error: null,
    });

    expect(nextHeaders).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBe("__Secure-neon-auth.session_token=default-path-session");
    expect(sent.get("origin")).toBe("https://default-path.example.test");
  });

  it("returns a bounded provider error for a rejected endpoint call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "INTERNAL_ERROR", message: "synthetic upstream failure" },
          { status: 503 },
        ),
      ),
    );

    await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
      data: null,
      error: { status: 503, code: "INTERNAL_ERROR" },
    });
  });

  it("bounds a non-string provider error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: 503 }, { status: 503 })),
    );

    await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
      data: null,
      error: { status: 503, code: "" },
    });
  });

  it("leaves a non-JSON success unconfirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  it.each([{ status: false }, {}])(
    "passes an unconfirmed success shape to the adapter unchanged: %j",
    async (data) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(data)),
      );

      await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
        data,
        error: null,
      });
    },
  );

  it("rejects if the current request headers cannot be read", async () => {
    nextHeaders.mockRejectedValue(new Error("synthetic headers failure"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createNeonSessionRevoker(config)()).rejects.toThrow("synthetic headers failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves an unexpected cookie-mutating success unconfirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: true },
          { headers: { "set-cookie": "__Secure-neon-auth.unexpected=changed; Path=/; HttpOnly" } },
        ),
      ),
    );

    await expect(createNeonSessionRevoker(config, { requestHeaders })()).resolves.toEqual({
      data: null,
      error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" },
    });
  });

  it("rejects a cookie mutation on a session-bound revocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: true },
          {
            headers: {
              "set-cookie": `${NEON_AUTH_SESSION_COOKIE_NAME}=changed; Path=/; HttpOnly; Secure`,
            },
          },
        ),
      ),
    );

    await expect(
      createNeonAccountClosureCalls(config, { requestHeaders }).revokeOtherSessionsWithSession(
        "fresh.synthetic-signature",
      ),
    ).resolves.toEqual({
      data: null,
      error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" },
    });
  });

  it("does not apply deletion cookies until the response exactly confirms deletion", async () => {
    const applyCookie = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: true, message: "Verification email sent" },
          {
            headers: {
              "set-cookie": `${NEON_AUTH_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; Max-Age=0`,
            },
          },
        ),
      ),
    );

    await expect(
      createNeonAccountClosureCalls(config, {
        requestHeaders,
        applyCookie,
      }).deleteUserWithSession("fresh.synthetic-signature", "synthetic-password"),
    ).resolves.toEqual({
      data: { success: true, message: "Verification email sent" },
      error: null,
    });
    expect(applyCookie).not.toHaveBeenCalled();
  });

  it("logs a bounded nonterminal 2xx outcome without its hostile response body", async () => {
    const lines = capturePreviewDiagnostics();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          message: "owner@example.test synthetic-password raw-session-token",
          secret: "do-not-log-me",
        }),
      ),
    );

    await expect(
      createNeonAccountClosureCalls(config, {
        requestHeaders,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(123),
      }).deleteUserWithSession("fresh.synthetic-signature", "synthetic-password"),
    ).resolves.toMatchObject({ error: null });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      scope: "auth",
      event: "account-closure-provider-call",
      stage: "delete-user",
      outcome: "nonterminal-response",
      status: 200,
      code: "UNKNOWN",
      elapsedMs: 23,
    });
    expect(lines[0]).not.toContain("owner");
    expect(lines[0]).not.toContain("password");
    expect(lines[0]).not.toContain("token");
    expect(lines[0]).not.toContain("do-not-log-me");
  });

  it("logs a strictly allowlisted provider rejection code and replaces a hostile code", async () => {
    const lines = capturePreviewDiagnostics();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "INVALID_PASSWORD" }, { status: 400 }))
      .mockResolvedValueOnce(
        Response.json(
          { code: "owner@example.test synthetic-password raw-session-token" },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const calls = createNeonAccountClosureCalls(config, { requestHeaders });

    await calls.deleteUserWithSession("fresh.synthetic-signature", "synthetic-password");
    await calls.deleteUserWithSession("fresh.synthetic-signature", "synthetic-password");

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        stage: "delete-user",
        outcome: "provider-rejected",
        status: 400,
        code: "INVALID_PASSWORD",
      }),
      expect.objectContaining({
        stage: "delete-user",
        outcome: "provider-rejected",
        status: 403,
        code: "UNKNOWN",
      }),
    ]);
    expect(lines.join("\n")).not.toContain("owner");
    expect(lines.join("\n")).not.toContain("password");
    expect(lines.join("\n")).not.toContain("token");
  });

  it("distinguishes a transport response from an error before any response exists", async () => {
    const lines = capturePreviewDiagnostics();
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed: secret-token"));
    vi.stubGlobal("fetch", fetchMock);

    await createNeonAccountClosureCalls(config, { requestHeaders }).deleteUserWithSession(
      "fresh.synthetic-signature",
      "synthetic-password",
    );
    await expect(
      createNeonAccountClosureCalls(config, {
        requestHeaders: async () => {
          throw new Error("headers contain secret-token");
        },
      }).deleteUserWithSession("fresh.synthetic-signature", "synthetic-password"),
    ).rejects.toThrow("headers contain secret-token");

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        stage: "delete-user",
        outcome: "transport-error",
        status: 502,
        code: "NETWORK_ERROR",
      }),
      expect.objectContaining({
        stage: "delete-user",
        outcome: "early-error",
      }),
    ]);
    expect(lines.join("\n")).not.toContain("secret-token");
  });

  it("logs confirmed and cookie-rejected outcomes, but emits nothing in Production", async () => {
    const lines = capturePreviewDiagnostics();
    const deletion = (setCookie: string) =>
      Response.json(
        { success: true, message: "User deleted" },
        { headers: { "set-cookie": setCookie } },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        deletion(`${NEON_AUTH_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; Max-Age=0`),
      )
      .mockResolvedValueOnce(
        deletion("__Secure-neon-auth.unexpected=; Path=/; HttpOnly; Secure; Max-Age=0"),
      )
      .mockResolvedValueOnce(Response.json({ code: "INVALID_PASSWORD" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const calls = createNeonAccountClosureCalls(config, { requestHeaders, applyCookie: vi.fn() });

    await calls.deleteUserWithSession("fresh.synthetic-signature", "synthetic-password");
    await calls.deleteUserWithSession("fresh.synthetic-signature", "synthetic-password");
    vi.stubEnv("VERCEL_ENV", "production");
    await calls.deleteUserWithSession("fresh.synthetic-signature", "synthetic-password");

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ stage: "delete-user", outcome: "confirmed", status: 200 }),
      expect.objectContaining({
        stage: "delete-user",
        outcome: "unexpected-cookie-mutation",
        status: 200,
        code: "UNEXPECTED_COOKIE_MUTATION",
      }),
    ]);
  });

  it.each([
    [
      "an unexpected cookie name",
      "__Secure-neon-auth.unexpected=; Path=/; HttpOnly; Secure; Max-Age=0",
    ],
    [
      "a non-expiring allowed cookie",
      `${NEON_AUTH_SESSION_COOKIE_NAME}=changed; Path=/; HttpOnly; Secure`,
    ],
  ])("rejects %s without applying any deletion cookies", async (_name, setCookie) => {
    const applyCookie = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: true, message: "User deleted" },
          { headers: { "set-cookie": setCookie } },
        ),
      ),
    );

    await expect(
      createNeonAccountClosureCalls(config, {
        requestHeaders,
        applyCookie,
      }).deleteUserWithSession("fresh.synthetic-signature", "synthetic-password"),
    ).resolves.toEqual({
      data: null,
      error: { status: 0, code: "UNEXPECTED_COOKIE_MUTATION" },
    });
    expect(applyCookie).not.toHaveBeenCalled();
  });
});
