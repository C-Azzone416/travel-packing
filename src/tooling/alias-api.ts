// Assigning the stable Preview alias (#96) through Vercel's REST API. `vercel alias set` cannot be used: the CLI first loads the
// token's USER (GET /v2/user), which answers 404 "User not found" for this token (deploy and pull never make that call when
// VERCEL_ORG_ID and VERCEL_PROJECT_ID are set). The two documented calls below need only the token and the team id:
//   GET  /v13/deployments/{host}?teamId=…        -> the deployment's id (and its host and state, to check we mean the right one)
//   POST /v2/deployments/{id}/aliases?teamId=…   -> {"alias": "<name>"}; Vercel moves the name off any older deployment
// The token goes only into the Authorization header and is never part of a message this module produces.

const API = "https://api.vercel.com";
const VERCEL_HOST = /^[a-z0-9][a-z0-9-]*\.vercel\.app$/;
const TEAM_ID = /^team_[A-Za-z0-9]+$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

export type AliasRequest = {
  deployUrl: string;
  alias: string;
  teamId: string | undefined;
  token: string | undefined;
};

export type AliasResult = { alias: string; host: string; deploymentId: string; previous?: string };

export class AliasError extends Error {}

// "https://travel-packing-abc.vercel.app/" -> "travel-packing-abc.vercel.app"
export function hostOf(url: string | undefined): string {
  return (url ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/+$/, "");
}

// What Vercel said went wrong, short and free of anything secret: its error code and message only, and never the token.
function reason(body: unknown, token: string): string {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const parts = [error?.code, error?.message]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .map((part) => part.replaceAll(token, "***").slice(0, 200));
  return parts.length ? parts.join(": ") : "no error detail";
}

async function call(
  fetcher: typeof fetch,
  step: string,
  url: string,
  token: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
    });
  } catch {
    throw new AliasError(`alias API (${step}): the request did not complete`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON: reported by status below
  }
  if (!response.ok) {
    throw new AliasError(
      `alias API (${step}): HTTP ${response.status}: ${reason(body, token)}${
        response.status === 401 || response.status === 403 || response.status === 404
          ? " (the token may lack access to this team; that is a credential matter, not a code one)"
          : ""
      }`,
    );
  }
  return body;
}

export async function assignAlias(
  request: AliasRequest,
  fetcher: typeof fetch = fetch,
): Promise<AliasResult> {
  const host = hostOf(request.deployUrl);
  const alias = hostOf(request.alias);
  const token = request.token?.trim() ?? "";
  const teamId = request.teamId?.trim() ?? "";
  if (!VERCEL_HOST.test(host))
    throw new AliasError("the deployment URL is not a https://….vercel.app address");
  if (!VERCEL_HOST.test(alias)) throw new AliasError("the alias is not a ….vercel.app name");
  if (!TEAM_ID.test(teamId)) throw new AliasError("VERCEL_ORG_ID is not a team id (team_…)");
  if (token === "") throw new AliasError("VERCEL_TOKEN is empty");

  const team = `teamId=${encodeURIComponent(teamId)}`;
  const found = (await call(
    fetcher,
    "look up the deployment",
    `${API}/v13/deployments/${encodeURIComponent(host)}?${team}`,
    token,
    { method: "GET" },
  )) as { id?: unknown; url?: unknown; readyState?: unknown } | null;

  const deploymentId = typeof found?.id === "string" ? found.id : "";
  if (!DEPLOYMENT_ID.test(deploymentId))
    throw new AliasError("alias API (look up the deployment): no deployment id in the answer");
  if (typeof found?.url === "string" && hostOf(found.url) !== host)
    throw new AliasError("alias API (look up the deployment): it answered for a different URL");
  if (typeof found?.readyState === "string" && found.readyState !== "READY")
    throw new AliasError(
      `the deployment is ${found.readyState}, not READY; the alias is not moved`,
    );

  const assigned = (await call(
    fetcher,
    "assign the alias",
    `${API}/v2/deployments/${deploymentId}/aliases?${team}`,
    token,
    { method: "POST", body: JSON.stringify({ alias }) },
  )) as { alias?: unknown; oldDeploymentId?: unknown } | null;

  if (assigned?.alias !== alias)
    throw new AliasError("alias API (assign the alias): it did not confirm the alias we asked for");
  return {
    alias,
    host,
    deploymentId,
    previous: typeof assigned.oldDeploymentId === "string" ? assigned.oldDeploymentId : undefined,
  };
}
