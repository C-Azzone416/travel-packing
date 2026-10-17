import { describe, expect, it } from "vitest";
import { assertSeedAllowed, SeedRefused } from "./guard";

const SEED_URL = "postgres://user:pw@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb";
const SAME_DB_DIRECT = "postgres://app:secret@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb";
const SAME_DB_POOLED =
  "postgres://app:secret@ep-dev-branch-123-pooler.us-west-2.aws.neon.tech/devdb";

function refusal(fn: () => void): SeedRefused {
  try {
    fn();
  } catch (error) {
    return error as SeedRefused;
  }
  throw new Error("expected the seed to be refused");
}

describe("assertSeedAllowed", () => {
  it("allows a local database outside production", () => {
    expect(() => assertSeedAllowed({})).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
  });

  it("allows a remote database that is not the app's own", () => {
    expect(() => assertSeedAllowed({}, SEED_URL)).not.toThrow();
    expect(() =>
      assertSeedAllowed(
        { DATABASE_URL: "postgres://app:secret@ep-other-456.us-west-2.aws.neon.tech/prod" },
        SEED_URL,
      ),
    ).not.toThrow();
  });

  describe("refuses to run against production", () => {
    it("when NODE_ENV is production, local or remote", () => {
      expect(refusal(() => assertSeedAllowed({ NODE_ENV: "production" })).message).toContain(
        "NODE_ENV is production",
      );
      expect(refusal(() => assertSeedAllowed({ NODE_ENV: "production" }, SEED_URL))).toBeInstanceOf(
        SeedRefused,
      );
    });

    it.each([
      ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
      ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
      ["any Vercel runtime", { VERCEL: "1" }],
    ])("on a Vercel %s runtime", (_name, env) => {
      expect(refusal(() => assertSeedAllowed(env)).message).toContain("Vercel");
      expect(refusal(() => assertSeedAllowed(env, SEED_URL))).toBeInstanceOf(SeedRefused);
    });

    it("when the target is the app's own DATABASE_URL, in either host spelling", () => {
      expect(
        refusal(() => assertSeedAllowed({ DATABASE_URL: SAME_DB_DIRECT }, SEED_URL)).message,
      ).toContain("DATABASE_URL");
      expect(
        refusal(() => assertSeedAllowed({ DATABASE_URL: SAME_DB_POOLED }, SEED_URL)),
      ).toBeInstanceOf(SeedRefused);
      expect(
        refusal(() => assertSeedAllowed({ DATABASE_URL: SAME_DB_DIRECT }, SAME_DB_POOLED)),
      ).toBeInstanceOf(SeedRefused);
    });

    it("when the target is the unpooled migration database", () => {
      const error = refusal(() =>
        assertSeedAllowed({ DATABASE_URL_UNPOOLED: SAME_DB_DIRECT }, SEED_URL),
      );
      expect(error.message).toContain("DATABASE_URL_UNPOOLED");
    });

    it("but a different database name on the same host is a different database", () => {
      expect(() =>
        assertSeedAllowed({ DATABASE_URL: SAME_DB_DIRECT.replace("devdb", "prod") }, SEED_URL),
      ).not.toThrow();
    });

    describe("every spelling of the app's own database is refused", () => {
      // The app's DATABASE_URL, and the same database written differently as SEED_DATABASE_URL.
      const app = "postgres://app:secret@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb";
      it.each([
        ["an upper-case host", "postgres://u:p@EP-DEV-BRANCH-123.US-WEST-2.AWS.NEON.TECH/devdb"],
        ["a mixed-case host", "postgres://u:p@Ep-Dev-Branch-123.us-west-2.aws.neon.tech/devdb"],
        [
          "an upper-case -POOLER",
          "postgres://u:p@ep-dev-branch-123-POOLER.us-west-2.aws.neon.tech/devdb",
        ],
        ["a trailing-dot host", "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech./devdb"],
        [
          "several trailing dots",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech.../devdb",
        ],
        [
          "a trailing slash on the path",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb/",
        ],
        [
          "a doubled leading slash",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech//devdb",
        ],
        [
          "a percent-encoded database name",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech/dev%64b",
        ],
        [
          "percent-encoded host letters",
          "postgres://u:p@%65p-dev-branch-123.us-west-2.aws.neon.tech/devdb",
        ],
        [
          "a different user and password",
          "postgres://other:different@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb",
        ],
        ["an explicit port", "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech:5432/devdb"],
        [
          "extra query parameters",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb?sslmode=require",
        ],
      ])("%s", (_name, seedUrl) => {
        expect(refusal(() => assertSeedAllowed({ DATABASE_URL: app }, seedUrl)).message).toContain(
          "DATABASE_URL",
        );
        expect(
          refusal(() => assertSeedAllowed({ DATABASE_URL_UNPOOLED: app }, seedUrl)).message,
        ).toContain("DATABASE_URL_UNPOOLED");
      });

      it("the app URL may be the one spelled oddly", () => {
        const odd =
          "postgres://app:secret@EP-DEV-BRANCH-123-Pooler.us-west-2.aws.neon.tech./devdb/";
        expect(refusal(() => assertSeedAllowed({ DATABASE_URL: odd }, SEED_URL))).toBeInstanceOf(
          SeedRefused,
        );
      });
    });

    describe("but different databases are not over-refused", () => {
      const app = "postgres://app:secret@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb";
      it.each([
        [
          "the same database name on a different host",
          "postgres://u:p@ep-other-999.us-west-2.aws.neon.tech/devdb",
        ],
        [
          "the same host with a different database",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech/otherdb",
        ],
        [
          "a database name that differs only in case (Postgres names are case-sensitive)",
          "postgres://u:p@ep-dev-branch-123.us-west-2.aws.neon.tech/DEVDB",
        ],
        [
          "a host that merely contains the app host",
          "postgres://u:p@x.ep-dev-branch-123.us-west-2.aws.neon.tech/devdb",
        ],
        [
          "a host that merely starts like the app host",
          "postgres://u:p@ep-dev-branch-1234.us-west-2.aws.neon.tech/devdb",
        ],
      ])("%s", (_name, seedUrl) => {
        expect(() => assertSeedAllowed({ DATABASE_URL: app }, seedUrl)).not.toThrow();
      });
    });

    describe("a URL that overrides its own host or database in the query string is refused", () => {
      it.each([
        ["host", "postgres://u:p@localhost/db?host=prod.example.test"],
        ["hostaddr", "postgres://u:p@localhost/db?hostaddr=10.0.0.5"],
        ["dbname", "postgres://u:p@ep-x.us-west-2.aws.neon.tech/db?dbname=prod"],
        ["service", "postgres://u:p@localhost/db?service=production"],
      ])("%s", (_name, seedUrl) => {
        expect(refusal(() => assertSeedAllowed({}, seedUrl)).message).toContain(
          "must not override",
        );
      });

      it("still allows harmless query parameters", () => {
        expect(() =>
          assertSeedAllowed({}, `${SEED_URL}?sslmode=require&connect_timeout=5`),
        ).not.toThrow();
      });
    });

    it("when the target URL is not a valid connection URL", () => {
      expect(refusal(() => assertSeedAllowed({}, "not a url")).message).toContain(
        "not a valid connection URL",
      );
    });
  });

  it("never echoes a connection string, its host, or its credentials", () => {
    const errors = [
      refusal(() => assertSeedAllowed({ DATABASE_URL: SAME_DB_DIRECT }, SEED_URL)),
      refusal(() => assertSeedAllowed({}, "not a url secret-token")),
      refusal(() => assertSeedAllowed({ NODE_ENV: "production" }, SEED_URL)),
    ];
    for (const error of errors) {
      expect(error.message).not.toMatch(/neon\.tech|secret|pw@|devdb|secret-token/);
    }
  });

  it("is a named error with a stable prefix", () => {
    const error = refusal(() => assertSeedAllowed({ NODE_ENV: "production" }));
    expect(error.name).toBe("SeedRefused");
    expect(error.message.startsWith("db:seed refused: ")).toBe(true);
  });
});
