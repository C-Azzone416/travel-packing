// The app's own origin as the browser sees it, for the reset link's return address. The auth project only honours
// origins it trusts, so a forged Host header cannot send a reset link anywhere else; this just builds the URL.

import { RESET_PASSWORD_PATH } from "./public-paths";

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export function resetPasswordUrl(headers: { get(name: string): string | null }): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!HOST_SHAPE.test(host)) return null;
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const protocol =
    forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${protocol}://${host}${RESET_PASSWORD_PATH}`;
}
