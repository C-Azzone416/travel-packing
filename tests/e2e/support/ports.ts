// One place for the e2e ports. The app port is overridable (E2E_PORT) so several worktrees can test on one
// machine; the second app (Open-Meteo mode) and the fake geocoder are offset from it so they never
// collide with another agent's assigned port either. The database server has its own port (E2E_DB_PORT).

/** A TCP port from the environment: a whole number 1..65535, else the default (an empty or junk value must not become 0 or NaN). */
export function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

export const PORT = portFrom(process.env.E2E_PORT, 3100);
export const OPEN_METEO_PORT = PORT + 100;
export const FAKE_GEOCODER_PORT = PORT + 200;
export const E2E_DB_PORT = portFrom(process.env.E2E_DB_PORT, 5433);
