import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import ReviewPage, { metadata } from "./page";

describe("/trips/[id]/review", () => {
  it("is titled 'Review your bag' and renders the review for the id in the URL", async () => {
    expect(metadata.title).toBe("Review your bag");
    const element = (await ReviewPage({
      params: Promise.resolve({ id: "san-diego" }),
    })) as ReactElement<{ tripId: string }>;
    expect(element.props.tripId).toBe("san-diego");
  });
});
