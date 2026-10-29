import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeonAccountClosureCalls, createNeonSessionRevoker } from "./neon-session-revocation";

const nextHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => nextHeaders(),
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
  nextHeaders.mockReset();
  vi.unstubAllGlobals();
});

describe("Neon account-closure session revocation", () => {
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

    await expect(calls.revokeOtherSessionsWithSession("fresh-session")).resolves.toEqual({
      data: { status: true },
      error: null,
    });
    await expect(
      calls.deleteUserWithSession("fresh-session", "synthetic-password"),
    ).resolves.toEqual({ data: { success: true, message: "User deleted" }, error: null });

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      path: new URL(url as string).pathname,
      cookie: new Headers((init as RequestInit).headers).get("cookie"),
    }));
    expect(requests).toEqual([
      {
        path: "/neondb/auth/revoke-other-sessions",
        cookie: "__Secure-neon-auth.session_token=fresh-session",
      },
      {
        path: "/neondb/auth/delete-user",
        cookie: "__Secure-neon-auth.session_token=fresh-session",
      },
    ]);
    expect(applied).toEqual(
      expect.arrayContaining([
        { name: "__Secure-neon-auth.session_token", value: "", maxAge: 0 },
        { name: "__Secure-neon-auth.local.session_data", value: "", maxAge: 0 },
      ]),
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
});
