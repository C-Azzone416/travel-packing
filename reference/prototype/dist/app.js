(function () {
  "use strict";

  const core = window.PackCore;
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastEl = document.getElementById("toast");
  const TODAY = "2026-10-16";

  const TOILETRY_GROUP_ID = "toiletry-bag";
  const defaultPackLast = ["Laptop", "Chargers", "Everyday glasses"];
  const CALCULATED_ITEM_IDS = new Set(["tops", "bottoms", "underwear", "socks", "sleepwear", "nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"]);
  const OPTIONAL_NICE_IDS = new Set(["nice-shoes", "nice-makeup", "nice-undergarments"]);

  const initialStaples = [
    { id: "underwear", name: "Underwear", qty: 1, cadence: "per day", category: "Clothing", packLast: false },
    { id: "socks", name: "Socks", qty: 1, cadence: "per day", category: "Clothing", packLast: false },
    { id: "sleepwear", name: "Sleepwear", qty: 1, cadence: "per trip", category: "Clothing", packLast: false },
    { id: "last-toothbrush", name: "Toothbrush", qty: 1, cadence: "per trip", category: "Bathroom", packLast: true, groupId: TOILETRY_GROUP_ID },
    { id: "last-toothpaste", name: "Toothpaste", qty: 1, cadence: "per trip", category: "Bathroom", packLast: true, groupId: TOILETRY_GROUP_ID },
    { id: "last-deodorant", name: "Deodorant", qty: 1, cadence: "per trip", category: "Bathroom", packLast: true, groupId: TOILETRY_GROUP_ID },
    { id: "last-contacts", name: "Contacts", qty: 1, cadence: "per trip", category: "Bathroom", packLast: true, groupId: TOILETRY_GROUP_ID },
    { id: "last-laptop", name: "Laptop", qty: 1, cadence: "per trip", category: "Tech", packLast: true },
    { id: "last-chargers", name: "Chargers", qty: 1, cadence: "per trip", category: "Tech", packLast: true },
    { id: "sunglasses", name: "Sunglasses", qty: 1, cadence: "per trip", category: "Other essentials", packLast: false },
    { id: "last-glasses", name: "Everyday glasses", qty: 1, cadence: "per trip", category: "Other essentials", packLast: true }
  ];

  const sampleLocations = [
    { id: "us-ca-palm-springs", city: "Palm Springs", region: "California", country: "United States", countryCode: "US", label: "Palm Springs, California, United States" },
    { id: "gb-eng-london", city: "London", region: "England", country: "United Kingdom", countryCode: "GB", label: "London, England, United Kingdom" },
    { id: "ca-on-london", city: "London", region: "Ontario", country: "Canada", countryCode: "CA", label: "London, Ontario, Canada" },
    { id: "us-ca-santa-barbara", city: "Santa Barbara", region: "California", country: "United States", countryCode: "US", label: "Santa Barbara, California, United States" },
    { id: "us-ca-san-diego", city: "San Diego", region: "California", country: "United States", countryCode: "US", label: "San Diego, California, United States" },
    { id: "pt-lisbon", city: "Lisbon", region: "Lisbon District", country: "Portugal", countryCode: "PT", label: "Lisbon, Lisbon District, Portugal" },
    { id: "fr-idf-paris", city: "Paris", region: "Île-de-France", country: "France", countryCode: "FR", label: "Paris, Île-de-France, France" }
  ];

  const destinationArtwork = {
    "us-ca-san-diego": { key: "san-diego", src: "assets/destination-san-diego.jpg", label: "San Diego sample artwork" },
    "pt-lisbon": { key: "lisbon", src: "assets/destination-lisbon.jpg", label: "Lisbon sample artwork" },
    "gb-eng-london": { key: "london", src: "assets/destination-london.jpg", label: "London sample artwork" }
  };
  const fallbackArtwork = { key: "fallback", src: "assets/destination-fallback.jpg", label: "Neutral sample artwork" };

  const state = {
    view: "trips",
    selectedTripId: "san-diego",
    filter: "all",
    simulatedSync: "saved",
    pendingTrip: null,
    tripListView: "upcoming",
    staplesFilter: "all",
    deletedTrips: [],
    quickViewOpen: {},
    quickViewFilters: {},
    reviewPrompt: false,
    staples: initialStaples.map(copy),
    trips: []
  };

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function artworkForTrip(trip) {
    const locationId = trip && trip.location && trip.location.id;
    return destinationArtwork[locationId] || fallbackArtwork;
  }

  function destinationVisualMarkup(trip, extraClass, eager) {
    const artwork = artworkForTrip(trip);
    return `<div class="destination-visual ${extraClass || ""}" data-art-key="${artwork.key}">
      <img class="destination-image" src="${artwork.src}" alt="" aria-hidden="true" decoding="async" loading="${eager ? "eager" : "lazy"}">
      <span class="destination-art-label">${artwork.label}</span>
    </div>`;
  }

  function packLastIndicator(extraClass) {
    return '<span class="timing-tag' + (extraClass ? " " + extraClass : "") + '">Pack last</span>';
  }

  function formatDate(value) {
    const date = core.parseDate(value);
    if (!date) return "Choose dates";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  }

  function formatRange(trip) {
    return formatDate(trip.start) + " – " + formatDate(trip.end);
  }

  function item(id, name, category, qty, section) {
    return { id, name, category, qty, packed: 0, section: section || "main" };
  }

  function migrateToiletryBag(trip) {
    const legacyPouch = trip.items.find(function (entry) { return entry.id === "toiletry-pouch"; });
    if (legacyPouch) trip.items = trip.items.filter(function (entry) { return entry.id !== "toiletry-pouch"; });
    const names = ["toothbrush", "toothpaste", "deodorant", "contacts"];
    trip.items.forEach(function (entry) {
      if (names.includes(entry.name.toLowerCase())) entry.groupId = TOILETRY_GROUP_ID;
    });
    if (typeof trip.toiletryBagPacked !== "boolean") trip.toiletryBagPacked = false;
    return trip;
  }

  function suggestedItems(config) {
    return core.calculateSuggestions(config).items.map(function (entry) {
      const suggested = item(entry.id, entry.name, entry.category, entry.qty, "main");
      suggested.optional = Boolean(entry.optional);
      if (entry.id === "nice-makeup") suggested.groupId = TOILETRY_GROUP_ID;
      return suggested;
    });
  }

  function niceAccessoryKey(entry) {
    const name = String(entry && entry.name || "").toLowerCase();
    if (name.includes("makeup") || name.includes("make-up")) return "makeup";
    if (name.includes("dress") && name.includes("shoe")) return "dress-shoes";
    if (name.includes("dress") && name.includes("undergarment")) return "dress-undergarments";
    return "";
  }

  function reconcileTripSuggestions(trip, nextConfig) {
    const oldItems = trip.items.slice();
    const oldToiletrySignature = toiletryChildren(trip).map(function (entry) { return entry.id + ":" + entry.qty; }).sort().join("|");
    trip.suggestionMemory = trip.suggestionMemory || {};
    trip.suppressedSuggestions = trip.suppressedSuggestions || {};
    oldItems.forEach(function (entry) {
      if (CALCULATED_ITEM_IDS.has(entry.id) && !trip.suppressedSuggestions[entry.id]) trip.suggestionMemory[entry.id] = copy(entry);
    });
    const nextSuggested = suggestedItems({ ...nextConfig, start: trip.start, end: trip.end }).filter(function (template) {
      if (trip.suppressedSuggestions[template.id]) return false;
      const key = niceAccessoryKey(template);
      return !key || !oldItems.some(function (entry) { return !CALCULATED_ITEM_IDS.has(entry.id) && niceAccessoryKey(entry) === key; });
    }).map(function (template) {
      const existing = oldItems.find(function (entry) { return entry.id === template.id; });
      const remembered = trip.suggestionMemory[template.id];
      const source = existing || remembered;
      if (!source) return template;
      const merged = copy(template);
      if (source.userEdited || !existing) {
        merged.name = source.name;
        merged.qty = source.qty;
        merged.section = source.section;
        merged.userEdited = Boolean(source.userEdited);
      }
      merged.packed = Math.min(source.packed || 0, merged.qty);
      merged.optional = Boolean(template.optional || source.optional);
      merged.groupId = template.id === "nice-makeup" ? TOILETRY_GROUP_ID : (source.groupId || template.groupId || null);
      return merged;
    });
    const nonCalculated = oldItems.filter(function (entry) { return !CALCULATED_ITEM_IDS.has(entry.id); });
    trip.items = nextSuggested.concat(nonCalculated);
    trip.config = copy(nextConfig);
    trip.days = core.calculateSuggestions({ ...nextConfig, start: trip.start, end: trip.end }).days;
    trip.dailyDays = core.calculateSuggestions({ ...nextConfig, start: trip.start, end: trip.end }).dailyDays;
    const nextToiletrySignature = toiletryChildren(trip).map(function (entry) { return entry.id + ":" + entry.qty; }).sort().join("|");
    if (oldToiletrySignature !== nextToiletrySignature) trip.toiletryBagPacked = false;
    trip.ready = false;
  }

  function makeTrip(destination, start, end, config, options) {
    const opts = options || {};
    const computed = core.calculateSuggestions({ ...config, start, end });
    const mainItems = suggestedItems({ ...config, start, end });
    mainItems.push(item("sunglasses", "Sunglasses", "Accessories", 1, "main"));
    const packLast = defaultPackLast.map(function (name) {
      const id = name === "Everyday glasses" ? "last-glasses" : "last-" + name.toLowerCase().replaceAll(" ", "-");
      return item(id, name, "Pack last", 1, "packlast");
    });
    const returnItems = config.returnOutfit === false ? [] : [
      item("return-top", "Fresh top", "Return outfit", 1, "return"),
      item("return-bottoms", "Bottoms", "Return outfit", 1, "return"),
      item("return-underwear", "Underwear", "Return outfit", 1, "return"),
      item("return-socks", "Socks", "Return outfit", 1, "return")
    ];
    const tripItems = mainItems.concat(returnItems, packLast);
    state.staples.forEach(function (staple) {
      let qty = staple.cadence === "per day" ? computed.dailyDays * staple.qty : staple.qty;
      if ((staple.id === "underwear" || staple.id === "socks") && config.spare) qty += 1;
      const stapleKey = niceAccessoryKey(staple);
      const existing = tripItems.find(function (entry) { return entry.id === staple.id || (stapleKey && niceAccessoryKey(entry) === stapleKey); });
      if (qty <= 0 && !existing) return;
      if (existing) {
        if (existing.id !== staple.id && stapleKey) existing.id = staple.id;
        existing.name = staple.name;
        existing.category = staple.category;
        existing.qty = qty;
        if (existing.section !== "return") existing.section = staple.packLast ? "packlast" : "main";
        existing.groupId = stapleKey === "makeup" ? TOILETRY_GROUP_ID : (staple.groupId || null);
      } else {
        const added = item(staple.id, staple.name, staple.category, qty, staple.packLast ? "packlast" : "main");
        added.groupId = stapleKey === "makeup" ? TOILETRY_GROUP_ID : (staple.groupId || null);
        tripItems.push(added);
      }
    });
    return migrateToiletryBag({
      id: opts.id || uid("trip"),
      destination,
      location: opts.location ? copy(opts.location) : null,
      start,
      end,
      config: copy(config),
      days: computed.days,
      dailyDays: computed.dailyDays,
      items: tripItems,
      suggestionMemory: {},
      suppressedSuggestions: {},
      toiletryBagPacked: false,
      ready: false,
      weather: { status: "pending", label: core.forecastLabel(start, TODAY), suggestion: "Compact umbrella" },
      copiedFrom: opts.copiedFrom || null,
      archived: Boolean(opts.archived),
      createdFromSample: true
    });
  }

  const sampleConfig = { laundry: false, spare: true, niceAttire: true, occasionCount: 1, reuseNice: true, returnOutfit: true };
  const sanDiego = makeTrip("San Diego", "2026-10-23", "2026-10-27", sampleConfig, { id: "san-diego", location: sampleLocations.find(function (entry) { return entry.id === "us-ca-san-diego"; }) });
  ["tops", "underwear", "socks", "sleepwear", "sunglasses"].forEach(function (id) {
    const found = sanDiego.items.find(function (entry) { return entry.id === id; });
    if (found) found.packed = Math.min(found.qty, id === "underwear" ? 2 : 1);
  });
  const lisbon = makeTrip("Lisbon", "2026-09-03", "2026-09-07", { ...sampleConfig, laundry: true, spare: false }, { id: "lisbon", location: sampleLocations.find(function (entry) { return entry.id === "pt-lisbon"; }) });
  lisbon.items.forEach(function (entry) { entry.packed = entry.qty; });
  lisbon.toiletryBagPacked = true;
  lisbon.ready = true;
  lisbon.weather.status = "accepted";
  lisbon.items.push(item("weather-umbrella", "Compact umbrella", "Weather suggestion", 1, "main"));
  lisbon.items[lisbon.items.length - 1].packed = 1;
  state.trips = [sanDiego, lisbon];

  function getTrip() {
    return state.trips.find(function (trip) { return trip.id === state.selectedTripId; }) || state.trips[0];
  }

  function allPacked(trip) {
    const itemsPacked = trip.items.length > 0 && trip.items.every(function (entry) { return entry.packed >= entry.qty; });
    const toiletries = toiletryChildren(trip);
    return itemsPacked && (!toiletries.length || trip.toiletryBagPacked);
  }

  function packedTotals(trip) {
    const totals = trip.items.reduce(function (total, entry) {
      total.total += entry.qty;
      total.packed += Math.min(entry.packed, entry.qty);
      return total;
    }, { packed: 0, total: 0 });
    if (toiletryChildren(trip).length) {
      totals.total += 1;
      totals.packed += trip.toiletryBagPacked ? 1 : 0;
    }
    return totals;
  }

  function isPastTrip(trip) {
    const end = core.parseDate(trip.end);
    const today = core.parseDate(TODAY);
    return Boolean(end && today && end < today);
  }

  function upcomingTrips() {
    return state.trips.filter(function (trip) { return !trip.archived && !isPastTrip(trip); });
  }

  function pastAndArchivedTrips() {
    return state.trips.filter(function (trip) { return trip.archived || isPastTrip(trip); });
  }

  function findSampleLocation(id) {
    return sampleLocations.find(function (entry) { return entry.id === id; }) || null;
  }

  function startNewDraft() {
    state.pendingTrip = {
      mode: "create",
      sourceId: null,
      destinationQuery: "Palm Springs",
      location: null,
      start: "2026-11-12",
      end: "2026-11-16",
      config: copy(sampleConfig)
    };
    setView("create");
  }

  function startCopyDraft(tripId) {
    const source = state.trips.find(function (trip) { return trip.id === tripId; });
    if (!source) return;
    state.pendingTrip = {
      mode: "copy",
      sourceId: source.id,
      destinationQuery: "Santa Barbara",
      location: null,
      start: "2026-12-04",
      end: "2026-12-08",
      config: copy(source.config)
    };
    setView("create");
  }

  function normalizeDraftDates(start, end) {
    const normalized = core.normalizeTripDates(start, end);
    if (state.pendingTrip) {
      state.pendingTrip.start = normalized.start;
      state.pendingTrip.end = normalized.end;
    }
    return normalized;
  }

  function announce(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  function setView(view, options) {
    state.view = view;
    if (!options || !options.keepFilter) state.filter = "all";
    closeModal();
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
    app.focus({ preventScroll: true });
  }

  function setSync(value) {
    state.simulatedSync = value;
    const chip = document.getElementById("sync-chip");
    const label = document.getElementById("sync-label");
    chip.className = "sync-chip " + value;
    const labels = { saved: "Saved · simulated", offline: "Offline · simulated", waiting: "Waiting · simulated" };
    label.textContent = labels[value];
  }

  function navState(active) {
    document.querySelectorAll("[data-nav]").forEach(function (button) {
      if (button.dataset.nav === active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function render() {
    if (state.view === "trips") renderTrips();
    else if (state.view === "create") renderCreate();
    else if (state.view === "builder") renderBuilder();
    else if (state.view === "trip") renderTrip();
    else if (state.view === "review") renderReview();
    else if (state.view === "staples") renderStaples();
    else if (state.view === "settings") renderSettings();
    setSync(state.simulatedSync);
  }

  function quickViewCategory(title, entries, filter) {
    const visible = filter === "still" ? entries.filter(function (entry) { return entry.packed < entry.qty; }) : entries;
    if (!visible.length) return "";
    return `<section class="quick-view-category"><h4>${title}</h4>${visible.map(function (entry) {
      const remaining = Math.max(0, entry.qty - entry.packed);
      const detail = remaining ? remaining + " left" : "Packed";
      return `<div class="quick-view-row"><span class="quick-view-item-name">${escapeHtml(entry.name)}${entry.section === "packlast" ? packLastIndicator("quick-timing") : ""}</span><strong>${detail}</strong></div>`;
    }).join("")}</section>`;
  }

  function quickViewMarkup(trip) {
    const filter = state.quickViewFilters[trip.id] || "still";
    const main = trip.items.filter(function (entry) { return entry.section === "main" && entry.groupId !== TOILETRY_GROUP_ID; });
    const toiletries = toiletryChildren(trip);
    const returns = trip.items.filter(function (entry) { return entry.section === "return"; });
    const packLast = trip.items.filter(function (entry) { return entry.section === "packlast" && entry.groupId !== TOILETRY_GROUP_ID; });
    const categories = [
      quickViewCategory("Clothing & essentials", main, filter),
      quickViewCategory("Toiletries", toiletries, filter),
      quickViewCategory("Return outfit", returns, filter),
      quickViewCategory("Pack last", packLast, filter)
    ].filter(Boolean).join("");
    const toiletriesComplete = toiletries.length > 0 && toiletries.every(function (entry) { return entry.packed >= entry.qty; });
    const bagStatus = trip.toiletryBagPacked
      ? '<span class="quick-bag-status complete">✓ In suitcase</span>'
      : toiletriesComplete
        ? '<span class="quick-bag-status pending">Still outside suitcase</span>'
        : '<span class="quick-bag-status waiting">Waiting on contents</span>';
    return `<div class="quick-view" id="quick-view-${trip.id}">
      <div class="quick-view-head"><div><p class="eyebrow">Read-only preview</p><h3>Packing quick view</h3></div><div class="quick-filters" role="group" aria-label="Quick view filter for ${escapeHtml(trip.destination)}"><button type="button" data-action="quick-view-filter" data-trip="${trip.id}" data-filter="still" aria-pressed="${filter === "still"}">Still to pack</button><button type="button" data-action="quick-view-filter" data-trip="${trip.id}" data-filter="all" aria-pressed="${filter === "all"}">All</button></div></div>
      <div class="quick-view-list">${categories || '<div class="empty-state compact">No items left in this view.</div>'}</div>
      <div class="quick-bag-row"><span><strong>Toiletry bag placement</strong><small>Separate completion gate</small></span>${bagStatus}</div>
      <button class="button secondary small" type="button" data-action="open-trip" data-trip="${trip.id}">View full list</button>
    </div>`;
  }

  function renderTrips() {
    navState("trips");
    const showingArchive = state.tripListView === "archive";
    const visibleTrips = showingArchive ? pastAndArchivedTrips() : upcomingTrips();
    const cards = visibleTrips.map(function (trip) {
      const totals = packedTotals(trip);
      const percent = totals.total ? Math.round(totals.packed / totals.total * 100) : 0;
      const remaining = totals.total - totals.packed;
      const status = trip.ready
        ? '<span class="status-pill ready" aria-label="Ready to go"><span aria-hidden="true">✓</span> Ready to go</span>'
        : '<span class="status-pill remaining" aria-label="' + remaining + ' items left to pack"><span aria-hidden="true">▣</span> ' + remaining + ' left to pack</span>';
      const tripKind = trip.archived ? "Archived trip" : isPastTrip(trip) ? "Past trip" : "Sample trip";
      const archiveAction = !showingArchive
        ? '<button class="button ghost small" type="button" data-action="archive-trip" data-trip="' + trip.id + '">Archive</button>'
        : trip.archived && !isPastTrip(trip)
          ? '<button class="button secondary small" type="button" data-action="restore-trip" data-trip="' + trip.id + '">Restore</button>'
          : "";
      const quickOpen = Boolean(state.quickViewOpen[trip.id]);
      return `
        <article class="card trip-card">
          ${destinationVisualMarkup(trip, "trip-card-visual", !showingArchive)}
          <div class="trip-card-body">
            <div class="trip-top">
              <div><p class="eyebrow">${tripKind}</p><h2>${escapeHtml(trip.destination)}</h2><div class="item-meta">${trip.location ? escapeHtml(trip.location.region + ", " + trip.location.country) : "Sample location"}</div></div>
              ${status}
            </div>
            <div class="meta"><span>◷ ${formatRange(trip)}</span><span>${trip.days} days</span><span>${trip.weather.label} · simulated</span></div>
            <div class="progress-track" aria-label="${percent}% packed"><span style="width:${percent}%"></span></div>
            <div class="progress-copy"><span>${totals.packed} of ${totals.total} packed</span><span>${percent}%</span></div>
            <button class="quick-view-toggle" type="button" data-action="toggle-quick-view" data-trip="${trip.id}" aria-expanded="${quickOpen}" aria-controls="quick-view-${trip.id}"><span>Quick view</span><span class="chevron" aria-hidden="true">${quickOpen ? "⌃" : "⌄"}</span></button>
            ${quickOpen ? quickViewMarkup(trip) : ""}
            <div class="actions">
              <button class="button small" type="button" data-action="open-trip" data-trip="${trip.id}">${trip.ready ? "Review bag" : "Keep packing"}</button>
              <button class="button secondary small" type="button" data-action="copy-trip" data-trip="${trip.id}">Copy trip</button>
              ${archiveAction}
              <button class="button ghost small" type="button" data-action="remove-trip" data-trip="${trip.id}">Remove</button>
            </div>
          </div>
        </article>`;
    }).join("");

    app.innerHTML = `
      <section class="screen">
        ${showingArchive ? `
        <div class="page-head"><div class="head-copy"><p class="eyebrow">Trip history</p><h1>Past trips & archive</h1><p class="muted">Past dates appear here automatically. Archiving is separate from whether a trip is Ready.</p></div></div>` : `
        <div class="hero">
          <div class="hero-art" aria-hidden="true"><div class="sun"></div><div class="hill one"></div><div class="hill two"></div><div class="palm">⌁</div></div>
          <div class="hero-copy">
            <p class="eyebrow">Less remembering. More ready.</p>
            <h1>Pack for the trip, not the anxiety.</h1>
            <p>Create a personal list that accounts for your travel days, return outfit, laundry plans, and the things you pack last.</p>
            <div class="actions"><button class="button" type="button" data-action="new-trip">＋ Create a sample trip</button></div>
          </div>
        </div>`}
        ${showingArchive ? "" : '<p class="artwork-note">Illustrative sample art is matched from a small local prototype set. Unknown destinations use a neutral scene; there is no live photo or location-image service.</p>'}
        <div class="section-head"><div><p class="eyebrow">Your trips</p><h2>${showingArchive ? "Trip history" : "Where are we going?"}</h2></div></div>
        <div class="trip-tabs" role="group" aria-label="Trip views">
          <button type="button" class="${showingArchive ? "" : "active"}" data-action="trip-list-view" data-view="upcoming">Upcoming <span>${upcomingTrips().length}</span></button>
          <button type="button" class="${showingArchive ? "active" : ""}" data-action="trip-list-view" data-view="archive">Past & archive <span>${pastAndArchivedTrips().length}</span></button>
        </div>
        <div class="card-grid">${cards || `<div class="empty-state"><strong>${showingArchive ? "No past or archived trips yet." : "No upcoming trips."}</strong><br />${showingArchive ? "Archived trips and trips whose return date has passed will appear here." : "Create a sample trip or restore one from Past & archive."}</div>`}</div>
        ${showingArchive ? `
          <div class="section-head"><div><p class="eyebrow">Recoverable</p><h2>Recently deleted</h2></div></div>
          <div class="card panel deleted-list">${state.deletedTrips.length ? state.deletedTrips.map(function (entry) {
            return `<div class="archive-row"><div><strong>${escapeHtml(entry.trip.destination)}</strong><div class="item-meta">${formatRange(entry.trip)} · sample trip</div></div><button class="button secondary small" type="button" data-action="undo-remove" data-trip="${entry.trip.id}">Undo remove</button></div>`;
          }).join("") : '<div class="empty-state">Nothing recently deleted.</div>'}</div>
        ` : ""}
      </section>`;
  }

  function matchingSampleLocations(query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    return sampleLocations.filter(function (entry) {
      return entry.label.toLowerCase().includes(needle);
    }).slice(0, 5);
  }

  function locationPickerMarkup(draft) {
    const matches = matchingSampleLocations(draft.destinationQuery);
    if (draft.location) {
      return `<div class="confirmed-location" role="status"><span aria-hidden="true">✓</span><div><strong>Confirmed sample location</strong><small>${escapeHtml(draft.location.city)} · ${escapeHtml(draft.location.region)} · ${escapeHtml(draft.location.country)}</small></div></div>`;
    }
    if (!draft.destinationQuery.trim()) return '<div class="location-hint">Type a city, then choose a SAMPLE result.</div>';
    if (!matches.length) return '<div class="empty-state compact">No local sample matches. Try London, Palm Springs, Santa Barbara, San Diego, Lisbon, or Paris.</div>';
    return `<div class="location-results" role="listbox" aria-label="Local sample location matches">${matches.map(function (entry) {
      return `<button type="button" role="option" data-action="select-location" data-location="${entry.id}"><strong>${escapeHtml(entry.city)}</strong><span>${escapeHtml(entry.region)}, ${escapeHtml(entry.country)}</span><small>SAMPLE</small></button>`;
    }).join("")}</div>`;
  }

  function updateLocationPickerUI() {
    const draft = state.pendingTrip;
    const target = document.getElementById("location-picker-results");
    const input = document.querySelector('input[name="destination"]');
    if (target && draft) target.innerHTML = locationPickerMarkup(draft);
    if (input) input.setAttribute("aria-invalid", draft && draft.location ? "false" : "true");
  }

  function renderCreate() {
    navState("trips");
    const draft = state.pendingTrip;
    if (!draft) return startNewDraft();
    const copying = draft.mode === "copy";
    const source = copying ? state.trips.find(function (trip) { return trip.id === draft.sourceId; }) : null;
    app.innerHTML = `
      <section class="screen">
        <div class="page-head">
          <button class="back" type="button" data-action="cancel-draft" aria-label="Cancel draft and return to trips">←</button>
          <div class="head-copy"><p class="eyebrow">${copying ? "Copy trip draft" : "New sample trip draft"}</p><h1>Confirm the trip</h1><p class="muted">This stays a draft and will not appear on the dashboard until you explicitly save it.</p></div>
        </div>
        <form class="card panel form-grid" id="create-form">
          <label class="field">Destination search
            <input name="destination" value="${escapeHtml(draft.destinationQuery)}" required maxlength="50" autocomplete="off" aria-describedby="location-picker-note" aria-invalid="${draft.location ? "false" : "true"}" />
          </label>
          <div id="location-picker-note" class="tiny muted"><strong>Local SAMPLE picker:</strong> choose the city, region, and country you mean. Free text is never treated as a confirmed weather location.</div>
          <div id="location-picker-results">${locationPickerMarkup(draft)}</div>
          <div class="two-col">
            <label class="field">Leave
              <input name="start" type="date" value="${draft.start}" required />
            </label>
            <label class="field">Return
              <input name="end" type="date" value="${draft.end}" min="${draft.start}" required />
            </label>
          </div>
          <div id="date-note" class="tiny muted">Same-day trips are allowed. Return cannot be before departure.</div>
          ${copying && source ? `<div class="callout"><strong>The original ${escapeHtml(source.destination)} trip stays unchanged.</strong> This copy will recalculate suggestions and clear every packing checkmark only after Save trip.</div>` : ""}
          <div class="callout"><strong>Sample data only.</strong> This prototype has no account, booking import, live geocoding, or durable cloud storage.</div>
          <div class="actions"><button class="button" type="submit">Continue to packing preferences</button><button class="button secondary" type="button" data-action="cancel-draft">Cancel draft</button></div>
        </form>
      </section>`;
  }

  function pendingConfig() {
    const draft = state.pendingTrip;
    return core.calculateSuggestions({ ...draft.config, start: draft.start, end: draft.end });
  }

  function renderBuilder() {
    navState("trips");
    const draft = state.pendingTrip;
    if (!draft) return startNewDraft();
    const calculated = pendingConfig();
    const items = calculated.items.map(function (entry) {
      return '<div class="review-row"><div><strong>' + escapeHtml(entry.name) + '</strong><div class="item-meta">' + escapeHtml(entry.category) + (entry.optional ? ' · optional' : '') + '</div></div><span class="tag">' + entry.qty + '</span></div>';
    }).join("");
    const forecast = core.forecastLabel(draft.start, TODAY);
    app.innerHTML = `
      <section class="screen">
        <div class="page-head">
          <button class="back" type="button" data-action="builder-back" aria-label="Back">←</button>
          <div class="head-copy"><p class="eyebrow">Unsaved ${draft.mode === "copy" ? "copy" : "trip"} draft</p><h1>Shape the list</h1><p class="muted">${escapeHtml(draft.location.label)} · ${formatDate(draft.start)} – ${formatDate(draft.end)} · ${calculated.days} days</p></div>
        </div>
        <div class="builder-layout">
          <div class="card panel">
            <h2>Your packing preferences</h2>
            <div class="toggle-row"><div><strong>Laundry access</strong><p>Reduce repeatable everyday clothing.</p></div><label class="switch"><input type="checkbox" data-config="laundry" ${draft.config.laundry ? "checked" : ""} /><span></span></label></div>
            <div class="toggle-row"><div><strong>One spare underwear + socks</strong><p>Added to the bag count, not the return outfit.</p></div><label class="switch"><input type="checkbox" data-config="spare" ${draft.config.spare ? "checked" : ""} /><span></span></label></div>
            <div class="toggle-row"><div><strong>Nice outfits</strong><p>Add planned occasion looks plus one editable Dress shoes, Makeup, and Dress-specific undergarments suggestion.</p></div><label class="switch"><input type="checkbox" data-config="niceAttire" ${draft.config.niceAttire ? "checked" : ""} /><span></span></label></div>
            <div class="two-col" style="margin-top:14px;">
              <label class="field">Occasions
                <input type="number" min="1" max="8" value="${draft.config.occasionCount}" data-config-number="occasionCount" ${draft.config.niceAttire ? "" : "disabled"} />
              </label>
              <div class="toggle-row" style="padding:4px 0;"><div><strong>Reuse one nice look</strong><p>Repeat the same pieces.</p></div><label class="switch"><input type="checkbox" data-config="reuseNice" ${draft.config.reuseNice ? "checked" : ""} ${draft.config.niceAttire ? "" : "disabled"} /><span></span></label></div>
            </div>
            <div class="toggle-row"><div><strong>Dedicated return travel outfit</strong><p>Fresh top, bottoms, underwear, and socks stay separate from everyday items.</p></div><label class="switch"><input type="checkbox" data-config="returnOutfit" ${draft.config.returnOutfit ? "checked" : ""} /><span></span></label></div>
            <div class="callout" style="margin-top:14px;"><strong>How counts work:</strong> the outbound outfit is worn, not packed. The return outfit covers return day, so return day is not counted again in everyday quantities.</div>
          </div>
          <aside class="card panel">
            <p class="eyebrow">Live sample calculation</p><h2>${calculated.dailyDays} everyday days</h2>
            <div class="count-summary"><div><strong>${calculated.days}</strong><span>TRIP DAYS</span></div><div><strong>1</strong><span>OUTBOUND WORN</span></div><div><strong>${draft.config.returnOutfit ? 1 : 0}</strong><span>RETURN SET</span></div></div>
            <div class="weather-card"><span class="tag">Simulated · ${forecast}</span><h3 style="margin-top:12px;">Weather suggestions wait for you</h3><p class="tiny muted">The prototype will offer a review card before changing the list.</p></div>
            <div class="review-group">${items}</div>
            <div class="callout" style="margin-bottom:14px;"><strong>Not on your dashboard yet.</strong> Review the details and preferences, then use Save trip.</div>
            <div class="actions"><button class="button" type="button" data-action="save-trip">Save trip</button><button class="button secondary" type="button" data-action="builder-back">Edit trip details</button><button class="button ghost" type="button" data-action="cancel-draft">Cancel draft</button></div>
          </aside>
        </div>
      </section>`;
  }

  function weatherMarkup(trip) {
    if (trip.weather.status === "accepted") return '<div class="weather-card"><span class="tag">Simulated · accepted</span><h3 style="margin-top:10px;">Weather suggestion added</h3><p class="tiny muted">Compact umbrella was added after review.</p></div>';
    if (trip.weather.status === "skipped") return '<div class="weather-card"><span class="tag">Simulated · skipped</span><h3 style="margin-top:10px;">No weather changes applied</h3><button class="button ghost small" type="button" data-action="reopen-weather">Review again</button></div>';
    return `<div class="weather-card"><span class="tag">Simulated · ${trip.weather.label}</span><h3 style="margin-top:10px;">Rain looks more likely</h3><p class="tiny muted">Review an umbrella suggestion. Your list will not change unless you accept.</p><button class="button secondary small" type="button" data-action="review-weather">Review suggestion</button></div>`;
  }

  function packRow(entry, trip) {
    const complete = entry.packed >= entry.qty;
    const timing = entry.section === "packlast" ? packLastIndicator("item-timing") : "";
    const editButton = '<button type="button" class="item-body" data-action="edit-trip-item" data-item="' + entry.id + '" style="border:0;background:none;text-align:left;padding:0;cursor:pointer;"><div class="item-name">' + escapeHtml(entry.name) + '</div><div class="item-meta">' + escapeHtml(entry.category) + ' · tap to edit quantity' + timing + '</div></button>';
    return `
      <div class="pack-row ${complete ? "complete" : ""}" data-item-id="${entry.id}">
        <button class="check-button" type="button" data-action="toggle-item" data-item="${entry.id}" aria-label="${complete ? "Mark " + escapeHtml(entry.name) + " unpacked" : "Pack all " + escapeHtml(entry.name)}">${complete ? "✓" : ""}</button>
        ${editButton}
        <div class="qty-stepper" aria-label="${escapeHtml(entry.name)} packed quantity">
          <button type="button" data-action="packed-minus" data-item="${entry.id}" aria-label="Pack one fewer">−</button>
          <span>${entry.packed}/${entry.qty}</span>
          <button type="button" data-action="packed-plus" data-item="${entry.id}" aria-label="Pack one more">＋</button>
        </div>
      </div>`;
  }

  function listSection(title, subtitle, entries, trip) {
    const visible = state.filter === "still" ? entries.filter(function (entry) { return entry.packed < entry.qty; }) : entries;
    return `
      <section class="list-section">
        <div class="list-section-head"><div><h3>${title}</h3><div class="item-meta">${subtitle}</div></div><span class="tag">${visible.length}</span></div>
        <div class="packing-list">${visible.length ? visible.map(function (entry) { return packRow(entry, trip); }).join("") : '<div class="empty-state">Nothing left in this section.</div>'}</div>
      </section>`;
  }

  function toiletryChildren(trip) {
    return trip.items.filter(function (entry) { return entry.groupId === TOILETRY_GROUP_ID; });
  }

  function toiletryBagMarkup(trip) {
    const entries = toiletryChildren(trip);
    const visible = state.filter === "still" ? entries.filter(function (entry) { return entry.packed < entry.qty; }) : entries;
    const contentsComplete = entries.length > 0 && entries.every(function (entry) { return entry.packed >= entry.qty; });
    if (state.filter === "still" && !visible.length && trip.toiletryBagPacked) return "";
    const completeCount = entries.filter(function (entry) { return entry.packed >= entry.qty; }).length;
    const bagGate = !contentsComplete
      ? '<div class="bag-placement waiting"><div><strong>Toiletry bag not ready to place</strong><p>Check every Bathroom item first. The bag itself remains a separate suitcase step.</p></div><span class="status-pill">Waiting</span></div>'
      : trip.toiletryBagPacked
        ? '<div class="bag-placement complete"><div><strong>Toiletry bag is in the suitcase</strong><p>Contents stay checked. You can undo only this placement step.</p></div><button class="button secondary small" type="button" data-action="undo-toiletry-bag">Undo placement</button></div>'
        : '<div class="bag-placement pending"><div><strong>Toiletry bag ready to place</strong><p>All Bathroom items are checked. The bag is still outside the suitcase.</p></div><button class="button small" type="button" data-action="prompt-toiletry-bag">Put bag in suitcase</button></div>';
    return `
      <section class="toiletry-section" aria-labelledby="toiletry-title-${trip.id}">
        <div class="list-section-head"><div><h3 id="toiletry-title-${trip.id}">Toiletries</h3><div class="item-meta">Bathroom · ${completeCount} of ${entries.length} contents checked</div></div><span class="tag">${visible.length}</span></div>
        <p class="tiny muted toiletry-explainer">Check each item normally. After every required item is checked, confirm the separate step of putting the toiletry bag in the suitcase.</p>
        <div class="packing-list">${visible.length ? visible.map(function (entry) { return packRow(entry, trip); }).join("") : '<div class="empty-state compact">All toiletry contents are checked.</div>'}</div>
        ${bagGate}
        <button class="button ghost small" type="button" data-action="add-toiletry-item">＋ Add a Bathroom item</button>
      </section>`;
  }

  function renderTrip() {
    navState("trips");
    const trip = getTrip();
    const totals = packedTotals(trip);
    const percent = totals.total ? Math.round(totals.packed / totals.total * 100) : 0;
    const main = trip.items.filter(function (entry) { return entry.section === "main" && entry.groupId !== TOILETRY_GROUP_ID; });
    const toiletries = toiletryChildren(trip);
    const returns = trip.items.filter(function (entry) { return entry.section === "return"; });
    const packLast = trip.items.filter(function (entry) { return entry.section === "packlast"; });
    const prompt = allPacked(trip) && !trip.ready ? `
      <div class="review-prompt">
        <h3>Everything is checked. Want to review?</h3>
        <p>We will show the full bag—including Pack last and the return outfit—before you decide it is ready.</p>
        <button class="button secondary" type="button" data-action="review-bag">Review your bag</button>
      </div>` : "";
    const ready = trip.ready ? `<div class="card ready-card"><p class="eyebrow" style="color:#b9ddd0;">Confirmed after review</p><h2>You’re ready to go.</h2><p>You can still correct anything below. Any checklist change will revoke Ready, or you can mark the trip not ready without changing packing progress.</p><div class="actions"><button class="button secondary small" type="button" data-action="review-bag">Review bag again</button><button class="button ready-secondary small" type="button" data-action="mark-not-ready">Mark as not ready</button></div></div>` : "";

    app.innerHTML = `
      <section class="screen">
        <div class="destination-trip-head">
          ${destinationVisualMarkup(trip, "trip-head-visual", true)}
          <div class="destination-head-content">
            <button class="back" type="button" data-action="go-trips" aria-label="Back to trips">←</button>
            <div class="head-copy destination-head-copy"><p class="eyebrow">Sample trip</p><h1>${escapeHtml(trip.destination)}</h1><p>${trip.location ? escapeHtml(trip.location.region + ", " + trip.location.country) + " · " : ""}${formatRange(trip)} · ${trip.days} days</p></div>
            ${trip.ready ? '<span class="status-pill ready">Ready</span>' : '<span class="status-pill">Packing</span>'}
          </div>
        </div>
        <div class="trip-layout">
          <div>
            <div class="card panel">
              <div class="section-head" style="margin-top:0;"><div><h2>Packing list</h2><p class="tiny muted">Partial quantities count as progress.</p></div><strong>${percent}%</strong></div>
              <div class="progress-track"><span style="width:${percent}%"></span></div>
              <div class="filters" role="group" aria-label="Packing list filters"><button class="filter ${state.filter === "all" ? "active" : ""}" type="button" data-action="filter" data-filter="all">All</button><button class="filter ${state.filter === "still" ? "active" : ""}" type="button" data-action="filter" data-filter="still">Still to pack</button></div>
              ${listSection("Everyday & occasion items", main.length + " loose items", main, trip)}
              ${toiletryBagMarkup(trip)}
              ${listSection("Return travel outfit", "Fresh set kept separate from everyday counts", returns, trip)}
              ${listSection("Pack last", toiletries.length + " toiletry items share this timing view", packLast, trip)}
              ${prompt}
            </div>
          </div>
          <aside class="side">
            ${ready}
            <div style="height:12px"></div>
            ${weatherMarkup(trip)}
            <div class="card panel" style="margin-top:12px;"><h3>Trip math</h3><p class="tiny muted">${trip.days} trip days − outbound worn − return outfit = <strong>${trip.dailyDays} everyday days</strong>.</p><button class="button ghost small" type="button" data-action="edit-preferences">Edit preferences</button></div>
          </aside>
        </div>
      </section>`;
  }

  function reviewRows(title, entries) {
    return `<section class="review-group"><div class="list-section-head"><div><h3>${title}</h3></div><span class="tag">${entries.length}</span></div>${entries.map(function (entry) {
      const complete = entry.packed >= entry.qty;
      return `<div class="review-row" data-item-id="${entry.id}"><div><strong>${escapeHtml(entry.name)}</strong>${entry.section === "packlast" ? packLastIndicator("review-timing") : ""}<div class="item-meta">${entry.packed} of ${entry.qty} packed</div></div><button class="button ${complete ? "secondary" : ""} small" type="button" data-action="review-toggle" data-item="${entry.id}">${complete ? "Packed ✓" : "Fix: unpacked"}</button></div>`;
    }).join("")}</section>`;
  }

  function reviewToiletryBagGate(trip) {
    const entries = toiletryChildren(trip);
    const contentsComplete = entries.length > 0 && entries.every(function (entry) { return entry.packed >= entry.qty; });
    const action = !contentsComplete
      ? '<span class="status-pill">Waiting on contents</span>'
      : trip.toiletryBagPacked
        ? '<button class="button secondary small" type="button" data-action="undo-toiletry-bag">Undo placement</button>'
        : '<button class="button small" type="button" data-action="prompt-toiletry-bag">Put bag in suitcase</button>';
    return `<section class="review-group bag-review-gate"><div class="review-row"><div><strong>Toiletry bag in suitcase</strong><div class="item-meta">Separate completion gate · ${trip.toiletryBagPacked ? "confirmed" : "not confirmed"}</div></div>${action}</div></section>`;
  }

  function renderReview() {
    navState("trips");
    const trip = getTrip();
    const main = trip.items.filter(function (entry) { return entry.section === "main"; });
    const toiletries = toiletryChildren(trip);
    const returns = trip.items.filter(function (entry) { return entry.section === "return"; });
    const packLast = trip.items.filter(function (entry) { return entry.section === "packlast"; });
    const complete = allPacked(trip);
    const toiletriesContentsComplete = toiletries.length > 0 && toiletries.every(function (entry) { return entry.packed >= entry.qty; });
    const reviewStatus = trip.ready ? "This trip is currently Ready." : toiletriesContentsComplete && !trip.toiletryBagPacked ? "Toiletry contents are checked, but the bag is not confirmed in the suitcase." : complete ? "Everything is packed." : "There are still unpacked items.";
    const reviewHelp = trip.ready ? "Reviewing does not change that unless you choose below or correct an item." : toiletriesContentsComplete && !trip.toiletryBagPacked ? "Confirm the separate bag-placement step before Ready is available." : complete ? "Ready is still your decision." : "Correct the items above before confirming.";
    const reviewActions = trip.ready
      ? `<button class="button secondary" type="button" data-action="mark-not-ready">Mark as not ready</button><button class="button ghost" type="button" data-action="back-to-trip">Back to packing list</button>`
      : `<button class="button" type="button" data-action="confirm-ready" ${complete ? "" : "disabled"}>I’m ready to go</button><button class="button secondary" type="button" data-action="back-to-trip">Back to packing list</button>`;
    app.innerHTML = `
      <section class="screen">
        <div class="page-head"><button class="back" type="button" data-action="back-to-trip" aria-label="Back to packing list">←</button><div class="head-copy"><p class="eyebrow">Final check</p><h1>Review your bag</h1><p class="muted">Nothing becomes Ready automatically. Make corrections here, then confirm when it looks right.</p></div></div>
        <div class="card panel" style="max-width:760px;margin:0 auto;">
          ${reviewRows("Everyday & occasion items", main.filter(function (entry) { return entry.groupId !== TOILETRY_GROUP_ID; }))}
          ${reviewRows("Toiletries · Bathroom", toiletries)}
          ${reviewToiletryBagGate(trip)}
          ${reviewRows("Return travel outfit", returns)}
          ${reviewRows("Pack last timing view", packLast)}
          <div class="callout"><strong>${reviewStatus}</strong> ${reviewHelp}</div>
          <div class="actions" style="margin-top:16px;">${reviewActions}</div>
        </div>
      </section>`;
  }

  function renderStaples() {
    navState("staples");
    function stapleCategory(entry) {
      if (entry.groupId === TOILETRY_GROUP_ID) return "Bathroom";
      const category = String(entry.category || "").toLowerCase();
      if (category === "clothes" || category === "clothing") return "Clothing";
      if (category === "toiletries" || category === "bathroom") return "Bathroom";
      if (category === "tech" || category === "technology") return "Tech";
      if (category === "accessories" || category === "other" || category === "other essentials") return "Other essentials";
      return entry.category || "Other essentials";
    }
    function stapleRows(entries) {
      return entries.map(function (entry) {
      return `<div class="staple-row"><div class="staple-name"><strong>${escapeHtml(entry.name)}</strong>${entry.packLast ? packLastIndicator() : ""}</div><span class="unit-badge">${entry.qty} ${escapeHtml(entry.cadence)}</span><button class="icon-button" type="button" data-action="edit-staple" data-staple="${entry.id}" aria-label="Edit ${escapeHtml(entry.name)}">✎</button></div>`;
      }).join("");
    }
    const visible = state.staples.filter(function (entry) { return state.staplesFilter !== "packlast" || entry.packLast; });
    const order = ["Clothing", "Bathroom", "Tech", "Other essentials"];
    const categoryNames = Array.from(new Set(visible.map(stapleCategory))).sort(function (a, b) {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    const categories = categoryNames.map(function (name) {
      const entries = visible.filter(function (entry) { return stapleCategory(entry) === name; });
      const description = name === "Bathroom"
        ? "These appear as normal Toiletries checkboxes; bag placement stays a separate confirmation."
        : name === "Tech"
          ? "Devices and their shared charging kit."
          : "Recurring essentials for every new trip.";
      return `<section class="staple-category" aria-labelledby="staple-${name.toLowerCase().replaceAll(" ", "-")}"><div class="staple-category-head"><div><h2 id="staple-${name.toLowerCase().replaceAll(" ", "-")}">${escapeHtml(name)}</h2><p>${description}</p></div><span class="category-count">${entries.length}</span></div>${stapleRows(entries)}</section>`;
    }).join("");
    app.innerHTML = `
      <section class="screen">
        <div class="page-head staples-page-head"><div class="head-copy"><p class="eyebrow">My staples</p><h1>Every trip starts here</h1><p class="muted">Clothing, bathroom, tech, and the other recurring essentials that seed every new trip. Changes here never rewrite historical trips.</p></div><button class="button small" type="button" data-action="add-staple">＋ Add</button></div>
        <div class="staples-shell">
          <div class="staples-toolbar"><div class="quick-filters" role="group" aria-label="Filter staples"><button type="button" data-action="staple-filter" data-filter="all" aria-pressed="${state.staplesFilter === "all"}">All</button><button type="button" data-action="staple-filter" data-filter="packlast" aria-pressed="${state.staplesFilter === "packlast"}">Pack last</button></div><p><strong>Pack last</strong> is a timing flag on an item—not a separate category.</p></div>
          <div class="staple-categories">${categories || '<div class="empty-state">No staples match this filter.</div>'}</div>
          <div class="callout staples-note">Editing an item from a trip lets you choose <strong>This trip only</strong> or <strong>Remember for future trips</strong>. Remembered changes affect future trips only.</div>
        </div>
      </section>`;
  }

  function renderSettings() {
    navState("settings");
    app.innerHTML = `
      <section class="screen">
        <div class="page-head"><div class="head-copy"><p class="eyebrow">Prototype controls</p><h1>Settings</h1><p class="muted">These states are illustrative only. There is no account, sync engine, database, or cloud durability in this wireframe.</p></div></div>
        <div style="max-width:720px;">
          <div class="card setting-card"><h2>Simulate save status</h2><p class="muted tiny">Try how status language might feel before auth and security are designed.</p><div class="state-options">
            <button class="state-option ${state.simulatedSync === "saved" ? "active" : ""}" type="button" data-action="sync-state" data-state="saved"><strong>Saved</strong><small>simulated</small></button>
            <button class="state-option ${state.simulatedSync === "offline" ? "active" : ""}" type="button" data-action="sync-state" data-state="offline"><strong>Offline</strong><small>simulated</small></button>
            <button class="state-option ${state.simulatedSync === "waiting" ? "active" : ""}" type="button" data-action="sync-state" data-state="waiting"><strong>Waiting</strong><small>simulated</small></button>
          </div></div>
          <div class="card setting-card"><h2>Sample data</h2><p class="muted">Reset trips, quantities, checkmarks, weather decisions, staples, and simulated status to the original prototype state.</p><button class="button danger" type="button" data-action="reset-sample">Reset sample data</button></div>
          <div class="card setting-card"><h2>Out of scope for this wireframe</h2><p class="muted tiny">Accounts, shared travelers, real weather, booking imports, billing, backend storage, and security architecture. Please do not enter credentials or sensitive travel details.</p></div>
        </div>
      </section>`;
  }

  function openModal(content, title, description) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="modal-backdrop">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head"><div><h2 id="modal-title">${title}</h2>${description ? '<p>' + description + '</p>' : ""}</div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">×</button></div>
          ${content}
        </section>
      </div>`;
    const focusable = modalRoot.querySelector("input, button, select");
    if (focusable) focusable.focus();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function openCopyModal(tripId) {
    const trip = state.trips.find(function (entry) { return entry.id === tripId; });
    openModal(`
      <form id="copy-form" class="form-grid" data-source="${trip.id}">
        <label class="field">New destination<input name="destination" value="Santa Barbara" required maxlength="50" /></label>
        <div class="two-col"><label class="field">Leave<input name="start" type="date" value="2026-12-04" required /></label><label class="field">Return<input name="end" type="date" value="2026-12-08" required /></label></div>
        <div class="callout">The original ${escapeHtml(trip.destination)} trip stays unchanged. Dates and suggestions update; all packing checkmarks clear.</div>
        <button class="button" type="submit">Copy and update suggestions</button>
      </form>`, "Copy " + escapeHtml(trip.destination), "Use the old trip as a starting point.");
  }

  function openWeatherModal(trip) {
    openModal(`
      <div class="weather-card"><span class="tag">Simulated · ${trip.weather.label}</span><h3 style="margin-top:12px;">Add a compact umbrella?</h3><p class="muted">A pretend weather signal suggests more rain. The list has not changed.</p></div>
      <div class="actions" style="margin-top:15px;"><button class="button" type="button" data-action="accept-weather">Accept suggestion</button><button class="button secondary" type="button" data-action="skip-weather">Skip for this trip</button></div>`, "Review weather suggestion", "You stay in control of list changes.");
  }

  function openTripItemModal(itemId) {
    const trip = getTrip();
    const entry = trip.items.find(function (candidate) { return candidate.id === itemId; });
    openModal(`
      <form id="trip-item-form" class="form-grid" data-item="${entry.id}">
        <label class="field">Item name<input name="name" value="${escapeHtml(entry.name)}" required maxlength="50" /></label>
        <label class="field">Quantity<input name="qty" type="number" min="1" max="30" value="${entry.qty}" required /></label>
        <fieldset style="border:0;padding:0;margin:0;"><legend style="font-weight:850;margin-bottom:8px;">Apply this change to</legend><div class="choice-stack">
          <label class="choice"><input type="radio" name="scope" value="trip" checked /><span><strong>This trip only</strong><small>Update ${escapeHtml(trip.destination)} only.</small></span></label>
          <label class="choice"><input type="radio" name="scope" value="future" /><span><strong>Remember for future trips</strong><small>Save to My staples without changing historical trips.</small></span></label>
        </div></fieldset>
        ${entry.optional ? '<div class="callout"><strong>Optional suggestion.</strong> Edit it, keep it, or remove it from this trip.</div>' : ""}
        ${entry.groupId === TOILETRY_GROUP_ID ? '<div class="callout"><strong>Bathroom staple.</strong> This is one canonical checkbox in Toiletries and Pack last. Bag placement is confirmed separately after all contents are checked.</div>' : ""}
        ${entry.section === "return" ? '<div class="callout"><strong>Return outfit item.</strong> It stays in the dedicated return set.</div>' : `<div class="toggle-row compact-toggle"><div><strong>Pack last</strong><p>Timing flag only—the item can still be saved in My staples.</p></div><label class="switch"><input type="checkbox" name="packLast" ${entry.section === "packlast" ? "checked" : ""} /><span></span></label></div>`}
        <div class="actions"><button class="button" type="submit">Save item</button>${entry.groupId === TOILETRY_GROUP_ID || entry.optional ? `<button class="button danger" type="button" data-action="remove-trip-item" data-item="${entry.id}">Remove item</button>` : ""}</div>
      </form>`, "Edit item", "Historical trips stay as they were.");
  }

  function openAddToiletryModal() {
    const trip = getTrip();
    openModal(`
      <form id="toiletry-item-form" class="form-grid">
        <label class="field">Item name<input name="name" required maxlength="50" placeholder="Face wash" /></label>
        <label class="field">Quantity<input name="qty" type="number" min="1" max="30" value="1" required /></label>
        <fieldset style="border:0;padding:0;margin:0;"><legend style="font-weight:850;margin-bottom:8px;">Apply this addition to</legend><div class="choice-stack">
          <label class="choice"><input type="radio" name="scope" value="trip" checked /><span><strong>This trip only</strong><small>Add to ${escapeHtml(trip.destination)} only.</small></span></label>
          <label class="choice"><input type="radio" name="scope" value="future" /><span><strong>Remember for future trips</strong><small>Add to My staples without changing historical trips.</small></span></label>
        </div></fieldset>
        <div class="toggle-row compact-toggle"><div><strong>Pack last</strong><p>Optional timing flag. New items default off.</p></div><label class="switch"><input type="checkbox" name="packLast" /><span></span></label></div>
        <div class="callout"><strong>Bathroom staple.</strong> This creates one normal checkbox in Toiletries. Pack last remains an optional timing flag.</div>
        <button class="button" type="submit">Add toiletry item</button>
      </form>`, "Add a Bathroom item", "Create a normal toiletry checklist item.");
  }

  function openToiletryBagPlacementModal() {
    openModal(`<p>All Bathroom items are checked. Is the completed toiletry bag in the suitcase?</p><div class="actions"><button class="button" type="button" data-action="confirm-toiletry-bag">Confirm</button><button class="button secondary" type="button" data-action="close-modal">Not yet</button></div>`, "Toiletry bag in suitcase?", "Separate bag-placement step");
  }

  function openStapleModal(stapleId) {
    const entry = state.staples.find(function (candidate) { return candidate.id === stapleId; });
    const editing = Boolean(entry);
    openModal(`
      <form id="staple-form" class="form-grid" data-staple="${editing ? entry.id : ""}">
        <label class="field">Item name<input name="name" value="${editing ? escapeHtml(entry.name) : ""}" required maxlength="50" /></label>
        <div class="two-col"><label class="field">Quantity<input name="qty" type="number" min="1" max="30" value="${editing ? entry.qty : 1}" required /></label><label class="field">Frequency<select name="cadence"><option value="per trip" ${editing && entry.cadence === "per trip" ? "selected" : ""}>Per trip</option><option value="per day" ${editing && entry.cadence === "per day" ? "selected" : ""}>Per day</option></select></label></div>
        <label class="field">Category<input name="category" value="${editing ? escapeHtml(entry.category) : "Other"}" required maxlength="30" /></label>
        ${editing && entry.groupId === TOILETRY_GROUP_ID ? '<div class="callout"><strong>Bathroom staple.</strong> Editing here preserves its Toiletries group membership.</div>' : ""}
        <div class="toggle-row compact-toggle"><div><strong>Pack last</strong><p>Optional timing flag. New items default off.</p></div><label class="switch"><input type="checkbox" name="packLast" ${editing && entry.packLast ? "checked" : ""} /><span></span></label></div>
        <div class="callout">This saves to My staples for future trips only. Existing trips keep their historical quantities and timing.</div>
        <button class="button" type="submit">${editing ? "Save staple" : "Add staple"}</button>
      </form>`, editing ? "Edit staple" : "Add a staple", "Set a per-day or per-trip default.");
  }

  function openPreferenceModal(trip) {
    openModal(`
      <form id="preference-form" class="form-grid">
        <div class="toggle-row"><div><strong>Laundry access</strong></div><label class="switch"><input type="checkbox" name="laundry" ${trip.config.laundry ? "checked" : ""} /><span></span></label></div>
        <div class="toggle-row"><div><strong>Spare underwear + socks</strong></div><label class="switch"><input type="checkbox" name="spare" ${trip.config.spare ? "checked" : ""} /><span></span></label></div>
        <div class="toggle-row"><div><strong>Nice outfits</strong><p>Includes optional Dress shoes, Makeup, and Dress-specific undergarments.</p></div><label class="switch"><input type="checkbox" name="niceAttire" ${trip.config.niceAttire ? "checked" : ""} /><span></span></label></div>
        <div class="two-col"><label class="field">Nice occasions<input type="number" name="occasionCount" min="1" max="8" value="${trip.config.occasionCount || 1}" /></label><div class="toggle-row compact-toggle"><div><strong>Reuse one nice look</strong></div><label class="switch"><input type="checkbox" name="reuseNice" ${trip.config.reuseNice ? "checked" : ""} /><span></span></label></div></div>
        <div class="callout">Updating recalculates suggestions while preserving edits and packed quantities for unchanged items. Changing Bathroom contents revokes toiletry-bag placement; Ready is always revoked.</div>
        <button class="button" type="submit">Update this trip</button>
      </form>`, "Edit packing preferences", "This trip only.");
  }

  function resetSample() {
    state.staples = initialStaples.map(copy);
    const freshSan = makeTrip("San Diego", "2026-10-23", "2026-10-27", sampleConfig, { id: "san-diego", location: findSampleLocation("us-ca-san-diego") });
    ["tops", "underwear", "socks", "sleepwear", "sunglasses"].forEach(function (id) {
      const found = freshSan.items.find(function (entry) { return entry.id === id; });
      if (found) found.packed = Math.min(found.qty, id === "underwear" ? 2 : 1);
    });
    const freshLisbon = makeTrip("Lisbon", "2026-09-03", "2026-09-07", { ...sampleConfig, laundry: true, spare: false }, { id: "lisbon", location: findSampleLocation("pt-lisbon") });
    freshLisbon.items.forEach(function (entry) { entry.packed = entry.qty; });
    freshLisbon.toiletryBagPacked = true;
    freshLisbon.ready = true;
    freshLisbon.weather.status = "accepted";
    const umbrella = item("weather-umbrella", "Compact umbrella", "Weather suggestion", 1, "main");
    umbrella.packed = 1;
    freshLisbon.items.push(umbrella);
    state.trips = [freshSan, freshLisbon];
    state.simulatedSync = "saved";
    state.selectedTripId = "san-diego";
    state.pendingTrip = null;
    state.tripListView = "upcoming";
    state.staplesFilter = "all";
    state.deletedTrips = [];
    state.quickViewOpen = {};
    state.quickViewFilters = {};
    announce("Sample data reset");
    renderSettings();
  }

  function updatePacked(itemId, mode) {
    const trip = getTrip();
    const entry = trip.items.find(function (candidate) { return candidate.id === itemId; });
    if (!entry) return;
    const wasToiletryComplete = toiletryChildren(trip).length > 0 && toiletryChildren(trip).every(function (candidate) { return candidate.packed >= candidate.qty; });
    if (mode === "toggle") entry.packed = entry.packed >= entry.qty ? 0 : entry.qty;
    if (mode === "plus") entry.packed = Math.min(entry.qty, entry.packed + 1);
    if (mode === "minus") entry.packed = Math.max(0, entry.packed - 1);
    const toiletriesComplete = toiletryChildren(trip).length > 0 && toiletryChildren(trip).every(function (candidate) { return candidate.packed >= candidate.qty; });
    if (entry.groupId === TOILETRY_GROUP_ID && !toiletriesComplete) {
      trip.toiletryBagPacked = false;
      trip.ready = false;
    }
    if (trip.ready && entry.packed < entry.qty) {
      trip.ready = false;
      announce("Ready revoked after your correction");
    }
    if (allPacked(trip) && !trip.ready) state.reviewPrompt = true;
    renderTrip();
    if (entry.groupId === TOILETRY_GROUP_ID && !wasToiletryComplete && toiletriesComplete && !trip.toiletryBagPacked) openToiletryBagPlacementModal();
  }

  document.addEventListener("submit", function (event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);

    if (form.id === "create-form") {
      const start = data.get("start");
      const end = data.get("end");
      const normalized = normalizeDraftDates(start, end);
      if (!normalized.valid || !core.tripDays(normalized.start, normalized.end)) return announce("Choose a valid departure date");
      if (!state.pendingTrip.location) return announce("Choose a SAMPLE city, region, and country to confirm the destination");
      state.pendingTrip.destinationQuery = state.pendingTrip.location.label;
      setView("builder");
    }

    if (form.id === "trip-item-form") {
      const trip = getTrip();
      const entry = trip.items.find(function (candidate) { return candidate.id === form.dataset.item; });
      const name = data.get("name").trim();
      const qty = Math.max(1, Number(data.get("qty")) || 1);
      const previousQty = entry.qty;
      entry.name = name;
      entry.qty = qty;
      entry.userEdited = true;
      entry.packed = Math.min(entry.packed, qty);
      if (entry.groupId === TOILETRY_GROUP_ID && previousQty !== qty) trip.toiletryBagPacked = false;
      const packLast = data.get("packLast") === "on";
      if (entry.section !== "return") entry.section = packLast ? "packlast" : "main";
      trip.ready = false;
      if (data.get("scope") === "future") {
        const staple = state.staples.find(function (candidate) { return candidate.id === entry.id; });
        if (staple) {
          staple.name = name;
          staple.qty = qty;
          staple.packLast = packLast;
          staple.groupId = entry.groupId || null;
        } else {
          state.staples.push({ id: entry.id, name, qty, cadence: "per trip", category: entry.category, packLast, groupId: entry.groupId || null });
        }
        announce("Saved to My staples; Pack last " + (packLast ? "on" : "off"));
      } else announce("Updated this trip only");
      closeModal();
      renderTrip();
    }

    if (form.id === "toiletry-item-form") {
      const trip = getTrip();
      const name = data.get("name").trim();
      const qty = Math.max(1, Number(data.get("qty")) || 1);
      const packLast = data.get("packLast") === "on";
      const entry = item(uid("toiletry"), name, "Toiletries", qty, packLast ? "packlast" : "main");
      entry.groupId = TOILETRY_GROUP_ID;
      trip.items.push(entry);
      trip.toiletryBagPacked = false;
      trip.ready = false;
      if (data.get("scope") === "future") {
        state.staples.push({ id: entry.id, name, qty, cadence: "per trip", category: "Toiletries", packLast, groupId: TOILETRY_GROUP_ID });
        announce("Added to this bag and My staples");
      } else announce("Added to this trip’s Toiletry bag");
      closeModal();
      renderTrip();
    }

    if (form.id === "staple-form") {
      const id = form.dataset.staple;
      const existingStaple = state.staples.find(function (candidate) { return candidate.id === id; });
      const next = { id: id || uid("staple"), name: data.get("name").trim(), qty: Number(data.get("qty")) || 1, cadence: data.get("cadence"), category: data.get("category").trim(), packLast: data.get("packLast") === "on", groupId: existingStaple && existingStaple.groupId ? existingStaple.groupId : null };
      const index = state.staples.findIndex(function (candidate) { return candidate.id === id; });
      if (index >= 0) state.staples[index] = next;
      else state.staples.push(next);
      closeModal();
      renderStaples();
      announce("Future-trip staple saved");
    }

    if (form.id === "preference-form") {
      const trip = getTrip();
      const nextConfig = {
        ...trip.config,
        laundry: data.get("laundry") === "on",
        spare: data.get("spare") === "on",
        niceAttire: data.get("niceAttire") === "on",
        occasionCount: Math.max(1, Number(data.get("occasionCount")) || 1),
        reuseNice: data.get("reuseNice") === "on"
      };
      reconcileTripSuggestions(trip, nextConfig);
      closeModal();
      renderTrip();
      announce("Suggestions updated; unchanged edits and progress preserved");
    }
  });

  document.addEventListener("input", function (event) {
    const target = event.target;
    if (target.form && target.form.id === "create-form" && target.name === "destination" && state.pendingTrip) {
      state.pendingTrip.destinationQuery = target.value;
      if (state.pendingTrip.location && target.value !== state.pendingTrip.location.label) state.pendingTrip.location = null;
      updateLocationPickerUI();
    }
  });

  document.addEventListener("change", function (event) {
    const target = event.target;
    if (target.form && target.form.id === "create-form" && (target.name === "start" || target.name === "end")) {
      const startInput = target.form.querySelector('input[name="start"]');
      const endInput = target.form.querySelector('input[name="end"]');
      const normalized = normalizeDraftDates(startInput.value, endInput.value);
      endInput.min = normalized.start;
      endInput.value = normalized.end;
      const note = document.getElementById("date-note");
      if (note) note.textContent = normalized.adjusted ? "Return adjusted to match departure. Same-day trips are allowed." : "Same-day trips are allowed. Return cannot be before departure.";
      if (normalized.adjusted) announce("Return adjusted to match departure");
    }
    if (target.dataset.config) {
      state.pendingTrip.config[target.dataset.config] = target.checked;
      renderBuilder();
    }
    if (target.dataset.configNumber) {
      state.pendingTrip.config[target.dataset.configNumber] = Math.max(1, Number(target.value) || 1);
      renderBuilder();
    }
  });

  document.addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;

    if (button.dataset.nav) return setView(button.dataset.nav);
    if (button.id === "brand-home") return setView("trips");
    if (button.id === "sync-chip") return setView("settings");
    if (action === "new-trip") return startNewDraft();
    if (action === "go-trips") return setView("trips");
    if (action === "builder-back") return setView("create");
    if (action === "cancel-draft") {
      state.pendingTrip = null;
      setView("trips");
      return announce("Draft discarded; dashboard unchanged");
    }
    if (action === "select-location") {
      const location = findSampleLocation(button.dataset.location);
      if (!location || !state.pendingTrip) return;
      state.pendingTrip.location = copy(location);
      state.pendingTrip.destinationQuery = location.label;
      const input = document.querySelector('input[name="destination"]');
      if (input) input.value = location.label;
      updateLocationPickerUI();
      return announce("Sample location confirmed");
    }
    if (action === "trip-list-view") {
      state.tripListView = button.dataset.view;
      return renderTrips();
    }
    if (action === "toggle-quick-view") {
      const tripId = button.dataset.trip;
      state.quickViewOpen[tripId] = !state.quickViewOpen[tripId];
      renderTrips();
      const toggle = document.querySelector('[data-action="toggle-quick-view"][data-trip="' + tripId + '"]');
      if (toggle) toggle.focus();
      return;
    }
    if (action === "quick-view-filter") {
      state.quickViewFilters[button.dataset.trip] = button.dataset.filter;
      renderTrips();
      const filterButton = document.querySelector('[data-action="quick-view-filter"][data-trip="' + button.dataset.trip + '"][data-filter="' + button.dataset.filter + '"]');
      if (filterButton) filterButton.focus();
      return;
    }
    if (action === "staple-filter") {
      state.staplesFilter = button.dataset.filter;
      renderStaples();
      const filterButton = document.querySelector('[data-action="staple-filter"][data-filter="' + state.staplesFilter + '"]');
      if (filterButton) filterButton.focus();
      return;
    }
    if (action === "open-trip") { state.selectedTripId = button.dataset.trip; return setView("trip"); }
    if (action === "copy-trip") return startCopyDraft(button.dataset.trip);
    if (action === "save-trip") {
      const draft = state.pendingTrip;
      if (!draft || !draft.location) return announce("Confirm the destination before saving");
      const trip = makeTrip(draft.location.city, draft.start, draft.end, draft.config, { copiedFrom: draft.sourceId, location: draft.location });
      state.trips.unshift(trip);
      state.selectedTripId = trip.id;
      state.pendingTrip = null;
      setView("trip");
      return announce(draft.mode === "copy" ? "Copied trip saved; original unchanged" : "Trip saved to your dashboard");
    }
    if (action === "archive-trip") {
      const trip = state.trips.find(function (entry) { return entry.id === button.dataset.trip; });
      if (!trip) return;
      trip.archived = true;
      renderTrips();
      return announce("Trip moved to Past & archive");
    }
    if (action === "restore-trip") {
      const trip = state.trips.find(function (entry) { return entry.id === button.dataset.trip; });
      if (!trip) return;
      trip.archived = false;
      state.tripListView = "upcoming";
      renderTrips();
      return announce("Trip restored to Upcoming");
    }
    if (action === "remove-trip") {
      const trip = state.trips.find(function (entry) { return entry.id === button.dataset.trip; });
      if (!trip) return;
      return openModal(`<p><strong>${escapeHtml(trip.destination)}</strong> will move to Recently deleted. You can undo the removal from Past & archive.</p><div class="actions"><button class="button danger" type="button" data-action="confirm-remove-trip" data-trip="${trip.id}">Remove trip</button><button class="button secondary" type="button" data-action="close-modal">Cancel</button></div>`, "Remove this trip?", "This is recoverable in the prototype.");
    }
    if (action === "confirm-remove-trip") {
      const index = state.trips.findIndex(function (entry) { return entry.id === button.dataset.trip; });
      if (index < 0) return closeModal();
      const removed = state.trips.splice(index, 1)[0];
      state.deletedTrips.unshift({ trip: removed, deletedAt: Date.now() });
      closeModal();
      renderTrips();
      return announce("Trip moved to Recently deleted");
    }
    if (action === "undo-remove") {
      const index = state.deletedTrips.findIndex(function (entry) { return entry.trip.id === button.dataset.trip; });
      if (index < 0) return;
      const restored = state.deletedTrips.splice(index, 1)[0].trip;
      if (!state.trips.some(function (entry) { return entry.id === restored.id; })) state.trips.push(restored);
      renderTrips();
      return announce("Removed trip restored");
    }
    if (action === "prompt-toiletry-bag") {
      const trip = getTrip();
      const complete = toiletryChildren(trip).length > 0 && toiletryChildren(trip).every(function (entry) { return entry.packed >= entry.qty; });
      if (!complete) return announce("Finish the Bathroom items first");
      return openToiletryBagPlacementModal();
    }
    if (action === "confirm-toiletry-bag") {
      const trip = getTrip();
      trip.toiletryBagPacked = true;
      closeModal();
      if (state.view === "review") renderReview();
      else renderTrip();
      return announce("Toiletry bag confirmed in suitcase");
    }
    if (action === "undo-toiletry-bag") {
      const trip = getTrip();
      trip.toiletryBagPacked = false;
      trip.ready = false;
      if (state.view === "review") renderReview();
      else renderTrip();
      return announce("Toiletry bag placement undone; contents stay checked");
    }
    if (action === "add-toiletry-item") return openAddToiletryModal();
    if (action === "remove-trip-item") {
      const form = button.closest("form");
      const scope = form ? new FormData(form).get("scope") : "trip";
      const trip = getTrip();
      const entry = trip.items.find(function (candidate) { return candidate.id === button.dataset.item; });
      if (!entry) return;
      const futureCopy = scope === "future" ? "from this trip and future My staples defaults" : "from this trip only";
      return openModal(`<p><strong>${escapeHtml(entry.name)}</strong> will be removed ${futureCopy}. Historical trips stay unchanged.</p><div class="actions"><button class="button danger" type="button" data-action="confirm-remove-trip-item" data-item="${entry.id}" data-scope="${scope}">Remove item</button><button class="button secondary" type="button" data-action="close-modal">Cancel</button></div>`, entry.groupId === TOILETRY_GROUP_ID ? "Remove toiletry item?" : "Remove optional item?", "This is an explicit checklist change.");
    }
    if (action === "confirm-remove-trip-item") {
      const trip = getTrip();
      const removed = trip.items.find(function (entry) { return entry.id === button.dataset.item; });
      trip.items = trip.items.filter(function (entry) { return entry.id !== button.dataset.item; });
      if (removed && removed.groupId === TOILETRY_GROUP_ID) trip.toiletryBagPacked = false;
      if (removed && removed.optional && OPTIONAL_NICE_IDS.has(removed.id)) {
        trip.suppressedSuggestions = trip.suppressedSuggestions || {};
        trip.suppressedSuggestions[removed.id] = true;
        if (trip.suggestionMemory) delete trip.suggestionMemory[removed.id];
      }
      if (button.dataset.scope === "future") state.staples = state.staples.filter(function (entry) { return entry.id !== button.dataset.item; });
      trip.ready = false;
      closeModal();
      renderTrip();
      return announce(button.dataset.scope === "future" ? "Removed from this trip and future staples" : "Removed from this trip only");
    }
    if (action === "filter") { state.filter = button.dataset.filter; return renderTrip(); }
    if (action === "toggle-item") return updatePacked(button.dataset.item, "toggle");
    if (action === "packed-plus") return updatePacked(button.dataset.item, "plus");
    if (action === "packed-minus") return updatePacked(button.dataset.item, "minus");
    if (action === "edit-trip-item") return openTripItemModal(button.dataset.item);
    if (action === "review-weather" || action === "reopen-weather") return openWeatherModal(getTrip());
    if (action === "accept-weather") {
      const trip = getTrip();
      trip.weather.status = "accepted";
      if (!trip.items.some(function (entry) { return entry.id === "weather-umbrella"; })) trip.items.push(item("weather-umbrella", "Compact umbrella", "Weather suggestion", 1, "main"));
      trip.ready = false;
      closeModal();
      renderTrip();
      return announce("Umbrella added after your approval");
    }
    if (action === "skip-weather") {
      getTrip().weather.status = "skipped";
      closeModal();
      renderTrip();
      return announce("Weather suggestion skipped");
    }
    if (action === "review-bag") return setView("review");
    if (action === "back-to-trip") return setView("trip", { keepFilter: true });
    if (action === "mark-not-ready") {
      const trip = getTrip();
      trip.ready = false;
      if (state.view === "review") renderReview();
      else renderTrip();
      return announce("Marked not ready; packing progress unchanged");
    }
    if (action === "review-toggle") {
      const trip = getTrip();
      const entry = trip.items.find(function (candidate) { return candidate.id === button.dataset.item; });
      const wasToiletryComplete = toiletryChildren(trip).length > 0 && toiletryChildren(trip).every(function (candidate) { return candidate.packed >= candidate.qty; });
      entry.packed = entry.packed >= entry.qty ? 0 : entry.qty;
      const toiletriesComplete = toiletryChildren(trip).length > 0 && toiletryChildren(trip).every(function (candidate) { return candidate.packed >= candidate.qty; });
      if (entry.groupId === TOILETRY_GROUP_ID && !toiletriesComplete) trip.toiletryBagPacked = false;
      if (trip.ready && entry.packed < entry.qty) trip.ready = false;
      renderReview();
      if (entry.groupId === TOILETRY_GROUP_ID && !wasToiletryComplete && toiletriesComplete && !trip.toiletryBagPacked) openToiletryBagPlacementModal();
      return;
    }
    if (action === "confirm-ready") {
      const trip = getTrip();
      if (!allPacked(trip)) return announce("Finish the unpacked items first");
      trip.ready = true;
      setView("trip");
      return announce("Ready to go — confirmed by you");
    }
    if (action === "edit-preferences") return openPreferenceModal(getTrip());
    if (action === "edit-staple") return openStapleModal(button.dataset.staple);
    if (action === "add-staple") return openStapleModal(null);
    if (action === "sync-state") {
      state.simulatedSync = button.dataset.state;
      renderSettings();
      setSync(state.simulatedSync);
      return announce("Showing " + button.dataset.state + " as a simulation");
    }
    if (action === "reset-sample") return openModal('<p>Reset every prototype change and restore the original sample trips?</p><div class="actions"><button class="button danger" type="button" data-action="confirm-reset">Reset everything</button><button class="button secondary" type="button" data-action="close-modal">Keep exploring</button></div>', "Reset sample data?", "This only affects this open prototype session.");
    if (action === "confirm-reset") { closeModal(); return resetSample(); }
    if (action === "close-modal") return closeModal();
    if (action === "modal-backdrop" && event.target === button) return closeModal();
  });

  modalRoot.addEventListener("click", function (event) {
    if (event.target.classList.contains("modal-backdrop")) closeModal();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modalRoot.children.length) closeModal();
  });

  render();

  window.addEventListener("error", function (event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("destination-image")) return;
    const visual = image.closest(".destination-visual");
    image.hidden = true;
    if (!visual) return;
    visual.classList.add("image-failed");
    const label = visual.querySelector(".destination-art-label");
    if (label) label.textContent = "Neutral illustrated fallback";
  }, true);
})();
