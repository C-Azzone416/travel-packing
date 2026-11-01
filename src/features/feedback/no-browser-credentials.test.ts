import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #260: the browser holds no refresh or access credential, no invitation and no token. Source-level guard for what the build markers
// check in the output: nothing in the feedback client or the shell may store anything in the browser's storage or cookies, name the
// SDK's access controller, or build an Authorization header, and every request goes to the app's own /api/feedback routes.
const ROOTS = ["src/features/feedback", "src/components/shell"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const FILES = ROOTS.flatMap((root) => sources(join(process.cwd(), root)));
// Comments explain what is NOT done; only code counts.
const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no credential has a storage path in the browser code", () => {
  it("finds the feedback client files it is meant to guard", () => {
    const names = FILES.map((file) => file.slice(process.cwd().length + 1));
    expect(names).toEqual(
      expect.arrayContaining([
        "src/features/feedback/FeedbackAccess.tsx",
        "src/features/feedback/enrollment-client.ts",
        "src/features/feedback/delivery.ts",
        "src/features/feedback/account-scope.ts",
        "src/components/shell/Nav.tsx",
      ]),
    );
  });

  it.each([
    ["the SDK access controller", /playtest-access|createPlaytestAccess|enrollment-store/],
    ["a refresh or access token", /refreshToken|refresh_token|accessToken|access_token/],
    ["localStorage", /\blocalStorage\b/],
    ["sessionStorage", /\bsessionStorage\b/],
    ["document.cookie", /document\.cookie/],
    ["an Authorization header or Bearer token", /[Aa]uthorization|Bearer/],
    ["an invitation kept anywhere", /setItem\(|\.put\(.*invitation/],
  ])("no non-test file under the feedback client or shell uses %s", (_name, pattern) => {
    const offenders = FILES.filter((file) => pattern.test(code(file))).map((file) =>
      file.slice(process.cwd().length + 1),
    );
    expect(offenders).toEqual([]);
  });

  it("sends requests only to the app's own /api/feedback routes", () => {
    const constants = ["enrollment-client.ts", "delivery.ts"].flatMap((name) => {
      const text = code(join(process.cwd(), "src/features/feedback", name));
      return [
        ...text.matchAll(
          /(?:ENROLLMENT_PATH|REDEEM_PATH|DISCONNECT_PATH|REPORTS_PATH)\s*=\s*([^;]+);/g,
        ),
      ].map((match) => match[1]);
    });
    expect(constants.length).toBeGreaterThanOrEqual(4);
    for (const value of constants) expect(value).toMatch(/\/api\/feedback\/|ENROLLMENT_PATH/);
    // And no file in the client fetches an absolute URL.
    for (const file of FILES) expect(code(file)).not.toMatch(/fetch(?:Impl)?\(\s*["'`]https?:/);
  });
});
