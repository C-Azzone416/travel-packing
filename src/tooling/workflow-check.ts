// Contract checks for the GitHub Actions workflows (#20), complementing actionlint (which checks syntax and expressions).
// Plain text scans, no YAML parser: every rule here is one that must hold line by line. Messages never print file
// contents beyond a line number.

/** Every `uses:` must name a full commit SHA (a tag or branch can be moved); local `./` actions are fine. */
export function unpinnedActions(workflow: string): string[] {
  const problems: string[] = [];
  workflow.split("\n").forEach((line, index) => {
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
    if (!match) return;
    const ref = match[1];
    if (ref.startsWith("./")) return;
    if (!/@[0-9a-f]{40}$/.test(ref)) {
      problems.push(`line ${index + 1}: an action is not pinned to a full commit SHA`);
    }
  });
  return problems;
}

function jobBody(workflow: string, job: string): string | null {
  const start = workflow.search(new RegExp(`^  ${job}:\\s*$`, "m"));
  if (start < 0) return null;
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The meaningful lines of the step whose name starts with `namePrefix`: indentation, blank lines and comments dropped, in order.
 * Null when there is no such step. Used to pin the few steps that guard the stable Preview alias to exactly what was reviewed.
 */
export function stepLines(workflow: string, namePrefix: string): string[] | null {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith(`- name: ${namePrefix}`));
  if (start < 0) return null;
  const indent = lines[start].length - lines[start].trimStart().length;
  const out: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const own = line.length - line.trimStart().length;
    if (index > start && trimmed !== "" && own <= indent) break;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    out.push(trimmed);
  }
  return out;
}

/** The three steps that decide whether the stable alias moves, exactly as reviewed (#96). Any change is a deliberate edit here. */
export const ALIAS_HEAD_STEP = [
  "- name: Is this run still the develop head? (preview only)",
  "id: alias_head",
  "if: env.TARGET == 'preview'",
  "env:",
  "GH_TOKEN: ${{ github.token }}",
  "run: |",
  'head=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/develop" --jq .object.sha)',
  'npx tsx scripts/check-alias-head.ts "$GITHUB_SHA" "$head"',
];
export const ALIAS_SET_STEP = [
  "- name: Assign the stable Preview alias",
  "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'",
  "env:",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "DEPLOY_URL: ${{ steps.deploy.outputs.url }}",
  "run: |",
  'vercel alias set "$DEPLOY_URL" "$PREVIEW_ALIAS" --scope="$VERCEL_ORG_ID" --token="$VERCEL_TOKEN"',
  'echo "Preview alias: https://$PREVIEW_ALIAS -> $DEPLOY_URL" >> "$GITHUB_STEP_SUMMARY"',
];
export const ALIAS_SMOKE_STEP = [
  "- name: Smoke test the alias",
  "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'",
  "env:",
  "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
  'run: npx tsx scripts/smoke-test.ts "https://${PREVIEW_ALIAS}"',
];

/** What must be true of `.github/workflows/deploy-vercel.yml`. Returns the broken rules (empty when fine). */
export function checkDeployWorkflow(workflow: string): string[] {
  const problems: string[] = [];
  const count = (pattern: RegExp) => (workflow.match(pattern) ?? []).length;
  const injection =
    /^( *)- name: Inject the Preview secrets[^\n]*\n((?:\1 {2}.*\n|\n)*)/m.exec(workflow)?.[0] ??
    "";

  // Triggers: the preview deploy is called by ci.yml (never a trigger of its own); production is a manual run.
  const on = workflow.slice(workflow.search(/^on:/m), workflow.search(/^concurrency:/m));
  if (!/^on:/m.test(workflow) || on.length === 0) problems.push("no `on:` block");
  if (/^\s*push:/m.test(on))
    problems.push("a push must not trigger the deploy workflow directly; ci.yml calls it after CI");
  if (!/^\s*workflow_call:/m.test(on))
    problems.push("the preview deploy must be callable from ci.yml (workflow_call)");
  if (!/^\s*workflow_dispatch:/m.test(on))
    problems.push("production needs the manual workflow_dispatch trigger");
  if (/pull_request/.test(workflow))
    problems.push("a pull request must never trigger a deploy workflow");
  if (/secrets:\s*inherit/.test(workflow)) problems.push("secrets must not be inherited");
  if (/\bsleep\b|seq 1 /.test(workflow))
    problems.push("the deploy must not poll or wait for CI (it is billed idle time)");
  const requireCi = /- name: Require green CI[^\n]*\n((?: {8}.*\n)*)/.exec(workflow)?.[1] ?? "";
  if (!/if:\s*github\.event_name == 'workflow_dispatch'/.test(requireCi))
    problems.push("the CI check must guard the manual (production) run");
  if (!/scripts\/require-ci\.ts/.test(requireCi))
    problems.push("the CI check must run scripts/require-ci.ts");

  // The gate decides the target and holds no secret and no environment.
  const gate = jobBody(workflow, "gate");
  if (!gate) problems.push("the gate job is missing");
  else {
    if (/secrets\./.test(gate)) problems.push("the gate job must not read any secret");
    if (/^\s+environment:/m.test(gate))
      problems.push("the gate job must not use a GitHub environment");
    if (!/scripts\/release-gate\.ts/.test(gate))
      problems.push("the gate job must run the release gate");
    if (/run:[^\n]*\$\{\{\s*(?:github|inputs)\./.test(gate)) {
      problems.push(
        "the gate job must pass context through env, never interpolate it into a shell command",
      );
    }
  }

  // The deploy job runs only after the gate, in the environment the gate chose.
  const deploy = jobBody(workflow, "deploy");
  if (!deploy) problems.push("the deploy job is missing");
  else {
    if (!/^\s+needs:\s*gate\s*$/m.test(deploy)) problems.push("the deploy job must need the gate");
    if (!/^\s+environment:\s*\$\{\{\s*needs\.gate\.outputs\.target\s*\}\}\s*$/m.test(deploy)) {
      problems.push("the deploy job's environment must be the target the gate chose");
    }
    if (!/^\s+TARGET:\s*\$\{\{\s*needs\.gate\.outputs\.target\s*\}\}\s*$/m.test(deploy)) {
      problems.push("TARGET must come from the gate");
    }
    // Seeding: preview only, by the guarded script, never the raw seed command.
    if (/db:seed(?!:preview)/.test(deploy))
      problems.push("only `db:seed:preview` may seed from the pipeline");
    const seed = /^(.*\n){0,8}?.*db:seed:preview/m.exec(deploy)?.[0] ?? "";
    if (!/if:\s*env\.TARGET == 'preview'/.test(seed)) {
      problems.push("the seed step must run only when TARGET is preview");
    }
  }

  // Secrets: the Vercel token only in the three steps that talk to Vercel (pull, deploy, and assigning the Preview alias);
  // the database secret only in the deploy job.
  if (count(/secrets\.VERCEL_TOKEN/g) !== 3)
    problems.push(
      "VERCEL_TOKEN must be read by exactly three steps (pull, deploy and the Preview alias)",
    );

  // The stable Preview alias (#96): assigned only after a green deploy and smoke test, only for the develop head, only for a
  // preview, and never by a step that runs after a failure.
  const aliasStep =
    /^( *)- name: Assign the stable Preview alias[^\n]*\n((?:\1 {2}.*\n|\n)*)/m.exec(
      workflow,
    )?.[0] ?? "";
  const headStep =
    /^( *)- name: Is this run still the develop head\?[^\n]*\n((?:\1 {2}.*\n|\n)*)/m.exec(
      workflow,
    )?.[0] ?? "";
  if (count(/vercel alias set/g) !== 1)
    problems.push("the Preview alias must be set by exactly one step");
  if (!/vercel alias set "\$DEPLOY_URL" "\$PREVIEW_ALIAS"/.test(aliasStep)) {
    problems.push("the alias step must assign the deployed URL to PREVIEW_ALIAS");
  }
  if (
    !/^\s+if:\s*env\.TARGET == 'preview' && steps\.alias_head\.outputs\.assign == 'true'\s*$/m.test(
      aliasStep,
    )
  ) {
    problems.push(
      "the alias may be set only for a preview run whose commit is still the develop head",
    );
  }
  if (
    !/^\s+if:\s*env\.TARGET == 'preview'\s*$/m.test(headStep) ||
    !/id:\s*alias_head/.test(headStep)
  ) {
    problems.push("the develop head check must run for previews only and be the step alias_head");
  }
  // The guard steps are pinned to exactly what was reviewed: the head is read from heads/develop (not this run's own SHA, not another
  // branch), compared with this run's SHA, and the alias is set to the deployed URL with the one reviewed command and nothing else.
  for (const [prefix, expected, what] of [
    ["Is this run still the develop head?", ALIAS_HEAD_STEP, "develop head check"],
    ["Assign the stable Preview alias", ALIAS_SET_STEP, "alias assignment"],
    ["Smoke test the alias", ALIAS_SMOKE_STEP, "alias smoke test"],
  ] as const) {
    const actual = stepLines(workflow, prefix);
    if (
      !actual ||
      actual.length !== expected.length ||
      actual.some((line, i) => line !== expected[i])
    ) {
      problems.push(
        `the ${what} step must be exactly as reviewed (see ALIAS_*_STEP in workflow-check.ts)`,
      );
    }
  }
  const code = workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  if (/\b(always|failure|cancelled)\(\)|continue-on-error/.test(code)) {
    problems.push(
      "no step may run after a failure or continue past one (the alias must not move then)",
    );
  }
  const headAt = workflow.indexOf("scripts/check-alias-head.ts");
  const aliasAt = workflow.indexOf("vercel alias set");
  const firstSmokeAt = workflow.indexOf("scripts/smoke-test.ts");
  const lastSmokeAt = workflow.lastIndexOf("scripts/smoke-test.ts");
  if (!(firstSmokeAt >= 0 && firstSmokeAt < headAt && headAt < aliasAt && aliasAt < lastSmokeAt)) {
    problems.push(
      "the order must be: smoke test, develop head check, alias set, smoke test of the alias",
    );
  }
  if (!/smoke-test\.ts "https:\/\/\$\{PREVIEW_ALIAS\}"/.test(workflow)) {
    problems.push("the alias itself must be smoke-tested");
  }
  if (!/^ {2}PREVIEW_ALIAS: travel-packing-preview\.vercel\.app\b/m.test(workflow)) {
    problems.push("PREVIEW_ALIAS must be travel-packing-preview.vercel.app");
  }
  const firstSecretLine = workflow.split("\n").findIndex((line) => /secrets\./.test(line));
  const deployLine = workflow.split("\n").findIndex((line) => /^ {2}deploy:\s*$/.test(line));
  if (firstSecretLine >= 0 && deployLine >= 0 && firstSecretLine < deployLine) {
    problems.push("secrets may only be read in the deploy job");
  }
  // The injection step names DATABASE_URL as one of the four it writes; that is the only place the pooled name may appear.
  if (/\bDATABASE_URL\s*:/.test(workflow.replace(injection, "")))
    problems.push("migrations must use DATABASE_URL_UNPOOLED, never the pooled URL");
  if (!/secrets\.DATABASE_URL_UNPOOLED/.test(workflow))
    problems.push("the direct database URL secret is not used");

  // The Preview secret injection (vercel pull cannot read Vercel Secrets): after the pull, before the check and the build,
  // preview only, and the values come from secrets.* alone.
  const stepStart = (needle: string) => workflow.indexOf(needle);
  const pull = stepStart("vercel pull --yes");
  const inject = stepStart("scripts/inject-preview-secrets.ts");
  const checkEnv = stepStart("scripts/check-deploy-env.ts");
  const build = stepStart("vercel build");
  if (inject < 0) problems.push("the Preview secret injection step is missing");
  else {
    if (!(pull >= 0 && pull < inject && inject < checkEnv && checkEnv < build)) {
      problems.push(
        "the secret injection must run after vercel pull and before the env check and the build",
      );
    }
    if (!/^\s+if:\s*env\.TARGET == 'preview'\s*$/m.test(injection)) {
      problems.push("the secret injection must run only when TARGET is preview");
    }
    // The step does one thing: run the script on the pulled file. Nothing else may sit beside it that could echo a value.
    const runLines = [...injection.matchAll(/^\s+run:\s*(.*)$/gm)].map((match) => match[1].trim());
    if (
      runLines.length !== 1 ||
      runLines[0] !== 'npx tsx scripts/inject-preview-secrets.ts ".vercel/.env.${TARGET}.local"'
    ) {
      problems.push(
        "the secret injection step must run exactly the injection script on the pulled preview file",
      );
    }
    for (const name of [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "OWNER_EMAIL_ALLOWLIST",
      "NEON_AUTH_COOKIE_SECRET",
    ]) {
      if (
        !new RegExp(`^\\s+${name}:\\s*\\$\\{\\{\\s*secrets\\.${name}\\s*\\}\\}\\s*$`, "m").test(
          injection,
        )
      ) {
        problems.push(`${name} must be injected from secrets.${name}`);
      }
    }
    const values = [...injection.matchAll(/^\s+[A-Z_]+:\s*(.+)$/gm)].map((match) => match[1]);
    if (values.some((value) => !/^\$\{\{\s*secrets\.[A-Z_]+\s*\}\}$/.test(value.trim()))) {
      problems.push("the secret injection may take values from secrets.* only");
    }
  }
  // Those four secret names are read in that one step and nowhere else (the migration URL is the one reuse).
  for (const name of ["DATABASE_URL", "OWNER_EMAIL_ALLOWLIST", "NEON_AUTH_COOKIE_SECRET"]) {
    if (count(new RegExp(`secrets\\.${name}\\b`, "g")) > 1) {
      problems.push(`secrets.${name} must be read only by the secret injection step`);
    }
  }

  // The project's build settings are printed after the pull (they decide the builder), before the build.
  const settingsAt = workflow.indexOf("scripts/print-project-settings.ts");
  if (!(pull >= 0 && pull < settingsAt && settingsAt < workflow.indexOf("vercel build"))) {
    problems.push("the project settings must be printed after vercel pull and before the build");
  }

  // The build output is checked for server functions after the build and before anything is uploaded.
  const buildAt = workflow.indexOf("vercel build");
  const outputCheckAt = workflow.indexOf("scripts/check-build-output.ts");
  const uploadAt = workflow.indexOf("vercel deploy --prebuilt");
  if (!(buildAt >= 0 && buildAt < outputCheckAt && outputCheckAt < uploadAt)) {
    problems.push("the build output check must run after the build and before the deploy");
  }

  // The deploy names its target outright (Vercel assigns a project's FIRST deployment to production when none is given), and
  // a check of the CLI's own output runs after it and before the smoke test.
  if (!/vercel deploy --prebuilt --target=preview\b/.test(workflow)) {
    problems.push("a preview deploy must pass --target=preview");
  }
  if (!/vercel deploy --prebuilt --prod\b/.test(workflow)) {
    problems.push("a production deploy must pass --prod");
  }
  if (/vercel deploy --prebuilt --token/.test(workflow)) {
    problems.push("no deploy may leave its target to Vercel's default");
  }
  const deployAt = workflow.indexOf("vercel deploy --prebuilt");
  const targetCheckAt = workflow.indexOf("scripts/check-deploy-target.ts");
  const smokeAt = workflow.indexOf("scripts/smoke-test.ts");
  if (!(deployAt >= 0 && deployAt < targetCheckAt && targetCheckAt < smokeAt)) {
    problems.push("the deploy target check must run after the deploy and before the smoke test");
  }

  // Safety steps and pins.
  for (const step of [
    "check-deploy-env",
    "check-migration-target",
    "check:no-e2e-in-build",
    "db:migrate:remote",
    "smoke-test",
  ]) {
    if (!workflow.includes(step)) problems.push(`the ${step} step is missing`);
  }
  const migrationTarget = workflow.indexOf("check-migration-target");
  if (
    workflow.indexOf("db:migrate:remote") < migrationTarget ||
    workflow.indexOf("db:seed:preview") < migrationTarget
  ) {
    problems.push("the migration target must be checked before migrating or seeding");
  }
  if (!/VERCEL_CLI_VERSION:\s*\d+\.\d+\.\d+\b/.test(workflow))
    problems.push("the Vercel CLI version must be pinned");
  if (/@latest\b/.test(workflow)) problems.push("nothing may be installed at @latest");
  if (!/vars\.PRODUCTION_DB_HOST/.test(workflow))
    problems.push("PRODUCTION_DB_HOST must be passed to the host checks");
  return problems;
}

/** The ci job needs room for a slow runner: a healthy full run is ~19 minutes, and a cancelled run stops the deploy that follows it. */
export const MIN_CI_TIMEOUT_MINUTES = 35;

/**
 * What must be true of `.github/workflows/ci.yml` (#91). Returns the broken rules (empty when fine).
 * The shape is deliberate: one job named `ci` (extra jobs cost whole billed minutes and the review gate reads this name),
 * gitleaks inside it, the heavy steps gated on the mode, a draft ending red, and a native-`needs` deploy on develop pushes only.
 */
export function checkCiWorkflow(workflow: string): string[] {
  const problems: string[] = [];
  const ci = jobBody(workflow, "ci");
  const deploy = jobBody(workflow, "deploy");
  const jobNames = [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  const jobsStart = workflow.search(/^jobs:/m);
  const jobs = jobNames.filter((_, i) => {
    const at = [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)][i].index ?? 0;
    return at > jobsStart;
  });

  if (!ci) problems.push("the job must be named `ci`");
  if (jobs.some((name) => name !== "ci" && name !== "deploy"))
    problems.push(
      "the workflow may have only the `ci` and `deploy` jobs (every extra job bills a minute)",
    );
  if (!/^\s*pull_request:/m.test(workflow) || !/^\s*push:/m.test(workflow))
    problems.push("ci must run on pull requests and on pushes");
  if (!/ready_for_review/.test(workflow))
    problems.push("marking a draft ready must run the full validation (ready_for_review)");

  const concurrency = /^concurrency:\n((?: {2}.*\n)*)/m.exec(workflow)?.[1] ?? "";
  if (
    !/cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/.test(concurrency)
  )
    problems.push(
      "only pull request runs may be cancelled by a newer push (a develop push may be deploying)",
    );

  if (ci) {
    const timeout = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(ci)?.[1] ?? NaN);
    if (!(timeout >= MIN_CI_TIMEOUT_MINUTES))
      problems.push(`the ci job's timeout-minutes must be at least ${MIN_CI_TIMEOUT_MINUTES}`);
    if (/secrets\.(?!GITHUB_TOKEN\b)/.test(ci))
      problems.push("the ci job must read no secret but GITHUB_TOKEN");
    if (/secrets:\s*inherit/.test(ci)) problems.push("the ci job must not inherit secrets");
    if (!/gitleaks\/gitleaks-action@[0-9a-f]{40}/.test(ci))
      problems.push("secret scanning (gitleaks) must run inside the ci job");
    if (!/fetch-depth:\s*0/.test(ci))
      problems.push("gitleaks needs the full history (fetch-depth: 0)");
    const gitleaks = ci.indexOf("gitleaks/gitleaks-action");
    const install = ci.indexOf("npm ci");
    if (gitleaks >= 0 && install >= 0 && gitleaks > install)
      problems.push("gitleaks must run before the install, so a leak fails the run first");
    if (!/scripts\/ci-mode\.ts/.test(ci)) problems.push("the mode step is missing");
    // Every step that costs real time must be skipped outside full mode; the cheap checks must not be.
    for (const heavy of [
      "npm run test:coverage",
      "npm run build",
      "npm run build:webpack",
      "check:no-e2e-in-build",
      "check:client-bundle",
      "playwright install",
      "npm run test:e2e",
    ]) {
      if (!ci.includes(heavy)) {
        problems.push(`the ${heavy} step is missing`);
        continue;
      }
      // Every step that runs it (the bundle checks run twice, once per bundler).
      const ungated = stepsOf(ci, heavy).some(
        (step) => !/if:[^\n]*steps\.mode\.outputs\.mode == 'full'/.test(step),
      );
      if (ungated) problems.push(`the ${heavy} step must run only in full mode`);
    }
    for (const cheap of [
      "check:repo-hygiene",
      "actionlint",
      "check:workflows",
      "npm audit",
      "npm run lint",
      "npm run typecheck",
    ]) {
      if (!ci.includes(cheap)) problems.push(`the ${cheap} check is missing`);
      else if (stepsOf(ci, cheap).some((step) => /steps\.mode/.test(step)))
        problems.push(`the ${cheap} check must run in every mode`);
    }
    if (!/npm audit --omit=dev --audit-level=high/.test(ci))
      problems.push("the dependency audit must fail on high severity");
    const finish = stepsOf(ci, "full validation not run")[0] ?? "";
    if (!/if:\s*steps\.mode\.outputs\.mode == 'quick'/.test(finish) || !/exit 1/.test(finish))
      problems.push("a quick (draft) run must end red");
    if (ci.lastIndexOf("- name:") !== ci.indexOf("- name: Draft pull request")) {
      problems.push("the red finish for a quick run must be the last step of the job");
    }
  }

  if (!deploy) problems.push("the deploy job is missing");
  else {
    if (!/^\s+needs:\s*ci\s*$/m.test(deploy)) problems.push("the deploy job must need ci");
    if (
      !/if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop'\s*$/m.test(
        deploy,
      )
    )
      problems.push("the deploy job must run only for a push to develop");
    if (!/uses:\s*\.\/\.github\/workflows\/deploy-vercel\.yml\s*$/m.test(deploy))
      problems.push("the deploy job must call the deploy workflow in this repository");
    if (!/secrets:\s*inherit/.test(deploy))
      problems.push("the deploy job must pass its secrets to the called workflow");
    if (/with:/.test(deploy)) problems.push("the deploy job must pass no inputs (no release_sha)");
    if (/\bsleep\b|gh run/.test(deploy)) problems.push("the deploy job must not poll for CI");
  }
  if ((workflow.match(/secrets:\s*inherit/g) ?? []).length > 1)
    problems.push("secrets may be inherited by the deploy job only");
  return problems;
}

/** The text of every step whose name or command contains `needle` (each from its `- name:` line to the next step). */
function stepsOf(job: string, needle: string): string[] {
  return job
    .split(/^(?= {6}(?:- |#))/m)
    .filter((chunk) => /^ {6}- /.test(chunk) && chunk.includes(needle));
}
