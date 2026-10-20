// Before the stable Preview alias moves (#96): is this run still the newest thing on develop? Deploys are serialized and
// never cancelled, so an older run can finish AFTER a newer push has landed; if it moved the alias it would put an older
// build over a newer one. So the alias is only assigned when the run's commit is still the develop head, and otherwise it
// is left exactly where it is. A head that cannot be read is an error, not a pass.

const FULL_SHA = /^[0-9a-f]{40}$/;

export type AliasDecision = { assign: true; reason: string } | { assign: false; reason: string };

export function aliasDecision(
  runSha: string | undefined,
  developHead: string | undefined,
): AliasDecision {
  const run = (runSha ?? "").trim().toLowerCase();
  const head = (developHead ?? "").trim().toLowerCase();
  if (!FULL_SHA.test(run)) throw new Error("this run's commit is not a full SHA");
  if (!FULL_SHA.test(head)) throw new Error("the develop head could not be read");
  return run === head
    ? { assign: true, reason: "this run's commit is the develop head" }
    : {
        assign: false,
        reason:
          "develop has moved on since this run started; the alias is left where it is (the newer run will move it)",
      };
}
