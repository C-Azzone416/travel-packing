import { describe, expect, it, vi } from "vitest";
import {
  describeCleanup,
  runPreviewCleanup,
  selectDeletions,
  type ListedDeployment,
} from "./preview-cleanup";

const TOKEN = "tok_secret_value_123";
const TEAM = "team_AbC123";
const PROJECT = "prj_Xy9";
const HOST = "travel-packing-new-c-azzone416s-projects.vercel.app";
const ALIAS = "travel-packing-preview.vercel.app";
const CURRENT = "dpl_current";

const preview = (uid: string, over: ListedDeployment = {}): ListedDeployment => ({
  uid,
  target: null,
  state: "READY",
  ...over,
});

describe("selectDeletions", () => {
  const listing = [
    preview(CURRENT),
    preview("dpl_old1"),
    preview("dpl_old2", { target: "preview", state: "ERROR" }),
  ];

  it("keeps the alias target and removes every other finished Preview", () => {
    expect(selectDeletions(listing, CURRENT)).toEqual({
      remove: ["dpl_old1", "dpl_old2"],
      kept: 1,
      skipped: 0,
    });
  });

  it("deletes nothing when the alias target is unknown, malformed or not in the listing", () => {
    for (const target of [undefined, "", "not-an-id", "dpl_missing"]) {
      expect(selectDeletions(listing, target)).toEqual({ remove: [], kept: 0, skipped: 0 });
    }
  });

  it("deletes nothing when the alias target is listed but is not itself a Preview", () => {
    const odd = [preview(CURRENT, { target: "production" }), preview("dpl_old1")];
    expect(selectDeletions(odd, CURRENT).remove).toEqual([]);
  });

  it("never deletes Production, staging, custom-environment, building or malformed entries", () => {
    const mixed = [
      preview(CURRENT),
      preview("dpl_prod", { target: "production" }),
      preview("dpl_stage", { target: "staging" }),
      preview("dpl_custom", { customEnvironmentId: "env_1" }),
      preview("dpl_building", { state: "BUILDING" }),
      preview("dpl_queued", { state: undefined }),
      preview("bad id"),
      { target: null, state: "READY" },
      preview("dpl_ok", { state: undefined, readyState: "CANCELED" }),
    ];
    expect(selectDeletions(mixed, CURRENT)).toEqual({ remove: ["dpl_ok"], kept: 1, skipped: 6 });
  });

  it("lists a repeated id once", () => {
    expect(
      selectDeletions([preview(CURRENT), preview("dpl_a"), preview("dpl_a")], CURRENT).remove,
    ).toEqual(["dpl_a"]);
  });
});

type Answer = {
  status?: number;
  body?: unknown;
  throws?: boolean;
  headers?: Record<string, string>;
};

function fakeFetch(handler: (url: URL, method: string) => Answer) {
  const calls: { url: URL; method: string; auth: string | null }[] = [];
  const fetcher = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({
      url,
      method,
      auth: (init.headers as Record<string, string>).Authorization ?? null,
    });
    const answer = handler(url, method);
    if (answer.throws) throw new Error("socket closed");
    return new Response(answer.body === undefined ? "not json" : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const input = {
  deployUrl: `https://${HOST}`,
  alias: ALIAS,
  teamId: TEAM,
  projectId: PROJECT,
  token: TOKEN,
};

/** A service with the given Preview pages; the deployment lookup and the alias both answer CURRENT unless overridden. */
function service(
  pages: unknown[][],
  over: Partial<Record<"deployed" | "aliased" | "delete", (id: string) => Answer>> = {},
) {
  return fakeFetch((url, method) => {
    if (method === "DELETE")
      return over.delete?.(url.pathname.split("/").pop() ?? "") ?? { body: {} };
    if (url.pathname === `/v13/deployments/${HOST}`)
      return { body: { id: CURRENT }, ...over.deployed?.("") };
    if (url.pathname === `/v4/aliases/${ALIAS}`)
      return { body: { deploymentId: CURRENT }, ...over.aliased?.("") };
    if (url.pathname === "/v6/deployments") {
      const until = url.searchParams.get("until");
      const index = until ? Number(until) : 0;
      return {
        body: {
          deployments: pages[index] ?? [],
          pagination: index + 1 < pages.length ? { next: index + 1 } : {},
        },
      };
    }
    return { status: 500 };
  });
}

const sleepless = async () => undefined;

describe("runPreviewCleanup", () => {
  it("lists Previews for the project across pages, deletes the superseded ones and keeps the alias target", async () => {
    const { fetcher, calls } = service([
      [preview(CURRENT), preview("dpl_a")],
      [preview("dpl_b")],
      [preview("dpl_c")],
    ]);
    const result = await runPreviewCleanup(input, fetcher, sleepless);
    expect(result).toEqual({ deleted: 3, failed: 0, skipped: 0 });
    const lists = calls.filter((call) => call.url.pathname === "/v6/deployments");
    expect(lists).toHaveLength(3);
    for (const list of lists) {
      expect(list.url.searchParams.get("target")).toBe("preview");
      expect(list.url.searchParams.get("projectId")).toBe(PROJECT);
      expect(list.url.searchParams.get("teamId")).toBe(TEAM);
    }
    const deletes = calls
      .filter((call) => call.method === "DELETE")
      .map((call) => call.url.pathname);
    expect(deletes.sort()).toEqual([
      "/v13/deployments/dpl_a",
      "/v13/deployments/dpl_b",
      "/v13/deployments/dpl_c",
    ]);
    expect(deletes).not.toContain(`/v13/deployments/${CURRENT}`);
    expect(calls.every((call) => call.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(calls.every((call) => !call.url.href.includes(TOKEN))).toBe(true);
  });

  it("never sends a delete for a Production entry that slipped into the listing", async () => {
    const { fetcher, calls } = service([
      [preview(CURRENT), preview("dpl_prod", { target: "production" }), preview("dpl_a")],
    ]);
    const result = await runPreviewCleanup(input, fetcher, sleepless);
    expect(result).toEqual({ deleted: 1, failed: 0, skipped: 1 });
    expect(
      calls.filter((call) => call.method === "DELETE").map((call) => call.url.pathname),
    ).toEqual(["/v13/deployments/dpl_a"]);
  });

  it.each([
    [
      "the alias points somewhere else than this run's deployment",
      { aliased: () => ({ body: { deploymentId: "dpl_other" } }) },
    ],
    [
      "the alias lookup fails",
      { aliased: () => ({ status: 404, body: { error: { code: "not_found" } } }) },
    ],
    ["the alias answer has no deployment id", { aliased: () => ({ body: {} }) }],
    ["the deployment lookup fails", { deployed: () => ({ status: 500 }) }],
    ["the deployment lookup has no id", { deployed: () => ({ body: {} }) }],
  ])("deletes nothing when %s", async (_name, over) => {
    const { fetcher, calls } = service([[preview(CURRENT), preview("dpl_a")]], over);
    const result = await runPreviewCleanup(input, fetcher, sleepless);
    expect(result.deleted).toBe(0);
    expect(result.stopped).toBe("the alias target could not be confirmed");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("deletes nothing when the alias target is not among the listed Previews", async () => {
    const { fetcher, calls } = service([[preview("dpl_a"), preview("dpl_b")]]);
    const result = await runPreviewCleanup(input, fetcher, sleepless);
    expect(result.stopped).toMatch(/not among the listed/);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it.each([
    ["a failing list", () => ({ status: 500 })],
    ["a list that is not a list", () => ({ body: { deployments: "nope" } })],
  ])("deletes nothing after %s", async (_name, answer) => {
    const { fetcher, calls } = fakeFetch((url) =>
      url.pathname === "/v6/deployments"
        ? answer()
        : { body: url.pathname.startsWith("/v13") ? { id: CURRENT } : { deploymentId: CURRENT } },
    );
    const result = await runPreviewCleanup(input, fetcher, sleepless);
    expect(result.stopped).toBe("the deployment list could not be read");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("refuses incomplete settings before any call", async () => {
    const { fetcher, calls } = service([[]]);
    for (const bad of [
      { ...input, token: " " },
      { ...input, token: undefined },
      { ...input, teamId: "nope" },
      { ...input, projectId: undefined },
      { ...input, deployUrl: "https://example.com" },
      { ...input, alias: "example.com" },
    ]) {
      expect((await runPreviewCleanup(bad, fetcher, sleepless)).deleted).toBe(0);
    }
    expect(calls).toHaveLength(0);
  });

  it("counts a failed delete and carries on; a 404 means already gone", async () => {
    const { fetcher } = service(
      [[preview(CURRENT), preview("dpl_a"), preview("dpl_b"), preview("dpl_c")]],
      {
        delete: (id) =>
          id === "dpl_a"
            ? { status: 500 }
            : id === "dpl_b"
              ? { status: 404, body: {} }
              : { throws: true },
      },
    );
    expect(await runPreviewCleanup(input, fetcher, sleepless)).toEqual({
      deleted: 1,
      failed: 2,
      skipped: 0,
    });
  });

  it("waits and retries on 429, then gives up on that deployment after three tries", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const { fetcher } = service([[preview(CURRENT), preview("dpl_a"), preview("dpl_b")]], {
      delete: (id) => {
        if (id === "dpl_a") {
          attempts += 1;
          return attempts < 3 ? { status: 429, headers: { "retry-after": "2" } } : { body: {} };
        }
        return { status: 429 };
      },
    });
    const result = await runPreviewCleanup(input, fetcher, sleep);
    expect(result).toEqual({ deleted: 1, failed: 1, skipped: 0 });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("caps a very long Retry-After", async () => {
    const sleep = vi.fn(async () => undefined);
    let first = true;
    const { fetcher } = service([[preview(CURRENT), preview("dpl_a")]], {
      delete: () => {
        if (first) {
          first = false;
          return { status: 429, headers: { "retry-after": "9999" } };
        }
        return { body: {} };
      },
    });
    await runPreviewCleanup(input, fetcher, sleep);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("treats a network failure on the lookups as unconfirmed", async () => {
    const { fetcher } = fakeFetch(() => ({ throws: true }));
    expect((await runPreviewCleanup(input, fetcher, sleepless)).stopped).toBe(
      "the alias target could not be confirmed",
    );
  });

  it("stops listing after the page cap", async () => {
    const endless = fakeFetch((url) =>
      url.pathname === "/v6/deployments"
        ? { body: { deployments: [preview(CURRENT)], pagination: { next: 1 } } }
        : url.pathname.startsWith("/v13")
          ? { body: { id: CURRENT } }
          : { body: { deploymentId: CURRENT } },
    );
    const result = await runPreviewCleanup(input, endless.fetcher, sleepless);
    expect(result.deleted).toBe(0);
    expect(endless.calls.filter((call) => call.url.pathname === "/v6/deployments")).toHaveLength(
      50,
    );
  });
});

describe("describeCleanup", () => {
  it("says counts only", () => {
    expect(describeCleanup({ deleted: 7, failed: 0, skipped: 0 })).toBe(
      "preview-cleanup: deleted 7, kept 1",
    );
    expect(describeCleanup({ deleted: 2, failed: 1, skipped: 3 })).toBe(
      "preview-cleanup: deleted 2, kept 1, 1 not deleted, 3 left alone",
    );
    expect(describeCleanup({ deleted: 0, failed: 0, skipped: 0, stopped: "why" })).toBe(
      "preview-cleanup: nothing deleted (why)",
    );
  });
});
