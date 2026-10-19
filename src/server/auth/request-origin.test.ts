import { describe, expect, it } from "vitest";
import { resetPasswordUrl } from "./request-origin";

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
