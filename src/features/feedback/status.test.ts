import { describe, expect, it } from "vitest";
import type { EnrollmentView } from "./enrollment-client";
import { feedbackStatus } from "./status";

const view = (over: Partial<EnrollmentView> = {}): EnrollmentView => ({
  status: "not-connected",
  expiresAt: "2026-11-19T12:00:00.000Z",
  redemption: "none",
  outboxKey: "k".repeat(43),
  ...over,
});
const here = { online: true, rateLimited: false };

describe("feedbackStatus", () => {
  it("connected: can capture, has an expiry, no notice", () => {
    expect(feedbackStatus(view({ status: "connected" }), here)).toEqual({
      connection: "connected",
      expiresAt: "2026-11-19T12:00:00.000Z",
      pendingRedemption: false,
      online: true,
      rateLimited: false,
      connected: true,
      canCapture: true,
      notice: null,
    });
  });

  it("not connected: cannot capture, shows no expiry and (with nothing pending) no notice", () => {
    expect(feedbackStatus(view(), here)).toMatchObject({
      connected: false,
      canCapture: false,
      expiresAt: null,
      notice: null,
    });
  });

  it.each(["expired", "revoked", "disabled", "unavailable"] as const)(
    "%s names itself as the notice",
    (status) => {
      expect(feedbackStatus(view({ status }), here)).toMatchObject({
        connection: status,
        canCapture: false,
        notice: status,
      });
    },
  );

  it("a connection the server can no longer open names itself 'needs-reconnect' and cannot capture", () => {
    expect(feedbackStatus(view({ status: "needs_reconnect" }), here)).toMatchObject({
      connection: "needs_reconnect",
      connected: false,
      canCapture: false,
      notice: "needs-reconnect",
    });
  });

  it("a pending redemption asks to finish connecting, but only while not connected", () => {
    expect(feedbackStatus(view({ redemption: "pending" }), here)).toMatchObject({
      pendingRedemption: true,
      notice: "finish-connecting",
    });
    expect(
      feedbackStatus(view({ status: "connected", redemption: "pending" }), here),
    ).toMatchObject({
      pendingRedemption: false,
      notice: null,
    });
    expect(feedbackStatus(view({ status: "expired", redemption: "pending" }), here)).toMatchObject({
      notice: "expired",
    });
  });

  it("being offline or rate limited changes neither the connection nor the ability to save", () => {
    expect(
      feedbackStatus(view({ status: "connected" }), { online: false, rateLimited: true }),
    ).toMatchObject({
      online: false,
      rateLimited: true,
      connected: true,
      canCapture: true,
      notice: null,
    });
  });
});
