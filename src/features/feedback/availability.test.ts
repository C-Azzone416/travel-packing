import { describe, expect, it } from "vitest";
import { PREVIEW_ORIGIN } from "@/server/auth/request-origin";
import {
  feedbackRuntimeAllowed,
  LOCAL_FEEDBACK_ORIGIN,
  PREVIEW_FEEDBACK_ORIGIN,
} from "./availability";

describe("feedbackRuntimeAllowed", () => {
  it("uses the same stable Preview origin as authentication and deployment", () => {
    expect(PREVIEW_FEEDBACK_ORIGIN).toBe(PREVIEW_ORIGIN);
  });

  it("allows only the exact approved origin in a development build", () => {
    expect(feedbackRuntimeAllowed(LOCAL_FEEDBACK_ORIGIN, true, false, false)).toBe(true);
    for (const origin of [
      "http://127.0.0.1:8080",
      "http://localhost:3000",
      "https://localhost:8080",
      PREVIEW_FEEDBACK_ORIGIN,
      "https://packed-smart.vercel.app",
      null,
    ]) {
      expect(feedbackRuntimeAllowed(origin, true, false, false)).toBe(false);
    }
  });

  it("allows only the exact stable origin in a Preview build", () => {
    expect(feedbackRuntimeAllowed(PREVIEW_FEEDBACK_ORIGIN, false, true, false)).toBe(true);
    for (const origin of [
      "https://travel-packing-git-feature-example.vercel.app",
      "https://travel-packing-preview.vercel.app.evil.example",
      "http://travel-packing-preview.vercel.app",
      "https://packed-smart.vercel.app",
      LOCAL_FEEDBACK_ORIGIN,
      null,
    ]) {
      expect(feedbackRuntimeAllowed(origin, false, true, false)).toBe(false);
    }
  });

  it("stays off in Production even when the URL looks local or Preview-like", () => {
    expect(feedbackRuntimeAllowed(LOCAL_FEEDBACK_ORIGIN, false, false, false)).toBe(false);
    expect(feedbackRuntimeAllowed(PREVIEW_FEEDBACK_ORIGIN, false, false, false)).toBe(false);
  });

  it("lets the synthetic e2e build run on its isolated test port", () => {
    expect(feedbackRuntimeAllowed("http://localhost:3100", false, false, true)).toBe(true);
  });
});
