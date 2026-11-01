import { describe, expect, it } from "vitest";
import { REDEMPTION_WINDOW_MINUTES, REDEMPTION_WINDOW_MS } from "@/domain/redemption-window";
import { REDEMPTION_WINDOW_MS as STORE_WINDOW_MS } from "@/server/feedback/enrollment-store";
import { disconnectText, isDisconnectSuccess } from "./disconnect-copy";
import type { DisconnectResult } from "./FeedbackAccess";

const ALL: DisconnectResult[] = [
  "ended",
  "nothing",
  "erased_unrevocable",
  "partial",
  "unavailable",
  "uncertain",
  "pending",
  "offline",
];

describe("disconnect copy (design's #261 spec, section 3)", () => {
  it("every result has its own distinct message", () => {
    const texts = ALL.map((key) => disconnectText(key, "2026-11-19T12:00:00.000Z"));
    expect(new Set(texts).size).toBe(ALL.length);
  });

  it("the exact words of each result", () => {
    expect(disconnectText("ended")).toBe("Disconnected. Your feedback access was ended.");
    expect(disconnectText("nothing")).toBe("You weren’t connected, so there was nothing to end.");
    expect(disconnectText("partial")).toBe(
      "Your feedback access was ended, but we couldn’t finish removing this app’s saved copy. Try again to finish.",
    );
    expect(disconnectText("unavailable")).toBe(
      "We couldn’t reach the service to end the access. You’re still connected. Try again.",
    );
    expect(disconnectText("uncertain")).toBe(
      "We couldn’t confirm whether your access was ended. You may still be connected. Try again.",
    );
    expect(disconnectText("offline")).toBe(
      "You’re offline, so nothing was changed. Disconnect again when you’re back online.",
    );
  });

  it("the pending message says up to 15 minutes, tied to the server's window, never 'a few'", () => {
    expect(STORE_WINDOW_MS).toBe(REDEMPTION_WINDOW_MS);
    expect(REDEMPTION_WINDOW_MINUTES).toBe(STORE_WINDOW_MS / 60_000);
    expect(disconnectText("pending")).toBe(
      `Connecting didn’t finish, so it can’t be ended just yet. Wait up to ${STORE_WINDOW_MS / 60_000} minutes and try again.`,
    );
    expect(disconnectText("pending")).toContain("up to 15 minutes");
    expect(disconnectText("pending")).not.toMatch(/few/);
  });

  it("erased_unrevocable names the date when it was known, and the deadline otherwise", () => {
    expect(disconnectText("erased_unrevocable", "2026-11-19T12:00:00.000Z")).toBe(
      "Disconnected. We removed this app’s copy of your feedback connection, but we couldn’t end the access itself. It stops on its own on Nov 19, 2026. Feedback can’t be sent from this app.",
    );
    for (const unknown of [null, undefined, "nonsense"]) {
      expect(disconnectText("erased_unrevocable", unknown)).toBe(
        "Disconnected. We removed this app’s copy of your feedback connection, but we couldn’t end the access itself. It stops on its own at the deadline Framebriar set. Feedback can’t be sent from this app.",
      );
    }
    expect(disconnectText("erased_unrevocable")).not.toMatch(/was ended|nothing to end/);
  });

  it("only the three finished results are successes", () => {
    expect(ALL.filter(isDisconnectSuccess)).toEqual(["ended", "nothing", "erased_unrevocable"]);
  });
});
