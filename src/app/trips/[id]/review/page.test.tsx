import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn<(to: string) => never>());
vi.mock("next/navigation", () => ({ redirect }));

import ReviewPage from "./page";

describe("/trips/[id]/review", () => {
  beforeEach(() => {
    redirect.mockReset();
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("forwards to the Packing page with ?review=1", async () => {
    await expect(ReviewPage({ params: Promise.resolve({ id: "san-diego" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirect.mock.calls.map((call) => call[0])).toEqual(["/trips/san-diego?review=1"]);
  });

  it("encodes an id that is not a plain token", async () => {
    await expect(ReviewPage({ params: Promise.resolve({ id: "a/b?c" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirect.mock.calls.map((call) => call[0])).toEqual(["/trips/a%2Fb%3Fc?review=1"]);
  });
});
