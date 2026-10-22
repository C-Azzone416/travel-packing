(function (root) {
  const MS_PER_DAY = 86400000;

  function parseDate(value) {
    if (!value) return null;
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function tripDays(start, end) {
    const from = parseDate(start);
    const to = parseDate(end);
    if (!from || !to || to < from) return 0;
    return Math.floor((to - from) / MS_PER_DAY) + 1;
  }

  function packingDays(start, end) {
    return Math.max(0, tripDays(start, end) - 2);
  }

  function normalizeTripDates(start, end) {
    const from = parseDate(start);
    if (!from) return { start: start || "", end: end || "", adjusted: false, valid: false };
    const to = parseDate(end);
    if (!to || to < from) return { start, end: start, adjusted: true, valid: true };
    return { start, end, adjusted: false, valid: true };
  }

  function forecastLabel(start, todayValue) {
    const from = parseDate(start);
    const today = todayValue ? parseDate(todayValue) : new Date();
    if (!from || !today) return "Seasonal outlook";
    const distance = Math.ceil((from - today) / MS_PER_DAY);
    return distance >= 0 && distance <= 10 ? "Close forecast" : "Seasonal outlook";
  }

  function calculateSuggestions(config) {
    const days = tripDays(config.start, config.end);
    const dailyDays = Math.max(0, days - 2);
    const laundry = Boolean(config.laundry);
    const spare = config.spare ? 1 : 0;
    const niceCount = config.niceAttire ? Math.max(1, Number(config.occasionCount) || 1) : 0;
    const niceLooks = config.reuseNice ? Math.min(niceCount, 1) : niceCount;
    const everydayLooks = Math.max(0, dailyDays - niceCount);

    return {
      days,
      dailyDays,
      items: [
        { id: "tops", name: "Everyday tops", category: "Clothes", qty: laundry ? Math.ceil(everydayLooks / 2) : everydayLooks },
        { id: "bottoms", name: "Everyday bottoms", category: "Clothes", qty: everydayLooks ? Math.max(1, Math.ceil(everydayLooks / (laundry ? 4 : 2))) : 0 },
        { id: "underwear", name: "Underwear", category: "Clothes", qty: dailyDays + spare },
        { id: "socks", name: "Socks", category: "Clothes", qty: dailyDays + spare },
        { id: "sleepwear", name: "Sleepwear", category: "Clothes", qty: days > 1 ? 1 : 0 },
        { id: "nice-top", name: "Nice-attire top", category: "Nice attire", qty: niceLooks },
        { id: "nice-bottom", name: "Nice-attire bottom", category: "Nice attire", qty: niceLooks },
        { id: "nice-shoes", name: "Dress shoes", category: "Nice attire", qty: niceCount ? 1 : 0, optional: true },
        { id: "nice-makeup", name: "Makeup", category: "Bathroom", qty: niceCount ? 1 : 0, optional: true },
        { id: "nice-undergarments", name: "Dress-specific undergarments", category: "Nice attire", qty: niceCount ? 1 : 0, optional: true }
      ].filter((item) => item.qty > 0)
    };
  }

  const api = { parseDate, tripDays, packingDays, normalizeTripDates, forecastLabel, calculateSuggestions };
  root.PackCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
