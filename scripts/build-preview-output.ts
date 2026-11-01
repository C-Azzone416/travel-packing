// Usage: tsx scripts/build-preview-output.ts
// Makes the Vercel Preview build output (`.vercel/output`, plus the `.next` its server functions point to) offline, with the locked
// CLI, a placeholder project and no token: the same build the Preview deploy scans. Run by CI (the `build` job) and `npm run verify`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOCKED_VERCEL,
  PREVIEW_ENV_FILE,
  PREVIEW_ENV_TEXT,
  hermeticEnv,
  projectJson,
} from "../src/tooling/preview-output";

if (!existsSync(LOCKED_VERCEL)) {
  const install = spawnSync("npm", ["ci", "--prefix", "tools/vercel-cli", "--ignore-scripts"], {
    stdio: "inherit",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

rmSync(".vercel/output", { recursive: true, force: true });
mkdirSync(".vercel", { recursive: true });
writeFileSync(".vercel/project.json", projectJson());
writeFileSync(PREVIEW_ENV_FILE, PREVIEW_ENV_TEXT);

const home = mkdtempSync(join(tmpdir(), "preview-output-"));
try {
  const build = spawnSync(LOCKED_VERCEL, ["build", "--yes"], {
    stdio: "inherit",
    env: hermeticEnv(process.env, home) as NodeJS.ProcessEnv,
  });
  process.exit(build.status ?? 1);
} finally {
  rmSync(home, { recursive: true, force: true });
}
