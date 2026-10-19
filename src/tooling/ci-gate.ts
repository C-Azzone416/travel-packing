// "Is CI green for exactly this commit?" (#91). One answer, used by the production deploy (instead of polling for it from a paid
// runner) and by `npm run ci:gate` before a merge. Branch protection is not available on this plan, so this check IS the
// required-check gate: it cannot pass for a commit CI has not fully validated.
//
// Input is `gh run list --workflow ci.yml --commit <sha> --json status,conclusion,headSha,createdAt`. A draft pull request's
// run is made to FAIL on purpose ("full validation not run", see ci-mode.ts), so a success always means the full validation
// ran on that head.

export interface CiRun {
  status: string;
  conclusion: string | null;
  headSha: string;
  createdAt: string;
}

export type CiVerdict = { ok: true } | { ok: false; reason: string };

const FULL_SHA = /^[0-9a-f]{40}$/;

export function ciVerdict(runs: readonly CiRun[], sha: string): CiVerdict {
  const want = sha.trim().toLowerCase();
  if (!FULL_SHA.test(want))
    return { ok: false, reason: "the commit must be a full 40-character SHA" };
  const mine = runs
    .filter((run) => run.headSha.toLowerCase() === want)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = mine[0];
  if (!latest) return { ok: false, reason: "CI has not run on this exact commit" };
  if (latest.status !== "completed")
    return { ok: false, reason: "CI is still running on this commit" };
  if (latest.conclusion !== "success") {
    return {
      ok: false,
      reason: `CI ended ${latest.conclusion ?? "without a result"} on this commit`,
    };
  }
  return { ok: true };
}
