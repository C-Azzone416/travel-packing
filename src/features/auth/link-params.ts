// Reads a reset link's query. Kept out of the page file because a Next.js page may only export its page and metadata.

/**
 * The link is `?for=<seal>&token=<token>`. If the provider glued its token on with a second "?" instead
 * (`?for=<seal>?token=<token>`), the token ends up inside `for`: split it back out rather than failing a good link.
 */
export function readLinkParams(params: Record<string, string | string[] | undefined>) {
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  let sealed = text(params.for);
  let token = text(params.token);
  const glued = sealed.indexOf("?token=");
  if (glued >= 0) {
    if (!token) token = sealed.slice(glued + "?token=".length);
    sealed = sealed.slice(0, glued);
  }
  return { token, sealed };
}
