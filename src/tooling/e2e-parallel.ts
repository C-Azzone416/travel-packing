// Running the phone and desktop browser tests at the same time in ONE CI job (#91). Two jobs would each pay for their own
// checkout, install and minute of rounding; one job with two test processes costs the sum of the work, not the sum plus
// overhead. The two cannot share anything the tests mutate, so each gets its own app server, its own in-memory database
// server, its own fake geocoder (all at ports that cannot collide) and its own output directory.

export const E2E_PROJECTS = ["phone", "desktop"] as const;
export type E2eProject = (typeof E2E_PROJECTS)[number];

/** Port gaps: the app uses PORT, the Open-Meteo copy PORT+100, the fake geocoder PORT+200 (tests/e2e/support/ports.ts). */
export const PORT_STRIDE = 300;

export interface E2eRun {
  project: E2eProject;
  /** Environment for this run's Playwright process, on top of the parent's. */
  env: Record<string, string>;
  /** Arguments after `playwright test`. */
  args: string[];
}

/** A port from the environment (a whole number 1..65535) or the fallback; junk never becomes 0 or NaN. */
function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

/**
 * One run per project. Run i uses app port E2E_PORT + i*300 and database port E2E_DB_PORT + i, so the three ports an app run
 * needs (PORT, PORT+100, PORT+200) never meet the next run's. `prebuilt` makes Playwright start the existing build.
 */
export function planRuns(
  env: Record<string, string | undefined>,
  prebuilt: boolean,
  extraArgs: string[] = [],
): E2eRun[] {
  const appPort = portFrom(env.E2E_PORT, 3100);
  const dbPort = portFrom(env.E2E_DB_PORT, 5433);
  const runs = E2E_PROJECTS.map((project, index): E2eRun => {
    const port = appPort + index * PORT_STRIDE;
    if (port + 200 > 65535) throw new Error("E2E_PORT is too high for two parallel runs");
    return {
      project,
      env: {
        E2E_PORT: String(port),
        E2E_DB_PORT: String(dbPort + index),
        ...(prebuilt ? { E2E_PREBUILT: "1" } : {}),
      },
      args: ["--project", project, "--output", `test-results/${project}`, ...extraArgs],
    };
  });
  return runs;
}

/** Every port every run will listen on; planRuns must never hand out the same one twice. */
export function portsOf(runs: E2eRun[]): number[] {
  return runs.flatMap((run) => {
    const port = Number(run.env.E2E_PORT);
    return [port, port + 100, port + 200, Number(run.env.E2E_DB_PORT)];
  });
}

/** The process exit code for the whole job: 0 only if every run exited 0. */
export function overallExitCode(codes: (number | null)[]): number {
  return codes.every((code) => code === 0) ? 0 : 1;
}
