import { describe, expect, it } from "vitest";
import {
  createWeatherRateLimiter,
  DEFAULT_WEATHER_REQUESTS_PER_MINUTE,
  weatherRequestsPerMinute,
} from "./rate-limit";

describe("weather rate limit config", () => {
  it.each([undefined, "", "0", "-1", "1.5", "1001", "nope"])("uses the default for %j", (value) => {
    expect(weatherRequestsPerMinute({ WEATHER_REQUESTS_PER_MINUTE: value })).toBe(
      DEFAULT_WEATHER_REQUESTS_PER_MINUTE,
    );
  });

  it("is 30 a minute per owner with no setting: the 30th call is allowed and the 31st refused", () => {
    expect(DEFAULT_WEATHER_REQUESTS_PER_MINUTE).toBe(30);
    expect(weatherRequestsPerMinute({})).toBe(30);
    const limiter = createWeatherRateLimiter({}, () => 0);
    for (let call = 1; call <= 30; call++) expect(limiter.consume("owner").ok).toBe(true);
    expect(limiter.consume("owner").ok).toBe(false);
    // Another owner has their own allowance.
    expect(limiter.consume("someone-else").ok).toBe(true);
  });

  it("accepts a bounded whole number and constructs the limiter", () => {
    const limiter = createWeatherRateLimiter({ WEATHER_REQUESTS_PER_MINUTE: "2" }, () => 0);
    expect(limiter.consume("owner").ok).toBe(true);
    expect(limiter.consume("owner").ok).toBe(true);
    expect(limiter.consume("owner").ok).toBe(false);
    expect(weatherRequestsPerMinute({ WEATHER_REQUESTS_PER_MINUTE: " 9 " })).toBe(9);
  });
});
