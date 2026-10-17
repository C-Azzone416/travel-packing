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
