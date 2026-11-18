import { describe, expect, it } from "vitest";
import { checkAuditJson, checkAuditReport, type AuditAllowlistEntry } from "./audit-gate";

const TODAY = new Date("2026-11-17T12:00:00Z");
const ALLOWLIST: AuditAllowlistEntry[] = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    packages: ["picomatch"],
    expires: "2026-12-18",
    issue: 536,
    reason: "no fix upstream; reached only through build tooling",
  },
];
const advisory = (id = "GHSA-fc5q-39xc-vjpf", severity = "high") => ({
  source: 1234,
  name: "picomatch",
  dependency: "picomatch",
  title: "Regular expression denial of service",
  url: `https://github.com/advisories/${id}`,
  severity,
  range: "<=4.0.7",
});
const finding = (severity: string, via: unknown[]) => ({
  name: "package",
  severity,
  isDirect: false,
  via,
  effects: [],
  range: "*",
  nodes: ["node_modules/package"],
  fixAvailable: false,
});
const report = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    picomatch: finding("high", [advisory()]),
    fdir: finding("high", ["picomatch"]),
    tinyglobby: finding("high", ["fdir", "picomatch"]),
    vite: finding("high", ["picomatch"]),
    vitest: finding("high", ["vite"]),
  },
  metadata: { vulnerabilities: { low: 0, moderate: 0, high: 5, critical: 0, total: 5 } },
});

describe("checkAuditReport", () => {
  it("allows the one advisory and every dependent that resolves only to it", () => {
    const result = checkAuditReport(report(), ALLOWLIST, TODAY);
    expect(result.passed).toBe(true);
    expect(result.messages).toHaveLength(5);
    expect(result.messages.every((message) => message.startsWith("WARNING:"))).toBe(true);
    expect(result.messages.join("\n")).toMatch(/vitest.*GHSA-fc5q-39xc-vjpf.*#536/i);
  });

  it("fails when another high advisory is present", () => {
    const input = report();
    Object.assign(input.vulnerabilities, {
      other: finding("high", [advisory("GHSA-1111-2222-3333")]),
    });
    const result = checkAuditReport(input, ALLOWLIST, TODAY);
    expect(result.passed).toBe(false);
    expect(result.messages.join("\n")).toMatch(/other.*GHSA-1111-2222-3333/);
  });

  it("does not match a different critical advisory on the allowlisted package", () => {
    const input = report();
    input.vulnerabilities.picomatch = finding("critical", [
      advisory("GHSA-4444-5555-6666", "critical"),
    ]);
    const result = checkAuditReport(input, ALLOWLIST, TODAY);
    expect(result.passed).toBe(false);
    expect(result.messages.join("\n")).toMatch(/picomatch.*GHSA-4444-5555-6666/);
  });

  it("fails a dependent when any of its chains is not allowlisted", () => {
    const input = report();
    Object.assign(input.vulnerabilities, {
      unsafe: finding("high", [advisory("GHSA-7777-8888-9999")]),
      dependent: finding("high", ["picomatch", "unsafe"]),
    });
    const result = checkAuditReport(input, ALLOWLIST, TODAY);
    expect(result.passed).toBe(false);
    expect(result.messages.join("\n")).toMatch(/dependent|unsafe/);
    expect(result.messages.join("\n")).toMatch(/GHSA-7777-8888-9999/);
  });

  it("fails after the inclusive UTC expiry and names the tracking issue", () => {
    expect(checkAuditReport(report(), ALLOWLIST, new Date("2026-12-19T00:00:00Z"))).toMatchObject({
      passed: false,
      messages: [expect.stringMatching(/expired.*#536/)],
    });
    expect(checkAuditReport(report(), ALLOWLIST, new Date("2026-12-18T23:59:59.999Z")).passed).toBe(
      true,
    );
  });

  it("ignores moderate and low findings", () => {
    const input = {
      vulnerabilities: {
        moderate: finding("moderate", [advisory("GHSA-1111-2222-3333", "moderate")]),
        low: finding("low", [advisory("GHSA-4444-5555-6666", "low")]),
      },
    };
    expect(checkAuditReport(input, ALLOWLIST, TODAY)).toEqual({ passed: true, messages: [] });
  });

  it("fails closed on malformed JSON or structure", () => {
    expect(checkAuditJson("{", ALLOWLIST, TODAY).passed).toBe(false);
    expect(checkAuditReport({}, ALLOWLIST, TODAY).passed).toBe(false);
    expect(checkAuditReport({ vulnerabilities: [] }, ALLOWLIST, TODAY).passed).toBe(false);
    expect(
      checkAuditReport({ vulnerabilities: { bad: { severity: "high" } } }, ALLOWLIST, TODAY).passed,
    ).toBe(false);
  });

  it("passes clean reports with an empty map or clean metadata totals", () => {
    expect(checkAuditReport({ vulnerabilities: {} }, ALLOWLIST, TODAY).passed).toBe(true);
    expect(
      checkAuditReport(
        { metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } },
        ALLOWLIST,
        TODAY,
      ).passed,
    ).toBe(true);
  });

  it("matches the advisory only for an explicitly listed package", () => {
    const input = { vulnerabilities: { impostor: finding("high", [advisory()]) } };
    expect(checkAuditReport(input, ALLOWLIST, TODAY).messages.join("\n")).toMatch(
      /impostor.*non-allowlisted/,
    );
  });

  it.each([
    [{ cycleA: finding("high", ["cycleB"]), cycleB: finding("high", ["cycleA"]) }, /cyclic/],
    [{ dependent: finding("high", ["missing"]) }, /missing audit finding/],
    [
      { direct: finding("high", [{ ...advisory(), url: "https://example.test" }]) },
      /without a GHSA URL/,
    ],
    [
      { inconsistent: finding("high", [advisory("GHSA-1111-2222-3333", "low")]) },
      /no allowlisted high\/critical advisory chain/,
    ],
  ])("fails an unresolved advisory graph %#", (vulnerabilities, message) => {
    expect(checkAuditReport({ vulnerabilities }, ALLOWLIST, TODAY).messages.join("\n")).toMatch(
      message,
    );
  });
});
