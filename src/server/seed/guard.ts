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

/** A host in canonical form: percent-decoded, lowercased, trailing dot(s) dropped, `-pooler` suffix ignored. */
export function normalizeHost(host: string): string {
  return decoded(host)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/-pooler(?=\.|$)/, "");
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * "host/db" for comparing two connection strings without ever printing them. Every spelling of the same database must
 * produce the same key: the host is percent-decoded and lowercased, a trailing dot is dropped, and a `-pooler` suffix
 * (any case) is ignored; the database is the first path segment, percent-decoded, with slashes stripped. (Database
 * names are case-sensitive in Postgres, so their case is kept.) Returns null if the URL cannot be read.
 */
function target(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const host = normalizeHost(url.hostname);
    const database = decoded(url.pathname).split("/").filter(Boolean)[0] ?? "";
    return `${host}/${database}`;
  } catch {
    return null;
  }
}

/**
 * SEED_ALLOWED_HOSTS: the hosts a remote seed may write to, comma or whitespace separated. Entries are compared as exact
 * normalized hosts; there are no wildcards and no ports, schemes, or paths (an entry containing any of those can never
 * match anything).
 */
function allowedHosts(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map(normalizeHost)
      .filter((entry) => entry.length > 0),
  );
}

/** Query parameters that can point a connection somewhere other than the URL's host and path. */
const OVERRIDING_PARAMS = ["host", "hostaddr", "dbname", "service"] as const;

function overridesTarget(connectionString: string): boolean {
  try {
    const params = new URL(connectionString).searchParams;
    return OVERRIDING_PARAMS.some((name) => params.has(name));
  } catch {
    return false;
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
  if (overridesTarget(targetUrl)) {
    // A `?host=` / `?dbname=` style override can send the connection somewhere the URL does not show.
    throw new SeedRefused(
      "SEED_DATABASE_URL must not override its host or database in the query string",
    );
  }

  // The app's own connections are the production database by convention: never seed them, whichever host
  // spelling (pooled or direct) they use.
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const configured = env[name];
    if (configured && target(configured) === seedTarget) {
      throw new SeedRefused(`SEED_DATABASE_URL points at the same database as ${name}`);
    }
  }

  // Finally the explicit allowlist: --yes alone is never enough. With no list, every remote target is refused.
  const allowed = allowedHosts(env.SEED_ALLOWED_HOSTS);
  if (allowed.size === 0) {
    throw new SeedRefused(
      "remote seeding needs SEED_ALLOWED_HOSTS, an explicit list of hosts that may be seeded",
    );
  }
  if (!allowed.has(seedTarget.split("/")[0])) {
    throw new SeedRefused("SEED_DATABASE_URL's host is not in SEED_ALLOWED_HOSTS");
  }
}
