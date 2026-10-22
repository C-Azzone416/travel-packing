// The link from the dashboard's "Edit quantity" to an item's editor on the trip screen (#166).

/** An item id is a short token (a uuid, or `saved:<list>:<item>`); anything else in `?edit=` is ignored. */
const MAX_ITEM_ID = 200;

/** The trip screen's URL that opens that item's editor on load. */
export const editItemHref = (tripId: string, itemId: string): string =>
  `/trips/${tripId}?edit=${encodeURIComponent(itemId)}`;

/** The item id in `?edit=`: exactly one non-empty, short value, or nothing. */
export function itemIdFromQuery(edit: string | string[] | undefined): string | undefined {
  return typeof edit === "string" && edit !== "" && edit.length <= MAX_ITEM_ID ? edit : undefined;
}
