export function uncoveredDemo(n: number): string {
  if (n > 10) return "big";
  if (n > 5) return "medium";
  if (n > 0) return "small";
  return "none";
}
