import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREVIEW_ORIGIN, resetPasswordUrl } from "./request-origin";

const headers = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

describe("resetPasswordUrl", () => {
  it("builds the app's reset page from the host", () => {
    expect(resetPasswordUrl(headers({ host: "app.example.test" }))).toBe(
      "https://app.example.test/reset-password",
    );
  });

  it("prefers the forwarded host and protocol", () => {
    expect(
      resetPasswordUrl(
        headers({
          host: "internal:3000",
          "x-forwarded-host": "app.example.test, other",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://app.example.test/reset-password");
  });

  it("uses http for local hosts and honours an explicit http", () => {
    expect(resetPasswordUrl(headers({ host: "localhost:3102" }))).toBe(
      "http://localhost:3102/reset-password",
    );
    expect(resetPasswordUrl(headers({ host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000/reset-password",
    );
    expect(
      resetPasswordUrl(headers({ host: "app.example.test", "x-forwarded-proto": "http" })),
    ).toBe("http://app.example.test/reset-password");
    expect(
      resetPasswordUrl(headers({ host: "app.example.test", "x-forwarded-proto": "javascript" })),
    ).toBe("https://app.example.test/reset-password");
  });

  it("refuses a missing or odd host", () => {
    for (const host of ["", "bad host", "a/b", "evil.test/path", "x@y.test", "-bad.test"]) {
      expect(resetPasswordUrl(headers({ host }))).toBeNull();
    }
    expect(resetPasswordUrl(headers({}))).toBeNull();
  });
});

describe("the stable Preview origin (#96)", () => {
  const perDeployment = headers({
    host: "travel-packing-abc123-c-azzone416s-projects.vercel.app",
    "x-forwarded-host": "travel-packing-abc123-c-azzone416s-projects.vercel.app",
    "x-forwarded-proto": "https",
  });

  it("is the one stable address on Preview, whatever host the request arrived on", () => {
    expect(resetPasswordUrl(perDeployment, { VERCEL_ENV: "preview" })).toBe(
      "https://travel-packing-preview.vercel.app/reset-password",
    );
    expect(resetPasswordUrl(headers({ host: "evil.example" }), { VERCEL_ENV: "preview" })).toBe(
      "https://travel-packing-preview.vercel.app/reset-password",
    );
    expect(resetPasswordUrl(headers({}), { VERCEL_ENV: "preview" })).toBe(
      "https://travel-packing-preview.vercel.app/reset-password",
    );
  });

  it("is only used on Preview: production, local and unset environments keep deriving it from the request", () => {
    for (const env of [
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "development" },
      {},
      { VERCEL_ENV: "Preview" },
    ]) {
      expect(resetPasswordUrl(perDeployment, env)).toBe(
        "https://travel-packing-abc123-c-azzone416s-projects.vercel.app/reset-password",
      );
    }
  });

  it("is a bare https origin (no path, no trailing slash) on the vercel.app alias the workflow assigns", () => {
    expect(PREVIEW_ORIGIN).toMatch(/^https:\/\/[a-z0-9-]+\.vercel\.app$/);
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "deploy-vercel.yml"),
      "utf8",
    );
    const alias = /^ {2}PREVIEW_ALIAS: (\S+)/m.exec(workflow)?.[1];
    expect(`https://${alias}`).toBe(PREVIEW_ORIGIN);
  });
});
