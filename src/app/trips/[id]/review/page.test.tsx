import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewPage from "./page";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

describe("/trips/[id]/review", () => {
  beforeEach(() => redirect.mockClear());

  it("redirects the legacy URL to Packing with the Ready review requested", async () => {
    await ReviewPage({ params: Promise.resolve({ id: "san-diego" }) });
    expect(redirect).toHaveBeenCalledWith("/trips/san-diego?review=1");
  });
});
