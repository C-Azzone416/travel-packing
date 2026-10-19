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
    expect(result.lines.at(-1)).toMatch(/^FAIL \/:/);
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
