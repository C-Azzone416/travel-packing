import { getAuth } from "@/server/auth/auth-runtime";
import { createDataStopsSource } from "@/server/weather/data-source";
import { selectWeatherProvider } from "@/server/weather/provider-config";
import { createWeatherRateLimiter } from "@/server/weather/rate-limit";
import { createWeatherRoute } from "@/server/weather/route-handler";

export const GET = createWeatherRoute({
  getAuth,
  source: createDataStopsSource(),
  provider: selectWeatherProvider(),
  limiter: createWeatherRateLimiter(),
});
