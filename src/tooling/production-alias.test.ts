import { describe, expect, it } from "vitest";
import { AliasError } from "./alias-api";
import { verifyProductionAlias } from "./production-alias";

const TOKEN = "tok_secret_value_123";
const TEAM = "team_AbC123";
const HOST = "travel-packing-abc123-c-azzone416s-projects.vercel.app";
const ALIAS = "packed-smart.vercel.app";
const NEW = "dpl_NEWdeployment1";
const OLD = "dpl_OLDdeployment0";
const SHA = "4544c8af40d7e7c0e0b5f39765c6f5e3aa4bc305";
const OTHER_SHA = "26835af0510496da22af78be84f3c32dffa9508a";

type Answer = { status?: number; body?: unknown; throws?: boolean };
type Call = { url: string; headers: Record<string, string> };

/** Answers in order; the last answer repeats, so a polling loop can run as long as it likes. */
function fakeFetch(answers: Answer[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer.throws) throw new Error("socket closed");
    return new Response(answer.body === undefined ? "not json" : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const deployment = (over: Record<string, unknown> = {}): Answer => ({
  body: {
    id: NEW,
    url: HOST,
    readyState: "READY",
    target: "production",
    meta: { releaseSha: SHA },
    ...over,
  },
});
const aliasOn = (id: string | undefined): Answer => ({
  body: { alias: ALIAS, ...(id === undefined ? {} : { deploymentId: id }) },
});

const request = {
  deployUrl: `https://${HOST}`,
  alias: ALIAS,
  expectedSha: SHA,
  teamId: TEAM,
  token: TOKEN,
};
const fast = { attempts: 3, delayMs: 0, sleep: async () => {} };
const refusal = (over: Partial<typeof request>, answers: Answer[] = []) =>
  verifyProductionAlias({ ...request, ...over }, fakeFetch(answers).fetcher, fast);

describe("verifyProductionAlias", () => {
  it("passes when the alias serves the deployment this run created, from the release commit", async () => {
    const { fetcher, calls } = fakeFetch([deployment(), aliasOn(NEW)]);
    expect(await verifyProductionAlias(request, fetcher, fast)).toEqual({
      alias: ALIAS,
      deploymentId: NEW,
      sha: SHA,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `https://api.vercel.com/v13/deployments/${HOST}?teamId=${TEAM}`,
      `https://api.vercel.com/v4/aliases/${ALIAS}?teamId=${TEAM}`,
    ]);
    // Read-only, authenticated with the bearer token only.
    expect(calls.every((call) => call.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("accepts the SHA in either case and trims it", async () => {
    const { fetcher } = fakeFetch([
      deployment({ meta: { releaseSha: SHA.toUpperCase() } }),
      aliasOn(NEW),
    ]);
    await expect(
      verifyProductionAlias({ ...request, expectedSha: `  ${SHA}\n` }, fetcher, fast),
    ).resolves.toMatchObject({ sha: SHA });
  });

  it("waits for Vercel to move the alias, then passes", async () => {
    const sleeps: number[] = [];
    const { fetcher, calls } = fakeFetch([deployment(), aliasOn(OLD), aliasOn(OLD), aliasOn(NEW)]);
    const proof = await verifyProductionAlias(request, fetcher, {
      attempts: 5,
      delayMs: 7,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(proof.deploymentId).toBe(NEW);
    expect(sleeps).toEqual([7, 7]);
    expect(calls).toHaveLength(4); // the deployment once, the alias three times
  });

  it("rejects a STALE alias that still serves the previous release, naming both deployments", async () => {
    const error = await refusal({}, [deployment(), aliasOn(OLD)]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AliasError);
    expect((error as Error).message).toBe(
      `the Production alias still points to ${OLD}, not this run's ${NEW}; not smoke-testing a stale address`,
    );
  });

  it("rejects an alias that serves no deployment at all", async () => {
    await expect(refusal({}, [deployment(), aliasOn(undefined)])).rejects.toThrow(
      /still points to no deployment/,
    );
  });

  it("does not wait on anything but the alias: a wrong SHA fails at once, with no alias call", async () => {
    const { fetcher, calls } = fakeFetch([deployment({ meta: { releaseSha: OTHER_SHA } })]);
    await expect(verifyProductionAlias(request, fetcher, fast)).rejects.toThrow(
      /built from 26835af05104, not the release 4544c8af40d7/,
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["no meta at all", deployment({ meta: undefined })],
    ["a null meta", deployment({ meta: null })],
    ["an empty release SHA", deployment({ meta: { releaseSha: "  " } })],
    ["a non-string release SHA", deployment({ meta: { releaseSha: 42 } })],
  ])("rejects %s: it cannot be matched to this release", async (_name, answer) => {
    await expect(refusal({}, [answer])).rejects.toThrow(/no release SHA/);
  });

  it("rejects a deployment that is not READY, or not production", async () => {
    await expect(refusal({}, [deployment({ readyState: "BUILDING" })])).rejects.toThrow(
      /BUILDING, not READY/,
    );
    await expect(refusal({}, [deployment({ readyState: undefined })])).rejects.toThrow(
      /in an unknown state, not READY/,
    );
    await expect(refusal({}, [deployment({ target: null })])).rejects.toThrow(
      /target is unset, not production/,
    );
    await expect(refusal({}, [deployment({ target: "preview" })])).rejects.toThrow(
      /target is preview, not production/,
    );
  });

  it("rejects an answer for another deployment, or without an id", async () => {
    await expect(
      refusal({}, [deployment({ url: "someone-elses-abc.vercel.app" })]),
    ).rejects.toThrow(/different URL/);
    await expect(refusal({}, [deployment({ id: "nonsense" })])).rejects.toThrow(/no deployment id/);
    await expect(refusal({}, [deployment({ id: undefined })])).rejects.toThrow(/no deployment id/);
  });

  it("rejects an answer for another alias", async () => {
    await expect(
      refusal({}, [deployment(), { body: { alias: "other.vercel.app", deploymentId: NEW } }]),
    ).rejects.toThrow(/different alias/);
  });

  it("fails closed on API errors, naming the step and the status and never the token", async () => {
    for (const answers of [
      [{ status: 403, body: { error: { code: "forbidden", message: `no ${TOKEN}` } } }],
      [{ status: 500 }],
      [{ throws: true }],
      [deployment(), { status: 404, body: { error: { code: "not_found" } } }],
      [deployment(), { throws: true }],
    ] as Answer[][]) {
      const error = await refusal({}, answers).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(AliasError);
      expect((error as Error).message).toMatch(
        /alias API \((look up the deployment|look up the alias)\)/,
      );
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });

  it.each([
    [
      "a non-Vercel deployment URL",
      { deployUrl: "https://example.com" },
      /not a https:\/\/….vercel.app/,
    ],
    ["the generated URL as the alias", { alias: HOST }, /is the generated deployment URL/],
    ["a non-host alias", { alias: "https://x/y z" }, /not a host name/],
    ["a short SHA", { expectedSha: "4544c8af" }, /full 40-character SHA/],
    ["no SHA", { expectedSha: undefined }, /full 40-character SHA/],
    ["a bad team id", { teamId: "nope" }, /VERCEL_ORG_ID is not a team id/],
    ["an empty token", { token: " " }, /VERCEL_TOKEN is empty/],
  ])("refuses %s before calling Vercel", async (_name, over, message) => {
    const { fetcher, calls } = fakeFetch([deployment(), aliasOn(NEW)]);
    await expect(
      verifyProductionAlias({ ...request, ...(over as Partial<typeof request>) }, fetcher, fast),
    ).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });
});
