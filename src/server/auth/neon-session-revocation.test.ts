import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeonSessionRevoker } from "./neon-session-revocation";

const config = {
  baseUrl: "https://auth.example.test/neondb/auth/",
  cookieSecret: "s".repeat(40),
};

const requestHeaders = async () =>
  new Headers({
    cookie: "__Secure-neon-auth.session_token=synthetic-session; appearance=synthetic-appearance",
    origin: "https://app.example.test",
  });

afterEach(() => vi.unstubAllGlobals());

describe("Neon account-closure session revocation", () => {
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
