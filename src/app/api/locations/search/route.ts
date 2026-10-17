import { getAuth } from "@/server/auth/auth-runtime";
import { selectSearch } from "@/server/locations/provider-config";
import { createRateLimiter, searchesPerMinute } from "@/server/locations/rate-limit";
import { createSearchRoute } from "@/server/locations/route-handler";

// Owner-only place search. Twenty searches a minute is far more than typing needs; the e2e suite raises it
// through LOCATION_SEARCHES_PER_MINUTE because many tests search at once as the same owner.
export const GET = createSearchRoute({
  getAuth,
  search: selectSearch(),
  limiter: createRateLimiter({ limit: searchesPerMinute(), windowMs: 60_000 }),
});
