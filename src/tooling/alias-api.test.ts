import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AliasError, assignAlias, hostOf } from "./alias-api";

const TOKEN = "tok_secret_value_123";
const TEAM = "team_AbC123";
const HOST = "travel-packing-abc123-c-azzone416s-projects.vercel.app";
const ALIAS = "travel-packing-preview.vercel.app";
const DPL = "dpl_8Xk2LmNoPq";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(answers: Array<{ status?: number; body?: unknown; throws?: boolean }>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const answer = answers[calls.length - 1] ?? { status: 500 };
    if (answer.throws) throw new Error("socket closed");
    return new Response(answer.body === undefined ? "not json" : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const request = {
  deployUrl: `https://${HOST}`,
  alias: ALIAS,
  teamId: TEAM,
  token: TOKEN,
};
const found = { status: 200, body: { id: DPL, url: HOST, readyState: "READY" } };
const assigned = { status: 200, body: { alias: ALIAS, uid: "a1", created: "2026-10-20" } };

describe("hostOf", () => {
  it.each([
    [`https://${HOST}`, HOST],
    [`https://${HOST}/`, HOST],
    [`  HTTPS://${HOST.toUpperCase()}//  `, HOST],
    [undefined, ""],
  ])("%j -> %j", (input, expected) => {
    expect(hostOf(input)).toBe(expected);
  });
});

describe("assignAlias", () => {
  it("looks the deployment up, then assigns the alias to its id, for the team, with the bearer token", async () => {
    const { fetcher, calls } = fakeFetch([found, assigned]);
    const result = await assignAlias(request, fetcher);
    expect(result).toEqual({
      alias: ALIAS,
      host: HOST,
      deploymentId: DPL,
      previous: undefined,
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET https://api.vercel.com/v13/deployments/${HOST}?teamId=${TEAM}`,
      `POST https://api.vercel.com/v2/deployments/${DPL}/aliases?teamId=${TEAM}`,
    ]);
    expect(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({ alias: ALIAS });
    expect(calls[1].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toBeUndefined();
  });

  it("reports the deployment the alias replaced", async () => {
    const { fetcher } = fakeFetch([
      found,
      { status: 200, body: { alias: ALIAS, oldDeploymentId: "dpl_old1" } },
    ]);
    expect((await assignAlias(request, fetcher)).previous).toBe("dpl_old1");
  });

  it("accepts an answer with no url or state fields (only the id is required)", async () => {
    const { fetcher } = fakeFetch([{ status: 200, body: { id: DPL } }, assigned]);
    await expect(assignAlias(request, fetcher)).resolves.toMatchObject({ deploymentId: DPL });
  });

  describe("refuses before any request", () => {
    it.each([
      ["a deployment URL that is not a vercel.app host", { deployUrl: "https://evil.example" }],
      ["an empty deployment URL", { deployUrl: "" }],
      ["a path smuggled into the host", { deployUrl: `https://${HOST}/../x` }],
      ["an alias that is not a vercel.app name", { alias: "preview.example.com" }],
      ["a missing team id", { teamId: undefined }],
      ["a team id that is not team_…", { teamId: "team_x&evil=1" }],
      ["an empty token", { token: "  " }],
      ["a missing token", { token: undefined }],
    ])("%s", async (_name, change) => {
      const { fetcher, calls } = fakeFetch([found, assigned]);
      await expect(assignAlias({ ...request, ...change }, fetcher)).rejects.toBeInstanceOf(
        AliasError,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe("fails loudly, and never assigns, when the lookup is wrong", () => {
    it.each([
      ["no id", { status: 200, body: { url: HOST } }, /no deployment id/],
      ["an id of the wrong shape", { status: 200, body: { id: "x/../y" } }, /no deployment id/],
      [
        "a different URL",
        { status: 200, body: { id: DPL, url: "other-build.vercel.app" } },
        /different URL/,
      ],
      [
        "a deployment still building",
        { status: 200, body: { id: DPL, url: HOST, readyState: "BUILDING" } },
        /BUILDING, not READY/,
      ],
      ["an error status", { status: 404, body: { error: { code: "not_found" } } }, /HTTP 404/],
    ])("%s", async (_name, answer, message) => {
      const { fetcher, calls } = fakeFetch([answer]);
      await expect(assignAlias(request, fetcher)).rejects.toThrow(message);
      expect(calls).toHaveLength(1);
    });
  });

  describe("fails loudly when the assignment is refused", () => {
    it("names the status, Vercel's code and message, and says a team-access problem is a credential matter", async () => {
      const { fetcher } = fakeFetch([
        found,
        {
          status: 403,
          body: { error: { code: "forbidden", message: "Not authorized for this team" } },
        },
      ]);
      const error = await assignAlias(request, fetcher).catch((e: Error) => e);
      expect(error).toBeInstanceOf(AliasError);
      expect((error as Error).message).toMatch(
        /assign the alias.*HTTP 403: forbidden: Not authorized for this team.*credential matter/,
      );
    });

    it("does not call it a credential problem for a 400", async () => {
      const { fetcher } = fakeFetch([
        found,
        { status: 400, body: { error: { code: "bad_request", message: "cert not ready" } } },
      ]);
      const error = await assignAlias(request, fetcher).catch((e: Error) => e);
      expect((error as Error).message).toMatch(/HTTP 400: bad_request: cert not ready$/);
    });

    it("rejects an answer that does not confirm our alias", async () => {
      const { fetcher } = fakeFetch([
        found,
        { status: 200, body: { alias: "someone-else.vercel.app" } },
      ]);
      await expect(assignAlias(request, fetcher)).rejects.toThrow(/did not confirm the alias/);
    });

    it("rejects a 200 that is not JSON", async () => {
      const { fetcher } = fakeFetch([found, { status: 200 }]);
      await expect(assignAlias(request, fetcher)).rejects.toThrow(/did not confirm the alias/);
    });

    it("reports 'no error detail' for a failure with no JSON body", async () => {
      const { fetcher } = fakeFetch([{ status: 502 }]);
      await expect(assignAlias(request, fetcher)).rejects.toThrow(/HTTP 502: no error detail/);
    });

    it("reports a request that never completed", async () => {
      const { fetcher } = fakeFetch([{ throws: true }]);
      await expect(assignAlias(request, fetcher)).rejects.toThrow(/did not complete/);
    });
  });

  it("never lets the token into an error message, even if Vercel echoes it", async () => {
    const { fetcher } = fakeFetch([
      found,
      { status: 401, body: { error: { code: "invalid_token", message: `bad ${TOKEN} given` } } },
    ]);
    const error = await assignAlias(request, fetcher).catch((e: Error) => e);
    expect((error as Error).message).toContain("bad *** given");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("cuts a very long Vercel message", async () => {
    const { fetcher } = fakeFetch([
      { status: 400, body: { error: { code: "x", message: "m".repeat(5000) } } },
    ]);
    const error = await assignAlias(request, fetcher).catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(400);
  });
});

describe("scripts/assign-alias.ts", () => {
  const run = (env: Record<string, string>, args: string[]) =>
    spawnSync("npx", ["tsx", "scripts/assign-alias.ts", ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
    });

  it("exits 1 with a reason, and without the token, when the inputs are wrong", () => {
    const result = run({ VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: "not-a-team" }, [
      `https://${HOST}`,
      ALIAS,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^alias: VERCEL_ORG_ID is not a team id/m);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it("exits 1 when called with no arguments", () => {
    const result = run({ VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: TEAM }, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a https:\/\/….vercel.app address/);
  });
});
