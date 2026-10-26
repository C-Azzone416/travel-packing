import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountClosureSignals } from "./account-closure-signal";

const mocks = vi.hoisted(() => ({
  value: undefined as string | undefined,
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.value === undefined ? undefined : { name, value: mocks.value }),
    set: mocks.set,
  }),
}));

import {
  ACCOUNT_CLOSURE_COMPLETE_PATH,
  ACCOUNT_CLOSURE_COMPLETION_COOKIE,
  consumeAccountClosureCompletion,
  issueAccountClosureCompletion,
} from "./account-closure-completion";

const signals = createAccountClosureSignals(
  "s".repeat(40),
  () => 1_800_000_000_000,
  () => "A".repeat(32),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.value = undefined;
  mocks.set.mockImplementation((_name: string, value: string, options: { maxAge?: number }) => {
    mocks.value = options.maxAge === 0 ? undefined : value;
  });
});

describe("account closure completion cookie", () => {
  it("is short-lived, httpOnly, strict same-site, path-scoped, and contains no identity", async () => {
    expect(await issueAccountClosureCompletion(signals)).toBe(true);
    const [name, value, options] = mocks.set.mock.calls[0];
    expect(name).toBe(ACCOUNT_CLOSURE_COMPLETION_COOKIE);
    expect(value).not.toContain("@");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: ACCOUNT_CLOSURE_COMPLETE_PATH,
      maxAge: 300,
    });
  });

  it("consumes the exact-path cookie before accepting it and rejects missing or altered values", async () => {
    mocks.value = signals.issue();
    expect(await consumeAccountClosureCompletion(signals)).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(
      ACCOUNT_CLOSURE_COMPLETION_COOKIE,
      "",
      expect.objectContaining({ path: ACCOUNT_CLOSURE_COMPLETE_PATH, maxAge: 0 }),
    );
    expect(await consumeAccountClosureCompletion(signals)).toBe(false);

    mocks.set.mockClear();
    mocks.value = `${signals.issue()}x`;
    expect(await consumeAccountClosureCompletion(signals)).toBe(false);
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });

  it("fails closed when cookies cannot be written", async () => {
    mocks.set.mockImplementationOnce(() => {
      throw new Error("cookie unavailable");
    });
    expect(await issueAccountClosureCompletion(signals)).toBe(false);
  });

  it("fails closed when a signal cannot be issued", async () => {
    await expect(
      issueAccountClosureCompletion({
        issue: () => {
          throw new Error("entropy unavailable");
        },
        open: () => false,
      }),
    ).resolves.toBe(false);
  });
});
