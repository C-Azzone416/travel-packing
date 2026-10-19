// Usage (the preview deploy job only): tsx scripts/inject-preview-secrets.ts <path to the file `vercel pull` wrote>
// Reads DATABASE_URL, DATABASE_URL_UNPOOLED, OWNER_EMAIL_ALLOWLIST and NEON_AUTH_COOKIE_SECRET from the environment
// (the workflow passes them from `secrets.*`) and replaces just those four entries in the file. Prints variable names
// only, never a value; refuses to run for anything but a preview (TARGET must be exactly "preview").
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { describeAllowlist } from "../src/server/auth/allowlist-fingerprint";
import { INJECTED_SECRETS, injectSecrets } from "../src/tooling/preview-secrets";

const file = process.argv[2];
if (!file) {
  console.error("usage: inject-preview-secrets <env file>");
  process.exit(2);
}
if (process.env.TARGET !== "preview") {
  console.error("preview secrets: refused: this is not a preview run (TARGET must be preview)");
  process.exit(1);
}

try {
  const result = injectSecrets(readFileSync(file, "utf8"), process.env);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`preview secrets: ${problem}`);
    process.exit(1);
  }
  writeFileSync(file, result.text);
  // The file may already exist with looser permissions (the pull created it): the values in it are for this job alone.
  chmodSync(file, 0o600);
  console.log(`preview secrets: injected ${INJECTED_SECRETS.join(", ")} (values not shown)`);
  // Compare this with the running app's `allowlist-loaded` log line to confirm Vercel's copy of the allowlist (and cookie
  // secret) matches this one without printing either: a keyed fingerprint and a count, never an address.
  const allowlist = describeAllowlist(
    process.env.OWNER_EMAIL_ALLOWLIST,
    process.env.NEON_AUTH_COOKIE_SECRET ?? "",
  );
  console.log(
    `preview secrets: allowlist ${allowlist.entries} entries, fingerprint ${allowlist.fingerprint}`,
  );
} catch {
  // Never print the error: it could carry a value.
  console.error("preview secrets: failed to update the env file");
  process.exit(1);
}
