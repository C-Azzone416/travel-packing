import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIAS_HEAD_STEP,
  checkCiWorkflow,
  checkDeployWorkflow,
  checkVercelConfig,
  checkVercelCliLock,
  ciJob,
  MIN_CI_TIMEOUT_MINUTES,
  stepScript,
  stepLines,
  dependabotProblems,
  unpinnedActions,
} from "./workflow-check";

const DIR = join(process.cwd(), ".github", "workflows");
const deploy = readFileSync(join(DIR, "deploy-vercel.yml"), "utf8");
const ci = readFileSync(join(DIR, "ci.yml"), "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

/** The real file with one edit; the edit must change something, so a mutant cannot silently be a no-op. */
function mutate(from: string | RegExp, to: string): string {
  const mutated = deploy.replace(from, to);
  expect(mutated).not.toBe(deploy);
  return mutated;
}

describe("the real workflows", () => {
  it.each(readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name)))(
    "%s pins every action to a full commit SHA",
    (file) => {
      expect(unpinnedActions(readFileSync(join(DIR, file), "utf8"))).toEqual([]);
    },
  );

  it("deploy-vercel.yml keeps its safety contract", () => {
    expect(checkDeployWorkflow(deploy)).toEqual([]);
  });

  it("vercel.json keeps dependency installation out of vercel build", () => {
    expect(checkVercelConfig(vercelConfig)).toEqual([]);
    expect(checkVercelConfig('{"framework":"nextjs"}').join("\n")).toMatch(/installCommand/);
    expect(
      checkVercelConfig('{"framework":"nextjs","installCommand":"npm ci"}').join("\n"),
    ).toMatch(/empty string/);
  });
});
describe("unpinnedActions", () => {
  it.each([
    ["a tag", "      - uses: actions/checkout@v4"],
    ["a branch", "      - uses: actions/checkout@main"],
    ["a short SHA", "      - uses: actions/checkout@3d3c42e"],
    ["no ref", "        uses: actions/checkout"],
  ])("flags %s, naming only the line", (_name, line) => {
    expect(unpinnedActions(`steps:\n${line}\n`)).toEqual([
      "line 2: an action is not pinned to a full commit SHA",
    ]);
  });

  it("accepts a full SHA (with a trailing comment) and a local action", () => {
    const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
    expect(
      unpinnedActions(`  - uses: actions/checkout@${sha} # v7\n  - uses: ./local-action\n`),
    ).toEqual([]);
  });
});

/** The real workflow with the injection step moved to after the env check (wrong order). */
function movedInjection(): string {
  const block = /( {6}# `vercel pull`[\s\S]*?inject-deploy-secrets\.ts[^\n]*\n\n)/.exec(
    deploy,
  )?.[1];
  expect(block).toBeTruthy();
  const anchor = "      # The root install above already populated node_modules.";
  expect(deploy).toContain(anchor);
  return deploy.replace(block as string, "").replace(anchor, `${block}${anchor}`);
}

/** The real workflow with the whole alias section moved in front of the first smoke test (wrong order). */
function aliasBeforeSmoke(): string {
  const start = deploy.indexOf("      # ---- the stable Preview alias");
  expect(start).toBeGreaterThan(0);
  const block = deploy.slice(start);
  const withoutBlock = deploy.slice(0, start).trimEnd() + "\n";
  const smoke = "      - name: Smoke test\n";
  expect(withoutBlock).toContain(smoke);
  return withoutBlock.replace(smoke, `${block}\n${smoke}`);
}

describe("checkDeployWorkflow: each rule fails when its line is broken", () => {
  it.each([
    [
      "repository-token package access is added",
      mutate(
        "  actions: read # to read the `ci` result for this commit",
        "  actions: read # to read the `ci` result for this commit\n  packages: read",
      ),
      /must not grant the repository token package access/,
    ],
    [
      "a root install loses its package token",
      mutate(
        /      - name: Install\n        env:\n          NODE_AUTH_TOKEN: \$\{\{ secrets\.FRAMEBRIAR_PACKAGES_TOKEN \}\}\n        run: npm ci --ignore-scripts/,
        "      - name: Install\n        run: npm ci --ignore-scripts",
      ),
      /deploy job must give the Framebriar secret/,
    ],
    [
      "vercel build receives the package token",
      mutate(
        "      - name: Build\n        run:",
        "      - name: Build\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.FRAMEBRIAR_PACKAGES_TOKEN }}\n        run:",
      ),
      /vercel build and everything it launches must not receive/,
    ],
    [
      "the build-time package credential guard is removed",
      mutate("          npx tsx scripts/check-package-credentials.ts\n", ""),
      /vercel build must fail closed when a package credential is present/,
    ],
    [
      "the Preview check scanning only the output, which holds no server code",
      mutate(
        "run: npm run check:preview-feedback-in-build -- .vercel/output .next",
        "run: npm run check:preview-feedback-in-build -- .vercel/output",
      ),
      /exact Vercel Preview artifact must prove feedback UI and SDK are present/,
    ],
    [
      "the Production exclusion check scanning only the output",
      mutate(
        "run: npm run check:no-feedback-in-build -- .vercel/output .next",
        "run: npm run check:no-feedback-in-build -- .vercel/output",
      ),
      /exact Vercel Production artifact must prove feedback UI and SDK are absent/,
    ],
    [
      "the exact Preview artifact check is removed",
      mutate(
        /      - name: Preview contains feedback UI and browser SDK\n        if: env\.TARGET == 'preview'\n        run: npm run check:preview-feedback-in-build -- \.vercel\/output \.next\n/,
        "",
      ),
      /exact Vercel Preview artifact must prove feedback UI and SDK are present/,
    ],
    [
      "the Production feedback exclusion check runs on Preview",
      mutate(
        "      - name: Production contains no feedback UI or browser SDK\n        if: env.TARGET == 'production'",
        "      - name: Production contains no feedback UI or browser SDK\n        if: env.TARGET == 'preview'",
      ),
      /exact Vercel Production artifact must prove feedback UI and SDK are absent/,
    ],
    [
      "the Production capture exclusion check is weakened",
      mutate(
        "        run: npm run check:no-capture-in-build -- .vercel/output\n",
        "        run: echo skipped-capture-check\n",
      ),
      /exact Vercel Production artifact must prove screenshot capture is absent/,
    ],
    [
      "dependency scripts receive the package token",
      mutate(
        "      - name: Run install scripts without package credential\n        run:",
        "      - name: Run install scripts without package credential\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.FRAMEBRIAR_PACKAGES_TOKEN }}\n        run:",
      ),
      /dependency lifecycle scripts must run once/,
    ],
    [
      "the locked Vercel CLI install receives the package token",
      mutate(
        "      - name: Install the locked Vercel CLI\n        run:",
        "      - name: Install the locked Vercel CLI\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.FRAMEBRIAR_PACKAGES_TOKEN }}\n        run:",
      ),
      /locked Vercel CLI install must not receive/,
    ],
    [
      "a push triggers the deploy directly",
      mutate("on:\n", "on:\n  push:\n    branches:\n      - develop\n"),
      /push must not trigger/,
    ],
    ["not callable from ci.yml", mutate("  workflow_call:", "  other_call:"), /workflow_call/],
    ["no manual trigger", mutate("  workflow_dispatch:", "  other_trigger:"), /workflow_dispatch/],
    [
      "a polling wait for CI",
      mutate(
        "        run: npx tsx scripts/require-ci.ts",
        "        run: sleep 30; npx tsx scripts/require-ci.ts",
      ),
      /poll or wait/,
    ],
    [
      "the CI check runs for previews too",
      mutate("        if: github.event_name == 'workflow_dispatch'\n", ""),
      /guard the manual/,
    ],
    [
      "the CI check is not the exact-commit script",
      mutate("scripts/require-ci.ts", "scripts/other.ts"),
      /require-ci/,
    ],
    ["a pull request trigger", mutate("on:\n", "on:\n  pull_request:\n"), /pull request/],
    ["inherited secrets", `${deploy}\n    secrets: inherit\n`, /inherited/],
    [
      "a production build that does not force screenshots off",
      mutate("FEEDBACK_SCREENSHOTS=0 vercel build --prod", "vercel build --prod"),
      /production build must set FEEDBACK_SCREENSHOTS=0/,
    ],
    [
      "the gate reads a secret",
      mutate(
        "        run: node --experimental-strip-types scripts/release-gate.ts",
        "        env:\n          TOKEN: ${{ secrets.VERCEL_TOKEN }}\n        run: node --experimental-strip-types scripts/release-gate.ts",
      ),
      /gate job must not read/,
    ],
    [
      "the gate has an environment",
      mutate(
        "  gate:\n    runs-on: ubuntu-latest\n",
        "  gate:\n    environment: production\n    runs-on: ubuntu-latest\n",
      ),
      /gate job must not use a GitHub environment/,
    ],
    [
      "the gate is skipped",
      mutate("scripts/release-gate.ts", "scripts/other.ts"),
      /run the dependency-free release gate/,
    ],
    [
      "context interpolated into a shell",
      mutate(
        "run: node --experimental-strip-types scripts/release-gate.ts",
        "run: echo ${{ inputs.release_sha }}; node --experimental-strip-types scripts/release-gate.ts",
      ),
      /never interpolate/,
    ],
    ["the deploy job skips the gate", mutate("    needs: gate\n", ""), /need the gate/],
    [
      "a fixed environment",
      mutate("environment: ${{ needs.gate.outputs.target }}", "environment: production"),
      /environment must be the target/,
    ],
    [
      "TARGET not from the gate",
      mutate("      TARGET: ${{ needs.gate.outputs.target }}", "      TARGET: production"),
      /TARGET must come from the gate/,
    ],
    ["the raw seed command", mutate("db:seed:preview", "db:seed"), /only `db:seed:preview`/],
    [
      "an unconditional seed",
      mutate(/(- name: Seed synthetic data[^\n]*\n)\s+if: env\.TARGET == 'preview'\n/, "$1"),
      /seed step must run only when TARGET is preview/,
    ],
    [
      "no secret injection step",
      mutate(
        / {6}- name: Inject deployment secrets[\s\S]*?inject-deploy-secrets\.ts[^\n]*\n\n/,
        "",
      ),
      /injection step is missing/,
    ],
    ["the injection after the env check", movedInjection(), /after vercel pull and before/],
    [
      "an injection restricted to Preview",
      mutate(
        /(- name: Inject deployment secrets[^\n]*\n)/,
        "$1        if: env.TARGET == 'preview'\n",
      ),
      /must run for both Preview and Production/,
    ],
    [
      "an injected value from a variable",
      mutate(
        "OWNER_EMAIL_ALLOWLIST: ${{ secrets.OWNER_EMAIL_ALLOWLIST }}",
        "OWNER_EMAIL_ALLOWLIST: ${{ vars.OWNER_EMAIL_ALLOWLIST }}",
      ),
      /OWNER_EMAIL_ALLOWLIST must be injected from secrets/,
    ],
    [
      "an injected literal value",
      mutate(
        "NEON_AUTH_COOKIE_SECRET: ${{ secrets.NEON_AUTH_COOKIE_SECRET }}",
        "NEON_AUTH_COOKIE_SECRET: hunter2",
      ),
      /NEON_AUTH_COOKIE_SECRET must be injected from secrets|secrets\.\* only/,
    ],
    [
      "the Framebriar key ring read from a variable",
      mutate(
        "FRAMEBRIAR_CREDENTIAL_KEYS: ${{ secrets.FRAMEBRIAR_CREDENTIAL_KEYS }}",
        "FRAMEBRIAR_CREDENTIAL_KEYS: ${{ vars.FRAMEBRIAR_CREDENTIAL_KEYS }}",
      ),
      /FRAMEBRIAR_CREDENTIAL_KEYS must be passed to the injection step from secrets|secrets\.\* only/,
    ],
    [
      "the Framebriar key ring dropped from the injection step",
      mutate(
        "          FRAMEBRIAR_CREDENTIAL_KEYS: ${{ secrets.FRAMEBRIAR_CREDENTIAL_KEYS }}\n",
        "",
      ),
      /FRAMEBRIAR_CREDENTIAL_KEYS must be passed to the injection step from secrets/,
    ],
    [
      "the Framebriar key ring read by another step",
      mutate(
        "      - name: Check the deploy environment (names only, no values)\n        env:",
        "      - name: Check the deploy environment (names only, no values)\n        env:\n          LEAK: ${{ secrets.FRAMEBRIAR_CREDENTIAL_KEYS }}",
      ),
      /secrets\.FRAMEBRIAR_CREDENTIAL_KEYS must be read only by the secret injection step/,
    ],
    [
      "the project settings never printed",
      mutate("scripts/print-project-settings.ts", "scripts/other.ts"),
      /project settings must be printed after vercel pull and before the build/,
    ],
    [
      "no check of the build output",
      mutate("scripts/check-build-output.ts", "scripts/other.ts"),
      /build output check must run after the build and before the deploy/,
    ],
    [
      "a head check that compares the run with itself (the judge's mutant 1)",
      mutate(/head=\$\(gh api [^\n]*\)\n/, "head=$GITHUB_SHA\n"),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "a head read from main (the judge's mutant 2)",
      mutate("git/ref/heads/develop", "git/ref/heads/main"),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "a head read with the wrong jq field",
      mutate("--jq .object.sha", "--jq .object.type"),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "a head check that compares another variable",
      mutate('check-alias-head.ts "$GITHUB_SHA" "$head"', 'check-alias-head.ts "$head" "$head"'),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "a head check with an extra environment variable",
      mutate(
        "GH_TOKEN: ${{ github.token }}\n        run: |\n          head=",
        "GH_TOKEN: ${{ github.token }}\n          EXTRA: 1\n        run: |\n          head=",
      ),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "a head check using a secret token",
      mutate(
        "GH_TOKEN: ${{ github.token }}\n        run: |\n          head=",
        "GH_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n        run: |\n          head=",
      ),
      /develop head check step must be exactly as reviewed|exactly four steps/,
    ],
    [
      "a head check that does something else afterwards",
      mutate(
        'npx tsx scripts/check-alias-head.ts "$GITHUB_SHA" "$head"',
        'npx tsx scripts/check-alias-head.ts "$GITHUB_SHA" "$head" || true',
      ),
      /develop head check step must be exactly as reviewed/,
    ],
    [
      "an alias pointed at a fixed URL (the judge's mutant 3)",
      mutate(
        "DEPLOY_URL: ${{ steps.deploy.outputs.url }}\n        run: npx tsx scripts/assign-alias.ts",
        "DEPLOY_URL: https://old-build.vercel.app\n        run: npx tsx scripts/assign-alias.ts",
      ),
      /alias assignment step must be exactly as reviewed/,
    ],
    [
      "an extra argument to the alias script",
      mutate(
        'scripts/assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
        'scripts/assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS" other.vercel.app',
      ),
      /alias assignment step must be exactly as reviewed/,
    ],
    [
      "an alias step with an extra command",
      mutate(
        'assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"\n\n      - name: Smoke test the alias',
        'assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"\n          curl -s https://example.test\n\n      - name: Smoke test the alias',
      ),
      /alias assignment step must be exactly as reviewed/,
    ],
    [
      "an alias smoke test that is allowed to fail",
      mutate(
        'smoke-test.ts "https://${PREVIEW_ALIAS}"',
        'smoke-test.ts "https://${PREVIEW_ALIAS}" || true',
      ),
      /alias smoke test step must be exactly as reviewed/,
    ],
    [
      "an alias smoke test with a different condition",
      mutate(
        "- name: Smoke test the alias\n        if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'",
        "- name: Smoke test the alias\n        if: env.TARGET == 'preview'",
      ),
      /alias smoke test step must be exactly as reviewed/,
    ],
    // ---- Production smoke target (#207) ----
    [
      "the Production alias proof removed",
      mutate(
        /      - name: Prove the Production alias belongs to this deployment[\s\S]*?\n\n(?=      - name: Production alias smoke test)/,
        "",
      ),
      /exactly five steps|Production alias is proven by one step/,
    ],
    [
      "the Production alias smoke test that may fail without stopping the run",
      mutate(
        'smoke-test.ts "https://${PRODUCTION_ALIAS}"',
        'smoke-test.ts "https://${PRODUCTION_ALIAS}" || true',
      ),
      /Production alias smoke test step must be exactly as reviewed/,
    ],
    [
      "the Production alias smoke test given the bypass secret",
      mutate(
        '        run: npx tsx scripts/smoke-test.ts "https://${PRODUCTION_ALIAS}"',
        '        env:\n          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}\n        run: npx tsx scripts/smoke-test.ts "https://${PRODUCTION_ALIAS}"',
      ),
      /Production alias smoke test step must be exactly as reviewed/,
    ],
    [
      "the Production alias proof that ignores the deployment",
      mutate(
        'verify-production-alias.ts "$DEPLOY_URL" "$PRODUCTION_ALIAS"',
        'verify-production-alias.ts "$PRODUCTION_ALIAS" "$PRODUCTION_ALIAS"',
      ),
      /Production alias proof step must be exactly as reviewed/,
    ],
    [
      "the Production alias proof with a different condition",
      mutate(
        "- name: Prove the Production alias belongs to this deployment\n        if: env.TARGET == 'production'",
        "- name: Prove the Production alias belongs to this deployment\n        if: env.TARGET != 'preview'",
      ),
      /Production alias proof step must be exactly as reviewed/,
    ],
    [
      "the deployment-URL smoke test running for Production (a protected generated address)",
      mutate(
        "      - name: Smoke test\n        if: env.TARGET == 'preview'",
        "      - name: Smoke test",
      ),
      /deployment smoke test step must be exactly as reviewed/,
    ],
    [
      "the Production smoke target pointing at the generated address",
      mutate('smoke-test.ts "https://${PRODUCTION_ALIAS}"', 'smoke-test.ts "$DEPLOY_URL"'),
      /Production alias smoke test step must be exactly as reviewed|Production alias is proven by one step/,
    ],
    [
      "another Production alias",
      mutate("PRODUCTION_ALIAS: packed-smart.vercel.app", "PRODUCTION_ALIAS: other.vercel.app"),
      /PRODUCTION_ALIAS must be packed-smart\.vercel\.app/,
    ],
    [
      "a production deploy that does not label the commit",
      mutate('--prod --meta releaseSha="$GITHUB_SHA"', "--prod"),
      /label the deployment with the release commit/,
    ],
    [
      "a second step that moves the alias",
      `${deploy.trimEnd()}\n      - name: Move it again\n        run: npx tsx scripts/assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"\n`,
      /alias must be set by exactly one step/,
    ],
    [
      "the alias moved with the vercel CLI again",
      mutate(
        'run: npx tsx scripts/assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
        'run: vercel alias set "$DEPLOY_URL" "$PREVIEW_ALIAS" --token="$VERCEL_TOKEN"',
      ),
      /never the vercel CLI/,
    ],
    [
      "the alias set for something other than the deployed URL",
      mutate(
        'assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
        'assign-alias.ts "$OLD_URL" "$PREVIEW_ALIAS"',
      ),
      /assign the deployed URL to PREVIEW_ALIAS/,
    ],
    [
      "the alias set without checking the develop head",
      mutate(
        " && steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN",
        "\n        env:\n          VERCEL_TOKEN",
      ),
      /still the develop head/,
    ],
    [
      "the alias set for a production run too",
      mutate(
        "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN",
        "if: steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN",
      ),
      /still the develop head/,
    ],
    [
      "the cleanup run for production too",
      mutate(
        "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n          DEPLOY_URL: ${{ steps.deploy.outputs.url }}\n        run: npx tsx scripts/cleanup-previews.ts",
        "if: steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n          DEPLOY_URL: ${{ steps.deploy.outputs.url }}\n        run: npx tsx scripts/cleanup-previews.ts",
      ),
      /Preview cleanup step must be exactly as reviewed/,
    ],
    [
      "the cleanup run without the alias having moved",
      mutate(
        "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n          DEPLOY_URL: ${{ steps.deploy.outputs.url }}\n        run: npx tsx scripts/cleanup-previews.ts",
        "if: env.TARGET == 'preview'\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n          DEPLOY_URL: ${{ steps.deploy.outputs.url }}\n        run: npx tsx scripts/cleanup-previews.ts",
      ),
      /Preview cleanup step must be exactly as reviewed/,
    ],
    [
      "a cleanup that is allowed to fail the step quietly",
      mutate(
        'run: npx tsx scripts/cleanup-previews.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
        'run: npx tsx scripts/cleanup-previews.ts "$DEPLOY_URL" "$PREVIEW_ALIAS" || true',
      ),
      /Preview cleanup step must be exactly as reviewed/,
    ],
    [
      "old deployments removed with the vercel CLI",
      `${deploy.trimEnd()}\n      - name: Tidy\n        run: vercel remove old --yes\n`,
      /never the vercel CLI/,
    ],
    [
      "a second cleanup step",
      `${deploy.trimEnd()}\n      - name: Again\n        run: npx tsx scripts/cleanup-previews.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"\n`,
      /one step, after the alias smoke test/,
    ],
    [
      "a step that runs after a failure",
      mutate(
        "- name: Smoke test the alias\n        if:",
        "- name: Smoke test the alias\n        if: always() &&",
      ),
      /must not move then/,
    ],
    [
      "a step that continues past a failure",
      mutate(
        "- name: Assign the stable Preview alias\n",
        "- name: Assign the stable Preview alias\n        continue-on-error: true\n",
      ),
      /must not move then/,
    ],
    [
      "the develop head check dropped",
      mutate("scripts/check-alias-head.ts", "scripts/other.ts"),
      /order must be: smoke test, develop head check, alias set/,
    ],
    [
      "the alias block moved ahead of the first smoke test",
      aliasBeforeSmoke(),
      /order must be: smoke test, develop head check, alias set/,
    ],
    [
      "no smoke test of the alias itself",
      mutate(
        'scripts/smoke-test.ts "https://${PREVIEW_ALIAS}"',
        'scripts/smoke-test.ts "$DEPLOY_URL"',
      ),
      /alias itself must be smoke-tested/,
    ],
    [
      "a different alias name",
      mutate(
        "PREVIEW_ALIAS: travel-packing-preview.vercel.app",
        "PREVIEW_ALIAS: other-name.vercel.app",
      ),
      /PREVIEW_ALIAS must be travel-packing-preview.vercel.app/,
    ],
    [
      "a sixth Vercel token use",
      `${deploy.trimEnd()}\n        X: \${{ secrets.VERCEL_TOKEN }}\n`,
      /exactly five steps/,
    ],
    [
      "a preview deploy that leaves its target to Vercel",
      mutate("vercel deploy --prebuilt --target=preview", "vercel deploy --prebuilt"),
      /preview deploy must pass --target=preview/,
    ],
    [
      "a production deploy without --prod",
      mutate("vercel deploy --prebuilt --prod", "vercel deploy --prebuilt --target=production"),
      /production deploy must pass --prod/,
    ],
    [
      "no check of where the deployment landed",
      mutate("scripts/check-deploy-target.ts", "scripts/other.ts"),
      /deploy target check must run after the deploy and before the smoke test/,
    ],
    [
      "the target check after the smoke test",
      mutate(/(- name: Check the deployment landed[^\n]*\n\s+run: [^\n]*\n\n)([\s\S]*)$/, "$2\n$1"),
      /deploy target check must run after the deploy and before the smoke test/,
    ],
    [
      "an extra command beside the injection script",
      mutate(
        'run: npx tsx scripts/inject-deploy-secrets.ts ".vercel/.env.${TARGET}.local"',
        'run: npx tsx scripts/inject-deploy-secrets.ts ".vercel/.env.${TARGET}.local" && env',
      ),
      /exactly the injection script/,
    ],
    [
      "the injection script run on a different file",
      mutate(
        'inject-deploy-secrets.ts ".vercel/.env.${TARGET}.local"',
        "inject-deploy-secrets.ts other.env",
      ),
      /exactly the injection script/,
    ],
    [
      "an extra non-secret value in the injection step",
      mutate(
        "NEON_AUTH_COOKIE_SECRET: ${{ secrets.NEON_AUTH_COOKIE_SECRET }}",
        "NEON_AUTH_COOKIE_SECRET: ${{ secrets.NEON_AUTH_COOKIE_SECRET }}\n          EXTRA: ${{ vars.X }}",
      ),
      /secrets\.\* only/,
    ],
    [
      "an injected secret read by another step",
      `${deploy.trimEnd()}\n        X: \${{ secrets.DATABASE_URL }}\n`,
      /secrets\.DATABASE_URL must be read only by the secret injection step/,
    ],
    ["a sixth Vercel token use", `${deploy}\n# ${"secrets"}.VERCEL_TOKEN\n`, /exactly five steps/],
    ["the pooled URL", `${deploy}\n          DATABASE_URL: x\n`, /never the pooled/],
    [
      "no direct URL secret",
      mutate(/secrets\.DATABASE_URL_UNPOOLED/g, "secrets.OTHER"),
      /direct database URL secret/,
    ],
    [
      "the env check removed",
      mutate("check-deploy-env", "other"),
      /check-deploy-env step is missing/,
    ],
    [
      "an unpinned CLI",
      mutate("VERCEL_CLI_VERSION: 64.5.0", "VERCEL_CLI_VERSION: latest"),
      /must be pinned/,
    ],
    ["a moving tag install", `${deploy}\nrun: npm i vercel@latest\n`, /@latest/],
    // ---- the Vercel CLI comes only from its lockfile (#208) ----
    [
      "the old global install back",
      mutate(
        "run: npm ci --prefix tools/vercel-cli --ignore-scripts",
        'run: npm install --global "vercel@${VERCEL_CLI_VERSION}"',
      ),
      /must not be installed with npm install or globally|locked Vercel CLI install step must be exactly as reviewed/,
    ],
    [
      "an ad-hoc install of vercel",
      `${deploy}\n        run: npm install vercel@64.5.0\n`,
      /must not be installed with npm install or globally/,
    ],
    [
      "any global npm install",
      `${deploy}\n        run: npm i -g something\n`,
      /must not be installed with npm install or globally/,
    ],
    [
      "vercel run through npx",
      `${deploy}\n        run: npx vercel deploy\n`,
      /must not be run with npx/,
    ],
    [
      "the locked install without --ignore-scripts",
      mutate(
        "npm ci --prefix tools/vercel-cli --ignore-scripts",
        "npm ci --prefix tools/vercel-cli",
      ),
      /locked Vercel CLI install step must be exactly as reviewed/,
    ],
    [
      "the locked install replaced by npm install",
      mutate(
        "npm ci --prefix tools/vercel-cli --ignore-scripts",
        "npm install --prefix tools/vercel-cli --ignore-scripts",
      ),
      /must not be installed with npm install or globally|exactly as reviewed/,
    ],
    [
      "the PATH step pointing somewhere else",
      mutate("tools/vercel-cli/node_modules/.bin", "node_modules/.bin"),
      /Vercel CLI PATH step must be exactly as reviewed|order must be: install the locked Vercel CLI/,
    ],
    [
      "the CLI used before it is installed",
      mutate(
        "      - name: Install the locked Vercel CLI",
        '      - name: Pull early\n        run: vercel pull --yes --environment="$TARGET"\n\n      - name: Install the locked Vercel CLI',
      ),
      /order must be: install the locked Vercel CLI/,
    ],
    [
      "the deploy downloading the e2e build",
      `${deploy}\n      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333\n        with:\n          name: e2e-build\n`,
      /never use an artifact or an e2e build/,
    ],
    [
      "the deploy building with the e2e flag",
      `${deploy}\n          NEXT_PUBLIC_E2E_BUILD: "1"\n`,
      /never use an artifact or an e2e build/,
    ],
    [
      "no production host passed",
      mutate(/secrets\.PRODUCTION_DB_HOST/g, "secrets.OTHER"),
      /PRODUCTION_DB_HOST must be passed/,
    ],
    [
      "the production host read as a variable",
      mutate("secrets.PRODUCTION_DB_HOST", "vars.PRODUCTION_DB_HOST"),
      /PRODUCTION_DB_HOST must be a secret/,
    ],
    [
      "the owner id read as a variable",
      mutate("secrets.PREVIEW_SEED_OWNER_ID", "vars.PREVIEW_SEED_OWNER_ID"),
      /PREVIEW_SEED_OWNER_ID must be a secret/,
    ],
    [
      "the owner id not read at all",
      mutate("secrets.PREVIEW_SEED_OWNER_ID", "secrets.OTHER"),
      /read PREVIEW_SEED_OWNER_ID as a secret/,
    ],
  ])("%s", (_name, workflow, message) => {
    expect(checkDeployWorkflow(workflow).join("\n")).toMatch(message);
  });

  it("flags a missing gate job and a missing deploy job", () => {
    expect(
      checkDeployWorkflow("on:\n  push:\n    branches:\n      - develop\nconcurrency:\n").join(
        "\n",
      ),
    ).toMatch(/gate job is missing/);
    expect(
      checkDeployWorkflow("on:\n  push:\n    branches:\n      - develop\nconcurrency:\n").join(
        "\n",
      ),
    ).toMatch(/deploy job is missing/);
  });

  it("flags secrets read before the deploy job and migrating before the target check", () => {
    const early = mutate("  gate:\n", "  other:\n    env:\n      A: ${{ secrets.X }}\n  gate:\n");
    expect(checkDeployWorkflow(early).join("\n")).toMatch(/only be read in the deploy job/);
    const reordered = mutate("npx tsx scripts/check-migration-target.ts", "echo skipped");
    expect(checkDeployWorkflow(reordered).join("\n")).toMatch(
      /check-migration-target step is missing|checked before/,
    );
  });
});

describe("checkCiWorkflow", () => {
  const mutateCi = (from: string | RegExp, to: string) => {
    const mutated = ci.replace(from, to);
    expect(mutated).not.toBe(ci);
    return mutated;
  };
  /** Replace text inside one job only. */
  const inJob = (job: string, from: string | RegExp, to: string) => {
    const body = jobText(job);
    const changed = body.replace(from, to);
    expect(changed).not.toBe(body);
    return ci.replace(body, changed);
  };
  const jobText = (name: string) => {
    const start = ci.search(new RegExp(`^  ${name}:\\s*$`, "m"));
    expect(start).toBeGreaterThan(0);
    const rest = ci.slice(start + 1);
    const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
    return next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next);
  };

  it("holds for the real workflow", () => {
    expect(checkCiWorkflow(ci)).toEqual([]);
    expect(MIN_CI_TIMEOUT_MINUTES).toBeGreaterThan(0);
  });

  it.each([
    [
      "repository-token package access is added",
      mutateCi(
        "permissions:\n  contents: read\n",
        "permissions:\n  contents: read\n  packages: read\n",
      ),
      /must not grant the repository token package access/,
    ],
    [
      "an install token exposed to fork pull requests",
      inJob(
        "unit",
        "NODE_AUTH_TOKEN: ${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && secrets.FRAMEBRIAR_PACKAGES_TOKEN || '' }}",
        "NODE_AUTH_TOKEN: ${{ secrets.FRAMEBRIAR_PACKAGES_TOKEN }}",
      ),
      /unit's fetch-only root install must receive the package token only/,
    ],
    [
      "dependency scripts receive the package token",
      inJob(
        "unit",
        "      - name: Run install scripts without package credential\n        run:",
        "      - name: Run install scripts without package credential\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.FRAMEBRIAR_PACKAGES_TOKEN }}\n        run:",
      ),
      /unit's dependency lifecycle scripts must run once without package credentials/,
    ],
    [
      "an explicit permission block adds package read",
      inJob("mode", "      contents: read\n", "      contents: read\n      packages: read\n"),
      /mode's explicit permissions must not grant package access/,
    ],
    ["the summary job renamed", mutateCi(/^ {2}ci:/m, "  summary:"), /ci job is missing/],
    [
      "an extra job nobody summarises",
      `${ci.replace(/\n {2}deploy:[\s\S]*$/, "")}\n  lint:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps: []\n\n${ci.slice(ci.indexOf("  deploy:"))}`,
      /unknown job lint/,
    ],
    ["no ready_for_review", mutateCi(", ready_for_review", ""), /ready_for_review/],
    [
      "a develop push that cancels a deploy",
      mutateCi(
        "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        "cancel-in-progress: true",
      ),
      /may be cancelled/,
    ],
    [
      "a job without a timeout",
      inJob("unit", /^ {4}timeout-minutes:.*\n/m, ""),
      /unit job needs a timeout/,
    ],
    [
      "a tiny e2e timeout",
      inJob("e2e", /timeout-minutes: \d+/, "timeout-minutes: 3"),
      /e2e job's timeout-minutes must leave room/,
    ],
    [
      "a job reading a secret",
      inJob(
        "unit",
        "      - name: Test with coverage\n",
        "      - name: Test with coverage\n        env:\n          X: ${{ secrets.VERCEL_TOKEN }}\n",
      ),
      /unit job must read no secret/,
    ],
    [
      "continue-on-error on a gate",
      inJob(
        "checks",
        "      - name: Lint\n",
        "      - name: Lint\n        continue-on-error: true\n",
      ),
      /checks job must not use continue-on-error/,
    ],
    [
      "no mode step",
      inJob("mode", "scripts/ci-mode.ts", "scripts/other.ts"),
      /mode step is missing/,
    ],
    [
      "the mode not published",
      inJob("mode", /\s+mode: \$\{\{ steps\.mode\.outputs\.mode \}\}/, ""),
      /must output the mode/,
    ],
    [
      "checks waiting for the mode",
      inJob("checks", "  checks:\n", "  checks:\n    needs: mode\n"),
      /checks job must run in every mode/,
    ],
    [
      "checks skipped outside full mode",
      inJob("checks", "  checks:\n", "  checks:\n    if: needs.mode.outputs.mode == 'full'\n"),
      /checks job must run in every mode/,
    ],
    [
      "gitleaks removed",
      inJob("checks", /      - uses: gitleaks[^\n]*\n {8}env:\n {10}GITHUB_TOKEN[^\n]*\n\n/, ""),
      /gitleaks\) must run inside the checks job/,
    ],
    [
      "a shallow checkout for gitleaks",
      inJob("checks", /\n {8}with:\n {10}fetch-depth: 0[^\n]*/, ""),
      /full history/,
    ],
    [
      "the audit weakened",
      inJob("checks", "--audit-level=high", "--audit-level=critical"),
      /dependency audit/,
    ],
    [
      "the locked Vercel CLI install dropped from the checks job",
      inJob("checks", "npm ci --prefix tools/vercel-cli --ignore-scripts", "true"),
      /locked Vercel CLI install check is missing/,
    ],
    [
      "the locked Vercel CLI never run",
      inJob("checks", "tools/vercel-cli/node_modules/.bin/vercel --version", "true"),
      /locked Vercel CLI version check is missing/,
    ],
    [
      "lint dropped",
      inJob("checks", "        run: npm run lint\n", "        run: true\n"),
      /lint check is missing/,
    ],
    [
      "actionlint dropped",
      inJob("checks", '"$RUNNER_TEMP/actionlint" -color', "true"),
      /actionlint check is missing/,
    ],
    [
      "unit not waiting for the mode",
      inJob("unit", "    needs: mode\n", ""),
      /unit job must need the mode/,
    ],
    [
      "unit running in every mode",
      inJob("unit", "    if: needs.mode.outputs.mode == 'full'\n", ""),
      /unit job must run only in full mode/,
    ],
    [
      "e2e running in every mode",
      inJob("e2e", "    if: needs.mode.outputs.mode == 'full'\n", ""),
      /e2e job must run only in full mode/,
    ],
    [
      "e2e-build running in every mode",
      inJob("e2e-build", "    if: needs.mode.outputs.mode == 'full'\n", ""),
      /e2e-build job must run only in full mode/,
    ],
    [
      "coverage dropped",
      inJob("unit", "npm run test:coverage", "true"),
      /unit job must run the coverage tests/,
    ],
    [
      "the webpack build dropped",
      inJob("build", "npm run build:webpack", "true"),
      /build job must run the webpack build/,
    ],
    [
      "the production build made with the e2e flag",
      inJob(
        "build",
        "      - name: Build\n        run: npm run build:production\n",
        "      - name: Build\n        env:\n          NEXT_PUBLIC_E2E_BUILD: '1'\n        run: npm run build:production\n",
      ),
      /build job must build exactly like production/,
    ],
    [
      "the production-mode build replaced by a plain build",
      inJob("build", "npm run build:production\n", "npm run build\n"),
      /build job is missing npm run build:production/,
    ],
    [
      "the screenshot capture check dropped",
      inJob("build", /npm run check:no-capture-in-build\n/g, "true\n"),
      /build job is missing check:no-capture-in-build/,
    ],
    [
      "the Production feedback exclusion check dropped",
      inJob("build", /npm run check:no-feedback-in-build\n/g, "true\n"),
      /build job is missing check:no-feedback-in-build/,
    ],
    [
      "the build job no longer makes the Preview output",
      inJob("build", "npm run build:preview-output", "true"),
      /build job must make the Preview output offline/,
    ],
    [
      "the build job never checks the Preview output for e2e-only modules",
      inJob(
        "build",
        "      - name: The Preview output carries no e2e-only module\n        run: npm run check:no-e2e-in-build\n",
        "",
      ),
      /build job must run check:no-e2e-in-build on the Preview output/,
    ],
    [
      "the Preview e2e check moved before the Preview output is made",
      inJob(
        "build",
        "      - name: The Preview output carries no e2e-only module\n        run: npm run check:no-e2e-in-build\n",
        "",
      ).replace(
        "      - name: Install the locked Vercel CLI\n",
        "      - name: Early\n        run: npm run check:no-e2e-in-build\n      - name: Install the locked Vercel CLI\n",
      ),
      /build job must run check:no-e2e-in-build on the Preview output/,
    ],
    [
      "the build job makes the Preview output but never checks it",
      inJob("build", "npm run check:preview-feedback-in-build -- .vercel/output .next", "true"),
      /build job must make the Preview output offline/,
    ],
    [
      "the build job checks the Preview output without the server build directory",
      inJob(
        "build",
        "npm run check:preview-feedback-in-build -- .vercel/output .next",
        "npm run check:preview-feedback-in-build -- .vercel/output",
      ),
      /build job must make the Preview output offline/,
    ],
    [
      "the build job making the Preview output without the locked CLI",
      inJob("build", "npm ci --prefix tools/vercel-cli --ignore-scripts", "true"),
      /build job must make the Preview output offline/,
    ],
    [
      "the production build uploading an artifact",
      inJob(
        "build",
        "      - name: Build with webpack\n",
        "      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9\n        with:\n          name: x\n          path: .next\n      - name: Build with webpack\n",
      ),
      /build job must build exactly like production/,
    ],
    [
      "the e2e build not made with the flag",
      inJob("e2e-build", "npm run build:e2e", "npm run build"),
      /must run npm run build:e2e/,
    ],
    [
      "a long-lived e2e artifact",
      inJob("e2e-build", "retention-days: 1", "retention-days: 30"),
      /live one day/,
    ],
    [
      "an artifact with the build cache",
      inJob("e2e-build", "            !.next/cache\n", ""),
      /without its cache/,
    ],
    [
      "e2e not waiting for the e2e build",
      inJob("e2e", "    needs: [mode, e2e-build]", "    needs: [mode]"),
      /e2e job must need the e2e-build/,
    ],
    [
      "a third e2e project",
      inJob(
        "e2e",
        "      - project: phone\n",
        "      - project: tablet\n        browser: webkit\n      - project: phone\n",
      ),
      /exactly phone on webkit/,
    ],
    [
      "only phone",
      inJob("e2e", /\n {10}- project: desktop\n {12}browser: chromium/, ""),
      /exactly phone on webkit/,
    ],
    [
      "phone run in chromium (not a real phone)",
      inJob("e2e", /browser: webkit/, "browser: chromium"),
      /exactly phone on webkit/,
    ],
    [
      "desktop run in webkit",
      inJob("e2e", /browser: chromium/, "browser: webkit"),
      /exactly phone on webkit/,
    ],
    [
      "an e2e job installing the wrong browser",
      inJob("e2e", 'npx playwright install "$BROWSER"', "npx playwright install chromium"),
      /install its own browser/,
    ],
    [
      "the Playwright dependency retry dropped",
      inJob("e2e", "for attempt in 1 2", "for attempt in 1"),
      /dependency install needs one bounded timeout retry/,
    ],
    [
      "the Playwright dependency timeout dropped",
      inJob(
        "e2e",
        "timeout --kill-after=30s 5m npx playwright install-deps",
        "npx playwright install-deps",
      ),
      /dependency install needs one bounded timeout retry/,
    ],
    [
      "a cache shared by both browsers",
      inJob("e2e", "-${{ matrix.browser }}-", "-"),
      /cache key must include the browser/,
    ],
    [
      "fail-fast",
      inJob("e2e", "fail-fast: false", "fail-fast: true"),
      /must not cancel one project/,
    ],
    [
      "serialised projects",
      inJob("e2e", "      fail-fast: false\n", "      fail-fast: false\n      max-parallel: 1\n"),
      /at the same time/,
    ],
    ["e2e rebuilding", inJob("e2e", 'E2E_PREBUILT: "1"', 'E2E_PREBUILT: "0"'), /E2E_PREBUILT/],
    [
      "feedback design evidence is not preserved",
      inJob(
        "e2e",
        "FEEDBACK_DESIGN_SHOTS: test-results/feedback-design",
        "FEEDBACK_DESIGN_SHOTS: ''",
      ),
      /preserve the feedback design matrix/,
    ],
    [
      "e2e without the download",
      inJob("e2e", "name: e2e-build\n          path: .next", "name: other\n          path: .next"),
      /download the e2e build/,
    ],
    [
      "both projects in one command",
      inJob("e2e", '--project="$E2E_PROJECT"', "--project=phone"),
      /for its own project/,
    ],
    [
      "sharded e2e",
      inJob("e2e", '--project="$E2E_PROJECT"', '--project="$E2E_PROJECT" --shard=1/2'),
      /whole, on one worker/,
    ],
    [
      "the summary missing a job",
      mutateCi(
        "needs: [mode, checks, unit, build, e2e-build, e2e]",
        "needs: [mode, checks, unit, build, e2e-build]",
      ),
      /ci job must need e2e$/m,
    ],
    ["the summary skippable", inJob("ci", "    if: always()\n", ""), /must always run/],
    [
      "the summary missing the quick branch",
      inJob("ci", "quick) fail", "quik) fail"),
      /must handle quick/,
    ],
    [
      "the summary needing the deploy",
      mutateCi(
        "needs: [mode, checks, unit, build, e2e-build, e2e]",
        "needs: [mode, checks, unit, build, e2e-build, e2e, deploy]",
      ),
      /only the jobs it summarises/,
    ],
    [
      "the deploy not needing ci",
      inJob("deploy", "    needs: ci\n", ""),
      /deploy job must need ci/,
    ],
    [
      "the deploy also needing a heavy job",
      inJob("deploy", "    needs: ci\n", "    needs: [ci, e2e]\n"),
      /need ci, and only ci/,
    ],
    [
      "the deploy running on pull requests",
      inJob("deploy", /&& github\.event_name == 'push' /, ""),
      /only for a push to develop/,
    ],
    [
      "the deploy running on any branch",
      inJob("deploy", / && github\.ref == 'refs\/heads\/develop'/, ""),
      /only for a push to develop/,
    ],
    [
      "the OLD condition (no status function: skipped after a reused push)",
      inJob(
        "deploy",
        /if: \$\{\{.*\}\}/,
        "if: github.event_name == 'push' && github.ref == 'refs/heads/develop'",
      ),
      /needs a status function/,
    ],
    [
      "no status function but ci's result",
      inJob("deploy", /!cancelled\(\) && /, ""),
      /needs a status function/,
    ],
    [
      "a status function but not ci's result (would deploy a red ci)",
      inJob("deploy", /needs\.ci\.result == 'success' && /, ""),
      /gated on ci's own result/,
    ],
    [
      "deploying when ci FAILED",
      inJob("deploy", /needs\.ci\.result == 'success'/, "needs.ci.result == 'failure'"),
      /gated on ci's own result/,
    ],
    [
      "failure() instead of the guard",
      inJob("deploy", /!cancelled\(\)/, "failure()"),
      /needs a status function|may hold only/,
    ],
    ["an || that lets anything deploy", inJob("deploy", /\}\}/, "|| true }}"), /must not use \|\|/],
    [
      "an extra term",
      inJob("deploy", /!cancelled\(\) && /, "!cancelled() && github.actor != 'x' && "),
      /may hold only/,
    ],
    [
      "the deploy calling something else",
      inJob("deploy", "./.github/workflows/deploy-vercel.yml", "./.github/workflows/other.yml"),
      /call the deploy workflow/,
    ],
    [
      "the deploy getting no secrets",
      inJob("deploy", "    secrets: inherit\n", ""),
      /pass its secrets/,
    ],
    [
      "secrets inherited elsewhere",
      inJob("unit", "    timeout-minutes", "    secrets: inherit\n    timeout-minutes"),
      /unit job must not inherit/,
    ],
    [
      "manual dispatch of ci.yml",
      mutateCi("on:\n", "on:\n  workflow_dispatch:\n"),
      /must not be dispatchable/,
    ],
  ])("fails with %s", (_name, workflow, message) => {
    expect(checkCiWorkflow(workflow).join("\n")).toMatch(message);
  });

  it("is not fooled by comments that mention what a rule bans", () => {
    expect(
      checkCiWorkflow(
        inJob(
          "build",
          "      - name: Build\n",
          "      # NEXT_PUBLIC_E2E_BUILD and secrets.VERCEL_TOKEN are not used here\n      - name: Build\n",
        ),
      ),
    ).toEqual([]);
  });

  it("accepts always() in place of !cancelled(), as long as ci's own result is checked", () => {
    expect(checkCiWorkflow(inJob("deploy", /!cancelled\(\)/, "always()"))).toEqual([]);
  });

  it("a job downstream of a skippable job needs a status function: ci has one, a plain downstream job does not", () => {
    const extra = ci.replace(
      "  deploy:",
      "  notify:\n    needs: ci\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps: []\n\n  deploy:",
    );
    const problems = checkCiWorkflow(extra).join("\n");
    expect(problems).toMatch(/unknown job notify/);
    // the summary job itself must keep its always()
    expect(checkCiWorkflow(inJob("ci", "    if: always()\n", "")).join("\n")).toMatch(
      /ci job runs after a job that can be skipped, so its if needs a status function/,
    );
  });

  it("flags a missing deploy job", () => {
    expect(checkCiWorkflow(ci.slice(0, ci.indexOf("  deploy:"))).join("\n")).toMatch(
      /deploy job is missing/,
    );
  });
});

describe("the ci summary script, run for real", () => {
  const script = stepScript(ciJob(ci, "ci") ?? "", "Every job must have succeeded");
  type Result = "success" | "failure" | "cancelled" | "skipped";
  const jobs = ["mode", "checks", "unit", "build", "e2e-build", "e2e"] as const;
  const needs = (results: Partial<Record<(typeof jobs)[number], Result>>) =>
    Object.fromEntries(jobs.map((job) => [job, { result: results[job] ?? "success" }]));
  /** Runs the real step in bash with the same env GitHub gives it; returns the exit code. */
  function run(mode: string, results: Partial<Record<(typeof jobs)[number], Result>>): number {
    try {
      execFileSync("bash", ["-e", "-c", script], {
        env: {
          ...process.env,
          NEEDS: JSON.stringify(needs(results)),
          MODE: mode,
        } as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 99;
    }
  }
  const skippedHeavy = {
    unit: "skipped",
    build: "skipped",
    "e2e-build": "skipped",
    e2e: "skipped",
  } as const;

  it("extracts a real script", () => {
    expect(script).toContain("jq");
    expect(script.split("\n").length).toBeGreaterThan(8);
  });

  it("full: passes only when every job succeeded", () => {
    expect(run("full", {})).toBe(0);
    for (const job of jobs) {
      for (const bad of ["failure", "cancelled", "skipped"] as const) {
        expect(run("full", { [job]: bad }), `${job} ${bad}`).not.toBe(0);
      }
    }
  });

  it("full: a missing job result is a failure", () => {
    const partial = { ...needs({}), e2e: undefined };
    const status = (() => {
      try {
        execFileSync("bash", ["-e", "-c", script], {
          env: {
            ...process.env,
            NEEDS: JSON.stringify(partial),
            MODE: "full",
          } as NodeJS.ProcessEnv,
          stdio: "pipe",
        });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? 99;
      }
    })();
    expect(status).not.toBe(0);
  });

  it("reused: passes with the heavy jobs skipped on purpose, fails if checks or a heavy job failed", () => {
    expect(run("reused", skippedHeavy)).toBe(0);
    expect(run("reused", {})).toBe(0);
    expect(run("reused", { ...skippedHeavy, checks: "failure" })).not.toBe(0);
    expect(run("reused", { ...skippedHeavy, checks: "skipped" })).not.toBe(0);
    expect(run("reused", { ...skippedHeavy, mode: "failure" })).not.toBe(0);
    for (const job of ["unit", "build", "e2e-build", "e2e"] as const) {
      for (const bad of ["failure", "cancelled"] as const) {
        expect(run("reused", { ...skippedHeavy, [job]: bad }), `${job} ${bad}`).not.toBe(0);
      }
    }
  });

  it("quick (a draft): always red, even when every job that ran succeeded", () => {
    expect(run("quick", skippedHeavy)).not.toBe(0);
    expect(run("quick", {})).not.toBe(0);
  });

  it("an unknown or empty mode is red", () => {
    expect(run("", {})).not.toBe(0);
    expect(run("everything", {})).not.toBe(0);
  });

  it("a failed mode job is red whatever the mode output says", () => {
    expect(run("full", { mode: "failure" })).not.toBe(0);
    expect(run("full", { mode: "cancelled" })).not.toBe(0);
  });
});
describe("dependabotProblems (#225)", () => {
  const config = readFileSync(join(process.cwd(), ".github", "dependabot.yml"), "utf8");

  it("the real config opens every update against develop", () => {
    expect(dependabotProblems(config)).toEqual([]);
    expect(config.match(/^ {2}- package-ecosystem:/gm)).toHaveLength(2);
  });

  it.each([
    ["target-branch removed (it would default to main)", /^ {4}target-branch: develop\n/m, ""],
    ["pointed at main", /target-branch: develop/, "target-branch: main"],
    ["set twice", /^( {4}target-branch: develop\n)/m, "$1$1"],
  ])("flags an entry with %s", (_name, from, to) => {
    const mutated = config.replace(from, to);
    expect(mutated).not.toBe(config);
    const problems = dependabotProblems(mutated);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^entry 1 \(npm\): target-branch must be set exactly once, to develop$/,
    );
  });

  it("flags the github-actions entry too, and an extra entry added without it", () => {
    const noActions = config.replace(
      /(github-actions\n {4}directory: \/\n) {4}target-branch: develop\n/,
      "$1",
    );
    expect(noActions).not.toBe(config);
    expect(dependabotProblems(noActions)).toEqual([
      "entry 2 (github-actions): target-branch must be set exactly once, to develop",
    ]);
    const extra = `${config}  - package-ecosystem: npm\n    directory: /tools/vercel-cli\n    schedule:\n      interval: weekly\n`;
    expect(dependabotProblems(extra)).toEqual([
      "entry 3 (npm): target-branch must be set exactly once, to develop",
    ]);
  });

  it("reports a file with no update entries", () => {
    expect(dependabotProblems("version: 2\n")).toEqual(["no update entries found"]);
  });
});

describe("checkVercelCliLock", () => {
  const dirTools = join(process.cwd(), "tools", "vercel-cli");
  const pkg = readFileSync(join(dirTools, "package.json"), "utf8");
  const lock = readFileSync(join(dirTools, "package-lock.json"), "utf8");

  it("the real lockfile pins exactly the workflow's version, with an integrity hash for every package, all from the npm registry", () => {
    expect(checkVercelCliLock(deploy, pkg, lock)).toEqual([]);
  });

  const withLock = (
    change: (lockfile: { packages: Record<string, Record<string, unknown>> }) => void,
  ) => {
    const copy = JSON.parse(lock);
    change(copy);
    return JSON.stringify(copy);
  };
  const firstTransitive = (lockfile: { packages: Record<string, Record<string, unknown>> }) =>
    Object.keys(lockfile.packages).find(
      (name) => name !== "" && name !== "node_modules/vercel",
    ) as string;

  it.each([
    [
      "a package without an integrity hash",
      pkg,
      withLock((l) => delete l.packages[firstTransitive(l)].integrity),
      /have no integrity hash/,
    ],
    [
      "a package from somewhere other than the npm registry",
      pkg,
      withLock((l) => (l.packages[firstTransitive(l)].resolved = "https://example.test/x.tgz")),
      /do not come from the npm registry/,
    ],
    [
      "a package with no resolved address",
      pkg,
      withLock((l) => delete l.packages[firstTransitive(l)].resolved),
      /do not come from the npm registry/,
    ],
    [
      "a lockfile that resolves another vercel",
      pkg,
      withLock((l) => (l.packages["node_modules/vercel"].version = "65.2.0")),
      /must resolve vercel to the version the workflow pins/,
    ],
    [
      "a package.json at another version",
      pkg.replace("64.5.0", "65.2.0"),
      lock,
      /must depend on exactly vercel at the version the workflow pins/,
    ],
    [
      "a package.json with a range",
      pkg.replace('"64.5.0"', '"^64.5.0"'),
      lock,
      /must depend on exactly vercel/,
    ],
    [
      "a package.json with another dependency",
      pkg.replace('"vercel": "64.5.0"', '"vercel": "64.5.0", "left-pad": "1.3.0"'),
      lock,
      /must depend on exactly vercel/,
    ],
    [
      "an empty lockfile",
      pkg,
      '{"lockfileVersion":3,"packages":{}}',
      /no locked dependency graph|must resolve vercel/,
    ],
    ["a lockfile that is not JSON", pkg, "not json", /not valid JSON/],
  ])("fails for %s", (_name, packageJson, lockJson, message) => {
    expect(checkVercelCliLock(deploy, packageJson, lockJson).join("\n")).toMatch(message);
  });

  it("fails when the workflow does not pin a version", () => {
    const unpinned = deploy.replace("VERCEL_CLI_VERSION: 64.5.0", "VERCEL_CLI_VERSION: latest");
    expect(checkVercelCliLock(unpinned, pkg, lock).join("\n")).toMatch(
      /does not pin VERCEL_CLI_VERSION/,
    );
  });
});
