import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import { parseAllowlist } from "./allowlist";
import { AuthFailure, authorizeOwner, requireOwner, withOwner } from "./guard";
import { setAuthLogSink } from "./safe-log";

const OWNER = { userId: "user-1", email: "owner@example.test" };
const OTHER = { userId: "user-2", email: "intruder@example.test" };
const allowlist = parseAllowlist("owner@example.test");

let fake: FakeAuth;
let logged: string[];

beforeEach(() => {
  fake = createFakeAuth();
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});

afterEach(() => {
  setAuthLogSink();
});

describe("authorizeOwner", () => {
  it("lets an allowlisted owner through", async () => {
    fake.current = OWNER;
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "ok", session: OWNER });
    expect(fake.signOutCalls).toBe(0);
  });

  it("treats a signed-out request as unauthenticated", async () => {
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "unauthenticated" });
    expect(logged).toEqual([JSON.stringify({ scope: "auth", event: "unauthenticated" })]);
  });

  it("denies a non-allowlisted user and ends their session", async () => {
    fake.current = OTHER;
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "forbidden" });
    expect(fake.signOutCalls).toBe(1);
    expect(fake.current).toBeNull();
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "unauthenticated" });
  });

  it("denies everyone when the allowlist is empty", async () => {
    fake.current = OWNER;
    expect(await authorizeOwner(fake, new Set())).toEqual({ status: "forbidden" });
  });

  it("still denies if ending the session fails", async () => {
    fake.current = OTHER;
    fake.failNextSignOut = true;
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "forbidden" });
    expect(logged.map((line) => JSON.parse(line).event)).toEqual(["forbidden", "provider-error"]);
  });

  it("fails closed when the provider throws while reading the session", async () => {
    fake.current = OWNER;
    fake.failNextGetSession = true;
    expect(await authorizeOwner(fake, allowlist)).toEqual({ status: "unauthenticated" });
    expect(logged.map((line) => JSON.parse(line).event)).toEqual(["provider-error"]);
  });
});

describe("requireOwner (data-layer gate)", () => {
  it("returns the session for an allowlisted owner", async () => {
    fake.current = OWNER;
    expect(await requireOwner(fake, allowlist)).toEqual(OWNER);
  });

  it("throws a generic 401 when signed out", async () => {
    const error = await requireOwner(fake, allowlist).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthFailure);
    expect(error).toMatchObject({
      code: "UNAUTHENTICATED",
      httpStatus: 401,
      message: "Authentication required",
    });
  });

  it("throws a generic 403 for a non-allowlisted user and clears the session", async () => {
    fake.current = OTHER;
    const error = (await requireOwner(fake, allowlist).catch(
      (caught: unknown) => caught,
    )) as AuthFailure;
    expect(error).toMatchObject({ code: "FORBIDDEN", httpStatus: 403, message: "Access denied" });
    expect(error.message).not.toContain(OTHER.email);
    expect(fake.current).toBeNull();
  });
});

describe("withOwner: the allowlist holds even if the UI route guard is bypassed", () => {
  const getAuth = async () => ({ provider: fake, allowlist });

  it("runs the handler for an allowlisted owner, passing the session and arguments", async () => {
    fake.current = OWNER;
    const action = withOwner(
      getAuth,
      async (session, a: number, b: number) => `${session.userId}:${a + b}`,
    );
    expect(await action(2, 3)).toBe("user-1:5");
  });

  it("never runs the handler when signed out", async () => {
    let ran = false;
    const action = withOwner(getAuth, async () => {
      ran = true;
    });
    await expect(action()).rejects.toMatchObject({ code: "UNAUTHENTICATED", httpStatus: 401 });
    expect(ran).toBe(false);
  });

  it("never runs the handler for a non-allowlisted user, and ends their session", async () => {
    fake.current = OTHER;
    let ran = false;
    const action = withOwner(getAuth, async () => {
      ran = true;
    });
    await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
    expect(ran).toBe(false);
    expect(fake.current).toBeNull();
  });
});
