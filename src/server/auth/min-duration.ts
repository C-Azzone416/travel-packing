// A floor on how long the account actions take, so a request that reached the provider (an allowlisted address) and one
// that did not (anyone else) cannot be told apart by timing. The provider call is normally well under the floor.
// AUTH_FLOW_MIN_MS overrides it ("0" turns it off; the browser tests do that to stay fast).

export const DEFAULT_FLOW_MIN_MS = 800;

export function flowMinimumMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AUTH_FLOW_MIN_MS?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return DEFAULT_FLOW_MIN_MS;
  return Math.min(Number(raw), 10_000);
}

export async function withMinimumDuration<T>(
  work: () => Promise<T>,
  minimumMs: number = flowMinimumMs(),
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    const remaining = minimumMs - (now() - started);
    if (remaining > 0) await sleep(remaining);
  }
}
