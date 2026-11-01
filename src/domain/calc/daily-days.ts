// Everyday outfits to pack (#295, decided by Caroline 2026-10-31; builds on #25/#205). The travel outfit is worn on the way
// there, so it is not packed and takes no day away: every trip day needs an everyday outfit, except that the dedicated return
// outfit (when on) covers the last day. A same-day trip changes nothing, so it packs none.
export function dailyDaysFor(days: number, returnOutfit: boolean): number {
  if (days <= 1) return 0;
  return days - (returnOutfit ? 1 : 0);
}
