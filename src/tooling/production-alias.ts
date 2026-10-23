// Proving that the public Production alias is the deployment THIS run just created, before anything is smoke-tested through it (#207).
// A production deployment's generated *.vercel.app address is behind Vercel Authentication, so the smoke test goes to the public
// alias instead; but a stale alias still answers 200 from the PREVIOUS release, so a healthy alias proves nothing on its own.
// Two read-only REST calls, with the same token and team as alias-api.ts:
//   GET /v13/deployments/{host}?teamId=…   -> id, url, readyState, target and meta.releaseSha (set by `vercel deploy --meta`)
//   GET /v4/aliases/{alias}?teamId=…       -> deploymentId: which deployment the alias serves right now
// It fails closed: an API error, a missing field, a deployment that is not this one, not READY, not production, built from another
// commit, or an alias still on another deployment after the wait, is a failure. Vercel assigns a production alias a few seconds
// after the deployment is READY, so only the alias check is retried; everything about the deployment itself is checked once.
// The token goes only into the Authorization header and is never part of a message this module produces.

import { AliasError, DEPLOYMENT_ID, TEAM_ID, VERCEL_HOST, call, hostOf } from "./alias-api";

const API = "https://api.vercel.com";
const FULL_SHA = /^[0-9a-f]{40}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;

export type ProductionAliasRequest = {
  /** The generated address `vercel deploy` printed for this run's deployment. */
  deployUrl: string;
  /** The public Production address, a bare host name. */
  alias: string;
  /** The commit this run releases (GITHUB_SHA): the deployment must carry it as meta.releaseSha. */
  expectedSha: string | undefined;
  teamId: string | undefined;
  token: string | undefined;
};

export type ProductionAliasProof = { alias: string; deploymentId: string; sha: string };

export type Waiting = {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Roughly two minutes for Vercel to move the alias onto the new deployment. */
const DEFAULT_ATTEMPTS = 24;
const DEFAULT_DELAY_MS = 5000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function field(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function verifyProductionAlias(
  request: ProductionAliasRequest,
  fetcher: typeof fetch = fetch,
  waiting: Waiting = {},
): Promise<ProductionAliasProof> {
  const host = hostOf(request.deployUrl);
  const alias = hostOf(request.alias);
  const sha = (request.expectedSha ?? "").trim().toLowerCase();
  const token = request.token?.trim() ?? "";
  const teamId = request.teamId?.trim() ?? "";
  if (!VERCEL_HOST.test(host))
    throw new AliasError("the deployment URL is not a https://….vercel.app address");
  if (!HOSTNAME.test(alias)) throw new AliasError("the Production alias is not a host name");
  if (alias === host) throw new AliasError("the Production alias is the generated deployment URL");
  if (!FULL_SHA.test(sha))
    throw new AliasError("the expected release SHA is not a full 40-character SHA");
  if (!TEAM_ID.test(teamId)) throw new AliasError("VERCEL_ORG_ID is not a team id (team_…)");
  if (token === "") throw new AliasError("VERCEL_TOKEN is empty");

  const team = `teamId=${encodeURIComponent(teamId)}`;
  const found = (await call(
    fetcher,
    "look up the deployment",
    `${API}/v13/deployments/${encodeURIComponent(host)}?${team}`,
    token,
    { method: "GET" },
  )) as {
    id?: unknown;
    url?: unknown;
    readyState?: unknown;
    target?: unknown;
    meta?: { releaseSha?: unknown } | null;
  } | null;

  const deploymentId = field(found?.id);
  if (!DEPLOYMENT_ID.test(deploymentId))
    throw new AliasError("alias API (look up the deployment): no deployment id in the answer");
  if (hostOf(field(found?.url)) !== host)
    throw new AliasError("alias API (look up the deployment): it answered for a different URL");
  if (found?.readyState !== "READY")
    throw new AliasError(
      `the deployment is ${field(found?.readyState) || "in an unknown state"}, not READY`,
    );
  if (found?.target !== "production")
    throw new AliasError(
      `the deployment's target is ${field(found?.target) || "unset"}, not production`,
    );
  const built = field(found?.meta?.releaseSha).trim().toLowerCase();
  if (built === "")
    throw new AliasError(
      "the deployment carries no release SHA (meta.releaseSha), so it cannot be matched to this release",
    );
  if (built !== sha)
    throw new AliasError(
      `the deployment was built from ${built.slice(0, 12)}, not the release ${sha.slice(0, 12)}`,
    );

  const attempts = Math.max(1, waiting.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = waiting.delayMs ?? DEFAULT_DELAY_MS;
  const sleep = waiting.sleep ?? pause;
  let serving = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const aliased = (await call(
      fetcher,
      "look up the alias",
      `${API}/v4/aliases/${encodeURIComponent(alias)}?${team}`,
      token,
      { method: "GET" },
    )) as { alias?: unknown; deploymentId?: unknown } | null;
    if (hostOf(field(aliased?.alias)) !== alias)
      throw new AliasError("alias API (look up the alias): it answered for a different alias");
    serving = field(aliased?.deploymentId);
    if (serving === deploymentId) return { alias, deploymentId, sha };
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new AliasError(
    `the Production alias still points to ${serving || "no deployment"}, not this run's ${deploymentId}; not smoke-testing a stale address`,
  );
}
