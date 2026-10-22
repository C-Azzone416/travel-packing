import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const [html, css, app, core, sanDiegoArt, lisbonArt, londonArt, fallbackArt] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/app.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/core.js", import.meta.url), "utf8"),
  stat(new URL("../dist/assets/destination-san-diego.jpg", import.meta.url)),
  stat(new URL("../dist/assets/destination-lisbon.jpg", import.meta.url)),
  stat(new URL("../dist/assets/destination-london.jpg", import.meta.url)),
  stat(new URL("../dist/assets/destination-fallback.jpg", import.meta.url))
]);

assert.match(html, /viewport/);
assert.match(html, /Sample data only/);
assert.match(html, /aria-label="Primary navigation"/);
assert.match(css, /#f5f7f2/i);
assert.match(css, /#166d7a/i);
assert.match(css, /@media \(min-width: 900px\)/);
assert.match(app, /Dedicated return travel outfit/);
assert.match(core, /nice-shoes/);
assert.match(core, /nice-makeup/);
assert.match(core, /nice-undergarments/);
assert.match(app, /reconcileTripSuggestions/);
assert.match(app, /Optional suggestion/);
assert.match(app, /unchanged edits and progress preserved/);
assert.match(app, /I’m ready to go/);
assert.match(app, /Mark as not ready/);
assert.match(app, /left to pack/);
assert.match(css, /#d4eadf/i);
assert.match(css, /#185b56/i);
assert.match(css, /#f6decb/i);
assert.match(css, /#704322/i);
assert.match(app, /Remember for future trips/);
assert.match(app, /Save to My staples without changing historical trips/);
assert.match(app, /optional timing flag/);
assert.match(app, /New items default off/);
assert.match(core, /Close forecast/);
assert.match(core, /Seasonal outlook/);
assert.match(app, /clear every packing checkmark/);
assert.match(app, /Local SAMPLE picker/);
assert.match(app, /live geocoding/);
assert.match(app, /Save trip/);
assert.match(app, /Past & archive/);
assert.match(app, /Recently deleted/);
assert.match(app, /Undo remove/);
assert.match(core, /normalizeTripDates/);
assert.match(app, /const defaultPackLast = \["Laptop", "Chargers", "Everyday glasses"\]/);
assert.match(app, /last-toothbrush/);
assert.match(app, /last-toothpaste/);
assert.match(app, /last-deodorant/);
assert.match(app, /last-contacts/);
assert.match(app, /migrateToiletryBag/);
assert.match(app, /Toiletry bag in suitcase\?/);
assert.match(app, /confirm-toiletry-bag/);
assert.match(app, /undo-toiletry-bag/);
assert.match(app, /Toiletry bag ready to place/);
assert.match(app, /All Bathroom items are checked/);
assert.match(app, /normal Toiletries checkboxes/);
assert.match(app, /Every trip starts here/);
assert.match(app, /data-action="staple-filter"/);
assert.match(app, /Pack last<\/span>/);
assert.match(app, /staple-category/);
assert.match(app, /Clothing/);
assert.match(app, /Bathroom/);
assert.match(app, /Tech/);
assert.match(app, /Other essentials/);
assert.match(app, /Everyday glasses/);
assert.doesNotMatch(app, /Pack last defaults/);
assert.match(css, /\.staples-toolbar/);
assert.match(css, /\.timing-tag/);
assert.doesNotMatch(css, /\.timing-tag::before/);
assert.doesNotMatch(css, /content: "↓"/);
assert.doesNotMatch(css, /linear-gradient\(#fff,#fff\)/);
assert.match(css, /background: var\(--teal\)/);
assert.match(css, /color: #fff/);
assert.match(app, /packLastIndicator/);
assert.match(app, /item-timing/);
assert.doesNotMatch(app, /prompt-pack-toiletry/);
assert.match(app, /confirm-remove-trip-item/);
assert.match(css, /\.toiletry-section/);
assert.match(css, /\.bag-placement/);
assert.match(app, /Packing quick view/);
assert.match(app, /Read-only preview/);
assert.match(app, /quick-view-filter/);
assert.match(app, /aria-expanded/);
assert.match(app, /View full list/);
assert.match(css, /\.quick-view-list/);
assert.match(css, /max-height: 250px/);
assert.match(app, /destination-san-diego\.jpg/);
assert.match(app, /destination-lisbon\.jpg/);
assert.match(app, /destination-london\.jpg/);
assert.match(app, /destination-fallback\.jpg/);
assert.match(app, /Neutral sample artwork/);
assert.match(app, /there is no live photo or location-image service/);
assert.match(app, /Neutral illustrated fallback/);
assert.match(css, /\.destination-trip-head/);
assert.match(css, /\.trip-card-visual/);
[sanDiegoArt, lisbonArt, londonArt, fallbackArt].forEach((asset) => assert.equal(asset.size > 100_000, true, "destination artwork is a populated image asset"));

console.log("Static requirement checks passed");
