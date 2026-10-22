import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "@/domain/appearance";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";

/** The signed-in person's saved theme, or Base when nobody is signed in, nothing is saved, or the read fails. */
export async function readSavedAppearance(): Promise<Appearance> {
  try {
    const context = await getDataContext();
    if (!context) return DEFAULT_APPEARANCE;
    const result = await service.getAppearance(context);
    return result.ok ? result.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * The theme to render this request with. The cookie mirror wins when it is present (an unknown value means Base), so
 * the first paint needs no database read. With no cookie, a signed-in person gets their saved theme (a new device);
 * everyone else gets Base.
 */
export async function appearanceForRequest(
  cookieValue: string | undefined,
  signedIn: boolean,
): Promise<Appearance> {
  if (cookieValue !== undefined) return parseAppearance(cookieValue);
  return signedIn ? readSavedAppearance() : DEFAULT_APPEARANCE;
}
