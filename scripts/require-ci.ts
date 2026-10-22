// "Is CI green for exactly this commit?" Usage: tsx scripts/require-ci.ts <full-sha | pull-request-number>
// Exits 0 only when the latest CI run on that exact commit is complete and successful (src/tooling/ci-gate.ts). Used by the
// manual production deploy (once, no waiting) and by anyone about to merge: `npm run ci:gate -- <pr number>`.
import { execFileSync } from "node:child_process";
import { ciVerdict, type CiRun } from "../src/tooling/ci-gate";

const arg = (process.argv[2] ?? "").trim();
if (!arg) {
  console.error("usage: require-ci <full-sha | pull-request-number>");
  process.exit(2);
}
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const sha = /^\d+$/.test(arg)
  ? gh(["pr", "view", arg, "--json", "headRefOid", "--jq", ".headRefOid"])
  : arg;
const runs = JSON.parse(
  gh([
    "run",
    "list",
    "--workflow",
    "ci.yml",
    "--commit",
    sha,
    "--json",
    "status,conclusion,headSha,createdAt",
  ]),
) as CiRun[];
const verdict = ciVerdict(runs, sha);
console.log(verdict.ok ? `ci for ${sha}: success` : `ci for ${sha}: NOT green: ${verdict.reason}`);
process.exit(verdict.ok ? 0 : 1);
