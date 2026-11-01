// The build the feedback service tags reports with. The SDK accepts 7 to 40 lowercase hex characters or null, and
// throws on anything else, so a deploy value that isn't a commit hash (or isn't there, as locally) becomes null.
export function feedbackBuildSha(raw: string | undefined | null): string | null {
  const value = raw?.trim().toLowerCase();
  return value && /^[a-f0-9]{7,40}$/.test(value) ? value : null;
}
