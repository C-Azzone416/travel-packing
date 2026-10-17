import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import { parseAllowlist } from "./allowlist";
import { authorizeOwner } from "./guard";
import { setAuthLogSink } from "./safe-log";
import { signInOwner, signOutOwner } from "./sign-in";

const OWNER = { email: "owner@example.test", password: "correct horse", userId: "u1" };
const OTHER = { email: "intruder@example.test", password: "battery staple", userId: "u2" };

let fake: FakeAuth;
let logged: string[];
const events = () => logged.map((line) => JSON.parse(line).event);
const auth = () => ({ provider: fake, allowlist: parseAllowlist(OWNER.email) });

beforeEach(() => {
  fake = createFakeAuth([OWNER, OTHER]);
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});
afterEach(() => setAuthLogSink());

describe("signInOwner", () => {
  it("signs in an allowlisted owner", async () => {
    expect(await signInOwner(auth(), OWNER.email, OWNER.password)).toBe("ok");
    expect(fake.current).toMatchObject({ email: OWNER.email });
    expect(events()).toEqual(["sign-in-succeeded"]);
  });

  it("trims the email before checking credentials", async () => {
    expect(await signInOwner(auth(), `  ${OWNER.email} `, OWNER.password)).toBe("ok");
  });

  it("gives the same generic outcome for a wrong password and an unknown email", async () => {
    expect(await signInOwner(auth(), OWNER.email, "wrong")).toBe("invalid");
    expect(await signInOwner(auth(), "nobody@example.test", "wrong")).toBe("invalid");
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["sign-in-failed", "sign-in-failed"]);
  });

  it.each([
    ["missing email", undefined, "pw"],
    ["missing password", OWNER.email, undefined],
    ["blank email", "   ", "pw"],
    ["empty password", OWNER.email, ""],
    ["non-string fields", 42, {}],
  ])("rejects %s without calling the provider", async (_name, email, password) => {
    expect(await signInOwner(auth(), email, password)).toBe("invalid");
    expect(fake.current).toBeNull();
  });

  it("denies a valid account that is not allowlisted and ends the session", async () => {
    expect(await signInOwner(auth(), OTHER.email, OTHER.password)).toBe("denied");
    expect(fake.current).toBeNull();
    expect(fake.signOutCalls).toBe(1);
    expect(events()).toEqual(["sign-in-denied"]);
    expect(await authorizeOwner(fake, parseAllowlist(OWNER.email))).toEqual({
      status: "unauthenticated",
    });
  });

  it("still denies if ending the session fails", async () => {
    fake.failNextSignOut = true;
    expect(await signInOwner(auth(), OTHER.email, OTHER.password)).toBe("denied");
    expect(events()).toEqual(["sign-in-denied", "provider-error"]);
  });
});

describe("signOutOwner", () => {
  it("ends the session", async () => {
    fake.current = { userId: OWNER.userId, email: OWNER.email };
    await signOutOwner(fake);
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["sign-out"]);
  });

  it("swallows a provider failure", async () => {
    fake.failNextSignOut = true;
    await expect(signOutOwner(fake)).resolves.toBeUndefined();
    expect(events()).toEqual(["provider-error", "sign-out"]);
  });
});

describe("logs never contain emails, passwords, tokens, or provider error text", () => {
  it("across success, failure, denial, and provider failures", async () => {
    await signInOwner(auth(), OWNER.email, OWNER.password);
    await signOutOwner(fake);
    await signInOwner(auth(), OWNER.email, "wrong");
    await signInOwner(auth(), OTHER.email, OTHER.password);
    fake.failNextSignOut = true;
    await signInOwner(auth(), OTHER.email, OTHER.password);
    fake.current = { userId: OWNER.userId, email: OWNER.email };
    fake.failNextGetSession = true;
    await authorizeOwner(fake, parseAllowlist(OWNER.email));
    fake.failNextSignOut = true;
    await signOutOwner(fake);

    const output = logged.join("\n");
    expect(logged.length).toBeGreaterThan(5);
    for (const secret of [
      OWNER.email,
      OTHER.email,
      OWNER.password,
      OTHER.password,
      "example.test",
      "provider down",
      "u1",
      "u2",
    ]) {
      expect(output).not.toContain(secret);
    }
    for (const line of logged)
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(["event", "scope"]);
  });
});
