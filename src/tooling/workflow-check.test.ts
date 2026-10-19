import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDeployWorkflow, unpinnedActions } from "./workflow-check";

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
      mutate("        if: env.TARGET == 'preview'\n", ""),
      /seed step must run only when TARGET is preview/,
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
