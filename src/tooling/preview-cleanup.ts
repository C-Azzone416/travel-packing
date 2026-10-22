// Removing superseded Preview deployments (#135, Caroline's retention decision). Once the stable alias has moved and its smoke test
// passed, every other Preview deployment of this project is deleted, so only the alias address stays reachable. Two layers:
//   selectDeletions  pure: which listed deployments may go (nothing unless the alias target is known and listed)
//   runPreviewCleanup  the Vercel REST calls around it, in the pattern of alias-api.ts (#101); it never throws and never logs
//                      more than counts. The workflow step runs it last, so a problem here can never fail or undo a deploy.
// Production is protected twice: the listing asks for target=preview, and each deployment's OWN target is checked again here.
import { hostOf } from "./alias-api";

const API = "https://api.vercel.com";
const TEAM_ID = /^team_[A-Za-z0-9]+$/;
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const VERCEL_HOST = /^[a-z0-9][a-z0-9-]*\.vercel\.app$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const RETRIES = 3;
const MAX_WAIT_MS = 10_000;
// Builds that have not finished are left alone: their deploy run may still be about to use them. The next run takes them.
const REMOVABLE_STATES = new Set(["READY", "ERROR", "CANCELED"]);

export type ListedDeployment = {
  uid?: unknown;
  target?: unknown;
  state?: unknown;
  readyState?: unknown;
  customEnvironmentId?: unknown;
};

export type Selection = { remove: string[]; kept: number; skipped: number };

/** A Preview deployment as Vercel lists it: target "preview", or none at all (Vercel reports no target for a Preview). */
function isPreview(deployment: ListedDeployment): boolean {
  const target = deployment.target;
  return (
    (target === null || target === undefined || target === "preview") &&
    !deployment.customEnvironmentId
  );
}

/**
 * What may be deleted from `listing`. Nothing at all when the alias target is unknown, malformed or not itself a listed Preview
 * (then the listing or the alias cannot be trusted). Never the alias target, never anything whose own target is not a Preview,
 * never a deployment that is still building, and never an entry without a well-formed id.
 */
export function selectDeletions(
  listing: readonly ListedDeployment[],
  aliasTargetId: string | undefined,
): Selection {
  const none: Selection = { remove: [], kept: 0, skipped: 0 };
  if (!aliasTargetId || !DEPLOYMENT_ID.test(aliasTargetId)) return none;
  const target = listing.find((entry) => entry.uid === aliasTargetId);
  if (!target || !isPreview(target)) return none;
  const remove: string[] = [];
  let skipped = 0;
  for (const entry of listing) {
    const id = entry.uid;
    if (typeof id !== "string" || id === aliasTargetId) continue;
    const state = entry.state ?? entry.readyState;
    if (
      !DEPLOYMENT_ID.test(id) ||
      !isPreview(entry) ||
      typeof state !== "string" ||
      !REMOVABLE_STATES.has(state)
    ) {
      skipped += 1;
      continue;
    }
    if (!remove.includes(id)) remove.push(id);
  }
  return { remove, kept: 1, skipped };
}

export type CleanupRequest = {
  deployUrl: string;
  alias: string;
  teamId: string | undefined;
  projectId: string | undefined;
  token: string | undefined;
};

export type CleanupResult = {
  deleted: number;
  failed: number;
  skipped: number;
  /** Set when nothing was attempted, and why (a fixed phrase: never a URL, id or token). */
  stopped?: string;
};

type Answer = { ok: boolean; status: number; body: unknown };

async function request(
  fetcher: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  url: string,
  token: string,
  method: "GET" | "DELETE",
): Promise<Answer> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch {
      return { ok: false, status: 0, body: null };
    }
    if (response.status === 429 && attempt < RETRIES) {
      const seconds = Number(response.headers.get("retry-after"));
      await sleep(
        Math.min(
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * attempt,
          MAX_WAIT_MS,
        ),
      );
      continue;
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // not JSON
    }
    return { ok: response.ok, status: response.status, body };
  }
}

export async function runPreviewCleanup(
  input: CleanupRequest,
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<CleanupResult> {
  const stop = (stopped: string): CleanupResult => ({ deleted: 0, failed: 0, skipped: 0, stopped });
  const host = hostOf(input.deployUrl);
  const alias = hostOf(input.alias);
  const token = input.token?.trim() ?? "";
  const teamId = input.teamId?.trim() ?? "";
  const projectId = input.projectId?.trim() ?? "";
  if (!VERCEL_HOST.test(host) || !VERCEL_HOST.test(alias))
    return stop("the deployment or alias address is not a vercel.app one");
  if (!TEAM_ID.test(teamId) || !PROJECT_ID.test(projectId) || token === "")
    return stop("the Vercel settings are incomplete");
  const team = `teamId=${encodeURIComponent(teamId)}`;
  const get = (path: string) => request(fetcher, sleep, `${API}${path}`, token, "GET");

  // The alias target must be confirmed two ways: what the alias points at now, and the deployment this run made. Both must agree.
  const deployed = await get(`/v13/deployments/${encodeURIComponent(host)}?${team}`);
  const ran = (deployed.body as { id?: unknown } | null)?.id;
  const aliased = await get(`/v4/aliases/${encodeURIComponent(alias)}?${team}`);
  const aliasTarget = (aliased.body as { deploymentId?: unknown } | null)?.deploymentId;
  if (
    !deployed.ok ||
    !aliased.ok ||
    typeof ran !== "string" ||
    typeof aliasTarget !== "string" ||
    ran !== aliasTarget
  ) {
    return stop("the alias target could not be confirmed");
  }

  const listing: ListedDeployment[] = [];
  let until: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await get(
      `/v6/deployments?${team}&projectId=${encodeURIComponent(projectId)}&target=preview&limit=${PAGE_SIZE}${
        until ? `&until=${encodeURIComponent(until)}` : ""
      }`,
    );
    if (!answer.ok) return stop("the deployment list could not be read");
    const body = answer.body as { deployments?: unknown; pagination?: { next?: unknown } } | null;
    if (!Array.isArray(body?.deployments)) return stop("the deployment list could not be read");
    listing.push(...(body.deployments as ListedDeployment[]));
    const next = body.pagination?.next;
    if (next === undefined || next === null) break;
    until = String(next);
  }

  const selection = selectDeletions(listing, aliasTarget);
  if (selection.kept === 0)
    return stop("the alias target is not among the listed Preview deployments");
  let deleted = 0;
  let failed = 0;
  for (const id of selection.remove) {
    const gone = await request(
      fetcher,
      sleep,
      `${API}/v13/deployments/${id}?${team}`,
      token,
      "DELETE",
    );
    if (gone.ok || gone.status === 404) deleted += 1;
    else failed += 1;
  }
  return { deleted, failed, skipped: selection.skipped };
}

export function describeCleanup(result: CleanupResult): string {
  if (result.stopped) return `preview-cleanup: nothing deleted (${result.stopped})`;
  return `preview-cleanup: deleted ${result.deleted}, kept 1${result.failed ? `, ${result.failed} not deleted` : ""}${
    result.skipped ? `, ${result.skipped} left alone` : ""
  }`;
}
