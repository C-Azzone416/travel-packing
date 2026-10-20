// Runs on `npm install` (the `prepare` script): points git at .githooks so the pre-push hook runs `npm run verify:quick`.
// Plain Node with no dependencies, and it never fails an install (a Vercel build has no .git, a production install has no dev tools).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git") && existsSync(".githooks")) {
  const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  if (result.status !== 0) console.warn("could not install the pre-push hook (git config failed)");
}
