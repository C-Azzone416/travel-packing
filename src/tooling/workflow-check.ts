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

/** What must be true of `.github/workflows/deploy-vercel.yml`. Returns the broken rules (empty when fine). */
export function checkDeployWorkflow(workflow: string): string[] {
  const problems: string[] = [];
  const count = (pattern: RegExp) => (workflow.match(pattern) ?? []).length;

  // Triggers: a push deploys preview only; production is a manual run.
  const on = workflow.slice(workflow.search(/^on:/m), workflow.search(/^concurrency:/m));
  if (!/^on:/m.test(workflow) || on.length === 0) problems.push("no `on:` block");
  if (/^\s*-\s*main\s*$/m.test(on)) problems.push("a push to main must not trigger a deploy");
  if (!/^\s*-\s*develop\s*$/m.test(on)) problems.push("a push to develop must deploy the preview");
  if (!/^\s*workflow_dispatch:/m.test(on))
    problems.push("production needs the manual workflow_dispatch trigger");
  if (/pull_request/.test(workflow))
    problems.push("a pull request must never trigger a deploy workflow");
  if (/secrets:\s*inherit/.test(workflow)) problems.push("secrets must not be inherited");

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

  // Secrets: the Vercel token only in the two steps that talk to Vercel; the database secret only in the deploy job.
  if (count(/secrets\.VERCEL_TOKEN/g) !== 2)
    problems.push("VERCEL_TOKEN must be read by exactly two steps (pull and deploy)");
  const firstSecretLine = workflow.split("\n").findIndex((line) => /secrets\./.test(line));
  const deployLine = workflow.split("\n").findIndex((line) => /^ {2}deploy:\s*$/.test(line));
  if (firstSecretLine >= 0 && deployLine >= 0 && firstSecretLine < deployLine) {
    problems.push("secrets may only be read in the deploy job");
  }
  if (/\bDATABASE_URL\s*:/.test(workflow))
    problems.push("migrations must use DATABASE_URL_UNPOOLED, never the pooled URL");
  if (!/secrets\.DATABASE_URL_UNPOOLED/.test(workflow))
    problems.push("the direct database URL secret is not used");

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
