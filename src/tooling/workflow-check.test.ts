import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDeployWorkflow,
  checkTimeoutHeadroom,
  ciJobs,
  criticalPathMinutes,
  MIN_CI_CRITICAL_PATH_MINUTES,
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

describe("ciJobs and criticalPathMinutes", () => {
  const sample = `name: X
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: []
  b:
    needs: a
    timeout-minutes: 7
  c:
    needs: [a, b]
    timeout-minutes: 3
  d:
    needs: [c]
  loose:
    timeout-minutes: 20
`;

  it("reads each job's timeout and its needs, from a single name or an inline list", () => {
    expect(ciJobs(sample)).toEqual([
      { id: "a", timeout: 5, needs: [] },
      { id: "b", timeout: 7, needs: ["a"] },
      { id: "c", timeout: 3, needs: ["a", "b"] },
      { id: "d", timeout: null, needs: ["c"] },
      { id: "loose", timeout: 20, needs: [] },
    ]);
  });

  it("finds no jobs in a file without a jobs block", () => {
    expect(ciJobs("name: X\non: push\n")).toEqual([]);
  });

  it("the critical path is the longest chain of timeouts through needs, not the sum of every job", () => {
    // a(5) -> b(7) -> c(3) -> d(none) = 15; the unconnected job is 20 on its own.
    expect(criticalPathMinutes(ciJobs(sample).filter((job) => job.id !== "loose"))).toBe(15);
    expect(criticalPathMinutes(ciJobs(sample))).toBe(20);
    expect(criticalPathMinutes([])).toBe(0);
  });

  it("survives a needs cycle and a need that names no job", () => {
    const cyclic = [
      { id: "x", timeout: 4, needs: ["y"] },
      { id: "y", timeout: 6, needs: ["x", "ghost"] },
    ];
    expect(criticalPathMinutes(cyclic)).toBeGreaterThan(0);
    expect(criticalPathMinutes(cyclic)).toBeLessThanOrEqual(10);
  });
});

describe("checkTimeoutHeadroom: the deploy waits on CI, so the timeouts nest", () => {
  const ci = readFileSync(join(DIR, "ci.yml"), "utf8");
  const jobs = ciJobs(ci);

  /** The real ci.yml with one edit inside one job; the edit must change something. */
  function editJob(job: string, from: string | RegExp, to: string): string {
    const start = ci.search(new RegExp(`^ {2}${job}:\\s*$`, "m"));
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = ci.slice(start + 1);
    const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
    const body = next < 0 ? rest : rest.slice(0, next);
    const edited = body.replace(from, to);
    expect(edited).not.toBe(body);
    return ci.slice(0, start + 1) + edited + (next < 0 ? "" : rest.slice(next));
  }

  it("holds for the real workflows", () => {
    expect(checkTimeoutHeadroom(ci, deploy)).toEqual([]);
  });

  it("the real ci.yml is the shape the issue asks for: parallel jobs, an e2e matrix, one required summary", () => {
    expect(jobs.map((job) => job.id)).toEqual([
      "checks",
      "unit",
      "build",
      "e2e-build",
      "e2e",
      "ci",
    ]);
    expect(jobs.find((job) => job.id === "e2e")?.needs).toEqual(["e2e-build"]);
    expect(jobs.find((job) => job.id === "ci")?.needs.sort()).toEqual(
      jobs
        .filter((job) => job.id !== "ci")
        .map((job) => job.id)
        .sort(),
    );
    expect(criticalPathMinutes(jobs)).toBeGreaterThanOrEqual(MIN_CI_CRITICAL_PATH_MINUTES);
    expect(ci).toMatch(/project: \[phone, desktop\]/);
    expect(ci).toMatch(/fail-fast: false/);
  });

  it.each([
    [
      "a job with no timeout",
      editJob("unit", /^ {4}timeout-minutes:.*\n/m, ""),
      /unit job has no timeout/,
    ],
    [
      "the e2e job with no timeout",
      editJob("e2e", /^ {4}timeout-minutes:.*\n/m, ""),
      /e2e job has no timeout/,
    ],
    [
      "timeouts too tight for a slow runner (the slowest chain under the minimum)",
      editJob("e2e", /^( {4}timeout-minutes:\s*)\d+/m, "$15"),
      /slowest chain of ci jobs/,
    ],
    ["no jobs at all", "name: CI\non: push\n", /no jobs/],
  ])("fails with %s", (_name, brokenCi, message) => {
    expect(checkTimeoutHeadroom(brokenCi, deploy).join("\n")).toMatch(message);
  });

  it.each([
    [
      "a summary that forgets a job (a failure there would not fail CI)",
      editJob("ci", /needs: \[[^\]]*\]/, "needs: [checks, unit, build, e2e-build]"),
      /must wait for every other job \(not: e2e\)/,
    ],
    [
      "a summary that forgets two jobs",
      editJob("ci", /needs: \[[^\]]*\]/, "needs: [checks, unit, build]"),
      /not: e2e-build, e2e\)/,
    ],
    [
      "a summary that would be skipped when a job fails",
      editJob("ci", /^ {4}if: always\(\)\n/m, ""),
      /if: always\(\)/,
    ],
    [
      "a summary with a different condition",
      editJob("ci", "if: always()", "if: success()"),
      /if: always\(\)/,
    ],
    [
      "no summary job at all",
      ci.replace(/^ {2}ci:\s*$/m, "  summary:"),
      /required `ci` job is missing/,
    ],
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
      "a wait that only equals the slowest chain",
      deploy.replace("seq 1 100", "seq 1 70"),
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

  it("the deploy's own wait for CI still reads the whole workflow's result for the exact commit", () => {
    // `gh run list --workflow ci.yml --commit $GITHUB_SHA` reports the WORKFLOW run, which fails when the `ci` summary fails.
    expect(deploy).toMatch(/gh run list --workflow ci\.yml --commit "\$GITHUB_SHA"/);
    expect(deploy).toMatch(/success\) exit 0/);
  });
});
