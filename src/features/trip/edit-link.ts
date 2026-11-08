// `?edit=` on the trip screen opens that item's editor (#166).

/** An item id is a short token (a uuid, or `saved:<list>:<item>`); anything else in `?edit=` is ignored. */
const MAX_ITEM_ID = 200;

/** The item id in `?edit=`: exactly one non-empty, short value, or nothing. */
export function itemIdFromQuery(edit: string | string[] | undefined): string | undefined {
  return typeof edit === "string" && edit !== "" && edit.length <= MAX_ITEM_ID ? edit : undefined;
}
