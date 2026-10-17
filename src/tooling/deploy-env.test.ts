import { describe, expect, it } from "vitest";
import {
  checkDeployEnv,
  checkMigrationTarget,
  hostOf,
  parseEnvFile,
  productionHost,
  PRODUCTION_HOST_FORMAT,
  REQUIRED,
} from "./deploy-env";

const PROD_HOST = "ep-prod-1.us-east-2.aws.neon.tech";
const good = {
  DATABASE_URL: "postgres://u:p@ep-prev-1-pooler.us-east-2.aws.neon.tech/db",
  DATABASE_URL_UNPOOLED: "postgres://u:p@ep-prev-1.us-east-2.aws.neon.tech/db",
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: "s".repeat(32),
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

  it("requires exactly these five variables (a name dropped from the list must fail here)", () => {
    expect([...REQUIRED]).toEqual([
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_AUTH_BASE_URL",
      "NEON_AUTH_COOKIE_SECRET",
      "OWNER_EMAIL_ALLOWLIST",
    ]);
  });

  it.each([
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "NEON_AUTH_BASE_URL",
    "NEON_AUTH_COOKIE_SECRET",
    "OWNER_EMAIL_ALLOWLIST",
  ])("reports %s when it is missing (literal list, independent of REQUIRED)", (name) => {
    expect(checkDeployEnv("production", { ...good, [name]: undefined }, undefined)).toContain(
      `${name} is not set`,
    );
  });

  it.each(["AUTH_E2E_FAKE", "AUTH_E2E_PASSWORD", "AUTH_E2E_STATE_DIR", "AUTH_E2E_SOMETHING_NEW"])(
    "refuses the whole AUTH_E2E_ family, not just the known names (%s)",
    (name) => {
      for (const target of ["preview", "production"] as const) {
        expect(checkDeployEnv(target, { ...good, [name]: "x" }, PROD_HOST)).toEqual([
          `${name} must not be set in a ${target} environment`,
        ]);
      }
    },
  );

  it("ignores an empty AUTH_E2E_ variable and names that merely contain the prefix", () => {
    expect(
      checkDeployEnv("production", { ...good, AUTH_E2E_X: " ", MY_AUTH_E2E_X: "1" }, undefined),
    ).toEqual([]);
  });

  it("reports a cookie secret shorter than the auth config's minimum", () => {
    const short = { ...good, NEON_AUTH_COOKIE_SECRET: "a".repeat(31) };
    expect(checkDeployEnv("production", short, undefined)).toEqual([
      "NEON_AUTH_COOKIE_SECRET is shorter than 32 characters, so sign-in would not work",
    ]);
    expect(
      checkDeployEnv("production", { ...good, NEON_AUTH_COOKIE_SECRET: "a".repeat(32) }, undefined),
    ).toEqual([]);
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
    "E2E_DATABASE_URL",
    "SEED_DATABASE_URL",
    "OPEN_METEO_GEOCODING_URL",
  ])("refuses %s in both environments, naming it but not its value", (name) => {
    for (const target of ["preview", "production"] as const) {
      const problems = checkDeployEnv(target, { ...good, [name]: "secret-value" }, PROD_HOST);
      expect(problems).toEqual([`${name} must not be set in a ${target} environment`]);
      expect(problems.join()).not.toContain("secret-value");
    }
  });

  it("lets production leave the location provider unset or use open-meteo, and nothing else", () => {
    const { LOCATION_PROVIDER: _unused, ...unset } = good;
    void _unused;
    expect(checkDeployEnv("production", unset, undefined)).toEqual([]);
    expect(
      checkDeployEnv("production", { ...good, LOCATION_PROVIDER: " open-meteo " }, undefined),
    ).toEqual([]);
    expect(checkDeployEnv("production", { ...good, LOCATION_PROVIDER: "fake" }, undefined)).toEqual(
      ["LOCATION_PROVIDER, when set, must be open-meteo"],
    );
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

  it.each([
    "postgres://u:p@ep-prod-1.us-east-2.aws.neon.tech/neondb",
    "https://ep-prod-1.us-east-2.aws.neon.tech",
    "ep-prod-1.us-east-2.aws.neon.tech/db",
    "user@ep-prod-1.us-east-2.aws.neon.tech",
    "ep-prod-1.us-east-2.aws.neon.tech:5432",
    "not a host",
    "-bad.example.test",
  ])(
    "refuses a PRODUCTION_DB_HOST that is not a bare host name (%s), so a preview cannot slip past",
    (value) => {
      const env = { ...good, DATABASE_URL: `postgres://u:p@${PROD_HOST}/db` };
      expect(checkDeployEnv("preview", env, value)).toEqual([PRODUCTION_HOST_FORMAT]);
    },
  );

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

describe("productionHost", () => {
  it("normalizes a bare host and reports missing / invalid", () => {
    expect(productionHost(" EP-Prod-POOLER.x.test. ")).toBe("ep-prod.x.test");
    expect(productionHost(undefined)).toBe("missing");
    expect(productionHost("   ")).toBe("missing");
    expect(productionHost("a/b")).toBe("invalid");
  });
});

describe("checkMigrationTarget", () => {
  const preview = "postgres://u:p@ep-prev-1.us-east-2.aws.neon.tech/db";
  const production = `postgres://u:p@${PROD_HOST}/db`;

  it("lets a preview migrate its own database and a production run migrate production", () => {
    expect(checkMigrationTarget("preview", preview, PROD_HOST)).toEqual([]);
    expect(checkMigrationTarget("production", production, PROD_HOST)).toEqual([]);
    expect(
      checkMigrationTarget(
        "production",
        `postgres://u:p@${PROD_HOST.replace("ep-prod-1", "EP-PROD-1-POOLER")}/db`,
        PROD_HOST,
      ),
    ).toEqual([]);
  });

  it("refuses a preview run whose secret points at production, in any spelling", () => {
    for (const url of [
      production,
      production.replace("ep-prod-1", "EP-PROD-1-pooler"),
      `${production}?sslmode=require`,
    ]) {
      expect(checkMigrationTarget("preview", url, PROD_HOST)).toEqual([
        "DATABASE_URL_UNPOOLED points at the production database host; a preview must not migrate or seed it",
      ]);
    }
  });

  it("refuses a production run whose secret points anywhere else", () => {
    expect(checkMigrationTarget("production", preview, PROD_HOST)).toEqual([
      "DATABASE_URL_UNPOOLED does not point at PRODUCTION_DB_HOST; production must migrate its own database",
    ]);
  });

  it("fails closed when the production host is unset or malformed, or the URL is missing or junk", () => {
    expect(checkMigrationTarget("preview", preview, undefined)).toEqual([
      "PRODUCTION_DB_HOST is not set, so the database target cannot be checked",
    ]);
    expect(checkMigrationTarget("preview", preview, `postgres://${PROD_HOST}/db`)).toEqual([
      PRODUCTION_HOST_FORMAT,
    ]);
    expect(checkMigrationTarget("preview", undefined, PROD_HOST)).toEqual([
      "DATABASE_URL_UNPOOLED is not set or is not a connection URL",
    ]);
    expect(checkMigrationTarget("production", "junk", PROD_HOST)).toHaveLength(1);
  });

  it("never prints the connection string or the host", () => {
    const lines = checkMigrationTarget("preview", production, PROD_HOST).join(" ");
    expect(lines).not.toContain(PROD_HOST);
    expect(lines).not.toContain("u:p");
  });
});
