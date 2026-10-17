import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// purgeDeletedBefore is the one retention helper that can act on every owner's data. It is for admin/cron use only
// (retention policy, #28), so nothing on a user request path may import it. This walks the source tree and fails if
// anything outside the allow-list mentions it.

const ROOT = join(process.cwd(), "src");
const ALLOWED = new Set([
  "server/db/retention.ts",
  "server/db/retention.test.ts",
  "server/db/retention-usage.test.ts",
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

describe("unowned retention helpers stay off user paths", () => {
  const mentioning = [...sourceFiles(ROOT)]
    .filter((path) => readFileSync(path, "utf8").includes("purgeDeletedBefore"))
    .map((path) => relative(ROOT, path));

  it("only the retention module and its tests mention purgeDeletedBefore", () => {
    expect(mentioning.filter((path) => !ALLOWED.has(path))).toEqual([]);
  });

  it("the check is live: the allow-listed files really do mention it", () => {
    expect(mentioning).toEqual(
      expect.arrayContaining(["server/db/retention.ts", "server/db/retention.test.ts"]),
    );
  });

  it("no user-facing module (app, components, features, service) imports the retention module's purge", () => {
    for (const path of sourceFiles(ROOT)) {
      const rel = relative(ROOT, path);
      if (!/^(app|components|features)\//.test(rel) && rel !== "server/data/service.ts") continue;
      expect(readFileSync(path, "utf8"), rel).not.toMatch(/purgeDeletedBefore/);
    }
  });
});
