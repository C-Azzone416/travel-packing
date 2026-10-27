import { describe, expect, it } from "vitest";
import { SCREENSHOT_SEND_LIMIT_BYTES, fitsSendLimit } from "./screenshot-limit";

describe("the screenshot send limit", () => {
  it("is 4,000,000 bytes, under the host's ~4.5 MB request body limit", () => {
    expect(SCREENSHOT_SEND_LIMIT_BYTES).toBe(4_000_000);
  });

  it("accepts only an image strictly smaller than the limit", () => {
    expect(fitsSendLimit(0)).toBe(true);
    expect(fitsSendLimit(1)).toBe(true);
    expect(fitsSendLimit(3_999_999)).toBe(true);
    expect(fitsSendLimit(4_000_000)).toBe(false);
    expect(fitsSendLimit(4_000_001)).toBe(false);
  });

  it("refuses a size that is not a real byte count", () => {
    expect(fitsSendLimit(Number.NaN)).toBe(false);
    expect(fitsSendLimit(Number.POSITIVE_INFINITY)).toBe(false);
    expect(fitsSendLimit(-1)).toBe(false);
  });
});
