// npm exits non-zero when it finds vulnerabilities; its JSON stdout is still the input to the gate.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAuditJson } from "../src/tooling/audit-gate";

let allowlist: unknown;
try {
  allowlist = JSON.parse(readFileSync("audit-allowlist.json", "utf8"));
} catch {
  console.error("ERROR: audit-allowlist.json is unreadable or invalid JSON");
  process.exit(1);
}

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const result = checkAuditJson(audit.stdout ?? "", allowlist, new Date());
for (const message of result.messages) {
  if (message.startsWith("WARNING:")) console.warn(message);
  else console.error(message);
}
process.exit(result.passed ? 0 : 1);
