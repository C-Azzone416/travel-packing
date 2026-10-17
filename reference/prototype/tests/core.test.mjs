import assert from "node:assert/strict";
await import("../dist/core.js");

const core = globalThis.PackCore;

assert.equal(core.tripDays("2026-11-12", "2026-11-16"), 5, "dates are inclusive");
assert.equal(core.packingDays("2026-11-12", "2026-11-16"), 3, "outbound and return days are excluded from everyday counts");
assert.equal(core.tripDays("2026-11-16", "2026-11-12"), 0, "invalid reversed dates are rejected");
assert.deepEqual(core.normalizeTripDates("2026-11-16", "2026-11-12"), { start: "2026-11-16", end: "2026-11-16", adjusted: true, valid: true }, "an earlier return adjusts to departure");
assert.deepEqual(core.normalizeTripDates("2026-11-16", ""), { start: "2026-11-16", end: "2026-11-16", adjusted: true, valid: true }, "a missing return adjusts to departure");
assert.equal(core.tripDays("2026-11-16", "2026-11-16"), 1, "same-day trips are allowed");
assert.equal(core.forecastLabel("2026-10-23", "2026-10-16"), "Close forecast");
assert.equal(core.forecastLabel("2026-12-12", "2026-10-16"), "Seasonal outlook");

const base = core.calculateSuggestions({
  start: "2026-11-12",
  end: "2026-11-16",
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false
});
assert.equal(base.days, 5);
assert.equal(base.dailyDays, 3);
assert.equal(base.items.find((item) => item.id === "underwear").qty, 3, "return underwear is not counted here");
assert.equal(base.items.find((item) => item.id === "socks").qty, 3, "return socks are not counted here");
assert.equal(base.items.some((item) => item.id === "nice-shoes"), false, "nice companion suggestions stay off with the toggle");

const withSpareAndLaundry = core.calculateSuggestions({
  start: "2026-11-12",
  end: "2026-11-18",
  laundry: true,
  spare: true,
  niceAttire: true,
  occasionCount: 2,
  reuseNice: true
});
assert.equal(withSpareAndLaundry.dailyDays, 5);
assert.equal(withSpareAndLaundry.items.find((item) => item.id === "underwear").qty, 6);
assert.equal(withSpareAndLaundry.items.find((item) => item.id === "nice-top").qty, 1, "nice-attire reuse collapses multiple occasions to one look");
assert.equal(withSpareAndLaundry.items.find((item) => item.id === "nice-shoes").qty, 1, "dress shoes use one editable default rather than dinner count");
assert.equal(withSpareAndLaundry.items.find((item) => item.id === "nice-makeup").qty, 1, "makeup uses one editable default rather than dinner count");
assert.equal(withSpareAndLaundry.items.find((item) => item.id === "nice-undergarments").qty, 1, "dress-specific undergarments stay distinct from everyday underwear");
assert.equal(withSpareAndLaundry.items.filter((item) => item.optional).length, 3, "nice companions are marked optional");
assert.ok(withSpareAndLaundry.items.find((item) => item.id === "tops").qty < 5, "laundry reduces everyday tops");

console.log("Core calculation tests passed");
