import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS } from "../server/auth/public-paths";
import { smokeTest } from "./smoke-test";

type Routes = Record<string, Response | "throw">;
function fakeFetch(routes: Routes, seen: { url: string; headers: Record<string, string> }[] = []) {
  return async (url: string, init: { redirect: "manual"; headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers });
    expect(init.redirect).toBe("manual");
    const route = routes[new URL(url).pathname];
    if (!route || route === "throw") throw new Error("network");
    return route;
  };
}
const redirect = (location: string, status = 307) =>
  new Response(null, { status, headers: { location } });
const healthy = (): Routes => ({
  ...Object.fromEntries(PUBLIC_PATHS.map((path) => [path, new Response("ok", { status: 200 })])),
  "/": redirect("/sign-in"),
});

describe("smokeTest", () => {
  it("passes when sign-in is 200 and the protected page redirects to sign-in", async () => {
    const result = await smokeTest("https://x.test/", fakeFetch(healthy()));
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([
      "ok   /sign-in: 200 (expected 200)",
      "ok   /access-denied: 200 (expected 200)",
      "ok   /sign-up: 200 (expected 200)",
      "ok   /verify: 200 (expected 200)",
      "ok   /forgot-password: 200 (expected 200)",
      "ok   /reset-password: 200 (expected 200)",
      "ok   /finish-setup: 200 (expected 200)",
      "ok   /: 307 (expected a redirect to /sign-in when signed out)",
    ]);
  });

  it("accepts an absolute redirect to sign-in", async () => {
    const routes = { ...healthy(), "/": redirect("https://x.test/sign-in?next=%2F", 302) };
    expect((await smokeTest("https://x.test", fakeFetch(routes))).ok).toBe(true);
  });

  it("fails when sign-in is not 200", async () => {
    const routes = { ...healthy(), "/sign-in": new Response("no", { status: 500 }) };
    const result = await smokeTest("https://x.test", fakeFetch(routes));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe("FAIL /sign-in: 500 (expected 200)");
  });

  it.each([
    ["a 200 (page open to anyone)", new Response("dashboard", { status: 200 })],
    ["a redirect elsewhere", redirect("/somewhere")],
    ["a redirect with no location", new Response(null, { status: 307 })],
    ["a redirect to an unparseable location", redirect("http://[bad")],
  ])("fails when the protected page gives %s", async (_name, response) => {
    const result = await smokeTest("https://x.test", fakeFetch({ ...healthy(), "/": response }));
    expect(result.ok).toBe(false);
    expect(result.lines.find((line) => line.startsWith("FAIL /:"))).toBeTruthy();
  });

  it("fails, without echoing the error, when the site does not answer", async () => {
    const result = await smokeTest("https://x.test", fakeFetch({}));
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      "FAIL /sign-in: no response (expected 200)",
      "FAIL /access-denied: no response (expected 200)",
      "FAIL /sign-up: no response (expected 200)",
      "FAIL /verify: no response (expected 200)",
      "FAIL /forgot-password: no response (expected 200)",
      "FAIL /reset-password: no response (expected 200)",
      "FAIL /finish-setup: no response (expected 200)",
      "FAIL /: no response (expected a redirect to /sign-in when signed out)",
    ]);
  });

  it("sends the protection bypass header only when given a secret", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await smokeTest("https://x.test", fakeFetch(healthy(), seen), { bypassSecret: "s3cret" });
    expect(seen.map((s) => s.headers)).toEqual(
      seen.map(() => ({ "x-vercel-protection-bypass": "s3cret" })),
    );
    const plain: typeof seen = [];
    await smokeTest("https://x.test", fakeFetch(healthy(), plain));
    expect(plain.map((s) => s.headers)).toEqual(plain.map(() => ({})));
  });

  it("needs no owner session and checks every public auth page the gate allows (sign-up, verification, forgot and reset included)", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await smokeTest("https://x.test", fakeFetch(healthy(), seen));
    const paths = seen.map((s) => new URL(s.url).pathname);
    for (const path of PUBLIC_PATHS) expect(paths).toContain(path);
    expect(seen.every((s) => !("cookie" in s.headers) && !("authorization" in s.headers))).toBe(
      true,
    );
  });

  it("fails when a public auth page redirects away", async () => {
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/access-denied": redirect("/sign-in") }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[1]).toBe("FAIL /access-denied: 307 (expected 200)");
  });
});

describe("smokeTest: what a failing response reveals", () => {
  const platform404 = () =>
    new Response("The page could not be found\n\nNOT_FOUND", {
      status: 404,
      headers: {
        "x-vercel-error": "NOT_FOUND",
        "x-vercel-id": "pdx1::abc-123",
        "set-cookie": "secret=1",
      },
    });
  const failing = (): Routes => ({ ...healthy(), "/sign-in": platform404() });

  it("prints the status, x-vercel-error, x-vercel-id and the start of the body for a failing check", async () => {
    const result = await smokeTest("https://x.test", fakeFetch(failing()));
    expect(result.ok).toBe(false);
    expect(result.lines.slice(0, 4)).toEqual([
      "FAIL /sign-in: 404 (expected 200)",
      "     x-vercel-error: NOT_FOUND",
      "     x-vercel-id: pdx1::abc-123",
      "     body: The page could not be found NOT_FOUND",
    ]);
  });

  it("prints nothing extra for passing checks", async () => {
    const result = await smokeTest("https://x.test", fakeFetch(healthy()));
    expect(result.lines.every((line) => /^ok {3}/.test(line))).toBe(true);
  });

  it("says (none) and (empty) when the response carries neither", async () => {
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/sign-in": new Response(null, { status: 500 }) }),
    );
    expect(result.lines.slice(0, 4)).toEqual([
      "FAIL /sign-in: 500 (expected 200)",
      "     x-vercel-error: (none)",
      "     x-vercel-id: (none)",
      "     body: (empty)",
    ]);
  });

  it("cuts the body at 200 characters and puts it on one line", async () => {
    const long = `${"a".repeat(150)}\n\n\t${"b".repeat(150)}`;
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/sign-in": new Response(long, { status: 404 }) }),
    );
    const body = result.lines[3].replace("     body: ", "");
    expect(body).toBe(`${"a".repeat(150)} ${"b".repeat(47)}`);
    expect(result.lines[3]).not.toMatch(/[\n\t]/);
  });

  it("never prints the bypass secret, even if the response echoes it, nor other response headers", async () => {
    const echo = new Response("you sent s3cret-value in a header", {
      status: 404,
      headers: { "x-vercel-id": "id-s3cret-value", location: "https://vercel.com/sso?nonce=zzz" },
    });
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/sign-in": echo }),
      {
        bypassSecret: "s3cret-value",
      },
    );
    const text = result.lines.join("\n");
    expect(text).not.toContain("s3cret-value");
    expect(text).toContain("body: you sent *** in a header");
    expect(text).toContain("x-vercel-id: id-***");
    expect(text).not.toMatch(/nonce|sso|set-cookie/);
  });

  it("still reports a redirect that goes the wrong way, without printing where it goes", async () => {
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/": redirect("https://vercel.com/sso-api?nonce=zzz") }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).not.toMatch(/nonce|sso-api/);
    expect(result.lines.find((line) => line.startsWith("FAIL /:"))).toBeTruthy();
  });

  it("survives a body that cannot be read", async () => {
    const unreadable = new Response("x", { status: 404 });
    Object.defineProperty(unreadable, "text", {
      value: async () => {
        throw new Error("stream error");
      },
    });
    const result = await smokeTest(
      "https://x.test",
      fakeFetch({ ...healthy(), "/sign-in": unreadable }),
    );
    expect(result.lines[3]).toBe("     body: (empty)");
  });
});
