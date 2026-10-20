// The develop-push reuse path, end to end with REAL git (no network): a pull request is squash-merged into develop and the
// push's mode is decided from the squash commit alone, in a clone that has never seen the pull request's head commit.
// This is the situation on every real merge; it did not fire for real on 6125273 because that pull request was not up to
// date with develop (its tree differed), which these tests also pin.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CiRun } from "./ci-gate";
import { decideMode, treeWithFetch, type Lookups } from "./ci-mode";

let root: string;
// Inside a git hook (the pre-push hook runs the unit tests), git exports GIT_DIR, GIT_INDEX_FILE and friends. They would
// point these scratch repositories at the real one, so every git call here runs without any GIT_* variable.
const cleanEnv: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("GIT_")) cleanEnv[key] = value;
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: cleanEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

function commitFile(cwd: string, name: string, text: string, message: string): string {
  writeFileSync(join(cwd, name), text);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

interface Scenario {
  squash: string;
  prHead: string;
  /** A fresh clone of develop that has never fetched the pull request's head. */
  runner: string;
}

/** origin (bare) + a work repo; the PR head lives only at refs/pull/1/head, like on GitHub. */
function scenario(name: string, developMovesAfterBranching: boolean): Scenario {
  const dir = join(root, name);
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  mkdirSync(dir);
  git(root, "init", "-q", "--bare", "-b", "develop", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "develop");
  commitFile(work, "a.txt", "base\n", "base");
  git(work, "push", "-q", "origin", "develop");

  git(work, "checkout", "-q", "-b", "feature");
  commitFile(work, "feature.txt", "one\n", "feature 1");
  const prHead = commitFile(work, "feature.txt", "one\ntwo\n", "feature 2");
  git(work, "push", "-q", "origin", `${prHead}:refs/pull/1/head`);

  git(work, "checkout", "-q", "develop");
  if (developMovesAfterBranching) {
    commitFile(work, "other.txt", "someone else\n", "another pull request landed");
  }
  git(work, "merge", "-q", "--squash", "feature");
  git(work, "commit", "-q", "-m", "feature (#1)");
  const squash = git(work, "rev-parse", "HEAD");
  git(work, "push", "-q", "origin", "develop");

  const runner = join(dir, "runner");
  git(
    root,
    "clone",
    "-q",
    "--no-tags",
    "--depth=1",
    "--branch",
    "develop",
    `file://${origin}`,
    runner,
  );
  return { squash, prHead, runner };
}

const green = (headSha: string): CiRun => ({
  status: "completed",
  conclusion: "success",
  headSha,
  createdAt: "2026-10-20T01:00:00Z",
});

function lookups(s: Scenario, runs: CiRun[]): Lookups {
  return {
    pullRequestsOf: async () => [{ number: 1, headSha: s.prHead }],
    treeOf: async (sha) => treeWithFetch((args) => git(s.runner, ...args), sha),
    runsFor: async (sha) => runs.filter((run) => run.headSha === sha),
  };
}

const push = (sha: string) => ({ event: "push", ref: "refs/heads/develop", draft: false, sha });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ci-squash-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("develop push after a squash merge", () => {
  it("is REUSED for a pull request that was up to date with develop and passed the full run", async () => {
    const s = scenario("up-to-date", false);
    // the runner really has not seen the PR head
    expect(() => git(s.runner, "cat-file", "-e", s.prHead)).toThrow();
    const decision = await decideMode(push(s.squash), lookups(s, [green(s.prHead)]));
    expect(decision.mode).toBe("reused");
    expect(decision.reason).toMatch(/pull request #1/);
    // and the fetch-by-id brought the head in
    expect(git(s.runner, "cat-file", "-t", s.prHead)).toBe("commit");
  });

  it("is FULL when develop moved after the pull request branched (the trees differ), as on 6125273", async () => {
    const s = scenario("behind", true);
    const decision = await decideMode(push(s.squash), lookups(s, [green(s.prHead)]));
    expect(decision.mode).toBe("full");
    expect(decision.reason).toMatch(/differ/);
  });

  it("is FULL when the up-to-date pull request has no successful full run", async () => {
    const s = scenario("no-green", false);
    const failed = { ...green(s.prHead), conclusion: "failure" };
    expect((await decideMode(push(s.squash), lookups(s, [failed]))).mode).toBe("full");
    expect((await decideMode(push(s.squash), lookups(s, []))).mode).toBe("full");
  });

  it("is FULL, not an error, when the pull request head cannot be fetched", async () => {
    const s = scenario("unfetchable", false);
    const broken: Lookups = {
      ...lookups(s, [green(s.prHead)]),
      treeOf: async (sha) =>
        treeWithFetch(
          (args) =>
            git(
              s.runner,
              ...(args[0] === "fetch" ? ["fetch", "--no-tags", "origin", "0".repeat(40)] : args),
            ),
          sha,
        ),
    };
    const decision = await decideMode(push(s.squash), broken);
    expect(decision.mode).toBe("full");
  });
});

describe("treeWithFetch", () => {
  it("returns the tree without fetching when the commit is already here", () => {
    const s = scenario("local", false);
    const calls: string[][] = [];
    const tree = treeWithFetch((args) => {
      calls.push(args);
      return git(s.runner, ...args);
    }, s.squash);
    expect(tree).toMatch(/^[0-9a-f]{40}$/);
    expect(calls.map((c) => c[0])).toEqual(["rev-parse"]);
  });
});
