import { getAuth } from "@/server/auth/auth-runtime";
import { selectSearch } from "@/server/locations/provider-config";
import { createRateLimiter } from "@/server/locations/rate-limit";
import { createSearchRoute } from "@/server/locations/route-handler";

// Owner-only place search. Twenty searches a minute per session is far more than typing needs.
export const GET = createSearchRoute({
  getAuth,
  search: selectSearch(),
  limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
});
