/** Explicit same-origin check for the destructive account action, in addition to Next.js Server Actions protection. */
export function hasSameRequestOrigin(headers: { get(name: string): string | null }): boolean {
  const rawOrigin = headers.get("origin")?.trim();
  const rawHost = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!rawOrigin || !rawHost) return false;
  try {
    const origin = new URL(rawOrigin);
    return (
      (origin.protocol === "https:" || origin.protocol === "http:") &&
      origin.host.toLowerCase() === rawHost &&
      origin.username === "" &&
      origin.password === ""
    );
  } catch {
    return false;
  }
}
