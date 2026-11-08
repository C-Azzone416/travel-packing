import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import TripPage, { generateMetadata } from "./page";
import { ReviewScreen } from "@/features/trip/ReviewScreen";

describe("/trips/[id]", () => {
  it("is titled 'Packing list' and renders the trip screen for the id in the URL", async () => {
    expect(await generateMetadata({})).toEqual({ title: "Packing list" });
    const element = (await TripPage({
      params: Promise.resolve({ id: "san-diego" }),
    })) as ReactElement<{ tripId: string }>;
    expect(element.props.tripId).toBe("san-diego");
  });

  it("passes ?edit=<item id> to the screen as the item whose editor opens, and nothing otherwise", async () => {
    const render = async (searchParams?: { edit?: string | string[] }) =>
      (await TripPage({
        params: Promise.resolve({ id: "san-diego" }),
        searchParams: searchParams ? Promise.resolve(searchParams) : undefined,
      })) as ReactElement<{ tripId: string; openItemId?: string }>;
    expect((await render({ edit: "sunglasses" })).props.openItemId).toBe("sunglasses");
    expect((await render({})).props.openItemId).toBeUndefined();
    expect((await render()).props.openItemId).toBeUndefined();
    expect((await render({ edit: ["a", "b"] })).props.openItemId).toBeUndefined();
    expect((await render({ edit: "" })).props.openItemId).toBeUndefined();
  });

  it("?review=1 (where /trips/[id]/review forwards, #389) shows the Ready final check, titled 'Review your bag'", async () => {
    const element = (await TripPage({
      params: Promise.resolve({ id: "san-diego" }),
      searchParams: Promise.resolve({ review: "1" }),
    })) as ReactElement<{ tripId: string }>;
    expect(element.type).toBe(ReviewScreen);
    expect(element.props.tripId).toBe("san-diego");
    expect(await generateMetadata({ searchParams: Promise.resolve({ review: "1" }) })).toEqual({
      title: "Review your bag",
    });
  });

  it("any other ?review value, or none, is the Packing page and its title", async () => {
    for (const review of ["0", "", ["1", "1"], undefined]) {
      const element = (await TripPage({
        params: Promise.resolve({ id: "san-diego" }),
        searchParams: Promise.resolve({ review }),
      })) as ReactElement<{ tripId: string }>;
      expect(element.type).not.toBe(ReviewScreen);
      expect(await generateMetadata({ searchParams: Promise.resolve({ review }) })).toEqual({
        title: "Packing list",
      });
    }
    expect(await generateMetadata({})).toEqual({ title: "Packing list" });
  });
});
