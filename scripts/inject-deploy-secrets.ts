// Usage: tsx scripts/inject-deploy-secrets.ts <path to the file `vercel pull` wrote>
// Reads the four build-time Secrets from the selected GitHub environment and replaces just those entries in the pulled
// file. Prints variable names and a keyed allowlist fingerprint only, never a value. TARGET must be preview or production.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { describeAllowlist } from "../src/server/auth/allowlist-fingerprint";
import {
  FRAMEBRIAR_KEYS_SECRET,
  INJECTED_SECRETS,
  applyFramebriarKeys,
  injectSecrets,
} from "../src/tooling/preview-secrets";

const file = process.argv[2];
if (!file) {
  console.error("usage: inject-deploy-secrets <env file>");
  process.exit(2);
}
const target = process.env.TARGET;
if (target !== "preview" && target !== "production") {
  console.error("deploy secrets: refused: TARGET must be preview or production");
  process.exit(1);
}

try {
  const result = injectSecrets(readFileSync(file, "utf8"), process.env);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`${target} secrets: ${problem}`);
    process.exit(1);
  }
  // Optional and Preview-only: it can never fail the deploy, and a missing or invalid ring just leaves enrollment unavailable.
  const keys = applyFramebriarKeys(result.text, process.env, target);
  writeFileSync(file, keys.text);
  chmodSync(file, 0o600);
  console.log(`${target} secrets: injected ${INJECTED_SECRETS.join(", ")} (values not shown)`);
  console.log(
    `${target} secrets: ${FRAMEBRIAR_KEYS_SECRET} ${keys.state}${keys.state === "injected" ? "" : " (account feedback enrollment stays unavailable)"}`,
  );
  const allowlist = describeAllowlist(
    process.env.OWNER_EMAIL_ALLOWLIST,
    process.env.NEON_AUTH_COOKIE_SECRET ?? "",
  );
  console.log(
    `${target} secrets: allowlist ${allowlist.entries} entries (${allowlist.malformed} malformed), fingerprint ${allowlist.fingerprint}`,
  );
} catch {
  console.error(`${target} secrets: failed to update the env file`);
  process.exit(1);
}
