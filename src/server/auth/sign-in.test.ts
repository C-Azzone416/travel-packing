import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import { withSetupGate, type AccountSetupStore } from "./account-setup";
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
    expect(events()).toEqual(["sign-in-credentials-rejected", "sign-in-credentials-rejected"]);
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

  it("gives invalid input its own correlated event", async () => {
    const reference = "abcdef012345";
    expect(await signInOwner(auth(), "not-an-email", "pw", reference)).toBe("invalid");
    expect(JSON.parse(logged.at(-1) ?? "{}")).toEqual({
      scope: "auth",
      event: "sign-in-input-invalid",
      reference,
    });
  });

  it("reports a right password for an account never set up through a link as 'unfinished', with no session", async () => {
    fake = createFakeAuth([{ ...OWNER, unfinished: true }]);
    expect(await signInOwner(auth(), OWNER.email, OWNER.password)).toBe("unfinished");
    expect(fake.current).toBeNull();
    expect(events()).toEqual(["sign-in-setup-pending"]);
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
    expect(events()).toEqual(["sign-in-denied", "sign-in-session-cleanup-failed"]);
  });

  it("correlates the bounded provider class without logging credentials or identity", async () => {
    const reference = "012345abcdef";
    expect(await signInOwner(auth(), OWNER.email, "secret-wrong", reference)).toBe("invalid");
    expect(JSON.parse(logged[0])).toEqual({
      scope: "auth",
      event: "sign-in-credentials-rejected",
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
      reference,
    });
    expect(logged[0]).not.toContain(OWNER.email);
    expect(logged[0]).not.toContain("secret-wrong");
  });

  it.each([
    ["provider-rate-limited", "sign-in-provider-rate-limited"],
    ["provider-unavailable", "sign-in-provider-unavailable"],
    ["provider-rejected", "sign-in-provider-rejected"],
    ["provider-response-invalid", "sign-in-provider-response-invalid"],
    ["session-not-created", "sign-in-session-not-created"],
  ] as const)("logs %s as %s with the same reference", async (reason, event) => {
    fake.signInWithPassword = async () => ({
      ok: false,
      diagnostic: {
        reason,
        rejection: { status: 503, code: "INTERNAL_ERROR" },
      },
    });
    const reference = "fedcba654321";
    expect(await signInOwner(auth(), OWNER.email, OWNER.password, reference)).toBe("invalid");
    expect(JSON.parse(logged[0])).toEqual({
      scope: "auth",
      event,
      status: 503,
      code: "INTERNAL_ERROR",
      reference,
    });
  });

  it.each([
    ["cleanup succeeds", false, ["sign-in-setup-unavailable"]],
    ["cleanup fails", true, ["sign-in-setup-unavailable", "sign-in-session-cleanup-failed"]],
  ])(
    "composes the real setup gate when the store throws and %s",
    async (_name, cleanupFails, expectedEvents) => {
      const store: AccountSetupStore = {
        completedAt: async () => {
          throw new Error("database secret for owner@example.test");
        },
        markComplete: async () => {},
      };
      fake.failNextSignOut = cleanupFails;
      const allowlist = parseAllowlist(OWNER.email);
      const provider = withSetupGate(fake, store, allowlist);
      const password = "correct horse";
      const reference = "123456abcdef";

      expect(await signInOwner({ provider, allowlist }, OWNER.email, password, reference)).toBe(
        "unfinished",
      );
      expect(logged.map((line) => JSON.parse(line))).toEqual(
        expectedEvents.map((event) => ({ scope: "auth", event, reference })),
      );

      const output = logged.join("\n");
      for (const sensitive of [OWNER.email, password, "database secret"]) {
        expect(output).not.toContain(sensitive);
      }
    },
  );
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
    for (const line of logged) {
      const keys = Object.keys(JSON.parse(line));
      expect(keys).toEqual(expect.arrayContaining(["event", "scope"]));
      expect(
        keys.every((key) => ["scope", "event", "status", "code", "reference"].includes(key)),
      ).toBe(true);
    }
  });
});
