// One place for the e2e ports. The app port is overridable (E2E_PORT) so several worktrees can test on one
// machine; the second app (Open-Meteo mode) and the fake geocoder are offset from it so they never
// collide with another agent's assigned port either.
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const OPEN_METEO_PORT = PORT + 100;
export const FAKE_GEOCODER_PORT = PORT + 200;
