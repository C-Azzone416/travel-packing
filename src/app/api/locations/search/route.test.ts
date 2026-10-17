import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/api/locations/search route", () => {
  it("exports a GET handler, and refuses a request with no session (auth is unconfigured in unit tests)", async () => {
    expect(typeof GET).toBe("function");
    const response = await GET(new Request("http://app.test/api/locations/search?q=London"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});
