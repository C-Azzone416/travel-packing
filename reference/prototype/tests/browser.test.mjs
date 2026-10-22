import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(projectRoot, "artifacts");
await mkdir(artifacts, { recursive: true });

const targetResponse = await fetch("http://127.0.0.1:9223/json/new?http://127.0.0.1:4173/", { method: "PUT" });
assert.equal(targetResponse.ok, true, "headless Chrome target opens");
const target = await targetResponse.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const browserErrors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push(message.params.exceptionDetails.text);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function letToastClear() {
  await new Promise((resolve) => setTimeout(resolve, 2300));
}

async function click(selector) {
  const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  assert.equal(found, true, "click target exists: " + selector);
  await settle();
}

async function fill(selector, value) {
  const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", {bubbles:true})); el.dispatchEvent(new Event("change", {bubbles:true})); return true; })()`);
  assert.equal(found, true, "field exists: " + selector);
  await settle();
}

async function text(selector) {
  return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ""`);
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(artifacts, name), Buffer.from(shot.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Page.navigate", { url: "http://127.0.0.1:4173/" });
await new Promise((resolve) => setTimeout(resolve, 300));

assert.equal(await text("h1"), "Pack for the trip, not the anxiety.");
assert.equal(await text("#sync-label"), "Saved · simulated");
assert.equal(await evaluate("document.querySelectorAll('[data-nav]').length"), 3);
assert.equal(await evaluate("document.querySelectorAll('.status-pill.remaining').length"), 1, "dashboard shows a distinct remaining badge");
assert.match(await evaluate("document.querySelector('.status-pill.remaining').innerText"), /left to pack/);
assert.equal(await evaluate("getComputedStyle(document.querySelector('.status-pill.remaining')).backgroundColor"), "rgb(246, 222, 203)");
const compactBadgeMetrics = await evaluate(`(() => {
  const badges = [...document.querySelectorAll('.trip-card .status-pill')];
  return badges.map(badge => ({ width: badge.getBoundingClientRect().width, height: badge.getBoundingClientRect().height, padding: getComputedStyle(badge).padding }));
})()`);
assert.equal(compactBadgeMetrics.every((badge) => badge.height <= 24), true, "dashboard status badges stay compact");
assert.equal(compactBadgeMetrics.every((badge) => badge.width < 105), true, "dashboard status badges stay content-width");
assert.equal(compactBadgeMetrics.every((badge) => badge.padding === "3px 6px"), true, "compact padding is applied only to status badges");
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length"), 1, "home shows upcoming trips only");
assert.equal(await evaluate("document.querySelector('.trip-card-visual').dataset.artKey"), "san-diego", "San Diego sample trip gets its own destination artwork");
const sanDiegoArtworkSrc = await evaluate("document.querySelector('.trip-card-visual .destination-image').getAttribute('src')");
assert.match(sanDiegoArtworkSrc, /destination-san-diego\.jpg$/);
assert.equal(await evaluate(`new Promise(resolve => { const image=document.querySelector('.trip-card-visual .destination-image'); if (image.complete) resolve(image.naturalWidth > 0); else image.addEventListener('load', () => resolve(image.naturalWidth > 0), {once:true}); })`), true, "San Diego card artwork loads real pixels");
const fallbackProbe = await evaluate(`(() => { const visual=document.querySelector('.trip-card-visual').cloneNode(true); visual.id='fallback-probe'; const image=visual.querySelector('img'); document.body.appendChild(visual); image.dispatchEvent(new Event('error')); const result={hidden:image.hidden, failed:visual.classList.contains('image-failed'), label:visual.querySelector('.destination-art-label').textContent}; visual.remove(); return result; })()`);
assert.deepEqual(fallbackProbe, { hidden: true, failed: true, label: "Neutral illustrated fallback" }, "broken destination image switches to the neutral CSS fallback");
await evaluate("document.querySelector('.trip-card').scrollIntoView({block:'center'})");
await settle();
await screenshot("phone-destination-card.png");
await evaluate("window.scrollTo(0,0)");
await settle();
const dashboardProgressSnapshot = await evaluate("document.querySelector('.trip-card .progress-copy').innerText");
assert.equal(await evaluate("document.querySelector('[data-action=\"toggle-quick-view\"]').getAttribute('aria-expanded')"), "false");
await click('[data-action="toggle-quick-view"]');
assert.equal(await evaluate("document.querySelector('[data-action=\"toggle-quick-view\"]').getAttribute('aria-expanded')"), "true", "Quick view expands inline");
assert.equal(await evaluate("Boolean(document.getElementById(document.querySelector('[data-action=\"toggle-quick-view\"]').getAttribute('aria-controls')))"), true, "aria-controls resolves to the inline preview");
assert.equal(await evaluate("document.querySelector('[data-action=\"quick-view-filter\"][data-filter=\"still\"]').getAttribute('aria-pressed')"), "true", "Quick view defaults to Still to pack");
assert.match(await evaluate("document.querySelector('.quick-view').innerText"), /Toiletries/i);
assert.match(await evaluate("document.querySelector('.quick-view').innerText"), /Pack last/i);
assert.match(await evaluate("document.querySelector('.quick-view').innerText"), /Toiletry bag placement/);
assert.equal(await evaluate("document.querySelectorAll('.quick-view .check-button').length"), 0, "Quick view is read-only");
const stillQuickCount = await evaluate("document.querySelectorAll('.quick-view-row').length");
await evaluate("document.querySelector('.quick-view').scrollIntoView({block:'start'})");
await settle();
await screenshot("phone-dashboard-quick-view.png");
await click('[data-action="quick-view-filter"][data-filter="all"]');
assert.equal(await evaluate("document.querySelector('[data-action=\"quick-view-filter\"][data-filter=\"all\"]').getAttribute('aria-pressed')"), "true");
assert.equal(await evaluate("document.querySelectorAll('.quick-view-row').length >= " + stillQuickCount), true, "All filter reveals at least as many items");
assert.equal(await evaluate("document.querySelector('.trip-card .progress-copy').innerText"), dashboardProgressSnapshot, "opening and filtering Quick view never changes progress");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await screenshot("desktop-dashboard-quick-view.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();
await click('[data-action="toggle-quick-view"]');
assert.equal(await evaluate("Boolean(document.querySelector('.quick-view'))"), false, "Quick view collapses reversibly");
await click('[data-action="trip-list-view"][data-view="archive"]');
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length"), 1, "past trips are separate from home");
assert.match(await evaluate("document.body.innerText"), /Past trip/);
assert.equal(await evaluate("document.querySelector('.trip-card-visual').dataset.artKey"), "lisbon", "Lisbon history card gets distinct city artwork");
assert.match(await evaluate("document.querySelector('.trip-card-visual .destination-image').getAttribute('src')"), /destination-lisbon\.jpg$/);
assert.notEqual(await evaluate("document.querySelector('.trip-card-visual .destination-image').getAttribute('src')"), sanDiegoArtworkSrc, "sample destinations never reuse the same beach artwork");
assert.equal(await evaluate(`new Promise(resolve => { const image=document.querySelector('.trip-card-visual .destination-image'); if (image.complete) resolve(image.naturalWidth > 0); else image.addEventListener('load', () => resolve(image.naturalWidth > 0), {once:true}); })`), true, "Lisbon artwork loads real pixels");
assert.equal(await evaluate("getComputedStyle(document.querySelector('.status-pill.ready')).backgroundColor"), "rgb(212, 234, 223)");
assert.match(await evaluate("document.body.innerText"), /Nothing recently deleted/);
await click('[data-action="toggle-quick-view"]');
assert.match(await evaluate("document.querySelector('.quick-view').innerText"), /No items left in this view/);
assert.match(await evaluate("document.querySelector('.quick-bag-row').innerText"), /In suitcase/);
await click('[data-action="toggle-quick-view"]');
await click('[data-action="trip-list-view"][data-view="upcoming"]');
await evaluate(`(() => {
  const root = document.documentElement.style;
  root.setProperty('--status-ready-bg', '#166d7a');
  root.setProperty('--status-ready-text', '#ffffff');
  root.setProperty('--status-ready-border', '#166d7a');
  root.setProperty('--status-remaining-bg', '#e6f2ed');
  root.setProperty('--status-remaining-text', '#0f5660');
  root.setProperty('--status-remaining-border', '#d9e3df');
})()`);
await screenshot("phone-dashboard-before-statuses.png");
await evaluate(`['--status-ready-bg','--status-ready-text','--status-ready-border','--status-remaining-bg','--status-remaining-text','--status-remaining-border'].forEach(name => document.documentElement.style.removeProperty(name))`);
await settle();
await screenshot("phone-dashboard.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await screenshot("desktop-dashboard-statuses.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();

const initialUpcomingCount = await evaluate("document.querySelectorAll('.trip-card').length");
await click('[data-action="new-trip"]');
assert.equal(await text("h1"), "Confirm the trip");
await fill('input[name="destination"]', "London");
assert.equal(await evaluate("document.querySelectorAll('.location-results button').length"), 2, "ambiguous city shows both local sample matches");
await evaluate("document.querySelector('#create-form').requestSubmit()");
await settle();
assert.equal(await text("h1"), "Confirm the trip", "free text alone cannot advance as a confirmed location");
assert.match(await text("#toast"), /Choose a SAMPLE city/);
await click('[data-action="select-location"][data-location="gb-eng-london"]');
assert.match(await evaluate("document.body.innerText"), /London · England · United Kingdom/);
await fill('input[name="destination"]', "London changed");
assert.equal(await evaluate("Boolean(document.querySelector('.confirmed-location'))"), false, "editing query invalidates location confirmation");
assert.equal(await evaluate("document.querySelector('input[name=\"destination\"]').getAttribute('aria-invalid')"), "true");
await click('[data-action="cancel-draft"]');
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length"), initialUpcomingCount, "cancelled draft never reaches dashboard");

await click('[data-action="new-trip"]');
await fill('input[name="destination"]', "London");
await click('[data-action="select-location"][data-location="gb-eng-london"]');
await fill('input[name="end"]', "2026-11-10");
assert.equal(await evaluate("document.querySelector('input[name=\"end\"]').value"), "2026-11-12", "earlier return adjusts to departure");
await fill('input[name="start"]', "2026-12-20");
assert.equal(await evaluate("document.querySelector('input[name=\"end\"]').value"), "2026-12-20", "departure change pulls earlier return forward");
assert.equal(await evaluate("document.querySelector('input[name=\"end\"]').min"), "2026-12-20");
await fill('input[name="end"]', "2026-12-24");
await evaluate("document.querySelector('#create-form').requestSubmit()");
await settle();
assert.equal(await text("h1"), "Shape the list");
assert.match(await evaluate("document.body.innerText"), /3 everyday days/);
assert.match(await evaluate("document.body.innerText"), /outbound outfit is worn, not packed/i);
assert.match(await evaluate("document.body.innerText"), /Not on your dashboard yet/);
for (const name of ["Dress shoes", "Makeup", "Dress-specific undergarments"]) {
  assert.equal(await evaluate(`[...document.querySelectorAll('.review-row strong')].filter(node => node.textContent === ${JSON.stringify(name)}).length`), 1, name + " appears once when Nice outfits is on");
}
await click('[data-config="niceAttire"]');
assert.equal(await evaluate(`[...document.querySelectorAll('.review-row strong')].some(node => ['Dress shoes','Dress-specific undergarments','Makeup'].includes(node.textContent))`), false, "turning Nice outfits off removes its companion suggestions from the calculated list");
await click('[data-config="niceAttire"]');
await fill('[data-config-number="occasionCount"]', "3");
for (const name of ["Dress shoes", "Makeup", "Dress-specific undergarments"]) {
  assert.equal(await evaluate(`(() => { const row=[...document.querySelectorAll('.review-row')].find(candidate => candidate.querySelector('strong')?.textContent === ${JSON.stringify(name)}); return row?.querySelector('.tag')?.textContent; })()`), "1", name + " stays at one visible editable default for three occasions");
}
await click('[data-config="laundry"]');
assert.match(await evaluate("document.body.innerText"), /Live sample calculation/i);
await click('[data-action="save-trip"]');
assert.equal(await text("h1"), "London");
assert.match(await evaluate("document.body.innerText"), /England, United Kingdom/);
assert.equal(await evaluate("document.querySelector('.trip-head-visual').dataset.artKey"), "london", "trip header uses the confirmed London sample artwork");
assert.match(await evaluate("document.querySelector('.trip-head-visual .destination-image').getAttribute('src')"), /destination-london\.jpg$/);
assert.equal(await evaluate(`new Promise(resolve => { const image=document.querySelector('.trip-head-visual .destination-image'); if (image.complete) resolve(image.naturalWidth > 0); else image.addEventListener('load', () => resolve(image.naturalWidth > 0), {once:true}); })`), true, "London trip-header artwork loads real pixels");
await letToastClear();
await screenshot("phone-destination-header.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await screenshot("desktop-destination-header.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();
assert.match(await evaluate("document.body.innerText"), /Return travel outfit/);
assert.match(await evaluate("document.body.innerText"), /Laptop/);
assert.equal(await evaluate("document.body.innerText.includes('Compact umbrella')"), false);
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-shoes\"]').length"), 1, "Dress shoes have one canonical trip item");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-makeup\"]').length"), 1, "Makeup has one canonical trip item");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-undergarments\"]').length"), 1, "Dress-specific undergarments have one canonical trip item");
assert.equal(await evaluate(`(() => { const everyday=[...document.querySelectorAll('.pack-row')].find(row => row.querySelector('.item-name')?.textContent === 'Underwear'); const dress=[...document.querySelectorAll('.pack-row')].find(row => row.querySelector('.item-name')?.textContent === 'Dress-specific undergarments'); return Boolean(everyday && dress && everyday.dataset.itemId !== dress.dataset.itemId); })()`), true, "dress-specific undergarments stay distinct from everyday underwear");

await evaluate(`(() => { const row=[...document.querySelectorAll('.pack-row')].find(candidate => candidate.querySelector('.item-name')?.textContent === 'Dress shoes'); row.querySelector('[data-action="edit-trip-item"]').click(); })()`);
await settle();
assert.match(await evaluate("document.querySelector('#trip-item-form').innerText"), /Optional suggestion/);
await fill('#trip-item-form input[name="qty"]', "2");
await evaluate("document.querySelector('#trip-item-form').requestSubmit()");
await settle();
await click('[data-item-id="nice-shoes"] [data-action="packed-plus"]');
assert.match(await evaluate("document.querySelector('[data-item-id=\"nice-shoes\"]').innerText"), /1\/2/, "edited quantity and partial packed state are visible");

await click('[data-action="edit-preferences"]');
await click('#preference-form input[name="niceAttire"]');
await evaluate("document.querySelector('#preference-form').requestSubmit()");
await settle();
assert.equal(await evaluate("document.body.innerText.includes('Dress shoes') || document.body.innerText.includes('Dress-specific undergarments') || document.body.innerText.includes('Makeup')"), false, "trip Nice outfits off removes calculated companions");
await click('[data-action="edit-preferences"]');
await click('#preference-form input[name="niceAttire"]');
await evaluate("document.querySelector('#preference-form').requestSubmit()");
await settle();
assert.match(await evaluate("document.querySelector('[data-item-id=\"nice-shoes\"]').innerText"), /1\/2/, "turning Nice outfits back on restores edited quantity and checked progress");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-makeup\"]').length"), 1, "repeated toggle restores one Makeup item without duplication");
await click('[data-action="edit-preferences"]');
await click('#preference-form input[name="niceAttire"]');
await evaluate("document.querySelector('#preference-form').requestSubmit()");
await settle();
await click('[data-action="edit-preferences"]');
await click('#preference-form input[name="niceAttire"]');
await evaluate("document.querySelector('#preference-form').requestSubmit()");
await settle();
assert.match(await evaluate("document.querySelector('[data-item-id=\"nice-shoes\"]').innerText"), /1\/2/, "repeated off/on use continues preserving edits and progress");

await evaluate(`(() => { const row=document.querySelector('[data-item-id="nice-undergarments"]'); row.querySelector('[data-action="edit-trip-item"]').click(); })()`);
await settle();
await click('[data-action="remove-trip-item"]');
assert.equal(await text("#modal-title"), "Remove optional item?");
await click('[data-action="confirm-remove-trip-item"]');
assert.equal(await evaluate("document.body.innerText.includes('Dress-specific undergarments')"), false, "optional nice companion is removable");
await click('[data-action="edit-preferences"]');
await evaluate("document.querySelector('#preference-form').requestSubmit()");
await settle();
assert.equal(await evaluate("document.body.innerText.includes('Dress-specific undergarments')"), false, "removed optional companion stays suppressed on later recalculation");

await evaluate("document.querySelector('[data-item-id=\"nice-shoes\"]').scrollIntoView({block:'center'})");
await settle();
await screenshot("phone-nice-outfits.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await screenshot("desktop-nice-outfits.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();
const packingIndicatorStyle = await evaluate(`(() => {
  const tag = document.querySelector('[data-item-id="last-laptop"] .timing-tag');
  return { text: tag?.textContent, background: getComputedStyle(tag).backgroundColor, color: getComputedStyle(tag).color, symbol: getComputedStyle(tag, '::before').content };
})()`);
assert.deepEqual(packingIndicatorStyle, { text: "Pack last", background: "rgb(22, 109, 122)", color: "rgb(255, 255, 255)", symbol: "none" }, "packing-list Pack last indicator is text-only with no decorative pseudo-icon");
await letToastClear();
await screenshot("phone-packing-list.png");

assert.match(await evaluate("document.querySelector('.toiletry-section').innerText"), /Bathroom · 0 of 5 contents checked/);
assert.equal(await evaluate("document.querySelectorAll('.toiletry-section .pack-row').length"), 5, "Nice outfits adds one optional Makeup item to the Bathroom checklist");
assert.equal(await evaluate("document.querySelectorAll('.toiletry-section [data-action=\"toggle-item\"]').length"), 5, "all toiletry contents use normal checkboxes");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-makeup\"]').length"), 1, "Makeup has one canonical toiletry row");
assert.equal(await evaluate("document.querySelectorAll('[data-action=\"prompt-pack-toiletry\"]').length"), 0, "per-item bag confirmations are removed");
assert.equal(await evaluate("document.querySelector('.toiletry-section').innerText.includes('Glasses')"), false, "Glasses remains separate from the toiletry bag by default");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"last-toothbrush\"]').length"), 2, "one canonical toothbrush appears in toiletry and Pack last views");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"last-toothbrush\"] .timing-tag').length"), 2, "matching Pack last indicators appear on both canonical item views");
for (const id of ["nice-makeup", "last-toothbrush", "last-toothpaste", "last-deodorant"]) {
  await click(`.toiletry-section [data-item-id="${id}"] [data-action="toggle-item"]`);
}
assert.equal(await evaluate("document.querySelector('#modal-root').children.length"), 0, "checking ordinary toiletry contents does not prompt early");
const lastContentFromPackLast = await evaluate(`(() => {
  const section = [...document.querySelectorAll('.list-section')].find(candidate => candidate.querySelector('h3')?.textContent === 'Pack last');
  const row = section?.querySelector('[data-item-id="last-contacts"]');
  if (!row) return false;
  row.querySelector('[data-action="toggle-item"]').click();
  return true;
})()`);
assert.equal(lastContentFromPackLast, true, "Pack last updates the same canonical content checkbox");
await settle();
assert.equal(await text("#modal-title"), "Toiletry bag in suitcase?");
assert.equal(await evaluate("document.querySelector('.modal').getAttribute('role')"), "dialog");
assert.match(await evaluate("document.querySelector('.modal').innerText"), /Confirm/);
assert.match(await evaluate("document.querySelector('.modal').innerText"), /Not yet/);
assert.equal(await evaluate("[...document.querySelectorAll('[data-item-id=\"last-contacts\"]')].every(row => row.classList.contains('complete'))"), true, "last content checkbox syncs across Toiletries and Pack last");
const percentBeforeBagPlacement = Number((await evaluate("[...document.querySelectorAll('.section-head strong')].find(node => node.textContent.includes('%'))?.textContent")).replace('%', ''));
assert.equal(Number.isFinite(percentBeforeBagPlacement), true, "contents produce a valid progress percentage while placement remains separate");
await click('[data-action="close-modal"]');
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /bag is still outside the suitcase/i, "Not yet preserves the bag-level reminder");
assert.equal(await text('[data-action="prompt-toiletry-bag"]'), "Put bag in suitcase", "dismissing the automatic prompt leaves a direct placement action");
await click("#brand-home");
assert.equal(await evaluate(`(() => { const card=[...document.querySelectorAll('.trip-card')].find(candidate => candidate.querySelector('h2')?.textContent === 'London'); if (!card) return false; card.querySelector('[data-action="open-trip"]').click(); return true; })()`), true, "complete-content trip can be revisited");
await settle();
assert.equal(await text('[data-action="prompt-toiletry-bag"]'), "Put bag in suitcase", "placement action persists on revisit without toggling or adding an item");
assert.equal(await evaluate("document.querySelector('#modal-root').children.length"), 0, "revisit does not require the automatic prompt to expose placement");
await evaluate("document.querySelector('.toiletry-section').scrollIntoView({block:'start'})");
await settle();
await screenshot("phone-toiletry-bag.png");
await click('[data-action="filter"][data-filter="still"]');
assert.equal(await evaluate("Boolean(document.querySelector('.toiletry-section'))"), true, "Still to pack keeps an unconfirmed bag-placement reminder visible");
assert.equal(await evaluate("document.querySelectorAll('.toiletry-section .pack-row').length"), 0, "Still to pack hides completed toiletry contents");
assert.match(await evaluate("document.querySelector('.toiletry-section').innerText"), /Put bag in suitcase/);
await click('[data-action="filter"][data-filter="all"]');
await click('[data-action="prompt-toiletry-bag"]');
await click('[data-action="confirm-toiletry-bag"]');
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /in the suitcase/i);
const percentAfterBagPlacement = Number((await evaluate("[...document.querySelectorAll('.section-head strong')].find(node => node.textContent.includes('%'))?.textContent")).replace('%', ''));
assert.equal(percentAfterBagPlacement > percentBeforeBagPlacement, true, "bag placement contributes one distinct completion gate");
await click('[data-action="filter"][data-filter="still"]');
assert.equal(await evaluate("Boolean(document.querySelector('.toiletry-section'))"), false, "Still to pack hides Toiletries once contents and bag placement are complete");
await click('[data-action="filter"][data-filter="all"]');
await click('[data-action="undo-toiletry-bag"]');
assert.equal(await evaluate("[...document.querySelectorAll('[data-item-id=\"last-toothbrush\"]')].every(row => row.classList.contains('complete'))"), true, "undo placement preserves content checkmarks");
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /outside the suitcase/i);
await click('[data-action="prompt-toiletry-bag"]');
await click('[data-action="confirm-toiletry-bag"]');
await click('.toiletry-section [data-item-id="last-toothbrush"] [data-action="toggle-item"]');
assert.equal(await evaluate("document.body.innerText.includes('Toiletry bag is in the suitcase')"), false, "unchecking a required content invalidates bag placement");
assert.equal(await evaluate("[...document.querySelectorAll('[data-item-id=\"last-toothbrush\"]')].every(row => !row.classList.contains('complete'))"), true);
await click('.toiletry-section [data-item-id="last-toothbrush"] [data-action="toggle-item"]');
assert.equal(await text("#modal-title"), "Toiletry bag in suitcase?");
await click('[data-action="confirm-toiletry-bag"]');

await click('[data-action="add-toiletry-item"]');
assert.equal(await evaluate("document.querySelector('#toiletry-item-form input[name=\"packLast\"]').checked"), false, "new toiletry item defaults Pack last off");
await fill('#toiletry-item-form input[name="name"]', "Face wash");
await click('#toiletry-item-form input[name="scope"][value="future"]');
await evaluate("document.querySelector('#toiletry-item-form').requestSubmit()");
await settle();
assert.equal(await evaluate("document.querySelector('#modal-root').children.length"), 0, "defining a new item does not ask whether it is physically packed");
assert.match(await evaluate("document.querySelector('.toiletry-section').innerText"), /Face wash/);
assert.equal(await evaluate("document.body.innerText.includes('Toiletry bag is in the suitcase')"), false, "adding a required Bathroom item invalidates bag placement");
assert.equal(await evaluate(`(() => { const section=[...document.querySelectorAll('.list-section')].find(candidate => candidate.querySelector('h3')?.textContent === 'Pack last'); return section?.innerText.includes('Face wash') || false; })()`), false, "Pack last off keeps the canonical child only in its bag view");
await evaluate(`(() => { const row=[...document.querySelectorAll('.toiletry-section .pack-row')].find(candidate => candidate.innerText.includes('Face wash')); row.querySelector('[data-action="edit-trip-item"]').click(); })()`);
await settle();
await click('[data-action="remove-trip-item"]');
assert.equal(await text("#modal-title"), "Remove toiletry item?");
await click('[data-action="confirm-remove-trip-item"]');
assert.equal(await evaluate("document.querySelector('.toiletry-section').innerText.includes('Face wash')"), false, "trip-only removal clears the current bag");
await click('[data-nav="staples"]');
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Face wash'))`), true, "trip-only removal preserves the remembered future staple");
await click('[data-nav="trips"]');
await click('.trip-card [data-action="open-trip"]');

const openedLaptopEditor = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.pack-row')].find(candidate => candidate.querySelector('.item-name')?.textContent === 'Laptop');
  if (!row) return false;
  row.querySelector('[data-action="edit-trip-item"]').click();
  return true;
})()`);
assert.equal(openedLaptopEditor, true, "pack-last item editor opens");
await settle();
assert.equal(await evaluate("document.querySelector('#trip-item-form input[name=\"packLast\"]').checked"), true, "existing pack-last item preserves its flag");
await click('#trip-item-form input[name="packLast"]');
await click('[data-action="close-modal"]');
assert.equal(await evaluate(`(() => { const section=[...document.querySelectorAll('.list-section')].find(candidate => candidate.querySelector('h3')?.textContent === 'Pack last'); return section?.innerText.includes('Laptop') || false; })()`), true, "cancelling a timing change leaves the trip unchanged");
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.pack-row')].find(candidate => candidate.querySelector('.item-name')?.textContent === 'Laptop');
  row.querySelector('[data-action="edit-trip-item"]').click();
})()`);
await settle();
assert.equal(await evaluate("document.querySelector('#trip-item-form input[name=\"packLast\"]').checked"), true, "reopening after cancel restores the saved flag");
await click('#trip-item-form input[name="scope"][value="future"]');
await evaluate("document.querySelector('#trip-item-form').requestSubmit()");
await settle();
assert.match(await text("#toast"), /Saved to My staples; Pack last on/);
await click('[data-nav="staples"]');
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Laptop') && row.innerText.includes('Pack last'))`), true, "remember saves the item to My staples with Pack last as a flag");
assert.equal(await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Laptop')); return row?.closest('.staple-category')?.querySelector('h2')?.textContent; })()`), "Tech", "changing timing never changes the staple category");
await click('[data-nav="trips"]');
await click('.trip-card [data-action="open-trip"]');
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.pack-row')].find(candidate => candidate.querySelector('.item-name')?.textContent === 'Laptop');
  row.querySelector('[data-action="edit-trip-item"]').click();
})()`);
await settle();
await click('#trip-item-form input[name="packLast"]');
await evaluate("document.querySelector('#trip-item-form').requestSubmit()");
await settle();
assert.match(await text("#toast"), /Updated this trip only/);
assert.equal(await evaluate(`(() => { const section=[...document.querySelectorAll('.list-section')].find(candidate => candidate.querySelector('h3')?.textContent === 'Pack last'); return section?.innerText.includes('Laptop') || false; })()`), false, "trip-only toggle removes Laptop from this trip's Pack last section");
assert.equal(await evaluate(`(() => { const section=[...document.querySelectorAll('.list-section')].find(candidate => candidate.querySelector('h3')?.textContent === 'Everyday & occasion items'); return section?.innerText.includes('Laptop') || false; })()`), true, "trip-only toggle keeps the same canonical item in its category-backed list");
await click('[data-nav="staples"]');
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Laptop') && row.innerText.includes('Pack last'))`), true, "this-trip-only timing change leaves the future staple untouched");
assert.equal(await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Laptop')); return row?.closest('.staple-category')?.querySelector('h2')?.textContent; })()`), "Tech", "trip-only timing changes do not move the future category");
await click('[data-nav="trips"]');
await click('.trip-card [data-action="open-trip"]');

const beforeWeather = await evaluate("document.querySelectorAll('.pack-row').length");
await click('[data-action="review-weather"]');
assert.match(await text("#modal-title"), /Review weather suggestion/);
assert.equal(await evaluate("document.querySelectorAll('.pack-row').length"), beforeWeather, "review does not mutate list");
await click('[data-action="accept-weather"]');
assert.equal(await evaluate("document.body.innerText.includes('Compact umbrella')"), true, "accepted weather item appears");

const underwearPlus = await evaluate(`(() => { const rows=[...document.querySelectorAll('.pack-row')]; const row=rows.find(r=>r.innerText.includes('Underwear') && !r.innerText.includes('Return outfit')); if(!row)return false; row.querySelector('[data-action="packed-plus"]').click(); return true; })()`);
assert.equal(underwearPlus, true);
await settle();
assert.match(await evaluate(`(() => { const rows=[...document.querySelectorAll('.pack-row')]; return rows.find(r=>r.innerText.includes('Underwear'))?.innerText || '' })()`), /1\//, "partial quantity is visible");
await click('[data-action="filter"][data-filter="still"]');
assert.match(await evaluate("document.body.innerText"), /Still to pack/);
assert.equal(await evaluate("document.querySelectorAll('.toiletry-section .pack-row').length"), 0, "Still to pack hides checked toiletry contents");
assert.match(await evaluate("document.querySelector('.toiletry-section').innerText"), /Put bag in suitcase/, "bag placement remains as the unfinished gate");

await click('[data-nav="staples"]');
await click('[data-action="add-staple"]');
await fill('#staple-form input[name="name"]', "Makeup");
await fill('#staple-form input[name="category"]', "Bathroom");
await evaluate("document.querySelector('#staple-form').requestSubmit()");
await settle();
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].filter(row => row.innerText.includes('Makeup')).length`), 1, "matching Makeup staple is saved once");
await click('[data-nav="trips"]');
await click("#brand-home");
const cardCountBeforeCopy = await evaluate("document.querySelectorAll('.trip-card').length");
const sourceCardSnapshot = await evaluate("document.querySelector('.trip-card').innerText");
await click('.trip-card [data-action="copy-trip"]');
assert.equal(await text("h1"), "Confirm the trip");
await fill('input[name="destination"]', "London");
assert.equal(await evaluate("document.querySelectorAll('.location-results button').length"), 2, "copy flow also disambiguates London");
await click('[data-action="select-location"][data-location="ca-on-london"]');
await fill('input[name="end"]', "2026-12-01");
assert.equal(await evaluate("document.querySelector('input[name=\"end\"]').value"), "2026-12-04", "copy return also adjusts to its departure");
await fill('input[name="start"]', "2027-01-05");
assert.equal(await evaluate("document.querySelector('input[name=\"end\"]').value"), "2027-01-05", "copy departure change pulls return forward");
await fill('input[name="end"]', "2027-01-09");
await evaluate("document.querySelector('#create-form').requestSubmit()");
await settle();
assert.equal(await text("h1"), "Shape the list");
await click('[data-action="cancel-draft"]');
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length"), cardCountBeforeCopy, "cancelled copy does not add a trip");
assert.equal(await evaluate("document.querySelector('.trip-card').innerText"), sourceCardSnapshot, "cancelled copy does not change its source");

await click('.trip-card [data-action="copy-trip"]');
await fill('input[name="destination"]', "London");
await click('[data-action="select-location"][data-location="ca-on-london"]');
await evaluate("document.querySelector('#create-form').requestSubmit()");
await settle();
await click('[data-action="save-trip"]');
assert.equal(await text("h1"), "London");
assert.match(await evaluate("document.body.innerText"), /Ontario, Canada/);
assert.equal(await evaluate("document.querySelectorAll('.pack-row.complete').length"), 0, "copied trip clears checks");
assert.equal(await evaluate("document.body.innerText.includes('Toiletry bag is in the suitcase')"), false, "copy clears bag placement confirmation");
assert.match(await evaluate("document.querySelector('.toiletry-section').innerText"), /Face wash/, "remembered toiletry staple appears in a future trip");
assert.equal(await evaluate(`[...document.querySelectorAll('.toiletry-section .pack-row')].filter(row => row.querySelector('.item-name')?.textContent === 'Makeup').length`), 1, "copied trip deduplicates the matching Makeup staple and suggestion");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-shoes\"]').length"), 1, "copied trip recalculates one Dress shoes suggestion");
assert.equal(await evaluate("document.querySelectorAll('[data-item-id=\"nice-undergarments\"]').length"), 1, "copied trip recalculates one dress-undergarments suggestion");
await evaluate(`(() => { const row=[...document.querySelectorAll('.toiletry-section .pack-row')].find(candidate => candidate.innerText.includes('Face wash')); row.querySelector('[data-action="edit-trip-item"]').click(); })()`);
await settle();
await click('#trip-item-form input[name="scope"][value="future"]');
await click('[data-action="remove-trip-item"]');
await click('[data-action="confirm-remove-trip-item"]');
assert.equal(await evaluate("document.querySelector('.toiletry-section').innerText.includes('Face wash')"), false, "future-scope removal clears the current bag");
await click("#brand-home");
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length"), cardCountBeforeCopy + 1, "copy preserves original and adds a trip");
assert.equal(await evaluate(`[...document.querySelectorAll('.trip-card')].some(card => card.innerText === ${JSON.stringify(sourceCardSnapshot)})`), true, "copy leaves source trip unchanged");
await click('.trip-card [data-action="open-trip"]');

let sawFinalBagPlacementPrompt = false;
for (let i = 0; i < 40; i++) {
  const left = await evaluate("document.querySelectorAll('.pack-row:not(.complete)').length");
  if (!left) break;
  const action = await evaluate(`(() => {
    const row = document.querySelector('.pack-row:not(.complete)');
    const direct = row?.querySelector('[data-action="toggle-item"]');
    if (direct) { direct.click(); return 'direct'; }
    return 'missing';
  })()`);
  await settle();
  if (await evaluate("Boolean(document.querySelector('[data-action=\"confirm-toiletry-bag\"]'))")) {
    sawFinalBagPlacementPrompt = true;
    await click('[data-action="close-modal"]');
  }
  assert.notEqual(action, "missing", "every unpacked row has a working physical packing action");
}
assert.equal(await evaluate("document.querySelectorAll('.pack-row:not(.complete)').length"), 0);
assert.equal(sawFinalBagPlacementPrompt, true, "last toiletry content offers the bag-placement confirmation");
assert.equal(await evaluate("Boolean(document.querySelector('[data-action=\"review-bag\"]'))"), false, "checked contents alone do not unlock final Ready review");
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /outside the suitcase/i);
assert.equal(await text('[data-action="prompt-toiletry-bag"]'), "Put bag in suitcase", "complete contents expose placement without another list mutation");
await click('[data-action="prompt-toiletry-bag"]');
await click('[data-action="confirm-toiletry-bag"]');
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /in the suitcase/i, "bag placement completes the separate gate");
assert.equal(await evaluate("document.body.innerText.includes('Ready to go — confirmed')"), false, "last check does not auto-confirm Ready");
assert.match(await evaluate("document.body.innerText"), /Review your bag/);
await click('[data-action="review-bag"]');
assert.equal(await text("h1"), "Review your bag");
assert.equal(await evaluate("document.querySelector('[data-action=\"confirm-ready\"]').disabled"), false);
await click('[data-action="undo-toiletry-bag"]');
assert.equal(await text('[data-action="prompt-toiletry-bag"]'), "Put bag in suitcase", "review screen exposes the same persistent placement action after undo");
assert.equal(await evaluate("document.querySelector('[data-action=\"confirm-ready\"]').disabled"), true, "undoing placement gates Ready on the review screen");
await click('[data-action="prompt-toiletry-bag"]');
assert.equal(await text("#modal-title"), "Toiletry bag in suitcase?");
await click('[data-action="close-modal"]');
assert.equal(await text('[data-action="prompt-toiletry-bag"]'), "Put bag in suitcase", "review placement action persists after dismissing confirmation");
await click('[data-action="prompt-toiletry-bag"]');
await click('[data-action="confirm-toiletry-bag"]');
assert.equal(await evaluate("document.querySelector('[data-action=\"confirm-ready\"]').disabled"), false, "explicit placement restores Ready eligibility without changing contents");

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await letToastClear();
await screenshot("desktop-review.png");
await click('[data-action="confirm-ready"]');
assert.match(await evaluate("document.body.innerText"), /You’re ready to go/);

const readyTripSnapshot = await evaluate("JSON.stringify([...document.querySelectorAll('.pack-row')].map(row => row.innerText))");
assert.equal(await evaluate("Boolean(document.querySelector('.ready-card [data-action=\"mark-not-ready\"]'))"), true, "ready trip exposes manual not-ready action");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await letToastClear();
await evaluate("document.querySelector('.ready-card').scrollIntoView({block:'start'})");
await settle();
await screenshot("phone-ready-actions.png");
await click('.ready-card [data-action="mark-not-ready"]');
assert.match(await evaluate("document.body.innerText"), /Packing/);
assert.equal(await evaluate("document.body.innerText.includes('You’re ready to go')"), false);
assert.equal(await evaluate("JSON.stringify([...document.querySelectorAll('.pack-row')].map(row => row.innerText))"), readyTripSnapshot, "manual not-ready preserves every packed quantity");
assert.match(await evaluate("document.body.innerText"), /Review your bag/);

await click('[data-action="review-bag"]');
await click('[data-action="confirm-ready"]');
await click('.ready-card [data-action="review-bag"]');
assert.equal(await text("h1"), "Review your bag");
assert.match(await evaluate("document.body.innerText"), /This trip is currently Ready/);
await evaluate("document.querySelector('[data-action=\"mark-not-ready\"]').scrollIntoView({block:'center'})");
await settle();
await screenshot("phone-review-ready-actions.png");
const readyReviewSnapshot = await evaluate("JSON.stringify([...document.querySelectorAll('.review-row')].map(row => row.innerText))");
await click('[data-action="mark-not-ready"]');
assert.equal(await text("h1"), "Review your bag", "manual not-ready stays on review page");
assert.equal(await evaluate("JSON.stringify([...document.querySelectorAll('.review-row')].map(row => row.innerText))"), readyReviewSnapshot, "review-page not-ready preserves every packed quantity");
assert.equal(await evaluate("document.querySelector('[data-action=\"confirm-ready\"]').disabled"), false, "trip can be explicitly confirmed ready again");
await click('[data-action="confirm-ready"]');
assert.match(await evaluate("document.body.innerText"), /You’re ready to go/);
await click('[data-action="undo-toiletry-bag"]');
assert.equal(await evaluate("document.body.innerText.includes('You’re ready to go')"), false, "undoing bag placement revokes Ready");
assert.equal(await evaluate("[...document.querySelectorAll('.toiletry-section .pack-row')].every(row => row.classList.contains('complete'))"), true, "undoing placement preserves content checkmarks");
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /outside the suitcase/i);
assert.match(await evaluate("document.body.innerText"), /Packing/);

await click("#brand-home");
for (let i = 0; i < 6; i++) {
  const archiveCount = await evaluate("document.querySelectorAll('[data-action=\"archive-trip\"]').length");
  if (!archiveCount) break;
  await click('[data-action="archive-trip"]');
}
assert.match(await evaluate("document.body.innerText"), /No upcoming trips/, "upcoming view has a designed empty state");
await click('[data-action="trip-list-view"][data-view="archive"]');
assert.match(await text("h1"), /Past trips & archive/);
await screenshot("phone-archive.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await settle();
await screenshot("desktop-archive.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();

const removedLisbon = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.trip-card')].find(candidate => candidate.querySelector('h2')?.textContent === 'Lisbon');
  if (!card) return false;
  card.querySelector('[data-action="remove-trip"]').click();
  return true;
})()`);
assert.equal(removedLisbon, true, "past Lisbon trip can be selected for removal");
await settle();
assert.equal(await text("#modal-title"), "Remove this trip?");
await click('[data-action="confirm-remove-trip"]');
assert.match(await evaluate("document.querySelector('.deleted-list').innerText"), /Lisbon/);
assert.match(await evaluate("document.querySelector('.deleted-list').innerText"), /Undo remove/);
await click('[data-action="undo-remove"][data-trip="lisbon"]');
assert.equal(await evaluate("document.querySelector('.deleted-list').innerText.includes('Lisbon')"), false, "undo clears Lisbon from Recently deleted");
assert.equal(await evaluate(`[...document.querySelectorAll('.trip-card h2')].some(heading => heading.textContent === 'Lisbon')`), true, "undo restores the exact trip to history");
await click('[data-action="restore-trip"]');
assert.match(await text("h1"), /Pack for the trip/);
assert.equal(await evaluate("document.querySelectorAll('.trip-card').length > 0"), true, "restoring an archived future trip returns it to Upcoming");

await click('[data-nav="staples"]');
assert.equal(await text("h1"), "Every trip starts here");
assert.equal(await text(".eyebrow"), "My staples");
assert.match(await evaluate("document.body.innerText"), /per day/i);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.staple-category h2')].map(heading => heading.textContent)`), ["Clothing", "Bathroom", "Tech", "Other essentials"], "Staples use consistent peer category sections");
assert.match(await evaluate("document.querySelector('.staple-category').parentElement.innerText"), /normal Toiletries checkboxes/);
assert.equal(await evaluate("document.body.innerText.includes('Pack last defaults')"), false, "Pack last is not rendered as a competing category");
assert.equal(await evaluate("document.querySelector('[data-action=\"staple-filter\"][data-filter=\"all\"]').getAttribute('aria-pressed')"), "true", "All staples is the default filter");
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].filter(row => row.innerText.includes('Everyday glasses')).length`), 1, "regular glasses have one canonical row");
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Everyday glasses') && row.innerText.includes('Pack last'))`), true, "regular glasses retain Pack last timing");
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Sunglasses') && !row.innerText.includes('Pack last'))`), true, "sunglasses stay distinct from everyday glasses");
const staplesIndicatorStyle = await evaluate(`(() => {
  const tag = [...document.querySelectorAll('.staple-row')].find(row => row.innerText.includes('Everyday glasses'))?.querySelector('.timing-tag');
  const edit = [...document.querySelectorAll('.staple-row')].find(row => row.innerText.includes('Everyday glasses'))?.querySelector('.icon-button');
  return { background: getComputedStyle(tag).backgroundColor, color: getComputedStyle(tag).color, symbol: getComputedStyle(tag, '::before').content, unrelatedEditBackground: getComputedStyle(edit).backgroundColor };
})()`);
assert.deepEqual(staplesIndicatorStyle, { background: "rgb(22, 109, 122)", color: "rgb(255, 255, 255)", symbol: "none", unrelatedEditBackground: "rgb(255, 255, 255)" }, "Staples uses the text-only badge without changing the edit control");
assert.equal(await evaluate("new Set([...document.querySelectorAll('[data-action=\"edit-staple\"]')].map(button => button.dataset.staple)).size"), await evaluate("document.querySelectorAll('[data-action=\"edit-staple\"]').length"), "All view has no duplicate canonical staples");
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Face wash'))`), false, "future-scope removal also clears the remembered staple");
await letToastClear();
await evaluate("window.scrollTo(0, 0)");
await settle();
await screenshot("phone-staples-all.png");
await click('[data-action="staple-filter"][data-filter="packlast"]');
assert.equal(await evaluate("document.querySelector('[data-action=\"staple-filter\"][data-filter=\"packlast\"]').getAttribute('aria-pressed')"), "true", "Pack last quick filter reports its pressed state");
assert.equal(await evaluate("document.querySelectorAll('.staple-row').length"), 7, "Pack last filter shows the seven flagged canonical defaults");
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].every(row => row.querySelector('.timing-tag')?.textContent === 'Pack last')`), true, "filtered rows keep discreet timing tags");
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.staple-category h2')].map(heading => heading.textContent)`), ["Bathroom", "Tech", "Other essentials"], "Pack last filter preserves category grouping");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await evaluate("window.scrollTo(0, 0)");
await settle();
await screenshot("desktop-staples-pack-last.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await settle();
await click('[data-action="staple-filter"][data-filter="all"]');
await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Sunglasses')); row.querySelector('[data-action="edit-staple"]').click(); })()`);
await settle();
assert.equal(await evaluate("document.querySelector('#staple-form input[name=\"packLast\"]').checked"), false, "any unflagged staple can open with Pack last off");
await click('#staple-form input[name="packLast"]');
await evaluate("document.querySelector('#staple-form').requestSubmit()");
await settle();
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Sunglasses') && row.innerText.includes('Pack last'))`), true, "Pack last can be added to an ordinary staple");
assert.equal(await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Sunglasses')); return row?.closest('.staple-category')?.querySelector('h2')?.textContent; })()`), "Other essentials", "adding the flag preserves the item's category");
await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Sunglasses')); row.querySelector('[data-action="edit-staple"]').click(); })()`);
await settle();
await click('#staple-form input[name="packLast"]');
await evaluate("document.querySelector('#staple-form').requestSubmit()");
await settle();
assert.equal(await evaluate(`[...document.querySelectorAll('.staple-row')].some(row => row.innerText.includes('Sunglasses') && row.innerText.includes('Pack last'))`), false, "Pack last can be removed again");
assert.equal(await evaluate(`(() => { const row=[...document.querySelectorAll('.staple-row')].find(candidate => candidate.innerText.includes('Sunglasses')); return row?.closest('.staple-category')?.querySelector('h2')?.textContent; })()`), "Other essentials", "removing the flag also preserves category");
await click('[data-action="add-staple"]');
assert.equal(await evaluate("document.querySelector('#staple-form input[name=\"packLast\"]').checked"), false, "new staple defaults Pack last off");
assert.match(await evaluate("document.querySelector('#staple-form').innerText"), /saves to My staples/);
await click('[data-action="close-modal"]');
await click('[data-action="edit-staple"]');
assert.match(await evaluate("document.body.innerText"), /Existing trips keep their historical quantities/);
await click('[data-action="close-modal"]');

await click('[data-nav="settings"]');
assert.equal(await text("h1"), "Settings");
await click('[data-action="sync-state"][data-state="offline"]');
assert.equal(await text("#sync-label"), "Offline · simulated");
await click('[data-action="sync-state"][data-state="waiting"]');
assert.equal(await text("#sync-label"), "Waiting · simulated");
await click('[data-action="reset-sample"]');
await click('[data-action="confirm-reset"]');
await click('[data-nav="trips"]');
await click('.trip-card [data-action="open-trip"]');
assert.equal(await evaluate("document.querySelectorAll('.toiletry-section .pack-row').length"), 5, "reset restores four defaults plus optional Makeup for Nice outfits");
assert.match(await evaluate("document.querySelector('.bag-placement').innerText"), /not ready to place/i, "reset clears bag placement for the active sample trip");
assert.equal(await evaluate("document.body.innerText.includes('Face wash')"), false, "reset removes remembered sample edits");

assert.deepEqual(browserErrors, [], "no uncaught browser exceptions");
ws.close();
console.log("Browser flow tests passed");
console.log("Screenshots: artifacts/phone-destination-card.png, artifacts/phone-destination-header.png, artifacts/desktop-destination-header.png, artifacts/phone-dashboard-before-statuses.png, artifacts/phone-dashboard.png, artifacts/phone-dashboard-quick-view.png, artifacts/desktop-dashboard-statuses.png, artifacts/desktop-dashboard-quick-view.png, artifacts/phone-packing-list.png, artifacts/phone-toiletry-bag.png, artifacts/phone-nice-outfits.png, artifacts/desktop-nice-outfits.png, artifacts/desktop-review.png, artifacts/phone-ready-actions.png, artifacts/phone-review-ready-actions.png, artifacts/phone-archive.png, artifacts/desktop-archive.png, artifacts/phone-staples-all.png, artifacts/desktop-staples-pack-last.png");
