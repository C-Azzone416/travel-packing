// The deploy workflow's gate (#20): decides WHICH target a run may deploy, before any secret is in reach.
//
//   push to develop                    -> preview (automatic)
//   workflow_dispatch on main          -> production, only if ALL of these hold:
//       - the run is on refs/heads/main,
//       - the person who started it (and the person who re-ran it) is the repository owner,
//       - the typed confirmation is exactly the full commit SHA being released (the tip of main at dispatch time)
//   anything else (a push to main, a dispatch from another branch, a pull request...) -> no deploy at all
//
// A push to main never deploys production by itself. GitHub's required reviewers are not available on this plan, so the
// typed SHA and the owner check ARE the production approval. The `production` environment (restricted to main) is a
// second, independent lock. Messages name the rule that failed and never echo the typed value.

type Env = Record<string, string | undefined>;

export type GateDecision =
  { ok: true; target: "preview" | "production" } | { ok: false; reason: string };

const FULL_SHA = /^[0-9a-f]{40}$/;

export function decideTarget(env: Env): GateDecision {
  const event = env.EVENT_NAME ?? "";
  const ref = env.REF ?? "";

  if (event === "push") {
    if (ref === "refs/heads/develop") return { ok: true, target: "preview" };
    return {
      ok: false,
      reason:
        ref === "refs/heads/main"
          ? "a push to main does not deploy production; release it with a manual run and the commit SHA"
          : "only develop deploys on push",
    };
  }

  if (event !== "workflow_dispatch") return { ok: false, reason: "this event cannot deploy" };
  if (ref !== "refs/heads/main") {
    return { ok: false, reason: "a manual run deploys production only from main" };
  }

  const owner = (env.REPO_OWNER ?? "").trim().toLowerCase();
  if (owner === "")
    return { ok: false, reason: "the repository owner is unknown, so no release is allowed" };
  for (const who of [env.ACTOR, env.TRIGGERING_ACTOR]) {
    if ((who ?? "").trim().toLowerCase() !== owner) {
      return { ok: false, reason: "only the repository owner may release production" };
    }
  }

  const sha = (env.SHA ?? "").trim().toLowerCase();
  const typed = (env.RELEASE_SHA ?? "").trim().toLowerCase();
  if (!FULL_SHA.test(sha)) return { ok: false, reason: "the commit being released is unknown" };
  if (typed === "")
    return { ok: false, reason: "type the full commit SHA to release in release_sha" };
  if (typed !== sha) {
    return {
      ok: false,
      reason:
        "release_sha does not match the tip of main (type the full 40-character SHA of the commit being released)",
    };
  }
  return { ok: true, target: "production" };
}
