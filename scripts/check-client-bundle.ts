// Usage: tsx scripts/check-client-bundle.ts [dir]   (default .next/static, after `npm run build`)
// Fails if anything the browser can download names a server secret, contains a secret-shaped value, or contains
// server-only code. Findings name the file and the problem, never the matched text.

import { statSync } from "node:fs";
import { scanDirectory } from "../src/tooling/bundle-scan";

const dir = process.argv[2] ?? ".next/static";
try {
  statSync(dir);
} catch {
  console.error(`No ${dir} directory: run \`npm run build\` first.`);
  process.exit(2);
}
const findings = scanDirectory(dir);
if (findings.length) {
  for (const finding of findings.slice(0, 40)) console.error(`${finding.path}: ${finding.problem}`);
  console.error(`client bundle scan: ${findings.length} problem(s)`);
  process.exit(1);
}
console.log(`ok: nothing secret or server-only in ${dir}`);
