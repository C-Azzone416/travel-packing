/**
 * Stable semantic identities shared by Staples, generated recommendations, and weather extras.
 * Display names are deliberately absent: renaming never changes identity.
 */
const ALIASES: Readonly<Record<string, string>> = {
  "last-toothbrush": "toothbrush",
  "last-toothpaste": "toothpaste",
  "last-deodorant": "deodorant",
  "last-contacts": "contacts",
  "last-laptop": "laptop",
  "last-chargers": "chargers",
  "last-glasses": "everyday-glasses",
  umbrella: "weather-umbrella",
  sunscreen: "weather-sunscreen",
  "sun-hat": "weather-sun-hat",
  "rain-jacket": "weather-rain-jacket",
  swimsuit: "weather-swimsuit",
  "snow-boots": "weather-snow-boots",
};

export function canonicalItemId(semanticId: string): string {
  return ALIASES[semanticId] ?? semanticId;
}

export function sameItemIdentity(a: string, b: string): boolean {
  return canonicalItemId(a) === canonicalItemId(b);
}
