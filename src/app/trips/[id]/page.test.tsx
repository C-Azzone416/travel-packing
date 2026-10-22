import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import TripPage, { metadata } from "./page";

describe("/trips/[id]", () => {
  it("is titled 'Packing list' and renders the trip screen for the id in the URL", async () => {
    expect(metadata.title).toBe("Packing list");
    const element = (await TripPage({
      params: Promise.resolve({ id: "san-diego" }),
    })) as ReactElement<{ tripId: string }>;
    expect(element.props.tripId).toBe("san-diego");
  });
});
