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
});
