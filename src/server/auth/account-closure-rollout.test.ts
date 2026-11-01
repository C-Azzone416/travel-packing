import { describe, expect, it } from "vitest";
import { accountClosureEnabled } from "./account-closure-rollout";

describe("accountClosureEnabled", () => {
  it("enables only the exact deliberate server value", () => {
    expect(accountClosureEnabled({ CLOSE_ACCOUNT_ENABLED: "1" })).toBe(true);
  });

  it.each([undefined, "", "0", "true", "TRUE", " 1 ", "yes", "2"])(
    "fails closed for %j",
    (value) => {
      expect(accountClosureEnabled({ CLOSE_ACCOUNT_ENABLED: value })).toBe(false);
    },
  );
});
