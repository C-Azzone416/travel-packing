import { describe, expect, it } from "vitest";
import { decideTarget } from "./release-gate";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const release = {
  EVENT_NAME: "workflow_dispatch",
  REF: "refs/heads/main",
  SHA,
  ACTOR: "C-Azzone416",
  TRIGGERING_ACTOR: "C-Azzone416",
  REPO_OWNER: "C-Azzone416",
  RELEASE_SHA: SHA,
};
const refused = (env: Record<string, string | undefined>) => {
  const decision = decideTarget(env);
  if (decision.ok) throw new Error("expected a refusal");
  return decision.reason;
};

describe("preview", () => {
  it("a push to develop deploys preview, with no owner or SHA needed", () => {
    expect(decideTarget({ EVENT_NAME: "push", REF: "refs/heads/develop" })).toEqual({
      ok: true,
      target: "preview",
    });
  });

  it("any other push deploys nothing", () => {
    expect(refused({ EVENT_NAME: "push", REF: "refs/heads/feature/x" })).toMatch(/only develop/);
  });

  it("a manual run from develop cannot deploy production or preview", () => {
    expect(refused({ ...release, REF: "refs/heads/develop" })).toMatch(/only from main/);
  });
});

describe("production release gate", () => {
  it("a push to main never deploys production on its own", () => {
    expect(refused({ ...release, EVENT_NAME: "push" })).toMatch(/does not deploy production/);
  });

  it("deploys production for the owner on main with the exact typed SHA", () => {
    expect(decideTarget(release)).toEqual({ ok: true, target: "production" });
  });

  it("ignores case and surrounding spaces in the owner and the typed SHA", () => {
    expect(
      decideTarget({
        ...release,
        ACTOR: "c-azzone416",
        TRIGGERING_ACTOR: "C-AZZONE416",
        RELEASE_SHA: `  ${SHA.toUpperCase()} `,
      }),
    ).toEqual({ ok: true, target: "production" });
  });

  it.each([
    ["another branch", { REF: "refs/heads/dev1/x" }],
    ["a tag", { REF: "refs/tags/v1" }],
    ["no ref", { REF: undefined }],
  ])("refuses a manual run from %s", (_name, patch) => {
    expect(refused({ ...release, ...patch })).toMatch(/only from main/);
  });

  it.each([
    ["a pull request", "pull_request"],
    ["a schedule", "schedule"],
    ["a manual workflow call", "workflow_call"],
    ["no event", ""],
  ])("refuses %s", (_name, event) => {
    expect(refused({ ...release, EVENT_NAME: event })).toMatch(/cannot deploy/);
  });

  it.each([
    ["someone else started it", { ACTOR: "someone-else" }],
    ["someone else re-ran it", { TRIGGERING_ACTOR: "someone-else" }],
    ["no actor", { ACTOR: undefined }],
    ["no triggering actor", { TRIGGERING_ACTOR: "" }],
  ])("refuses when %s", (_name, patch) => {
    expect(refused({ ...release, ...patch })).toMatch(/only the repository owner/);
  });

  it.each([[undefined], [""], ["  "]])("refuses when the owner is unknown (%j)", (owner) => {
    expect(refused({ ...release, REPO_OWNER: owner })).toMatch(/owner is unknown/);
  });

  it.each([
    ["not typed", undefined, /type the full commit SHA/],
    ["blank", "   ", /type the full commit SHA/],
    ["a different SHA", "f".repeat(40), /does not match/],
    ["an abbreviated SHA", SHA.slice(0, 7), /does not match/],
    ["a branch name", "main", /does not match/],
    ["the SHA with extra text", `${SHA} please`, /does not match/],
  ])("refuses a typed confirmation that is %s", (_name, typed, message) => {
    expect(refused({ ...release, RELEASE_SHA: typed })).toMatch(message);
  });

  it("refuses when the commit being released is unknown or not a full SHA", () => {
    expect(refused({ ...release, SHA: undefined, RELEASE_SHA: "x" })).toMatch(/unknown/);
    expect(refused({ ...release, SHA: "abc123", RELEASE_SHA: "abc123" })).toMatch(/unknown/);
  });

  it("never echoes what was typed", () => {
    const typed = "f".repeat(40);
    expect(refused({ ...release, RELEASE_SHA: typed })).not.toContain(typed);
    expect(refused({ ...release, ACTOR: "intruder-name" })).not.toContain("intruder-name");
  });
});
