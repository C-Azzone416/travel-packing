// Runs the phone and desktop browser tests at the same time, each against its own servers (see src/tooling/e2e-parallel.ts).
// Builds the e2e variant of the app once, unless E2E_PREBUILT=1 says a build is already in place. Usage:
//   npm run test:e2e:parallel [-- <extra playwright args, e.g. a spec file>]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { overallExitCode, planRuns, portsOf } from "../src/tooling/e2e-parallel";

const prebuilt = process.env.E2E_PREBUILT === "1";
const runs = planRuns(process.env, prebuilt, process.argv.slice(2));
const ports = portsOf(runs);
if (new Set(ports).size !== ports.length) {
  console.error("e2e: the planned ports collide");
  process.exit(1);
}

// Start from a clean slate: stale accounts or "emails" from an earlier run would change what the tests see.
rmSync(join("test-results", "e2e-sessions"), { recursive: true, force: true });
mkdirSync("test-results", { recursive: true });

if (!prebuilt) {
  const build = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_E2E_BUILD: "1" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

/** Prefix every line a run prints with its project, so two interleaved logs stay readable. */
function pipe(stream: NodeJS.ReadableStream, out: NodeJS.WriteStream, label: string): void {
  let pending = "";
  stream.on("data", (chunk: Buffer) => {
    const lines = (pending + chunk.toString()).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) out.write(`[${label}] ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) out.write(`[${label}] ${pending}\n`);
  });
}

/**
 * Waits until the app answers at `url` (or the run ended). `next start` takes a lock on the build directory while it starts,
 * so two runs must not start their servers at the same moment: each run starts once the one before it is fully up.
 */
async function waitUntilUp(url: string, ended: () => boolean, seconds = 240): Promise<void> {
  for (let attempt = 0; attempt < seconds * 2 && !ended(); attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const codes: (number | null)[] = [];
  const finished: Promise<void>[] = [];
  for (const [index, run] of runs.entries()) {
    let ended = false;
    const child = spawn("npx", ["playwright", "test", ...run.args], {
      env: { ...process.env, ...run.env, E2E_PREBUILT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipe(child.stdout, process.stdout, run.project);
    pipe(child.stderr, process.stderr, run.project);
    finished.push(
      new Promise((resolve) =>
        child.on("exit", (code) => {
          ended = true;
          codes[index] = code;
          resolve();
        }),
      ),
    );
    // The last server a run starts is its Open-Meteo copy (PORT + 100); once that answers, the next run may start.
    if (index < runs.length - 1) {
      await waitUntilUp(`http://localhost:${Number(run.env.E2E_PORT) + 100}/sign-in`, () => ended);
    }
  }
  await Promise.all(finished);
  console.log(
    `e2e: ${runs.map((run, i) => `${run.project}=${codes[i]}`).join(" ")} in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  process.exit(overallExitCode(codes));
}

void main();
