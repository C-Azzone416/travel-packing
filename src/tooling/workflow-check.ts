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

/**
 * Every update entry in .github/dependabot.yml must open its PRs against develop (#225). Dependabot defaults to the repository's
 * default branch, main, which would skip develop, the review gates and the Preview. A plain text scan of the entries.
 */
export function dependabotProblems(config: string): string[] {
  const lines = config.split("\n");
  const starts = lines.flatMap((line, index) =>
    /^ {2}- package-ecosystem:/.test(line) ? [index] : [],
  );
  if (starts.length === 0) return ["no update entries found"];
  return starts.flatMap((start, entry) => {
    const end = starts[entry + 1] ?? lines.length;
    const body = lines.slice(start, end);
    const ecosystem = /package-ecosystem:\s*(\S+)/.exec(body[0])?.[1] ?? "?";
    const targets = body.flatMap((line) => /^ {4}target-branch:\s*(\S+)\s*$/.exec(line)?.[1] ?? []);
    if (targets.length === 1 && targets[0] === "develop") return [];
    return [
      `entry ${entry + 1} (${ecosystem}): target-branch must be set exactly once, to develop`,
    ];
  });
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
  'run: npx tsx scripts/assign-alias.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
];
export const ALIAS_SMOKE_STEP = [
  "- name: Smoke test the alias",
  "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'",
  "env:",
  "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
  'run: npx tsx scripts/smoke-test.ts "https://${PREVIEW_ALIAS}"',
];
/** The Production steps (#207), exactly as reviewed: the alias is proven to be THIS deployment before it is smoke-tested, and the smoke test never gets the bypass secret. */
export const PROD_ALIAS_STEP = [
  "- name: Prove the Production alias belongs to this deployment",
  "if: env.TARGET == 'production'",
  "env:",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "DEPLOY_URL: ${{ steps.deploy.outputs.url }}",
  'run: npx tsx scripts/verify-production-alias.ts "$DEPLOY_URL" "$PRODUCTION_ALIAS"',
];
export const PROD_SMOKE_STEP = [
  "- name: Production alias smoke test",
  "if: env.TARGET == 'production'",
  'run: npx tsx scripts/smoke-test.ts "https://${PRODUCTION_ALIAS}"',
];
/** The deployment-URL smoke test is for Previews only: a production deployment's generated address is behind Vercel Authentication. */
export const DEPLOY_SMOKE_STEP = [
  "- name: Smoke test",
  "if: env.TARGET == 'preview'",
  "env:",
  "DEPLOY_URL: ${{ steps.deploy.outputs.url }}",
  "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
  'run: npx tsx scripts/smoke-test.ts "$DEPLOY_URL"',
];
/** The locked Vercel CLI install (#208): reproducible from its own lockfile, scripts off, then put on the PATH. */
export const CLI_INSTALL_STEP = [
  "- name: Install the locked Vercel CLI",
  "run: npm ci --prefix tools/vercel-cli --ignore-scripts",
];
export const CLI_PATH_STEP = [
  "- name: Put the locked Vercel CLI on the PATH",
  'run: echo "$GITHUB_WORKSPACE/tools/vercel-cli/node_modules/.bin" >> "$GITHUB_PATH"',
];
export const CLEANUP_STEP = [
  "- name: Delete superseded Preview deployments",
  "if: env.TARGET == 'preview' && steps.alias_head.outputs.assign == 'true'",
  "env:",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "DEPLOY_URL: ${{ steps.deploy.outputs.url }}",
  'run: npx tsx scripts/cleanup-previews.ts "$DEPLOY_URL" "$PREVIEW_ALIAS"',
];

/** What must be true of `.github/workflows/deploy-vercel.yml`. Returns the broken rules (empty when fine). */
export function checkDeployWorkflow(workflow: string): string[] {
  const problems: string[] = [];
  const count = (pattern: RegExp) => (workflow.match(pattern) ?? []).length;
  const injection =
    /^( *)- name: Inject deployment secrets[^\n]*\n((?:\1 {2}.*\n|\n)*)/m.exec(workflow)?.[0] ?? "";

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

  // The private SDK is fetched with the repository's expiring read-only package token. The gate remains dependency- and
  // secret-free; the credential reaches only the deploy job's application install and Vercel's second install during
  // `vercel build`, never the independently locked Vercel CLI.
  const permissionBlock = /^permissions:\n((?: {2}.*\n)*)/m.exec(workflow)?.[1] ?? "";
  if (/^ {2}packages:\s*/m.test(permissionBlock))
    problems.push("the deploy workflow must not grant the repository token package access");
  if (stepsOf(jobBody(workflow, "gate") ?? "", "run: npm ci\n").length !== 0)
    problems.push("the release gate must not install dependencies or receive the package secret");
  const installs = stepsOf(jobBody(workflow, "deploy") ?? "", "run: npm ci\n");
  if (
    installs.length !== 1 ||
    !/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.FRAMEBRIAR_PACKAGES_TOKEN\s*\}\}/.test(installs[0])
  )
    problems.push("the deploy job must give the Framebriar secret only to its root npm ci step");
  const buildStep = stepsOf(jobBody(workflow, "deploy") ?? "", "- name: Build")[0] ?? "";
  if (!/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.FRAMEBRIAR_PACKAGES_TOKEN\s*\}\}/.test(buildStep))
    problems.push("vercel build needs the Framebriar package secret for its second install");
  if (count(/NODE_AUTH_TOKEN:/g) !== 2)
    problems.push("NODE_AUTH_TOKEN may appear only on the deploy root install and vercel build");
  const cliInstall =
    stepsOf(jobBody(workflow, "deploy") ?? "", "Install the locked Vercel CLI")[0] ?? "";
  if (/NODE_AUTH_TOKEN/.test(cliInstall))
    problems.push("the independently locked Vercel CLI install must not receive the package token");

  // A production build never captures screenshots (#130): the switch is forced off on the build line itself.
  if (!/FEEDBACK_SCREENSHOTS=0 vercel build --prod/.test(workflow))
    problems.push("the production build must set FEEDBACK_SCREENSHOTS=0");

  // The gate decides the target and holds no secret and no environment.
  const gate = jobBody(workflow, "gate");
  if (!gate) problems.push("the gate job is missing");
  else {
    if (/secrets\./.test(gate)) problems.push("the gate job must not read any secret");
    if (/^\s+environment:/m.test(gate))
      problems.push("the gate job must not use a GitHub environment");
    if (!/node --experimental-strip-types scripts\/release-gate\.ts/.test(gate))
      problems.push("the gate job must run the dependency-free release gate");
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

  // Secrets: the Vercel token only in the five steps that talk to Vercel (pull, deploy, assigning the Preview alias, tidying up old
  // Previews, and the read-only proof of the Production alias); the database secret only in the deploy job.
  if (count(/secrets\.VERCEL_TOKEN/g) !== 5)
    problems.push(
      "VERCEL_TOKEN must be read by exactly five steps (pull, deploy, the Preview alias, the Preview cleanup and the Production alias proof)",
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
  if (count(/scripts\/assign-alias\.ts/g) !== 1)
    problems.push("the Preview alias must be set by exactly one step");
  // Not the CLI: `vercel alias` loads the token's user first, which answers 404 for this token (see src/tooling/alias-api.ts).
  if (/\bvercel alias\b/.test(workflow.replace(/^\s*#.*$/gm, "")))
    problems.push("the alias must be assigned by scripts/assign-alias.ts, never the vercel CLI");
  if (!/assign-alias\.ts "\$DEPLOY_URL" "\$PREVIEW_ALIAS"/.test(aliasStep)) {
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
    ["Prove the Production alias", PROD_ALIAS_STEP, "Production alias proof"],
    ["Production alias smoke test", PROD_SMOKE_STEP, "Production alias smoke test"],
    ["Smoke test", DEPLOY_SMOKE_STEP, "deployment smoke test"],
    ["Install the locked Vercel CLI", CLI_INSTALL_STEP, "locked Vercel CLI install"],
    ["Put the locked Vercel CLI on the PATH", CLI_PATH_STEP, "Vercel CLI PATH"],
    ["Delete superseded Preview deployments", CLEANUP_STEP, "Preview cleanup"],
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
  const aliasAt = workflow.indexOf("scripts/assign-alias.ts");
  // The deployment-URL smoke test (Preview), not the Production alias one, comes before the Preview alias section.
  const firstSmokeAt = workflow.indexOf('scripts/smoke-test.ts "$DEPLOY_URL"');
  const lastSmokeAt = workflow.lastIndexOf("scripts/smoke-test.ts");
  if (!(firstSmokeAt >= 0 && firstSmokeAt < headAt && headAt < aliasAt && aliasAt < lastSmokeAt)) {
    problems.push(
      "the order must be: smoke test, develop head check, alias set, smoke test of the alias",
    );
  }
  // The cleanup (#135) comes last: after the alias moved and was smoke-tested, one step, only for the script that confirms the target.
  const cleanupAt = workflow.indexOf("scripts/cleanup-previews.ts");
  if (count(/scripts\/cleanup-previews\.ts/g) !== 1 || cleanupAt < lastSmokeAt) {
    problems.push("the Preview cleanup must be one step, after the alias smoke test");
  }
  if (/\bvercel (remove|rm)\b/.test(code)) {
    problems.push(
      "old deployments are removed only by scripts/cleanup-previews.ts, never the vercel CLI",
    );
  }
  if (!/smoke-test\.ts "https:\/\/\$\{PREVIEW_ALIAS\}"/.test(workflow)) {
    problems.push("the alias itself must be smoke-tested");
  }
  if (!/^ {2}PREVIEW_ALIAS: travel-packing-preview\.vercel\.app\b/m.test(workflow)) {
    problems.push("PREVIEW_ALIAS must be travel-packing-preview.vercel.app");
  }
  // Production (#207): the public alias is the smoke target, only after it is proven to serve this deployment and this commit.
  if (!/^ {2}PRODUCTION_ALIAS: packed-smart\.vercel\.app\b/m.test(workflow)) {
    problems.push("PRODUCTION_ALIAS must be packed-smart.vercel.app");
  }
  if (count(/--meta releaseSha="\$GITHUB_SHA"/g) !== 2) {
    problems.push(
      'both deploys must label the deployment with the release commit (--meta releaseSha="$GITHUB_SHA"), which the alias proof matches',
    );
  }
  const targetCheckStep = workflow.indexOf("scripts/check-deploy-target.ts");
  const proofAt = workflow.indexOf("scripts/verify-production-alias.ts");
  const prodSmokeAt = workflow.indexOf('scripts/smoke-test.ts "https://${PRODUCTION_ALIAS}"');
  if (count(/verify-production-alias\.ts/g) !== 1 || count(/PRODUCTION_ALIAS\}"/g) !== 1) {
    problems.push("the Production alias is proven by one step and smoke-tested by one step");
  } else if (!(targetCheckStep < proofAt && proofAt < prodSmokeAt)) {
    problems.push(
      "the order must be: deploy target check, Production alias proof, Production alias smoke test",
    );
  }
  // Never smoke-test a production deployment's generated address (Vercel Authentication answers there, not the app).
  if (
    /scripts\/smoke-test\.ts "\$DEPLOY_URL"/.test(workflow) &&
    !/if:\s*env\.TARGET == 'preview'\s*\n\s*env:\s*\n\s*DEPLOY_URL/.test(workflow)
  ) {
    problems.push("the deployment-URL smoke test must run for previews only");
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

  // Secret injection (vercel pull cannot read Vercel Secrets): after the pull, before the check and build, for either
  // target through its selected GitHub environment, and the values come from secrets.* alone.
  const stepStart = (needle: string) => workflow.indexOf(needle);
  const pull = stepStart("vercel pull --yes");
  const inject = stepStart("scripts/inject-deploy-secrets.ts");
  const checkEnv = stepStart("scripts/check-deploy-env.ts");
  const build = stepStart("vercel build");
  if (inject < 0) problems.push("the deployment secret injection step is missing");
  else {
    if (!(pull >= 0 && pull < inject && inject < checkEnv && checkEnv < build)) {
      problems.push(
        "the secret injection must run after vercel pull and before the env check and the build",
      );
    }
    if (/^\s+if:/m.test(injection)) {
      problems.push("the secret injection must run for both Preview and Production");
    }
    // The step does one thing: run the script on the pulled file. Nothing else may sit beside it that could echo a value.
    const runLines = [...injection.matchAll(/^\s+run:\s*(.*)$/gm)].map((match) => match[1].trim());
    if (
      runLines.length !== 1 ||
      runLines[0] !== 'npx tsx scripts/inject-deploy-secrets.ts ".vercel/.env.${TARGET}.local"'
    ) {
      problems.push(
        "the secret injection step must run exactly the injection script on the pulled target file",
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
  // The Vercel CLI is installed only from its own lockfile (#208). It holds a production-capable token in later steps, so its
  // dependency graph must not be resolved at run time: no global or ad-hoc install of it, no npx that could download it.
  const cliCode = workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  if (
    /\bnpm\s+(install|i|add)\b[^\n]*\bvercel\b|\bnpm\s+(install|i)\b[^\n]*(--global|\s-g\b)/.test(
      cliCode,
    )
  )
    problems.push(
      "the Vercel CLI must not be installed with npm install or globally; it comes from tools/vercel-cli/package-lock.json",
    );
  if (/\bnpx\b(?![^\n]*\btsx\b)[^\n]*\bvercel\b/.test(cliCode))
    problems.push(
      "the Vercel CLI must not be run with npx (it could resolve a new dependency graph)",
    );
  const cliInstallAt = workflow.indexOf("npm ci --prefix tools/vercel-cli");
  const cliPathAt = workflow.indexOf("tools/vercel-cli/node_modules/.bin");
  const firstCliUseAt = workflow.indexOf("vercel pull --yes");
  if (!(cliInstallAt >= 0 && cliInstallAt < cliPathAt && cliPathAt < firstCliUseAt)) {
    problems.push(
      "the order must be: install the locked Vercel CLI, put it on the PATH, then the first vercel command",
    );
  }
  // The e2e build exists only inside a CI run; a deploy builds its own, exactly as production does.
  if (/download-artifact|upload-artifact|e2e-build|NEXT_PUBLIC_E2E_BUILD\s*[:=]/.test(workflow))
    problems.push("the deploy must never use an artifact or an e2e build");
  if (!/secrets\.PRODUCTION_DB_HOST/.test(workflow)) {
    problems.push("PRODUCTION_DB_HOST must be passed to the host checks, from the secret store");
  }
  // GitHub prints step env values in the log and masks only secrets, so these two must never come from variables.
  for (const name of ["PRODUCTION_DB_HOST", "PREVIEW_SEED_OWNER_ID"]) {
    if (new RegExp(`vars\\.${name}\\b`).test(workflow)) {
      problems.push(`${name} must be a secret, not a variable (variables are printed in the log)`);
    }
  }
  if (!/secrets\.PREVIEW_SEED_OWNER_ID/.test(workflow)) {
    problems.push("the seed step must read PREVIEW_SEED_OWNER_ID as a secret");
  }
  return problems;
}

/** The ci job needs room for a slow runner: a healthy full run is ~19 minutes, and a cancelled run stops the deploy that follows it. */
export const MIN_CI_TIMEOUT_MINUTES = 35;

/** The jobs `ci.yml` may have. A new job must be added here, to the `ci` job's needs and to its summary script together. */
export const CI_JOBS = [
  "mode",
  "checks",
  "unit",
  "build",
  "e2e-build",
  "e2e",
  "ci",
  "deploy",
] as const;
/** The jobs that wait for the mode and run only in full mode. */
const HEAVY_JOBS = ["unit", "build", "e2e-build", "e2e"] as const;
/** The jobs the `ci` summary waits for (everything but itself and the deploy). */
const SUMMARY_NEEDS = ["mode", "checks", ...HEAVY_JOBS] as const;

/** The job names a `needs:` line or list names, from the job's own text. */
function jobNeeds(job: string): string[] {
  const inline = /^ {4}needs:\s*\[([^\]]*)\]\s*$/m.exec(job)?.[1];
  if (inline !== undefined)
    return inline
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  const single = /^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/m.exec(job)?.[1];
  if (single) return [single];
  const block = /^ {4}needs:\s*\n((?: {6}- .*\n)+)/m.exec(job)?.[1];
  return block ? [...block.matchAll(/- ([A-Za-z0-9_-]+)/g)].map((m) => m[1]) : [];
}

/** The `run:` script of the step whose name contains `needle`, as the shell would read it (used by tests to run it). */
export function stepScript(job: string, needle: string): string {
  const step = stepsOf(job, needle)[0] ?? "";
  const block = /^ {8}run:\s*\|\n((?: {10}.*\n?|\n)*)/m.exec(step)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}

/** A job's text without its YAML comment lines, so a rule never fires on what a comment says. Null when there is no such job. */
export function ciJob(workflow: string, name: string): string | null {
  const job = jobBody(workflow, name);
  return job === null ? null : job.replace(/^\s*#.*\n?/gm, "");
}

/**
 * What must be true of `.github/workflows/ci.yml` (#91, #98). Returns the broken rules (empty when fine).
 * The shape: parallel jobs (checks, unit, the production builds, one e2e build shared by phone and desktop e2e on separate
 * runners), one required summary job named `ci` that needs them all, a mode job every heavy job waits for, gitleaks in the
 * checks, and a native-`needs` deploy on develop pushes only.
 */
export function checkCiWorkflow(workflow: string): string[] {
  const problems: string[] = [];
  const jobsStart = workflow.search(/^jobs:/m);
  const jobs = [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)]
    .filter((match) => (match.index ?? 0) > jobsStart)
    .map((match) => match[1]);
  const body = (name: string) => ciJob(workflow, name);

  for (const name of CI_JOBS) if (!body(name)) problems.push(`the ${name} job is missing`);
  for (const name of jobs)
    if (!(CI_JOBS as readonly string[]).includes(name))
      problems.push(
        `unknown job ${name}: add it to CI_JOBS, the ci job's needs and its summary script together`,
      );
  if (!/^\s*pull_request:/m.test(workflow) || !/^\s*push:/m.test(workflow))
    problems.push("ci must run on pull requests and on pushes");
  if (!/ready_for_review/.test(workflow))
    problems.push("marking a draft ready must run the full validation (ready_for_review)");
  if (/^\s*workflow_dispatch:/m.test(workflow.slice(0, jobsStart)))
    problems.push("ci.yml must not be dispatchable by hand");

  const permissionBlock =
    /^permissions:\n((?: {2}.*\n)*)/m.exec(workflow.slice(0, jobsStart))?.[1] ?? "";
  if (/^ {2}packages:\s*/m.test(permissionBlock))
    problems.push("ci must not grant the repository token package access");
  const trustedPackageToken =
    /NODE_AUTH_TOKEN:\s*\$\{\{\s*\(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\) && secrets\.FRAMEBRIAR_PACKAGES_TOKEN \|\| ''\s*\}\}/;
  for (const name of ["mode", "checks", "unit", "build", "e2e-build", "e2e"] as const) {
    const installs = stepsOf(body(name) ?? "", "run: npm ci\n");
    if (installs.length !== 1 || !trustedPackageToken.test(installs[0]))
      problems.push(
        `${name}'s root install must receive the package token only for pushes and same-repository pull requests`,
      );
  }
  if ((workflow.match(/secrets\.FRAMEBRIAR_PACKAGES_TOKEN/g) ?? []).length !== 6)
    problems.push("the Framebriar package secret may appear only on the six trusted root installs");
  for (const name of ["mode", "checks", "deploy"] as const)
    if (/^ {6}packages:\s*/m.test(body(name) ?? ""))
      problems.push(`${name}'s explicit permissions must not grant package access`);

  const concurrency = /^concurrency:\n((?: {2}.*\n)*)/m.exec(workflow)?.[1] ?? "";
  if (
    !/cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/.test(concurrency)
  )
    problems.push(
      "only pull request runs may be cancelled by a newer push (a develop push may be deploying)",
    );

  for (const name of jobs.filter((job) => job !== "deploy")) {
    const job = body(name) ?? "";
    if (!/^ {4}timeout-minutes:\s*\d+/m.test(job))
      problems.push(`the ${name} job needs a timeout-minutes`);
    if (/secrets\.(?!GITHUB_TOKEN\b|FRAMEBRIAR_PACKAGES_TOKEN\b)/.test(job))
      problems.push(`the ${name} job must read no secret but GITHUB_TOKEN or the package token`);
    if (/secrets:\s*inherit/.test(job)) problems.push(`the ${name} job must not inherit secrets`);
    if (/continue-on-error/.test(job))
      problems.push(`the ${name} job must not use continue-on-error`);
  }
  for (const name of ["unit", "build", "e2e-build", "e2e"] as const) {
    const timeout = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(body(name) ?? "")?.[1] ?? NaN);
    if (!(timeout >= MIN_CI_TIMEOUT_MINUTES / 2))
      problems.push(`the ${name} job's timeout-minutes must leave room for a slow runner`);
  }

  // The mode job decides once for everyone.
  const mode = body("mode") ?? "";
  if (!/scripts\/ci-mode\.ts/.test(mode)) problems.push("the mode step is missing");
  if (!/^\s+mode:\s*\$\{\{\s*steps\.mode\.outputs\.mode\s*\}\}\s*$/m.test(mode))
    problems.push("the mode job must output the mode");

  // The static checks start at once and run in every mode; gitleaks is first, with the full history.
  const checks = body("checks") ?? "";
  if (jobNeeds(checks).length > 0 || /^ {4}if:/m.test(checks))
    problems.push("the checks job must run in every mode and need nothing");
  if (!/gitleaks\/gitleaks-action@[0-9a-f]{40}/.test(checks))
    problems.push("secret scanning (gitleaks) must run inside the checks job");
  if (!/fetch-depth:\s*0/.test(checks))
    problems.push("gitleaks needs the full history (fetch-depth: 0)");
  if (checks.indexOf("gitleaks/gitleaks-action") > checks.indexOf("npm ci"))
    problems.push("gitleaks must run before the install, so a leak fails the run first");
  for (const [needle, label] of [
    ["npm run check:repo-hygiene", "repository hygiene"],
    ['"$RUNNER_TEMP/actionlint"', "actionlint"],
    ["npm run check:workflows", "workflow contract"],
    ["npm audit --omit=dev --audit-level=high", "dependency audit (high severity)"],
    ["npm ci --prefix tools/vercel-cli --ignore-scripts", "locked Vercel CLI install"],
    ["tools/vercel-cli/node_modules/.bin/vercel --version", "locked Vercel CLI version"],
    ["npm run lint", "lint"],
    ["npm run typecheck", "typecheck"],
  ] as const) {
    if (!checks.includes(needle))
      problems.push(`the ${label} check is missing from the checks job`);
  }

  // Every heavy job waits for the mode and runs only in full mode.
  for (const name of HEAVY_JOBS) {
    const job = body(name) ?? "";
    if (!jobNeeds(job).includes("mode")) problems.push(`the ${name} job must need the mode job`);
    if (!/^ {4}if:\s*needs\.mode\.outputs\.mode == 'full'\s*$/m.test(job))
      problems.push(`the ${name} job must run only in full mode`);
  }
  const requireStep = (name: string, needle: string, message: string) => {
    if (!(body(name) ?? "").includes(needle)) problems.push(message);
  };
  requireStep("unit", "npm run test:coverage", "the unit job must run the coverage tests");
  requireStep("build", "npm run build:webpack", "the build job must run the webpack build");
  for (const needle of [
    "npm run build:production\n",
    "check:no-e2e-in-build",
    "check:no-capture-in-build",
    "check:no-feedback-in-build",
    "check:client-bundle",
  ]) {
    requireStep("build", needle, `the build job is missing ${needle.trim()}`);
  }

  // The production builds never carry the e2e flag or hand anything on; the one e2e build does, to both e2e jobs.
  const build = body("build") ?? "";
  if (/NEXT_PUBLIC_E2E_BUILD|build:e2e|upload-artifact/.test(build))
    problems.push("the build job must build exactly like production (no e2e flag, no artifact)");
  const e2eBuild = body("e2e-build") ?? "";
  if (!/npm run build:e2e/.test(e2eBuild))
    problems.push("the e2e-build job must run npm run build:e2e");
  if (!/name:\s*e2e-build\b/.test(e2eBuild) || !/retention-days:\s*1\s*$/m.test(e2eBuild))
    problems.push("the e2e build artifact must be named e2e-build and live one day");
  if (!/include-hidden-files:\s*true/.test(e2eBuild) || !/!\.next\/cache/.test(e2eBuild))
    problems.push("the e2e build artifact must include .next without its cache");
  for (const name of jobs.filter((job) => !["e2e-build", "deploy", "ci"].includes(job)))
    if (
      /actions\/upload-artifact[^\n]*\n(?:[^\n]*\n){0,3}\s+name:\s*e2e-build/.test(body(name) ?? "")
    )
      problems.push(`only the e2e-build job may upload the e2e build (found in ${name})`);

  const e2e = body("e2e") ?? "";
  if (!jobNeeds(e2e).includes("e2e-build"))
    problems.push("the e2e job must need the e2e-build job");
  const matrix = [...e2e.matchAll(/^ {10}- project:\s*(\S+)\s*\n {12}browser:\s*(\S+)\s*$/gm)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
  if (
    matrix.join() !== "phone:webkit,desktop:chromium" ||
    (e2e.match(/- project:/g) ?? []).length !== 2
  )
    problems.push(
      "the e2e matrix must be exactly phone on webkit (a real iPhone profile) and desktop on chromium",
    );
  if (
    !/BROWSER:\s*\$\{\{\s*matrix\.browser\s*\}\}/.test(e2e) ||
    !/npx playwright install-deps "\$BROWSER"/.test(e2e) ||
    !/npx playwright install "\$BROWSER"/.test(e2e)
  )
    problems.push("each e2e job must install its own browser (matrix.browser)");
  if (
    !/for attempt in 1 2/.test(e2e) ||
    !/timeout --kill-after=30s 5m npx playwright install-deps/.test(e2e) ||
    !/Playwright dependency install timed out/.test(e2e)
  )
    problems.push("the Playwright dependency install needs one bounded timeout retry");
  if (!/key:\s*playwright-[^\n]*matrix\.browser/.test(e2e))
    problems.push("the Playwright cache key must include the browser");
  if (!/fail-fast:\s*false/.test(e2e))
    problems.push("the e2e matrix must not cancel one project when the other fails");
  if (/^ {6}max-parallel:/m.test(e2e))
    problems.push("the e2e projects must run at the same time (no max-parallel)");
  if (!/actions\/download-artifact@[0-9a-f]{40}[\s\S]*name:\s*e2e-build/.test(e2e))
    problems.push("the e2e job must download the e2e build");
  if (!/E2E_PREBUILT:\s*"1"/.test(e2e))
    problems.push("the e2e job must start the downloaded build (E2E_PREBUILT)");
  if (!/npm run test:e2e -- --project="\$E2E_PROJECT"/.test(e2e))
    problems.push("the e2e job must run npm run test:e2e for its own project");
  if (/--shard|workers/.test(e2e))
    problems.push("the e2e job runs its project whole, on one worker");

  // A job that runs AFTER a job which can be skipped (a heavy job, in quick or reused mode) gets an implicit success() unless its
  // if names a status function, and that is false when any ancestor was skipped. Only `ci` and `deploy` do that on purpose.
  const needsOf = new Map(jobs.map((name) => [name, jobNeeds(body(name) ?? "")]));
  const ancestors = (name: string, seen = new Set<string>()): Set<string> => {
    for (const parent of needsOf.get(name) ?? [])
      if (!seen.has(parent)) {
        seen.add(parent);
        ancestors(parent, seen);
      }
    return seen;
  };
  for (const name of jobs) {
    if ((HEAVY_JOBS as readonly string[]).includes(name)) continue;
    if (![...ancestors(name)].some((parent) => (HEAVY_JOBS as readonly string[]).includes(parent)))
      continue;
    const condition = /^ {4}if:\s*(.*)$/m.exec(body(name) ?? "")?.[1] ?? "";
    if (!/(?:^|[\s{(&|])(?:always\(\)|!cancelled\(\))/.test(condition))
      problems.push(
        `the ${name} job runs after a job that can be skipped, so its if needs a status function (always() or !cancelled())`,
      );
  }

  // The summary: the one required check.
  const ci = body("ci") ?? "";
  const needs = jobNeeds(ci);
  for (const name of SUMMARY_NEEDS)
    if (!needs.includes(name)) problems.push(`the ci job must need ${name}`);
  if (needs.some((name) => !(SUMMARY_NEEDS as readonly string[]).includes(name)))
    problems.push("the ci job may need only the jobs it summarises");
  if (!/^ {4}if:\s*always\(\)\s*$/m.test(ci))
    problems.push("the ci job must always run (if: always())");
  if (/^ {4}if:/m.test(ci) && !/^ {4}if:\s*always\(\)\s*$/m.test(ci))
    problems.push("the ci job must not be skippable");
  const script = stepScript(ci, "Every job must have succeeded");
  for (const piece of ["quick)", "full)", "reused)", "fail"])
    if (!script.includes(piece))
      problems.push(`the ci summary must handle ${piece.replace(")", "")}`);

  const deploy = body("deploy");
  if (deploy) {
    if (!jobNeeds(deploy).includes("ci") || jobNeeds(deploy).length !== 1)
      problems.push("the deploy job must need ci, and only ci");
    // The condition is exactly these terms, joined by &&. A status function is required: without one the job gets an implicit
    // success() that fails when any ancestor was skipped, and a reused push skips the heavy jobs behind `ci` (#105).
    const condition = (/^ {4}if:\s*(.*)$/m.exec(deploy)?.[1] ?? "")
      .replace(/^\$\{\{\s*/, "")
      .replace(/\s*\}\}$/, "")
      .trim();
    const terms = condition.split("&&").map((term) => term.trim());
    if (condition.includes("||")) problems.push("the deploy job's condition must not use ||");
    if (!terms.includes("!cancelled()") && !terms.includes("always()"))
      problems.push(
        "the deploy job needs a status function (!cancelled()) in its if, or a reused push (heavy jobs skipped) never deploys",
      );
    if (!terms.includes("needs.ci.result == 'success'"))
      problems.push(
        "the deploy job must be gated on ci's own result (needs.ci.result == 'success')",
      );
    if (
      !terms.includes("github.event_name == 'push'") ||
      !terms.includes("github.ref == 'refs/heads/develop'")
    )
      problems.push("the deploy job must run only for a push to develop");
    const allowed = new Set([
      "!cancelled()",
      "always()",
      "needs.ci.result == 'success'",
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/develop'",
    ]);
    if (terms.some((term) => !allowed.has(term)))
      problems.push(
        "the deploy job's condition may hold only the status function, ci's result and the push/develop guard",
      );
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

/**
 * The locked Vercel CLI (#208): tools/vercel-cli/package.json names the exact version the workflow pins, the lockfile resolves
 * that version, and every package in the lockfile has an integrity hash and comes from the npm registry. Returns the broken rules.
 */
export function checkVercelCliLock(
  workflow: string,
  packageJson: string,
  lockJson: string,
): string[] {
  const problems: string[] = [];
  const pinned = /VERCEL_CLI_VERSION:\s*(\d+\.\d+\.\d+)\b/.exec(workflow)?.[1];
  let pkg: { dependencies?: Record<string, string> };
  let lock: { lockfileVersion?: number; packages?: Record<string, Record<string, unknown>> };
  try {
    pkg = JSON.parse(packageJson);
    lock = JSON.parse(lockJson);
  } catch {
    return ["tools/vercel-cli/package.json or package-lock.json is not valid JSON"];
  }
  if (!pinned) problems.push("the workflow does not pin VERCEL_CLI_VERSION");
  const dependencies = Object.entries(pkg.dependencies ?? {});
  if (
    dependencies.length !== 1 ||
    dependencies[0][0] !== "vercel" ||
    dependencies[0][1] !== pinned
  ) {
    problems.push(
      "tools/vercel-cli/package.json must depend on exactly vercel at the version the workflow pins",
    );
  }
  const packages = lock.packages ?? {};
  if (packages["node_modules/vercel"]?.version !== pinned) {
    problems.push(
      "tools/vercel-cli/package-lock.json must resolve vercel to the version the workflow pins",
    );
  }
  if (Object.keys(packages).length < 2)
    problems.push("tools/vercel-cli/package-lock.json has no locked dependency graph");
  const entries = Object.entries(packages).filter(([name, entry]) => name !== "" && !entry.link);
  const unhashed = entries.filter(
    ([, entry]) => typeof entry.integrity !== "string" || entry.integrity === "",
  );
  if (unhashed.length > 0) {
    problems.push(
      `${unhashed.length} package(s) in the Vercel CLI lockfile have no integrity hash (first: ${unhashed[0][0]})`,
    );
  }
  const elsewhere = entries.filter(
    ([, entry]) =>
      typeof entry.resolved !== "string" ||
      !entry.resolved.startsWith("https://registry.npmjs.org/"),
  );
  if (elsewhere.length > 0) {
    problems.push(
      `${elsewhere.length} package(s) in the Vercel CLI lockfile do not come from the npm registry (first: ${elsewhere[0][0]})`,
    );
  }
  return problems;
}
