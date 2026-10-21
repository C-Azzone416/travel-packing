import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import TripPage, { metadata } from "./page";

describe("/trips/[id]", () => {
  it("is titled 'Packing list' and renders the trip screen for the id in the URL", async () => {
    expect(metadata.title).toBe("Packing list");
    const element = (await TripPage({
      params: Promise.resolve({ id: "san-diego" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ tripId: string; openAdd: boolean }>;
    expect(element.props.tripId).toBe("san-diego");
    expect(element.props.openAdd).toBe(false);
  });

  it("asks for the add form open only for ?add=item (the dashboard's + Add item)", async () => {
    const open = async (add?: string) =>
      (
        (await TripPage({
          params: Promise.resolve({ id: "san-diego" }),
          searchParams: Promise.resolve({ add }),
        })) as ReactElement<{ openAdd: boolean }>
      ).props.openAdd;
    expect(await open("item")).toBe(true);
    expect(await open("other")).toBe(false);
  });
});
