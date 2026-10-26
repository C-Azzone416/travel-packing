import { describe, expect, it } from "vitest";
import { feedbackRuntimeAllowed, LOCAL_FEEDBACK_ORIGIN } from "./availability";

describe("feedbackRuntimeAllowed", () => {
  it("allows only the exact approved origin in a development build", () => {
    expect(feedbackRuntimeAllowed(LOCAL_FEEDBACK_ORIGIN, true, false)).toBe(true);
    for (const origin of [
      "http://127.0.0.1:8080",
      "http://localhost:3000",
      "https://localhost:8080",
      "https://travel-packing-preview.vercel.app",
      "https://packed-smart.vercel.app",
      null,
    ]) {
      expect(feedbackRuntimeAllowed(origin, true, false)).toBe(false);
    }
  });

  it("stays off in a hosted-style production build even when the URL looks local", () => {
    expect(feedbackRuntimeAllowed(LOCAL_FEEDBACK_ORIGIN, false, false)).toBe(false);
  });

  it("lets the synthetic e2e build run on its isolated test port", () => {
    expect(feedbackRuntimeAllowed("http://localhost:3100", false, true)).toBe(true);
  });
});
