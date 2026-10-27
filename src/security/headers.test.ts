import { describe, expect, it } from "vitest";
import { FEEDBACK_ENDPOINT } from "@masra91/framebriar/browser/feedback-runtime";
import { contentSecurityPolicy, FEEDBACK_ORIGIN, securityHeaders } from "./headers";

const value = (development: boolean, key: string, feedback = development) =>
  securityHeaders(development, feedback).find((rule) => rule.key === key)?.value;

describe("contentSecurityPolicy", () => {
  const production = contentSecurityPolicy(false);

  it("forbids framing, plugins and foreign form targets, and pins the base URI", () => {
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("frame-src 'none'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("base-uri 'self'");
    expect(production).toContain("form-action 'self'");
  });

  it("allows no foreign origin in a hosted production policy", () => {
    expect(production).toContain("default-src 'self'");
    expect(production).toContain("connect-src 'self'");
    expect(production).not.toContain(FEEDBACK_ORIGIN);
    expect(FEEDBACK_ORIGIN).toBe(new URL(FEEDBACK_ENDPOINT).origin);
    expect(production).toContain("font-src 'self'");
    expect(production).toContain("script-src 'self' 'unsafe-inline'");
    expect(production).not.toMatch(/\*|https?:\/\//);
  });

  it("allows Framebriar only when the build contains the Preview/local/test feature", () => {
    const local = contentSecurityPolicy(true, true);
    const e2e = contentSecurityPolicy(false, true);
    expect(local).toContain(`connect-src 'self' ${FEEDBACK_ORIGIN} ws: wss:`);
    expect(e2e).toContain(`connect-src 'self' ${FEEDBACK_ORIGIN}`);
    expect(e2e).not.toMatch(/\bwss?:/);
  });

  it("never allows eval or websockets in production, only in development", () => {
    expect(production).not.toContain("unsafe-eval");
    expect(production).not.toMatch(/\bwss?:/);
    const development = contentSecurityPolicy(true);
    expect(development).toContain("'unsafe-eval'");
    expect(development).toContain("ws: wss:");
  });
});

describe("securityHeaders", () => {
  it("sends each header once with the policy values", () => {
    const keys = securityHeaders(false).map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(value(false, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(value(false, "X-Frame-Options")).toBe("DENY");
    expect(value(false, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(false, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(false, "Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(value(false, "Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
  });

  it("uses the production policy for the CSP header unless in development", () => {
    expect(value(false, "Content-Security-Policy", false)).toBe(
      contentSecurityPolicy(false, false),
    );
    expect(value(true, "Content-Security-Policy", true)).toBe(contentSecurityPolicy(true, true));
  });
});
