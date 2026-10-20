// How much of CI a run must do (#91). GitHub rounds every job up to a whole minute and bills them all, so a push that only
// needs the cheap checks must not pay for the full suite, and a push whose exact files were already fully validated must not
// pay for it twice. The rules, all fail-safe (anything unexpected runs everything):
//
//   draft pull request          -> "quick": the static checks and the secret scan only. The run then FAILS on purpose, so a
//                                  draft can never be mistaken for a validated head. Marking the PR ready runs the full suite.
//   ready pull request          -> "full"
//   push to develop             -> "reused" if the pushed commit has exactly the same git tree as the head of the pull request
//                                  it came from AND that head had a successful full CI run; otherwise "full"
//   anything else (main, ...)   -> "full"
//
// "Same tree" means byte-identical files, so the validated tests ran on exactly what is now on develop.

import { ciVerdict, type CiRun } from "./ci-gate";

export type CiMode = "quick" | "full" | "reused";

export interface ModeInput {
  event: string;
  ref: string;
  draft: boolean;
}

/** What the event alone decides; "check-reuse" means a push to develop, which needs one lookup. */
export function initialMode(input: ModeInput): CiMode | "check-reuse" {
  if (input.event === "pull_request") return input.draft ? "quick" : "full";
  if (input.event === "push" && input.ref === "refs/heads/develop") return "check-reuse";
  return "full";
}

export interface Candidate {
  number: number;
  headSha: string;
  headTree: string;
  runs: readonly CiRun[];
}

const TREE = /^[0-9a-f]{40}$/;

/** Reuse only for a byte-identical tree with a fully successful run on the pull request's head. */
export function chooseReuse(
  pushedTree: string,
  candidates: readonly Candidate[],
): { reuse: true; from: number; headSha: string } | { reuse: false; reason: string } {
  const tree = pushedTree.trim().toLowerCase();
  if (!TREE.test(tree)) return { reuse: false, reason: "the pushed commit's tree is unknown" };
  if (candidates.length === 0)
    return { reuse: false, reason: "no pull request is linked to this commit" };
  for (const candidate of candidates) {
    if (!TREE.test(candidate.headTree.toLowerCase()) || candidate.headTree.toLowerCase() !== tree)
      continue;
    if (ciVerdict(candidate.runs, candidate.headSha).ok) {
      return { reuse: true, from: candidate.number, headSha: candidate.headSha };
    }
  }
  const sameTree = candidates.some((candidate) => candidate.headTree.toLowerCase() === tree);
  return {
    reuse: false,
    reason: sameTree
      ? "the pull request head has the same files but no successful full CI run"
      : "the pushed files differ from the pull request head (it was not up to date with develop)",
  };
}

/** The lookups the reuse check needs; injected so the logic is tested without GitHub or git. */
export interface Lookups {
  pullRequestsOf(sha: string): Promise<{ number: number; headSha: string }[]>;
  treeOf(sha: string): Promise<string>;
  runsFor(sha: string): Promise<CiRun[]>;
}

export interface ModeDecision {
  mode: CiMode;
  /** One sentence for the log; names no secret and no value. */
  reason: string;
}

export async function decideMode(
  input: ModeInput & { sha: string },
  lookups: Lookups,
): Promise<ModeDecision> {
  const first = initialMode(input);
  if (first === "quick") {
    return {
      mode: "quick",
      reason:
        "draft pull request: only the quick checks run, and this check will fail until it is marked ready",
    };
  }
  if (first === "full") return { mode: "full", reason: "full validation" };
  try {
    const pushedTree = await lookups.treeOf(input.sha);
    const pulls = await lookups.pullRequestsOf(input.sha);
    const candidates: Candidate[] = [];
    for (const pull of pulls) {
      candidates.push({
        number: pull.number,
        headSha: pull.headSha,
        headTree: await lookups.treeOf(pull.headSha),
        runs: await lookups.runsFor(pull.headSha),
      });
    }
    const choice = chooseReuse(pushedTree, candidates);
    if (choice.reuse) {
      return {
        mode: "reused",
        reason: `identical files to the head of pull request #${choice.from}, which passed the full CI; not run again`,
      };
    }
    return { mode: "full", reason: `full validation: ${choice.reason}` };
  } catch {
    // Any failure to look (an API error, a missing object) means "run everything".
    return { mode: "full", reason: "full validation: the earlier result could not be checked" };
  }
}

/**
 * Whether the pull request is a draft RIGHT NOW. The event payload is a snapshot, and events can arrive out of order (a push
 * and "ready for review" a second apart): a stale "draft" payload on the newest run would leave a ready pull request with
 * only the quick checks. So the live answer wins; when it cannot be read, the answer is "not a draft", which runs everything.
 */
export function resolveDraft(live: string | null): boolean {
  return live?.trim() === "true";
}

/**
 * The tree of a commit, fetching the commit first when this clone does not have it. A pull request's head is not in a
 * develop clone after a squash merge (only the squash commit is), but GitHub keeps it reachable from refs/pull/N/head, so
 * fetching it by id works. `run` is the command runner (`git` with these arguments, output trimmed).
 */
export function treeWithFetch(run: (args: string[]) => string, sha: string): string {
  try {
    return run(["rev-parse", `${sha}^{tree}`]);
  } catch {
    run(["fetch", "--no-tags", "--depth=1", "origin", sha]);
    return run(["rev-parse", `${sha}^{tree}`]);
  }
}
