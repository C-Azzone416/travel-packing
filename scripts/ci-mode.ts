// First real step of the `ci` job: decides how much of CI this run does (src/tooling/ci-mode.ts) and writes `mode=` to
// GITHUB_OUTPUT. Reads EVENT_NAME, REF, DRAFT, SHA, GITHUB_REPOSITORY and GH_TOKEN from the environment.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { decideMode, type Lookups } from "../src/tooling/ci-mode";
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
    // The pull request's head may not be in a shallow clone; fetch just that commit when it is missing.
    try {
      return run("git", ["rev-parse", `${sha}^{tree}`]);
    } catch {
      run("git", ["fetch", "--no-tags", "--depth=1", "origin", sha]);
      return run("git", ["rev-parse", `${sha}^{tree}`]);
    }
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

async function main(): Promise<void> {
  const decision = await decideMode(
    {
      event: process.env.EVENT_NAME ?? "",
      ref: process.env.REF ?? "",
      draft: process.env.DRAFT === "true",
      sha: process.env.SHA ?? "",
    },
    lookups,
  );
  console.log(`ci mode: ${decision.mode} (${decision.reason})`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${decision.mode}\n`);
}

void main();
