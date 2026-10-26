import { describe, expect, it } from "vitest";
import { hasSameRequestOrigin } from "./csrf";

const requestHeaders = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("hasSameRequestOrigin", () => {
  it("accepts an exact browser Origin and forwarded host", () => {
    expect(
      hasSameRequestOrigin(
        requestHeaders({
          origin: "https://app.example.test",
          "x-forwarded-host": "app.example.test",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["missing Origin", { host: "app.example.test" }],
    ["another host", { origin: "https://evil.example.test", host: "app.example.test" }],
    [
      "a deceptive suffix",
      { origin: "https://app.example.test.evil.test", host: "app.example.test" },
    ],
    [
      "credentials in the URL",
      { origin: "https://name@app.example.test", host: "app.example.test" },
    ],
    ["a non-http scheme", { origin: "javascript:alert(1)", host: "app.example.test" }],
  ])("rejects %s", (_name, values) => {
    expect(hasSameRequestOrigin(requestHeaders(values))).toBe(false);
  });
});
