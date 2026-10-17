import { describe, expect, it } from "vitest";
import { checkDeployEnv, hostOf, parseEnvFile, REQUIRED } from "./deploy-env";

const PROD_HOST = "ep-prod-1.us-east-2.aws.neon.tech";
const good = {
  DATABASE_URL: "postgres://u:p@ep-prev-1-pooler.us-east-2.aws.neon.tech/db",
  DATABASE_URL_UNPOOLED: "postgres://u:p@ep-prev-1.us-east-2.aws.neon.tech/db",
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: "x",
  OWNER_EMAIL_ALLOWLIST: "a@example.test",
  LOCATION_PROVIDER: "open-meteo",
};

describe("checkDeployEnv", () => {
  it("accepts a complete preview environment on its own database", () => {
    expect(checkDeployEnv("preview", good, PROD_HOST)).toEqual([]);
  });

  it("accepts a production environment without a location provider override", () => {
    const { LOCATION_PROVIDER: _unused, ...production } = good;
    void _unused;
    expect(checkDeployEnv("production", production, undefined)).toEqual([]);
  });

  it.each(REQUIRED)("reports %s when it is missing or blank", (name) => {
    expect(checkDeployEnv("production", { ...good, [name]: "  " }, undefined)).toEqual([
      `${name} is not set`,
    ]);
    expect(checkDeployEnv("production", { ...good, [name]: undefined }, undefined)).toEqual([
      `${name} is not set`,
    ]);
  });

  it.each([
    "NEXT_PUBLIC_E2E_BUILD",
    "AUTH_E2E_FAKE",
    "AUTH_E2E_PASSWORD",
    "AUTH_E2E_STATE_DIR",
    "E2E_DATABASE_URL",
    "SEED_DATABASE_URL",
  ])("refuses %s in both environments, naming it but not its value", (name) => {
    for (const target of ["preview", "production"] as const) {
      const problems = checkDeployEnv(target, { ...good, [name]: "secret-value" }, PROD_HOST);
      expect(problems).toEqual([`${name} must not be set in a ${target} environment`]);
      expect(problems.join()).not.toContain("secret-value");
    }
  });

  it("requires open-meteo for previews", () => {
    expect(checkDeployEnv("preview", { ...good, LOCATION_PROVIDER: "other" }, PROD_HOST)).toEqual([
      "LOCATION_PROVIDER must be open-meteo in a preview environment",
    ]);
    expect(
      checkDeployEnv("preview", { ...good, LOCATION_PROVIDER: undefined }, PROD_HOST),
    ).toHaveLength(1);
  });

  it("refuses a preview that cannot prove it avoids production", () => {
    expect(checkDeployEnv("preview", good, undefined)).toEqual([
      "PRODUCTION_DB_HOST is not set, so a preview cannot prove it avoids production",
    ]);
  });

  it("refuses a preview pointing at the production host, pooled or direct, in any spelling", () => {
    const env = {
      ...good,
      DATABASE_URL: "postgres://u:p@EP-PROD-1-POOLER.us-east-2.aws.neon.tech./db",
      DATABASE_URL_UNPOOLED: `postgres://u:p@${PROD_HOST}/db`,
    };
    expect(checkDeployEnv("preview", env, PROD_HOST)).toEqual([
      "DATABASE_URL points at the production database host; previews must use their own",
      "DATABASE_URL_UNPOOLED points at the production database host; previews must use their own",
    ]);
  });

  it("does not treat a look-alike host as production", () => {
    const env = { ...good, DATABASE_URL: `postgres://u:p@x-${PROD_HOST}/db` };
    expect(checkDeployEnv("preview", env, PROD_HOST)).toEqual([]);
  });
});

describe("hostOf", () => {
  it("normalizes case, trailing dots and -pooler", () => {
    expect(hostOf("postgres://u:p@EP-A-POOLER.x.test./db")).toBe("ep-a.x.test");
  });
  it("returns null for nothing or a non-URL", () => {
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("parseEnvFile", () => {
  it("reads quoted and bare values, skips comments and junk, strips export", () => {
    const text = [
      "# comment",
      'A="one"',
      "B='two'",
      "C=three",
      "export D=four",
      "not a line",
      'E=""',
      'F="',
    ].join("\r\n");
    expect(parseEnvFile(text)).toEqual({
      A: "one",
      B: "two",
      C: "three",
      D: "four",
      E: "",
      F: '"',
    });
  });
});
