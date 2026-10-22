// #27: a user whose email is NOT verified is denied everywhere, even when the address is on OWNER_EMAIL_ALLOWLIST.
// The provider here is the real Neon adapter over a stand-in SDK that reports the allowlisted owner with
// emailVerified false, null, missing, or a non-boolean. Every entry point below must refuse them: page routes (the
// proxy), API routes, server actions (withOwner), the data layer (run), and sign-in itself. Verified controls stay on.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Db } from "../db/retention";
import { run } from "../data/run";
import { setDataLogSink } from "../data/safe-log";
import { createSearchRoute } from "../locations/route-handler";
import { createRateLimiter } from "../locations/rate-limit";
import { parseAllowlist } from "./allowlist";
import { AuthFailure, requireOwner, withOwner } from "./guard";
import { createNeonAuthProvider, type NeonAuthLike } from "./neon-adapter";
import { handleRequest } from "./proxy-handler";
import { setAuthLogSink } from "./safe-log";
import { signInOwner } from "./sign-in";
import type { AuthProvider } from "./types";

const OWNER_EMAIL = "owner@example.test";
const allowlist = parseAllowlist(OWNER_EMAIL);

const UNVERIFIED = [
  ["false", { emailVerified: false }],
  ["null", { emailVerified: null }],
  ["missing", {}],
  ["the string 'true'", { emailVerified: "true" }],
  ["the number 1", { emailVerified: 1 }],
] as const;

type User = Record<string, unknown>;

/** A provider whose SDK reports `user` as signed in (and as the result of a password sign-in). */
function providerFor(user: User | null): AuthProvider {
  const signedIn = user && { id: "u1", email: OWNER_EMAIL, ...user };
  const neon = {
    getSession: async () => ({ data: signedIn ? { user: signedIn } : null }),
    signIn: { email: async () => ({ data: signedIn ? { user: signedIn } : null }) },
    signOut: async () => undefined,
  } as unknown as NeonAuthLike;
  return createNeonAuthProvider(neon);
}

beforeEach(() => {
  setAuthLogSink(() => {});
  setDataLogSink(() => {});
});
afterEach(() => {
  setAuthLogSink();
  setDataLogSink();
});

const request = (path: string, method = "GET") =>
  new NextRequest(new URL(path, "https://app.example.test"), { method });
const location = (response: Response) =>
  new URL(response.headers.get("location") ?? "", "https://app.example.test").pathname;

describe.each(UNVERIFIED)("an allowlisted address with emailVerified %s", (_name, flag) => {
  const provider = () => providerFor(flag);

  it("has no session at all", async () => {
    expect(await provider().getSession()).toBeNull();
  });

  it("is sent to sign-in from every page route, and refused 401 on every API route", async () => {
    for (const path of ["/", "/trips", "/trips/abc", "/staples", "/settings"]) {
      const response = await handleRequest(request(path), { provider: provider(), allowlist });
      expect(response.status).toBe(307);
      expect(location(response)).toBe("/sign-in");
    }
    for (const [path, method] of [
      ["/api/locations/search", "GET"],
      ["/api/trips", "POST"],
      ["/api/staples", "DELETE"],
    ] as const) {
      const response = await handleRequest(request(path, method), {
        provider: provider(),
        allowlist,
      });
      expect(response.status).toBe(401);
    }
  });

  it("is refused by the place-search API route before any search runs", async () => {
    const search = vi.fn();
    const GET = createSearchRoute({
      getAuth: async () => ({ provider: provider(), allowlist }),
      search,
      limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    });
    const response = await GET(new Request("http://app.test/api/locations/search?q=London"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(search).not.toHaveBeenCalled();
  });

  it("cannot run a server action wrapped in withOwner", async () => {
    const action = vi.fn(async () => "did the thing");
    const guarded = withOwner(async () => ({ provider: provider(), allowlist }), action);
    await expect(guarded()).rejects.toMatchObject({ code: "UNAUTHENTICATED", httpStatus: 401 });
    expect(action).not.toHaveBeenCalled();
    await expect(requireOwner(provider(), allowlist)).rejects.toBeInstanceOf(AuthFailure);
  });

  it("is refused by the data layer before the database is touched", async () => {
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error("the database must not be used");
        },
      },
    ) as Db;
    const handler = vi.fn();
    const result = await run(
      { db, auth: { provider: provider(), allowlist }, now: () => new Date(0) },
      z.object({}),
      {},
      handler,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("cannot sign in: the only outcome is 'unverified' (a new code), never a session", async () => {
    const owner = provider();
    expect(await signInOwner({ provider: owner, allowlist }, OWNER_EMAIL, "right-password")).toBe(
      "unverified",
    );
    expect(await owner.getSession()).toBeNull();
  });
});

describe("the same address once verified", () => {
  const verified = () => providerFor({ emailVerified: true });

  it("gets in everywhere the allowlist allows", async () => {
    expect(
      (await handleRequest(request("/trips"), { provider: verified(), allowlist })).status,
    ).toBe(200);
    expect(await requireOwner(verified(), allowlist)).toEqual({ userId: "u1", email: OWNER_EMAIL });
    expect(await signInOwner({ provider: verified(), allowlist }, OWNER_EMAIL, "pw")).toBe("ok");
  });

  it("is still refused when it is not on the allowlist (verification alone grants nothing)", async () => {
    const stranger = providerFor({ emailVerified: true, email: "stranger@example.test" });
    const response = await handleRequest(request("/trips"), { provider: stranger, allowlist });
    expect(location(response)).toBe("/access-denied");
  });
});

describe("the account screens never need a session", () => {
  it.each(["/sign-up", "/verify", "/forgot-password", "/reset-password"])(
    "%s is reachable signed out and without a verified session",
    async (path) => {
      const provider = providerFor({ emailVerified: false });
      const response = await handleRequest(request(path), { provider, allowlist });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );
});
