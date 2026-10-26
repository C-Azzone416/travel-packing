import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import { parseAllowlist } from "./allowlist";
import {
  ACCESS_DENIED_PATH,
  AUTH_SCREEN_HEADER,
  handleRequest,
  isPublicPath,
  SIGN_IN_PATH,
} from "./proxy-handler";
import { CLOSE_ACCOUNT_PATH } from "./public-paths";

const OWNER = { userId: "u1", email: "owner@example.test" };
const OTHER = { userId: "u2", email: "intruder@example.test" };
const allowlist = parseAllowlist(OWNER.email);

let fake: FakeAuth;
beforeEach(() => {
  fake = createFakeAuth();
});

const request = (path: string, method = "GET") =>
  new NextRequest(new URL(path, "https://app.example.test"), { method });
const run = (path: string, method?: string) =>
  handleRequest(request(path, method), { provider: fake, allowlist });
const location = (response: Response) =>
  new URL(response.headers.get("location") ?? "", "https://app.example.test").pathname;

/** Every kind of protected target: app pages (including unknown ones) and API routes, any method. */
const PROTECTED_PAGES = [
  "/",
  "/trips",
  "/trips/abc",
  "/staples",
  "/settings",
  "/anything/else",
  "/sign-in/extra",
  "/access-denied-not",
];
const PROTECTED_API = ["/api", "/api/trips", "/api/trips/abc/items", "/api/staples", "/api/export"];

describe("isPublicPath", () => {
  it.each([
    [SIGN_IN_PATH, true],
    [`${SIGN_IN_PATH}/`, true],
    [ACCESS_DENIED_PATH, true],
    [`${ACCESS_DENIED_PATH}/`, true],
    [CLOSE_ACCOUNT_PATH, true],
    [`${CLOSE_ACCOUNT_PATH}/`, true],
    ["/", false],
    ["/sign-in/extra", false],
    ["/api/sign-in", false],
    ["/access-denied-not", false],
  ])("%s -> %s", (path, expected) => {
    expect(isPublicPath(path)).toBe(expected);
  });
});

describe("signed out", () => {
  it.each(PROTECTED_PAGES)("page %s redirects to sign-in with no-store", async (path) => {
    const response = await run(path);
    expect(response.status).toBe(307);
    expect(location(response)).toBe(SIGN_IN_PATH);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(
    PROTECTED_API.flatMap((path) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => [path, method]),
    ),
  )("API %s %s returns 401 with a generic body", async (path, method) => {
    const response = await run(path, method);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([SIGN_IN_PATH, ACCESS_DENIED_PATH, CLOSE_ACCOUNT_PATH])(
    "public page %s is reachable",
    async (path) => {
      const response = await run(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );
});

describe("non-allowlisted user", () => {
  beforeEach(() => {
    fake.current = OTHER;
  });

  it.each(PROTECTED_API)("API %s returns 403 and the session is cleared", async (path) => {
    fake.current = OTHER;
    const response = await run(path, "POST");
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Access denied" });
    expect(body).not.toContain(OTHER.email);
    expect(fake.current).toBeNull();
  });

  it.each(PROTECTED_PAGES)(
    "page %s redirects to access-denied and the session is cleared",
    async (path) => {
      fake.current = OTHER;
      const response = await run(path);
      expect(response.status).toBe(307);
      expect(location(response)).toBe(ACCESS_DENIED_PATH);
      expect(fake.current).toBeNull();
    },
  );

  it("does not need the user to visit a protected route: the next request is simply unauthenticated", async () => {
    await run("/trips");
    const next = await run("/trips");
    expect(location(next)).toBe(SIGN_IN_PATH);
  });
});

describe("allowlisted owner", () => {
  beforeEach(() => {
    fake.current = OWNER;
  });

  it.each([...PROTECTED_PAGES, ...PROTECTED_API])("%s passes through", async (path) => {
    const response = await run(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(fake.signOutCalls).toBe(0);
  });

  it("does not consult the provider for public pages", async () => {
    fake.failNextGetSession = true;
    expect((await run(SIGN_IN_PATH)).status).toBe(200);
    expect(fake.failNextGetSession).toBe(true);
  });
});

describe("provider failure", () => {
  it("fails closed for pages and APIs", async () => {
    fake.current = OWNER;
    fake.failNextGetSession = true;
    expect(location(await run("/trips"))).toBe(SIGN_IN_PATH);
    fake.failNextGetSession = true;
    expect((await run("/api/trips")).status).toBe(401);
  });
});

describe("auth-screen marker (so the layout can drop the app chrome)", () => {
  const forwarded = (response: Response, name = AUTH_SCREEN_HEADER) =>
    response.headers.get(`x-middleware-request-${name}`);
  const withHeader = (path: string) =>
    new NextRequest(new URL(path, "https://app.example.test"), {
      headers: { [AUTH_SCREEN_HEADER]: "1" },
    });
  const runRequest = (req: NextRequest) => handleRequest(req, { provider: fake, allowlist });

  it.each([SIGN_IN_PATH, ACCESS_DENIED_PATH, CLOSE_ACCOUNT_PATH])(
    "is set on the public screen %s",
    async (path) => {
      expect(forwarded(await run(path))).toBe("1");
    },
  );

  it("is not set on app pages for an allowlisted owner", async () => {
    fake.current = OWNER;
    expect(forwarded(await run("/trips"))).toBeNull();
  });

  it("a client-supplied marker is stripped from app pages, so it cannot hide the shell", async () => {
    fake.current = OWNER;
    const response = await runRequest(withHeader("/trips"));
    expect(forwarded(response)).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).not.toContain(AUTH_SCREEN_HEADER);
  });

  it("is forced to '1' (not echoed) on public screens regardless of what the client sent", async () => {
    const response = await runRequest(
      new NextRequest(new URL(SIGN_IN_PATH, "https://app.example.test"), {
        headers: { [AUTH_SCREEN_HEADER]: "something-else" },
      }),
    );
    expect(forwarded(response)).toBe("1");
  });
});
