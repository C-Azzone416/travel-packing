import { describe, expect, it } from "vitest";
import { APP_NAME } from "./app-name";

describe("APP_NAME", () => {
  it("is the product name", () => {
    expect(APP_NAME).toBe("Travel Packing");
  });
});
