import { describe, expect, it } from "vitest";
import type { CiRun } from "./ci-gate";
import {
  chooseReuse,
  decideMode,
  initialMode,
  resolveDraft,
  type Candidate,
  type Lookups,
} from "./ci-mode";

const PUSHED = "1".repeat(40);
const TREE = "2".repeat(40);
const OTHER_TREE = "3".repeat(40);
const HEAD = "4".repeat(40);

const good: CiRun = {
  status: "completed",
  conclusion: "success",
  headSha: HEAD,
  createdAt: "2026-10-19T10:00:00Z",
};
const candidate = (changes: Partial<Candidate> = {}): Candidate => ({
  number: 7,
  headSha: HEAD,
  headTree: TREE,
  runs: [good],
  ...changes,
});

describe("initialMode", () => {
  it.each([
    [
      "a draft pull request",
      { event: "pull_request", ref: "refs/pull/1/merge", draft: true },
      "quick",
    ],
    [
      "a ready pull request",
      { event: "pull_request", ref: "refs/pull/1/merge", draft: false },
      "full",
    ],
    [
      "a push to develop",
      { event: "push", ref: "refs/heads/develop", draft: false },
      "check-reuse",
    ],
    ["a push to main", { event: "push", ref: "refs/heads/main", draft: false }, "full"],
    [
      "a push to any other branch",
      { event: "push", ref: "refs/heads/dev2/x", draft: false },
      "full",
    ],
    [
      "an event it has never heard of",
      { event: "schedule", ref: "refs/heads/develop", draft: false },
      "full",
    ],
    [
      "a draft flag on a push (meaningless)",
      { event: "push", ref: "refs/heads/main", draft: true },
      "full",
    ],
  ])("%s -> %s", (_name, input, expected) => {
    expect(initialMode(input)).toBe(expected);
  });
});

describe("chooseReuse", () => {
  it("reuses a byte-identical tree whose pull request head passed the full CI", () => {
    expect(chooseReuse(TREE, [candidate()])).toEqual({ reuse: true, from: 7, headSha: HEAD });
  });

  it("ignores case and surrounding space in the pushed tree", () => {
    expect(chooseReuse(` ${TREE.toUpperCase()}\n`, [candidate()]).reuse).toBe(true);
  });

  it.each([
    ["different files", [candidate({ headTree: OTHER_TREE })], /differ from the pull request head/],
    ["no pull request", [], /no pull request is linked/],
    [
      "the same files but a failed run",
      [candidate({ runs: [{ ...good, conclusion: "failure" }] })],
      /same files but no successful full CI run/,
    ],
    [
      "the same files but a run still going",
      [candidate({ runs: [{ ...good, status: "in_progress", conclusion: null }] })],
      /same files but no successful full CI run/,
    ],
    ["the same files but no run at all", [candidate({ runs: [] })], /no successful full CI run/],
    [
      "a successful run on a DIFFERENT commit than the head",
      [candidate({ runs: [{ ...good, headSha: "5".repeat(40) }] })],
      /no successful full CI run/,
    ],
    ["a head tree that is not a tree id", [candidate({ headTree: "" })], /differ/],
  ])("does not reuse for %s", (_name, candidates, message) => {
    const choice = chooseReuse(TREE, candidates);
    expect(choice.reuse).toBe(false);
    expect(choice.reuse ? "" : choice.reason).toMatch(message);
  });

  it("does not reuse when the pushed tree is unknown or malformed, even if a head tree is empty too", () => {
    for (const bad of ["", "abc", `${TREE}0`]) {
      expect(chooseReuse(bad, [candidate({ headTree: bad })]).reuse).toBe(false);
    }
  });

  it("finds the matching pull request among several", () => {
    const choice = chooseReuse(TREE, [
      candidate({ number: 1, headTree: OTHER_TREE }),
      candidate({ number: 2, runs: [{ ...good, conclusion: "failure" }] }),
      candidate({ number: 3 }),
    ]);
    expect(choice).toEqual({ reuse: true, from: 3, headSha: HEAD });
  });
});

function lookups(overrides: Partial<Lookups> = {}): Lookups & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async pullRequestsOf(sha) {
      calls.push(`pulls ${sha}`);
      return [{ number: 7, headSha: HEAD }];
    },
    async treeOf(sha) {
      calls.push(`tree ${sha}`);
      return TREE;
    },
    async runsFor(sha) {
      calls.push(`runs ${sha}`);
      return [good];
    },
    ...overrides,
  };
}

describe("decideMode", () => {
  const push = { event: "push", ref: "refs/heads/develop", draft: false, sha: PUSHED };

  it("a draft pull request is quick and looks nothing up", async () => {
    const lookup = lookups();
    const decision = await decideMode(
      { event: "pull_request", ref: "r", draft: true, sha: PUSHED },
      lookup,
    );
    expect(decision.mode).toBe("quick");
    expect(decision.reason).toMatch(/will fail until it is marked ready/);
    expect(lookup.calls).toEqual([]);
  });

  it("a ready pull request and a push to main are full and look nothing up", async () => {
    for (const input of [
      { event: "pull_request", ref: "r", draft: false, sha: PUSHED },
      { event: "push", ref: "refs/heads/main", draft: false, sha: PUSHED },
    ]) {
      const lookup = lookups();
      expect((await decideMode(input, lookup)).mode).toBe("full");
      expect(lookup.calls).toEqual([]);
    }
  });

  it("a push to develop with identical files to a fully validated pull request head is reused", async () => {
    const lookup = lookups();
    const decision = await decideMode(push, lookup);
    expect(decision.mode).toBe("reused");
    expect(decision.reason).toMatch(/pull request #7/);
    expect(lookup.calls).toEqual([
      `tree ${PUSHED}`,
      `pulls ${PUSHED}`,
      `tree ${HEAD}`,
      `runs ${HEAD}`,
    ]);
  });

  it.each([
    [
      "different files",
      lookups({ treeOf: async (sha) => (sha === PUSHED ? TREE : OTHER_TREE) }),
      /differ from the pull request head/,
    ],
    [
      "no pull request (a direct push)",
      lookups({ pullRequestsOf: async () => [] }),
      /no pull request/,
    ],
    [
      "a pull request head without a green run",
      lookups({ runsFor: async () => [{ ...good, conclusion: "cancelled" }] }),
      /no successful full CI run/,
    ],
  ])("a push to develop is full for %s", async (_name, lookup, message) => {
    const decision = await decideMode(push, lookup);
    expect(decision.mode).toBe("full");
    expect(decision.reason).toMatch(message);
  });

  it.each([
    [
      "the API fails",
      {
        pullRequestsOf: async () => {
          throw new Error("502 for secret");
        },
      },
    ],
    [
      "git cannot read a commit",
      {
        treeOf: async () => {
          throw new Error("bad object");
        },
      },
    ],
    [
      "the run list fails",
      {
        runsFor: async () => {
          throw new Error("rate limited");
        },
      },
    ],
  ])("falls back to full validation when %s, saying nothing about why", async (_name, broken) => {
    const decision = await decideMode(push, lookups(broken));
    expect(decision).toEqual({
      mode: "full",
      reason: "full validation: the earlier result could not be checked",
    });
  });
});

describe("resolveDraft", () => {
  it("is a draft only when the live answer says exactly so", () => {
    expect(resolveDraft("true")).toBe(true);
    expect(resolveDraft("true\n")).toBe(true);
    expect(resolveDraft("false")).toBe(false);
  });

  it("fails safe to full validation when the live answer is missing or odd", () => {
    for (const odd of [null, "", "null", "TRUE?", "yes"]) expect(resolveDraft(odd)).toBe(false);
  });
});
