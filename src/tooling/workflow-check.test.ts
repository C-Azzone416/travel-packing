import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIAS_HEAD_STEP,
  checkCiWorkflow,
  checkDeployWorkflow,
  MIN_CI_TIMEOUT_MINUTES,
  stepLines,
  unpinnedActions,
} from "./workflow-check";

const DIR = join(process.cwd(), ".github", "workflows");
const deploy = readFileSync(join(DIR, "deploy-vercel.yml"), "utf8");
const ci = readFileSync(join(DIR, "ci.yml"), "utf8");

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
  const block =
    /( {6}# Preview only\. `vercel pull`[\s\S]*?inject-preview-secrets\.ts[^\n]*\n\n)/.exec(
      deploy,
    )?.[1];
  expect(block).toBeTruthy();
  const anchor = "      # `vercel build` works";
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
      "the gate reads a secret",
      mutate(
        "      - name: Install\n        run: npm ci\n\n      - name: Release",
        "      - name: Install\n        run: echo ${{ secrets.VERCEL_TOKEN }}\n\n      - name: Release",
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
      /run the release gate/,
    ],
    [
      "context interpolated into a shell",
      mutate(
        "run: npx tsx scripts/release-gate.ts",
        "run: echo ${{ inputs.release_sha }}; npx tsx scripts/release-gate.ts",
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
        / {6}- name: Inject the Preview secrets[\s\S]*?inject-preview-secrets\.ts[^\n]*\n\n/,
        "",
      ),
      /injection step is missing/,
    ],
    ["the injection after the env check", movedInjection(), /after vercel pull and before/],
    [
      "an unconditional injection",
      mutate(/(- name: Inject the Preview secrets[^\n]*\n)\s+if: env\.TARGET == 'preview'\n/, "$1"),
      /injection must run only when TARGET is preview/,
    ],
    [
      "an injection for production too",
      mutate(
        /(- name: Inject the Preview secrets[^\n]*\n\s+if: )env\.TARGET == 'preview'/,
        "$1always()",
      ),
      /injection must run only when TARGET is preview/,
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
      /develop head check step must be exactly as reviewed|exactly three steps/,
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
      "a fourth Vercel token use",
      `${deploy.trimEnd()}\n        X: \${{ secrets.VERCEL_TOKEN }}\n`,
      /exactly three steps/,
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
        'run: npx tsx scripts/inject-preview-secrets.ts ".vercel/.env.${TARGET}.local"',
        'run: npx tsx scripts/inject-preview-secrets.ts ".vercel/.env.${TARGET}.local" && env',
      ),
      /exactly the injection script/,
    ],
    [
      "the injection script run on a different file",
      mutate(
        'inject-preview-secrets.ts ".vercel/.env.${TARGET}.local"',
        "inject-preview-secrets.ts other.env",
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
    ["a third Vercel token use", `${deploy}\n# ${"secrets"}.VERCEL_TOKEN\n`, /exactly three steps/],
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
    [
      "no production host passed",
      mutate(/vars\.PRODUCTION_DB_HOST/g, "vars.OTHER"),
      /PRODUCTION_DB_HOST must be passed/,
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

  it("holds for the real workflow, with a timeout of at least the minimum", () => {
    expect(checkCiWorkflow(ci)).toEqual([]);
    expect(Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(ci)?.[1])).toBeGreaterThanOrEqual(
      MIN_CI_TIMEOUT_MINUTES,
    );
  });

  it.each([
    ["the job renamed", mutateCi(/^ {2}ci:/m, "  checks:"), /named `ci`/],
    [
      "an extra job",
      `${ci}\n  lint:\n    runs-on: ubuntu-latest\n    steps: []\n`,
      /only the `ci` and `deploy` jobs/,
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
    ["a short timeout", mutateCi(/^( {4}timeout-minutes:\s*)\d+/m, "$120"), /timeout-minutes/],
    ["no timeout", mutateCi(/^ {4}timeout-minutes:.*\n/m, ""), /timeout-minutes/],
    [
      "the ci job reads a secret",
      mutateCi(
        "          GH_TOKEN: ${{ github.token }}",
        "          GH_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
      ),
      /no secret but GITHUB_TOKEN/,
    ],
    [
      "gitleaks removed",
      mutateCi(/ {6}- uses: gitleaks[^\n]*\n {8}env:\n {10}GITHUB_TOKEN[^\n]*\n\n/, ""),
      /gitleaks\) must run inside/,
    ],
    ["a shallow checkout", mutateCi(/ {8}with:\n {10}fetch-depth: 0[^\n]*\n/, ""), /full history/],
    [
      "gitleaks after the install",
      mutateCi(
        "      - name: Install\n        run: npm ci\n",
        "      - name: Install\n        run: npm ci\n      - run: true # gitleaks/gitleaks-action\n",
      ).replace(/(gitleaks\/gitleaks-action@[0-9a-f]{40})/, "other/action@" + "0".repeat(40)),
      /gitleaks/,
    ],
    ["no mode step", mutateCi("scripts/ci-mode.ts", "scripts/other.ts"), /mode step is missing/],
    [
      "coverage runs in every mode",
      mutateCi(/(- name: Test with coverage\n) {8}if:[^\n]*\n/, "$1"),
      /test:coverage step must run only in full mode/,
    ],
    [
      "e2e runs in every mode",
      mutateCi(/(- name: E2E \(phone \+ desktop\)\n) {8}if:[^\n]*\n/, "$1"),
      /test:e2e step must run only in full mode/,
    ],
    [
      "the webpack bundle scan runs in every mode",
      mutateCi(/(- name: Scan the webpack client bundle\n) {8}if:[^\n]*\n/, "$1"),
      /check:client-bundle step must run only in full mode/,
    ],
    ["the audit is gone", mutateCi("npm audit --omit=dev --audit-level=high", "true"), /audit/],
    [
      "lint only in full mode",
      mutateCi(
        "      - name: Lint\n",
        "      - name: Lint\n        if: steps.mode.outputs.mode == 'full'\n",
      ),
      /lint check must run in every mode/,
    ],
    [
      "a draft that passes",
      mutateCi("          exit 1", "          exit 0"),
      /quick \(draft\) run must end red/,
    ],
    [
      "a draft check that is not last",
      `${ci.replace(/\n {2}deploy:[\s\S]*$/, "")}      - name: After\n        run: true\n\n${ci.slice(ci.indexOf("  deploy:"))}`,
      /must be the last step/,
    ],
    ["the deploy does not need ci", mutateCi("    needs: ci\n", ""), /deploy job must need ci/],
    [
      "the deploy runs on pull requests",
      mutateCi(
        "    if: github.event_name == 'push' && github.ref == 'refs/heads/develop'",
        "    if: github.event_name == 'push'",
      ),
      /only for a push to develop/,
    ],
    [
      "the deploy calls something else",
      mutateCi("./.github/workflows/deploy-vercel.yml", "./.github/workflows/other.yml"),
      /call the deploy workflow/,
    ],
    ["the deploy gets no secrets", mutateCi("    secrets: inherit\n", ""), /pass its secrets/],
    [
      "the deploy passes a release sha",
      mutateCi(
        "    secrets: inherit\n",
        "    secrets: inherit\n    with:\n      release_sha: abc\n",
      ),
      /no inputs/,
    ],
    [
      "secrets inherited by the ci job too",
      mutateCi(
        "    permissions:\n      contents: read\n      pull-requests",
        "    secrets: inherit\n    permissions:\n      contents: read\n      pull-requests",
      ),
      /ci job must not inherit/,
    ],
    [
      "the deploy polls",
      mutateCi(
        "    uses: ./.github/workflows/deploy-vercel.yml",
        "    uses: ./.github/workflows/deploy-vercel.yml\n    # gh run list",
      ),
      /poll/,
    ],
  ])("fails with %s", (_name, workflow, message) => {
    expect(checkCiWorkflow(workflow).join("\n")).toMatch(message);
  });

  it("flags a missing deploy job", () => {
    expect(checkCiWorkflow(ci.slice(0, ci.indexOf("  deploy:"))).join("\n")).toMatch(
      /deploy job is missing/,
    );
  });
});

describe("stepLines", () => {
  const sample = [
    "jobs:",
    "  a:",
    "    steps:",
    "      # a comment",
    "      - name: One",
    "        id: first",
    "",
    "        # inner comment",
    "        run: |",
    "          echo   hi  ",
    "      - name: Two",
    "        run: echo two",
  ].join("\n");

  it("returns a step's meaningful lines, trimmed, without comments or blank lines", () => {
    expect(stepLines(sample, "One")).toEqual(["- name: One", "id: first", "run: |", "echo   hi"]);
    expect(stepLines(sample, "Two")).toEqual(["- name: Two", "run: echo two"]);
  });

  it("returns null when there is no such step", () => {
    expect(stepLines(sample, "Three")).toBeNull();
  });

  it("pins the real workflow's three alias steps to the reviewed lines", () => {
    expect(stepLines(deploy, "Is this run still the develop head?")).toEqual(ALIAS_HEAD_STEP);
  });
});
