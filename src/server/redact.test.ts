import { afterEach, describe, expect, it, vi } from "vitest";
import { logInfo, logWarning, redact, redactFields, REDACTED, setLogSink } from "./redact";

afterEach(() => setLogSink());

describe("redact", () => {
  it.each([
    ["an email", "signed in as owner@example.test today", "owner@example.test"],
    ["an ISO date", "trip 2026-10-23 failed", "2026-10-23"],
    ["an ISO date-time", "at 2026-10-23T12:30:00Z", "2026-10-23T12:30:00Z"],
    ["a slash date", "left on 10/23/2026", "10/23/2026"],
    ["a month-name date", "Oct 23, 2026 and Dec 4", "Oct 23, 2026"],
    [
      "a database URL with credentials",
      "connect postgres://user:hunter2@db.example.test/app failed",
      "hunter2",
    ],
    ["a bearer token", "header Bearer abcdef0123456789abcdef", "abcdef0123456789abcdef"],
  ])("scrubs %s", (_name, text, secret) => {
    const out = redact(text);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("scrubs every occurrence and leaves ordinary words alone", () => {
    expect(redact("a@b.test and c@d.test on 2026-01-02 and 2026-01-03")).toBe(
      `${REDACTED} and ${REDACTED} on ${REDACTED} and ${REDACTED}`,
    );
    expect(redact("auth unavailable: NEON_AUTH_BASE_URL is not set")).toBe(
      "auth unavailable: NEON_AUTH_BASE_URL is not set",
    );
  });

  it("scrubs a database URL's host as well as its password", () => {
    const out = redact("postgres://u:p@db.example.test/x");
    expect(out).not.toContain("db.example.test");
    expect(out).not.toContain("u:p");
  });
});

describe("redactFields", () => {
  it.each(["email", "destination", "location", "name", "items", "start", "end", "query", "token"])(
    "never keeps the value of %s",
    (key) => {
      expect(redactFields({ [key]: "Lisbon" })).toEqual({ [key]: REDACTED });
      expect(redactFields({ [key.toUpperCase()]: "Lisbon" })).toEqual({
        [key.toUpperCase()]: REDACTED,
      });
    },
  );

  it("redacts text inside other fields, hides objects, and keeps harmless values", () => {
    expect(
      redactFields({ code: "INTERNAL", count: 3, ok: false, note: "for a@b.test", deep: { a: 1 } }),
    ).toEqual({ code: "INTERNAL", count: 3, ok: false, note: `for ${REDACTED}`, deep: REDACTED });
  });
});

describe("logInfo / logWarning", () => {
  it("emit one JSON line with the message and fields redacted, at the right level", () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    logWarning("failed for owner@example.test", { destination: "Lisbon", status: 500 });
    logInfo("plain");
    expect(lines).toHaveLength(2);
    const warn = JSON.parse(lines[0]);
    expect(warn).toEqual({
      level: "warn",
      message: `failed for ${REDACTED}`,
      fields: { destination: REDACTED, status: 500 },
    });
    expect(lines[0]).not.toContain("Lisbon");
    expect(lines[0]).not.toContain("owner@");
    expect(JSON.parse(lines[1])).toEqual({ level: "info", message: "plain" });
  });

  it("write to the console (warn / info) when no sink is installed, still redacted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logWarning("x 2026-10-23");
    logInfo("y a@b.test");
    expect(warn.mock.calls[0][0]).not.toContain("2026-10-23");
    expect(info.mock.calls[0][0]).not.toContain("a@b.test");
    warn.mockRestore();
    info.mockRestore();
  });
});
