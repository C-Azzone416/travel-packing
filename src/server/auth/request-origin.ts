// The app's own origin, for the reset link's return address. On Preview it is ONE stable address (#96), never the
// per-deployment URL a request happens to arrive on, so the auth project only has to trust that one origin. Elsewhere it is
// the origin as the browser sees it. The auth project only honours origins it trusts, so a forged Host header cannot send a
// reset link anywhere else; this just builds the URL.

import { RESET_PASSWORD_PATH } from "./public-paths";

/**
 * The stable Preview address (assigned by the deploy workflow after a green deploy of the develop head, see
 * docs/deploy.md). The workflow's PREVIEW_ALIAS holds the same host; a test keeps the two equal.
 */
export const PREVIEW_ORIGIN = "https://travel-packing-preview.vercel.app";

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export function resetPasswordUrl(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string | null {
  // Vercel sets VERCEL_ENV at runtime ("preview" for every preview deployment, "production" for production).
  if (env.VERCEL_ENV === "preview") return `${PREVIEW_ORIGIN}${RESET_PASSWORD_PATH}`;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!HOST_SHAPE.test(host)) return null;
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const protocol =
    forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${protocol}://${host}${RESET_PASSWORD_PATH}`;
}
