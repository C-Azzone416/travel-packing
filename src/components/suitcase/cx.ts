/** Joins the class names that are set; false, null and undefined are dropped. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
