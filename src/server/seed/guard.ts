// The seed writes SYNTHETIC data and wipes-and-recreates its own sample trips, so it must never run against
// anything real. This guard is the single place that decides, and it fails closed.
//
// The seed target is chosen explicitly: either an on-disk/in-memory PGlite database, or SEED_DATABASE_URL (a name
// that is deliberately not DATABASE_URL, so the app's own connection is never picked up by accident).

type Env = Record<string, string | undefined>;

export class SeedRefused extends Error {
  constructor(reason: string) {
    super(`db:seed refused: ${reason}`);
    this.name = "SeedRefused";
  }
}

/** "host/db" for comparing two connection strings without ever printing them. */
function target(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    return `${url.hostname.replace(/-pooler(?=\.)/, "")}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Throws SeedRefused unless it is safe to seed. `targetUrl` is the remote database about to be written, or
 * undefined for a local PGlite database (which is always fine outside production).
 */
export function assertSeedAllowed(env: Env, targetUrl?: string): void {
  if (env.NODE_ENV === "production") throw new SeedRefused("NODE_ENV is production");
  if (env.VERCEL) throw new SeedRefused("this is a Vercel runtime");
  if (targetUrl === undefined) return;

  const seedTarget = target(targetUrl);
  if (!seedTarget) throw new SeedRefused("SEED_DATABASE_URL is not a valid connection URL");

  // The app's own connections are the production database by convention: never seed them, whichever host
  // spelling (pooled or direct) they use.
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const configured = env[name];
    if (configured && target(configured) === seedTarget) {
      throw new SeedRefused(`SEED_DATABASE_URL points at the same database as ${name}`);
    }
  }
}
