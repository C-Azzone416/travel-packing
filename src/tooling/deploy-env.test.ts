import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkDeployEnv,
  checkMigrationTarget,
  hostOf,
  parseBuildEnvFile,
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

// A production environment: both connection strings on the production host.
const production = {
  ...good,
  DATABASE_URL: `postgres://u:p@${PROD_HOST.replace("ep-prod-1", "ep-prod-1-pooler")}/db`,
  DATABASE_URL_UNPOOLED: `postgres://u:p@${PROD_HOST}/db`,
};

describe("checkDeployEnv: screenshots (#130)", () => {
  it("fails a production environment that switches screenshots on, naming the variable only", () => {
    const problems = checkDeployEnv(
      "production",
      { ...production, FEEDBACK_SCREENSHOTS: "1" },
      PROD_HOST,
    );
    expect(problems).toEqual([expect.stringContaining("FEEDBACK_SCREENSHOTS must be unset or 0")]);
  });

  it("accepts production with screenshots off, and a preview with them on", () => {
    expect(
      checkDeployEnv("production", { ...production, FEEDBACK_SCREENSHOTS: "0" }, PROD_HOST),
    ).toEqual([]);
    expect(checkDeployEnv("preview", { ...good, FEEDBACK_SCREENSHOTS: "1" }, PROD_HOST)).toEqual(
      [],
    );
  });
});

describe("checkDeployEnv", () => {
  it("accepts a complete preview environment on its own database", () => {
    expect(checkDeployEnv("preview", good, PROD_HOST)).toEqual([]);
  });

  it("accepts a production environment without a location provider override", () => {
    const { LOCATION_PROVIDER: _unused, ...withoutProvider } = production;
    void _unused;
    expect(checkDeployEnv("production", withoutProvider, PROD_HOST)).toEqual([]);
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
    expect(checkDeployEnv("production", { ...production, [name]: undefined }, PROD_HOST)).toContain(
      `${name} is not set`,
    );
  });

  it.each(["AUTH_E2E_FAKE", "AUTH_E2E_PASSWORD", "AUTH_E2E_STATE_DIR", "AUTH_E2E_SOMETHING_NEW"])(
    "refuses the whole AUTH_E2E_ family, not just the known names (%s)",
    (name) => {
      for (const target of ["preview", "production"] as const) {
        expect(
          checkDeployEnv(
            target,
            { ...(target === "production" ? production : good), [name]: "x" },
            PROD_HOST,
          ),
        ).toEqual([`${name} must not be set in a ${target} environment`]);
      }
    },
  );

  it("ignores an empty AUTH_E2E_ variable and names that merely contain the prefix", () => {
    expect(
      checkDeployEnv(
        "production",
        { ...production, AUTH_E2E_X: " ", MY_AUTH_E2E_X: "1" },
        PROD_HOST,
      ),
    ).toEqual([]);
  });

  it("reports a cookie secret shorter than the auth config's minimum", () => {
    const short = { ...production, NEON_AUTH_COOKIE_SECRET: "a".repeat(31) };
    expect(checkDeployEnv("production", short, PROD_HOST)).toEqual([
      "NEON_AUTH_COOKIE_SECRET is shorter than 32 characters, so sign-in would not work",
    ]);
    expect(
      checkDeployEnv(
        "production",
        { ...production, NEON_AUTH_COOKIE_SECRET: "a".repeat(32) },
        PROD_HOST,
      ),
    ).toEqual([]);
  });

  it.each(REQUIRED)("reports %s when it is missing or blank", (name) => {
    expect(checkDeployEnv("production", { ...production, [name]: "  " }, PROD_HOST)).toEqual([
      `${name} is not set`,
    ]);
    expect(checkDeployEnv("production", { ...production, [name]: undefined }, PROD_HOST)).toEqual([
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
      const problems = checkDeployEnv(
        target,
        { ...(target === "production" ? production : good), [name]: "secret-value" },
        PROD_HOST,
      );
      expect(problems).toEqual([`${name} must not be set in a ${target} environment`]);
      expect(problems.join()).not.toContain("secret-value");
    }
  });

  it("lets production leave the location provider unset or use open-meteo, and nothing else", () => {
    const { LOCATION_PROVIDER: _unused, ...unset } = production;
    void _unused;
    expect(checkDeployEnv("production", unset, PROD_HOST)).toEqual([]);
    expect(
      checkDeployEnv("production", { ...production, LOCATION_PROVIDER: " open-meteo " }, PROD_HOST),
    ).toEqual([]);
    expect(
      checkDeployEnv("production", { ...production, LOCATION_PROVIDER: "fake" }, PROD_HOST),
    ).toEqual(["LOCATION_PROVIDER, when set, must be open-meteo"]);
  });

  it("makes production prove it is on its own database: both strings on PRODUCTION_DB_HOST", () => {
    expect(checkDeployEnv("production", production, PROD_HOST)).toEqual([]);
    expect(
      checkDeployEnv("production", { ...production, DATABASE_URL: good.DATABASE_URL }, PROD_HOST),
    ).toEqual([
      "DATABASE_URL does not point at PRODUCTION_DB_HOST; production must use its own database",
    ]);
    expect(
      checkDeployEnv(
        "production",
        { ...production, DATABASE_URL_UNPOOLED: good.DATABASE_URL_UNPOOLED },
        PROD_HOST,
      ),
    ).toEqual([
      "DATABASE_URL_UNPOOLED does not point at PRODUCTION_DB_HOST; production must use its own database",
    ]);
  });

  it("fails production closed when PRODUCTION_DB_HOST is unset or not a bare host name", () => {
    expect(checkDeployEnv("production", production, undefined)).toEqual([
      "PRODUCTION_DB_HOST is not set, so production cannot confirm its database",
    ]);
    expect(checkDeployEnv("production", production, `postgres://${PROD_HOST}/db`)).toEqual([
      PRODUCTION_HOST_FORMAT,
    ]);
  });

  it("does not double-report a missing connection string in production", () => {
    expect(
      checkDeployEnv("production", { ...production, DATABASE_URL: undefined }, PROD_HOST),
    ).toEqual(["DATABASE_URL is not set"]);
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
    "user@example.test",
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

describe("checkDeployEnv: values that vercel pull could not read", () => {
  const MARKER = "[SENSITIVE]";

  it.each(REQUIRED)(
    "rejects Vercel's redaction marker for %s, naming only the variable",
    (name) => {
      for (const marker of [MARKER, `  ${MARKER} `, MARKER.toLowerCase()]) {
        const problems = checkDeployEnv("preview", { ...good, [name]: marker }, PROD_HOST);
        expect(problems).toEqual([
          `${name} is Vercel's redaction marker (a Secret that vercel pull cannot read); the real value must be injected first`,
        ]);
      }
    },
  );

  it("reports every redacted variable at once", () => {
    const all = Object.fromEntries(REQUIRED.map((name) => [name, MARKER]));
    const problems = checkDeployEnv("preview", { ...good, ...all }, PROD_HOST);
    expect(problems).toHaveLength(REQUIRED.length);
  });

  it("does not also complain that the marker is too short or not a URL", () => {
    const problems = checkDeployEnv(
      "preview",
      { ...good, NEON_AUTH_COOKIE_SECRET: MARKER },
      PROD_HOST,
    );
    expect(problems.join("\n")).not.toMatch(/shorter/);
  });

  it.each(["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const)(
    "requires %s to be a Postgres connection URL",
    (name) => {
      for (const value of [
        "not a url",
        "ep-prev-1.us-east-2.aws.neon.tech/db",
        "https://ep-prev-1.us-east-2.aws.neon.tech/db",
        "mysql://u:p@ep-prev-1.us-east-2.aws.neon.tech/db",
        "postgres:///db",
      ]) {
        expect(checkDeployEnv("preview", { ...good, [name]: value }, PROD_HOST)).toEqual([
          `${name} is not a Postgres connection URL`,
        ]);
      }
      expect(
        checkDeployEnv(
          "preview",
          { ...good, [name]: "postgresql://u:p@ep-prev-1.x.test/db" },
          PROD_HOST,
        ),
      ).toEqual([]);
    },
  );

  it("never prints the value of an unparseable URL", () => {
    const problems = checkDeployEnv(
      "preview",
      { ...good, DATABASE_URL: "secret-garbage-value" },
      PROD_HOST,
    );
    expect(problems.join("\n")).not.toContain("secret-garbage-value");
  });

  it("still catches a preview database on the production host", () => {
    const onProd = { ...good, DATABASE_URL_UNPOOLED: `postgres://u:p@${PROD_HOST}/db` };
    expect(checkDeployEnv("preview", onProd, PROD_HOST)).toEqual([
      "DATABASE_URL_UNPOOLED points at the production database host; previews must use their own",
    ]);
  });

  it.each([
    ["a single well-formed email", "a@example.test", true],
    ["several emails with spaces around the commas", "a@example.test , b@example.test", true],
    ["an empty list", "", false],
    ["only commas", ",", false],
    ["a trailing comma", "a@example.test,", false],
    ["a doubled comma", "a@example.test,,b@example.test", false],
    ["an entry with no @", "a.example.test", false],
    ["an entry with no domain dot", "a@localhost", false],
    ["whitespace instead of commas", "a@example.test b@example.test", false],
    ["semicolons instead of commas", "a@example.test;b@example.test", false],
    ["a display-name style entry", "Name <a@example.test>", false],
    ["an entry wrapped in double quotes", '"a@example.test"', false],
    ["an entry wrapped in single quotes", "'a@example.test'", false],
    ["an entry wrapped in angle brackets", "<a@example.test>", false],
    ["an entry with a mailto: prefix", "mailto:a@example.test", false],
    ["one good and one quoted entry", 'a@example.test,"b@example.test"', false],
    ["plus-addressing and a subdomain", "first.last+tag@sub.example.test", true],
  ])("validates OWNER_EMAIL_ALLOWLIST: %s", (_name, value, ok) => {
    const problems = checkDeployEnv(
      "preview",
      { ...good, OWNER_EMAIL_ALLOWLIST: value },
      PROD_HOST,
    );
    if (ok) expect(problems).toEqual([]);
    else if (value.trim() === "") expect(problems).toEqual(["OWNER_EMAIL_ALLOWLIST is not set"]);
    else if (/,\s*(,|$)|^\s*,/.test(value)) {
      expect(problems).toEqual(["OWNER_EMAIL_ALLOWLIST has an empty entry (check the commas)"]);
    } else {
      expect(problems).toEqual([
        "OWNER_EMAIL_ALLOWLIST has an entry that is not a well-formed email address",
      ]);
    }
  });

  it("never prints an email address from the allowlist", () => {
    const problems = checkDeployEnv(
      "preview",
      { ...good, OWNER_EMAIL_ALLOWLIST: "secret.person@example.test," },
      PROD_HOST,
    );
    expect(problems.join("\n")).not.toMatch(/secret\.person|example\.test/);
  });

  it("requires NEON_AUTH_COOKIE_SECRET to be at least 32 characters", () => {
    expect(
      checkDeployEnv("preview", { ...good, NEON_AUTH_COOKIE_SECRET: "s".repeat(31) }, PROD_HOST),
    ).toEqual(["NEON_AUTH_COOKIE_SECRET is shorter than 32 characters, so sign-in would not work"]);
    expect(
      checkDeployEnv("preview", { ...good, NEON_AUTH_COOKIE_SECRET: "s".repeat(32) }, PROD_HOST),
    ).toEqual([]);
  });
});

describe("checkDeployEnv: Production receives the same strict secret validation", () => {
  const M = "[SENSITIVE]";
  const prodBase = {
    DATABASE_URL: "postgres://u:p@ep-prod-1-pooler.us-east-2.aws.neon.tech/db",
    DATABASE_URL_UNPOOLED: `postgres://u:p@${PROD_HOST}/db`,
    NEON_AUTH_BASE_URL: "https://auth.example.test",
    NEON_AUTH_COOKIE_SECRET: "s".repeat(32),
    OWNER_EMAIL_ALLOWLIST: "a@example.test",
  };
  const onProductionHost =
    "does not point at PRODUCTION_DB_HOST; production must use its own database";
  const tooShort =
    "NEON_AUTH_COOKIE_SECRET is shorter than 32 characters, so sign-in would not work";
  const marker = (name: string) =>
    `${name} is Vercel's redaction marker (a Secret that vercel pull cannot read); the real value must be injected first`;

  it.each([
    ["a good environment", prodBase, []],
    [
      "every variable the marker",
      Object.fromEntries(Object.keys(prodBase).map((name) => [name, M])),
      Object.keys(prodBase).map(marker),
    ],
    [
      "the database URLs the marker",
      { ...prodBase, DATABASE_URL: M, DATABASE_URL_UNPOOLED: M },
      [marker("DATABASE_URL"), marker("DATABASE_URL_UNPOOLED")],
    ],
    [
      "the cookie secret the marker",
      { ...prodBase, NEON_AUTH_COOKIE_SECRET: M },
      [marker("NEON_AUTH_COOKIE_SECRET")],
    ],
    [
      "the allowlist the marker",
      { ...prodBase, OWNER_EMAIL_ALLOWLIST: M },
      [marker("OWNER_EMAIL_ALLOWLIST")],
    ],
    [
      "unparseable database URLs",
      { ...prodBase, DATABASE_URL: "garbage", DATABASE_URL_UNPOOLED: "https://x.test/db" },
      [
        "DATABASE_URL is not a Postgres connection URL",
        "DATABASE_URL_UNPOOLED is not a Postgres connection URL",
      ],
    ],
    [
      "a malformed allowlist",
      { ...prodBase, OWNER_EMAIL_ALLOWLIST: "not-an-email,,;" },
      ["OWNER_EMAIL_ALLOWLIST has an empty entry (check the commas)"],
    ],
    ["a short cookie secret", { ...prodBase, NEON_AUTH_COOKIE_SECRET: "short" }, [tooShort]],
    [
      "a database URL on another host",
      { ...prodBase, DATABASE_URL: "postgres://u:p@ep-other-9.x.test/db" },
      [`DATABASE_URL ${onProductionHost}`],
    ],
  ])("%s", (_name, env, expected) => {
    expect(checkDeployEnv("production", env, PROD_HOST)).toEqual(expected);
  });

  it("rejects redacted Secrets for both targets", () => {
    expect(
      checkDeployEnv("production", { ...production, OWNER_EMAIL_ALLOWLIST: M }, PROD_HOST),
    ).toEqual([marker("OWNER_EMAIL_ALLOWLIST")]);
    expect(checkDeployEnv("preview", { ...good, OWNER_EMAIL_ALLOWLIST: M }, PROD_HOST)).toEqual([
      marker("OWNER_EMAIL_ALLOWLIST"),
    ]);
  });
});

describe("parseEnvFile (production's reader, unchanged)", () => {
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

describe("parseBuildEnvFile (reads the file the way vercel build's dotenv 4 reader does)", () => {
  it("reads quoted and bare values, skips comments and junk, and does not treat `export` as an assignment", () => {
    const text = [
      "# comment",
      'A="one"',
      "B='two'",
      "C=three",
      "export D=four",
      "not a line",
      'E=""',
      'F="',
      "G = spaced  ",
    ].join("\r\n");
    expect(parseBuildEnvFile(text)).toEqual({
      A: "one",
      B: "two",
      C: "three",
      E: "",
      F: "",
      G: "spaced",
    });
  });

  it("turns \\n into a newline inside double quotes only, and strips one quote from each end", () => {
    expect(
      parseBuildEnvFile('A="x\\ny"\nB=x\\ny\nC=\'x\\ny\'\nD=""q""\nE="$HOME #not-a-comment"'),
    ).toEqual({
      A: "x\ny",
      B: "x\\ny",
      C: "x\\ny",
      D: '"q"',
      E: "$HOME #not-a-comment",
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

describe("scripts/check-deploy-env.ts reads both targets exactly as vercel build does", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-env-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const script = join(process.cwd(), "scripts", "check-deploy-env.ts");

  const envFile = (prefix: string, url: string, unpooled: string) =>
    [
      `${prefix}DATABASE_URL="${url}"`,
      `${prefix}DATABASE_URL_UNPOOLED="${unpooled}"`,
      `${prefix}NEON_AUTH_BASE_URL="https://auth.example.test"`,
      `${prefix}NEON_AUTH_COOKIE_SECRET="${"s".repeat(32)}"`,
      `${prefix}OWNER_EMAIL_ALLOWLIST="a@example.test"`,
      `${prefix}LOCATION_PROVIDER="open-meteo"`,
    ].join("\n");

  function run(target: string, text: string, host: string) {
    const file = join(dir, `${target}.env`);
    writeFileSync(file, text);
    return spawnSync(tsx, [script, target, file], {
      env: { PATH: process.env.PATH, PRODUCTION_DB_HOST: host } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
  }

  it.each([
    ["production", PROD_HOST],
    ["preview", "ep-prev-1.x.test"],
  ])("%s accepts ordinary assignments", (target, host) => {
    const result = run(
      target,
      envFile("", `postgres://u:p@${host}/db`, `postgres://u:p@${host}/db`),
      PROD_HOST,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`deploy env: ok for ${target}\n`);
  });

  it.each(["preview", "production"])(
    "%s rejects export lines because vercel build does not read them as assignments",
    (target) => {
      const host = target === "production" ? PROD_HOST : "ep-prev-1.x.test";
      const result = run(
        target,
        envFile("export ", `postgres://u:p@${host}/db`, `postgres://u:p@${host}/db`),
        PROD_HOST,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("DATABASE_URL is not set");
    },
  );
});
