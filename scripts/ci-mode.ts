// First real step of the `ci` job: decides how much of CI this run does (src/tooling/ci-mode.ts) and writes `mode=` to
// GITHUB_OUTPUT. Reads EVENT_NAME, REF, PR_NUMBER, SHA, GITHUB_REPOSITORY and GH_TOKEN from the environment.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { decideMode, resolveDraft, treeWithFetch, type Lookups } from "../src/tooling/ci-mode";
import type { CiRun } from "../src/tooling/ci-gate";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: "utf8" }).trim();

const lookups: Lookups = {
  async pullRequestsOf(sha) {
    const out = run("gh", [
      "api",
      `repos/${repo}/commits/${sha}/pulls`,
      "--jq",
      "[.[] | {number, headSha: .head.sha}]",
    ]);
    return JSON.parse(out) as { number: number; headSha: string }[];
  },
  async treeOf(sha) {
    return treeWithFetch((args) => run("git", args), sha);
  },
  async runsFor(sha) {
    const out = run("gh", [
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--commit",
      sha,
      "--json",
      "status,conclusion,headSha,createdAt",
    ]);
    return JSON.parse(out) as CiRun[];
  },
};

// The event payload's draft flag can be stale; ask GitHub now. A lookup failure means "not a draft" (full validation).
function liveDraft(): boolean {
  try {
    return resolveDraft(
      run("gh", ["api", `repos/${repo}/pulls/${process.env.PR_NUMBER}`, "--jq", ".draft"]),
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const isPullRequest = process.env.EVENT_NAME === "pull_request";
  const decision = await decideMode(
    {
      event: process.env.EVENT_NAME ?? "",
      ref: process.env.REF ?? "",
      draft: isPullRequest && liveDraft(),
      sha: process.env.SHA ?? "",
    },
    lookups,
  );
  console.log(`ci mode: ${decision.mode} (${decision.reason})`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${decision.mode}\n`);
}

void main();
