import { describe, expect, it } from "vitest";
import { loadAuthConfig, MIN_COOKIE_SECRET_LENGTH } from "./config";

const SECRET = "x".repeat(MIN_COOKIE_SECRET_LENGTH);
const valid = {
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: SECRET,
  OWNER_EMAIL_ALLOWLIST: "Owner@Example.test",
};

describe("loadAuthConfig", () => {
  it("accepts a complete configuration and normalizes the allowlist", () => {
    const result = loadAuthConfig(valid);
    expect(result).toMatchObject({
      ok: true,
      config: { baseUrl: "https://auth.example.test", cookieSecret: SECRET },
    });
    if (result.ok) expect([...result.config.allowlist]).toEqual(["owner@example.test"]);
  });

  it("reports every missing setting by name", () => {
    expect(loadAuthConfig({})).toEqual({
      ok: false,
      problems: [
        "NEON_AUTH_BASE_URL is not set",
        "NEON_AUTH_COOKIE_SECRET is not set",
        "OWNER_EMAIL_ALLOWLIST has no entries",
      ],
    });
  });

  it.each([
    [
      "an invalid URL",
      { NEON_AUTH_BASE_URL: "not a url" },
      "NEON_AUTH_BASE_URL is not a valid URL",
    ],
    ["a blank URL", { NEON_AUTH_BASE_URL: "   " }, "NEON_AUTH_BASE_URL is not set"],
    [
      "a short cookie secret",
      { NEON_AUTH_COOKIE_SECRET: "short" },
      "NEON_AUTH_COOKIE_SECRET is shorter than 32 characters",
    ],
    ["a blank allowlist", { OWNER_EMAIL_ALLOWLIST: " , " }, "OWNER_EMAIL_ALLOWLIST has no entries"],
  ])("rejects %s", (_name, override, problem) => {
    expect(loadAuthConfig({ ...valid, ...override })).toEqual({ ok: false, problems: [problem] });
  });

  it("never echoes setting values in its problems", () => {
    const result = loadAuthConfig({
      ...valid,
      NEON_AUTH_COOKIE_SECRET: "short-secret-value",
      NEON_AUTH_BASE_URL: "bad url value",
    });
    expect(JSON.stringify(result)).not.toContain("short-secret-value");
    expect(JSON.stringify(result)).not.toContain("bad url value");
  });
});
