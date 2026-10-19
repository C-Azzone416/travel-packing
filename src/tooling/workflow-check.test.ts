import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDeployWorkflow,
  checkTimeoutHeadroom,
  MIN_CI_TIMEOUT_MINUTES,
  unpinnedActions,
} from "./workflow-check";

const DIR = join(process.cwd(), ".github", "workflows");
const deploy = readFileSync(join(DIR, "deploy-vercel.yml"), "utf8");

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

describe("checkDeployWorkflow: each rule fails when its line is broken", () => {
  it.each([
    [
      "a push to main deploys",
      mutate("      - develop\n", "      - develop\n      - main\n"),
      /push to main/,
    ],
    ["develop no longer deploys", mutate("      - develop\n", ""), /push to develop/],
    ["no manual trigger", mutate("  workflow_dispatch:", "  other_trigger:"), /workflow_dispatch/],
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
    ["a third Vercel token use", `${deploy}\n# ${"secrets"}.VERCEL_TOKEN\n`, /exactly two steps/],
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

describe("checkTimeoutHeadroom: the deploy waits on CI, so the timeouts nest", () => {
  const ci = readFileSync(join(DIR, "ci.yml"), "utf8");

  it("holds for the real workflows, with CI given at least the minimum", () => {
    expect(checkTimeoutHeadroom(ci, deploy)).toEqual([]);
    expect(Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(ci)?.[1])).toBeGreaterThanOrEqual(
      MIN_CI_TIMEOUT_MINUTES,
    );
  });

  it.each([
    [
      "the old 20-minute ci timeout",
      ci.replace(/^( {4}timeout-minutes:\s*)\d+/m, "$120"),
      /ci job's timeout/,
    ],
    [
      "a ci timeout just under the minimum",
      ci.replace(/^( {4}timeout-minutes:\s*)\d+/m, "$134"),
      /ci job's timeout/,
    ],
    ["no ci timeout at all", ci.replace(/^ {4}timeout-minutes:.*\n/m, ""), /ci job's timeout/],
  ])("fails with %s", (_name, brokenCi, message) => {
    expect(checkTimeoutHeadroom(brokenCi, deploy).join("\n")).toMatch(message);
  });

  it.each([
    [
      "the old 40-attempt wait (20 minutes)",
      deploy.replace("seq 1 100", "seq 1 40"),
      /wait for CI must outlast/,
    ],
    [
      "a wait that only equals the ci timeout",
      deploy.replace("seq 1 100", "seq 1 80"),
      /wait for CI must outlast/,
    ],
    ["a wait with no loop", deploy.replace("seq 1 100", "seq x"), /wait for CI must outlast/],
    [
      "a deploy job that would time out inside its own wait",
      deploy.replace(/^( {4}timeout-minutes:\s*)75/m, "$130"),
      /deploy job's timeout/,
    ],
    [
      "a deploy job timeout just short of the headroom",
      deploy.replace(/^( {4}timeout-minutes:\s*)75/m, "$164"),
      /deploy job's timeout/,
    ],
  ])("fails with %s", (_name, brokenDeploy, message) => {
    expect(checkTimeoutHeadroom(ci, brokenDeploy).join("\n")).toMatch(message);
  });
});
