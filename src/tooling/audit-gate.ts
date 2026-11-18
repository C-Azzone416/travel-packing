export interface AuditAllowlistEntry {
  id: string;
  packages: string[];
  expires: string;
  issue: number;
  reason: string;
}
export interface AuditGateResult {
  passed: boolean;
  messages: string[];
}
type JsonObject = Record<string, unknown>;
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const GHSA = /\bGHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/i;
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function failure(message: string): AuditGateResult {
  return { passed: false, messages: [`ERROR: ${message}`] };
}
function cleanMetadataReport(report: JsonObject): boolean {
  if (!object(report.metadata) || !object(report.metadata.vulnerabilities)) return false;
  const totals = report.metadata.vulnerabilities;
  return (
    totals.total === 0 &&
    ["low", "moderate", "high", "critical"].every((key) => {
      const value = totals[key];
      return value === undefined || value === 0;
    })
  );
}
function validatedAllowlist(value: unknown): AuditAllowlistEntry[] | string {
  if (!Array.isArray(value)) return "audit allowlist must be an array";
  for (const entry of value) {
    if (
      !object(entry) ||
      typeof entry.id !== "string" ||
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(entry.id) ||
      !Array.isArray(entry.packages) ||
      entry.packages.length === 0 ||
      !entry.packages.every((name) => typeof name === "string" && name.length > 0) ||
      typeof entry.expires !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
      typeof entry.issue !== "number" ||
      !Number.isInteger(entry.issue) ||
      typeof entry.reason !== "string" ||
      entry.reason.length === 0
    ) {
      return "audit allowlist contains a malformed entry";
    }
    if (Number.isNaN(Date.parse(`${entry.expires}T23:59:59.999Z`))) {
      return `audit allowlist has an invalid expiry for ${entry.id}`;
    }
  }
  return value as AuditAllowlistEntry[];
}
function validatedVulnerabilities(report: unknown): JsonObject | string {
  if (!object(report)) return "npm audit report must be a JSON object";
  if (!("vulnerabilities" in report)) {
    return cleanMetadataReport(report)
      ? {}
      : "npm audit report has no vulnerabilities map or clean metadata totals";
  }
  if (!object(report.vulnerabilities)) return "npm audit vulnerabilities must be an object";
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (
      !object(finding) ||
      typeof finding.severity !== "string" ||
      !Array.isArray(finding.via) ||
      !finding.via.every(
        (via) =>
          (typeof via === "string" && via.length > 0) ||
          (object(via) && typeof via.severity === "string" && typeof via.url === "string"),
      )
    ) {
      return `npm audit finding for ${name} is malformed`;
    }
  }
  return report.vulnerabilities;
}
export function checkAuditReport(
  report: unknown,
  allowlistValue: unknown,
  now: Date,
): AuditGateResult {
  if (Number.isNaN(now.getTime())) return failure("audit gate received an invalid current date");
  const allowlist = validatedAllowlist(allowlistValue);
  if (typeof allowlist === "string") return failure(allowlist);
  const vulnerabilities = validatedVulnerabilities(report);
  if (typeof vulnerabilities === "string") return failure(vulnerabilities);

  const messages: string[] = [];
  const memo = new Map<string, { ids: Set<string>; errors: string[] }>();
  const resolve = (name: string, stack: string[]): { ids: Set<string>; errors: string[] } => {
    const cached = memo.get(name);
    if (cached) return cached;
    if (stack.includes(name)) {
      return { ids: new Set(), errors: [`${[...stack, name].join(" -> ")} is cyclic`] };
    }
    const finding = vulnerabilities[name];
    if (!object(finding) || !Array.isArray(finding.via)) {
      return { ids: new Set(), errors: [`${name} refers to a missing audit finding`] };
    }
    const ids = new Set<string>();
    const errors: string[] = [];
    for (const via of finding.via) {
      if (typeof via === "string") {
        const child = resolve(via, [...stack, name]);
        child.ids.forEach((id) => ids.add(id));
        errors.push(...child.errors);
        continue;
      }
      if (!BLOCKING_SEVERITIES.has(String(via.severity).toLowerCase())) continue;
      const id = GHSA.exec(String(via.url))?.[0].toUpperCase();
      if (!id) {
        errors.push(`${name} has a high/critical advisory without a GHSA URL`);
        continue;
      }
      const entry = allowlist.find(
        (candidate) => candidate.id.toUpperCase() === id && candidate.packages.includes(name),
      );
      if (!entry) {
        errors.push(`${name} has non-allowlisted advisory ${id}`);
        continue;
      }
      if (now.getTime() > Date.parse(`${entry.expires}T23:59:59.999Z`)) {
        errors.push(`${name} allowlist entry ${id} expired ${entry.expires}; see #${entry.issue}`);
        continue;
      }
      ids.add(id);
    }
    if (ids.size === 0 && errors.length === 0) {
      errors.push(`${name} has no allowlisted high/critical advisory chain`);
    }
    const result = { ids, errors };
    memo.set(name, result);
    return result;
  };

  for (const [name, finding] of Object.entries(vulnerabilities)) {
    if (!object(finding) || !BLOCKING_SEVERITIES.has(String(finding.severity).toLowerCase())) {
      continue;
    }
    const resolved = resolve(name, []);
    if (resolved.errors.length) {
      messages.push(...resolved.errors.map((message) => `ERROR: ${message}`));
    } else {
      const details = [...resolved.ids]
        .map((id) => {
          const entry = allowlist.find((candidate) => candidate.id.toUpperCase() === id);
          return `${id} until ${entry?.expires} (#${entry?.issue})`;
        })
        .join(", ");
      messages.push(`WARNING: allowing ${name} through ${details}`);
    }
  }
  const uniqueMessages = [...new Set(messages)];
  return {
    passed: !uniqueMessages.some((message) => message.startsWith("ERROR:")),
    messages: uniqueMessages,
  };
}
export function checkAuditJson(json: string, allowlist: unknown, now: Date): AuditGateResult {
  try {
    return checkAuditReport(JSON.parse(json), allowlist, now);
  } catch {
    return failure("npm audit output is not valid JSON");
  }
}
