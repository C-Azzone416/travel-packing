# Caroline's Travel Packing App — Design and Implementation Plan

Generated from the current source, tests, checked-in visual assets, deployment metadata, and approved product decisions available in this task.

## 1. Canonical project identity

| Field | Value |
| --- | --- |
| Project root | `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe` |
| Report path | `/Users/cazzone/Repos/travel-packing/TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md` |
| Published prototype | <https://caroline-packing-wireframe.choicelyric4.chatgpt.site> |
| Site title | Caroline's Packing Prototype |
| Site project ID | `appgprj_6ad28751dc9c81918c396d19d082a3ae` |
| Site audience | Custom owner-only access; one allowed owner and zero external visitors at handoff |
| Site version | `14` |
| Current commit | `539c448e4f7d820699fbff344d93db226a73b72a` |
| Hosting manifest | [`.openai/hosting.json`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/.openai/hosting.json) |
| Static directory | [`dist/`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist) |

If this report and the source ever diverge, the checked-in source and tests at the named commit are authoritative for implemented behavior. Product decisions and open questions below remain the design authority unless Caroline changes them.

## 2. Status and scope

### Approved decisions

- This is a mobile-first personal packing app for Caroline alone.
- Production will be an online-first responsive web app, initially private to Caroline and designed to expand to roughly 1–5 users without replacing the backend.
- Free use and operational simplicity are key constraints.
- Shared use is not part of the initial release; every record must still have an owner so additional private users can be added later.
- The current clickable wireframe and latest destination art are approved.
- The visual direction is **Lagoon & Linen**: airy destination imagery in headers/cards, practical solid surfaces for lists and forms.
- A trip does not become Ready when the last checkbox is completed. The app must offer a review screen, then require explicit confirmation.
- Trip dates and destinations are privacy-sensitive.
- A future production version should provide durable cloud save and export/restore. Offline queues, service workers, and conflict synchronization are not required now.
- Caroline wants phone access without a weekly sideloading workflow.

### Implemented in this prototype

- Static, responsive HTML/CSS/JavaScript.
- In-memory sample trips and staples.
- End-to-end trip creation, packing preferences, checklist progress, final review, explicit readiness, trip copy, archive, recoverable delete, staple editing, and reset.
- Simulated weather, location choices, and save/offline/waiting labels.
- Owner-private Site deployment.

### Explicitly not implemented

- Production login/authentication or user accounts.
- Production database or durable cloud persistence.
- Real offline cache, background sync, conflict resolution, or service worker.
- Export/import or backup recovery.
- Live weather, geocoding, travel-booking imports, or photo/location services.
- Shared travelers, collaboration, billing, notifications, or production analytics.
- Production privacy/security architecture.

Provisioning does not make any item in this list implemented. No application source, workflow, schema, migration, deployment, or real trip data was uploaded during infrastructure setup. Cloud saving, login isolation, and production behavior are unverified; the app is not ready for real use.

### Selected production foundation and setup status

- **Database/auth:** Neon Free Postgres with managed Better Auth; email/password is the initial login method.
- **Delivery:** responsive web app, with a same-origin architecture such as Next.js as the current implementation candidate.
- **Source:** private repository <https://github.com/C-Azzone416/travel-packing>.
- **Hosting:** empty Vercel Hobby project <https://vercel.com/c-azzone416s-projects/travel-packing>, project ID `prj_QxQOEprSd7SWg3LOiG1i7nmgwC5S`.
- **Database project:** [Caroline Travel Packing](https://console.neon.tech/app/projects/quiet-leaf-68107705/branches/br-frosty-recipe-arxh54js), project ID `quiet-leaf-68107705`, Free plan in Caroline / `owner@example.test`, AWS US West 2 (Oregon), default `production` branch.
- **Deployment policy:** do not connect Vercel directly to GitHub. Reproduce `C-Azzone416/tabletop-sim`'s GitHub Actions + Vercel CLI pattern for `develop` previews and `main` production, without modifying `tabletop-sim`.
- **Configured GitHub repository variables:** `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
- **Configured GitHub repository secret:** `VERCEL_TOKEN`, backed by a new Vercel token scoped only to `travel-packing`, expiring October 17, 2027.
- **Configured Vercel Production variables:** `DATABASE_URL` (Secret), `NEON_AUTH_COOKIE_SECRET` (Secret), and `NEON_AUTH_BASE_URL` (Config). Secret values must never enter source, documentation, logs, screenshots, or client bundles.
- **Isolation:** no direct GitHub–Vercel integration and no Agent-Clubhouse connection exist.

The Vercel UI warning last verified at 16:54 UTC on October 17, 2026 applied only to `NEON_AUTH_BASE_URL`: its name triggered a heuristic that it might be secret. It is a non-secret service endpoint. Both genuine credentials remained classified as Secret and masked.

### Superseded backend exploration

- Firebase was previously recommended primarily to reduce custom offline-sync work. That recommendation is superseded because the first version is now explicitly online-first and Neon has been selected and provisioned.
- Supabase and Clerk were considered but are not selected. Firebase, Supabase, and Clerk are not part of the current implementation plan.
- Preserve this history only to explain the decision; do not reopen provider selection unless requirements materially change.

### Auth posture still requiring review

Current Neon auth settings observed during setup: signup is enabled by default, email verification is disabled, trusted domains are empty, localhost is allowed, and shared Google development keys are enabled. No Apple OAuth is planned for the initial release.

Before real use, with separate approval for persistent grants or security-setting changes:

- Choose Caroline's exact owner login email before provisioning the account.
- Enforce the single-user allowlist on the server for every request. Hiding signup controls is not access control.
- Add only the exact verified production origin to trusted domains; do not assume or whitelist a placeholder or broad `*.vercel.app` domain.
- Decide and configure signup, email verification, password reset, session lifetime, and production email delivery behavior.
- Disable unused development OAuth or replace shared development credentials with approved production credentials when appropriate.

## 3. Product and interaction decisions

### Navigation

The primary navigation has exactly three destinations:

1. **Trips** — upcoming dashboard, past/archive view, trip creation, packing, and review.
2. **Staples** — recurring per-day/per-trip defaults grouped by semantic category.
3. **Settings** — simulated save status and sample-data reset.

On phone, this is a fixed bottom navigation. On desktop, it becomes a compact vertical rail.

### Dashboard

- The default dashboard shows Upcoming trips only.
- Past dates and archived trips live in **Past & archive**.
- Each card includes destination-specific sample artwork, location, dates, duration, simulated forecast label, packing progress, compact status, actions, and a collapsible read-only Quick view.
- Quick view can filter between **Still to pack** and **All** without mutating progress.
- Empty states exist for no upcoming trips, no past/archive trips, and no recently deleted trips.

### Create-trip flow

1. Start a new sample trip.
2. Enter a destination query and select a disambiguated local SAMPLE result containing city, region, and country.
3. Choose departure and return dates.
4. Review packing preferences and a live sample calculation.
5. Explicitly choose **Save trip** before the trip appears on the dashboard.

Important behavior:

- Free text alone never confirms a location.
- Same-day trips are allowed.
- A return date earlier than departure is adjusted to departure.
- Canceling at either step discards the draft and leaves the dashboard unchanged.
- The UI repeatedly labels this as sample data and asks users not to treat it as live geocoding or durable storage.

### Packing preferences

- Laundry access.
- One spare underwear and socks.
- Nice outfits toggle.
- Nice-occasion count.
- Reuse one nice look.
- Dedicated return travel outfit, default on.

Nice outfits add calculated nice top/bottom quantities plus optional, removable suggestions:

- Dress shoes — one editable default, not multiplied by occasion count.
- Makeup — one editable default in the Bathroom/toiletry group.
- Dress-specific undergarments — one editable default and distinct from everyday underwear.

Repeated Nice outfits off/on changes preserve prior user edits and packed progress through `suggestionMemory`. Explicitly removed optional suggestions stay suppressed through `suppressedSuggestions`. Equivalent matching staples prevent duplicate Makeup or Dress shoes rows.

### Packing-list interaction

- **All** and **Still to pack** filters.
- Full-item check/uncheck control.
- Per-item plus/minus partial quantity controls.
- Tap item name to edit its name, quantity, timing, and scope.
- Scope choices are **This trip only** and **Remember for future trips**.
- Trip-only edits never rewrite historical trips or future staples.
- Remembered edits affect future trips, not historical trips.
- Pack last is a timing flag/view; it is not a semantic category and must not create a duplicate canonical item.

### Ready behavior

- Completing the last item only exposes **Review your bag**.
- The review screen shows everyday/occasion items, toiletries, toiletry-bag placement, return travel outfit, and Pack last timing.
- **I'm ready to go** is enabled only when every canonical item is fully packed and toiletry-bag placement is confirmed.
- Ready is an explicit user decision, never an automatic side effect.
- Unchecking/correcting an item, changing suggestions, accepting weather changes, removing an item, or undoing toiletry-bag placement revokes Ready.
- **Mark as not ready** preserves every packed quantity.

### Staples

- Staples are future-trip defaults with quantity, cadence (`per day` or `per trip`), semantic category, and an optional Pack last flag.
- Existing/historical trips are snapshots and are not rewritten when staples change.
- Categories render as peer sections: Clothing, Bathroom, Tech, and Other essentials.
- Pack last is exposed as a filter and badge while preserving the item's semantic category.
- New staples default with Pack last off.

### Trip history, archive, and removal

- Trips with an end date before the prototype's fixed `TODAY` value are shown as past trips.
- Archiving is a manual flag independent of Ready state.
- A future archived trip can be restored to Upcoming.
- Remove moves a trip to in-memory **Recently deleted**.
- Undo restores the exact removed trip object.
- All of this is prototype-session state only and disappears on refresh.

## 4. Screen and flow inventory

| Screen/state | Primary purpose | Important actions |
| --- | --- | --- |
| Trips / Upcoming | Current trip dashboard | Create sample trip, Quick view, Keep packing/Review bag, Copy, Archive, Remove |
| Trips / Past & archive | History and recoverable removal | Quick view, restore archived future trip, remove, undo remove |
| Confirm the trip | Unsaved destination/date draft | Select SAMPLE location, normalize dates, continue, cancel |
| Shape the list | Unsaved preference builder | Toggle preferences, inspect live calculation, save, back, cancel |
| Trip packing list | Canonical packing workflow | All/Still filter, partial quantities, edit, weather review, bag placement, preferences |
| Toiletries section | Bathroom contents plus bag gate | Check contents, add/remove item, confirm/undo bag placement |
| Review your bag | Explicit final gate | Correct items, confirm bag placement, I'm ready to go, mark not ready |
| Staples | Future defaults | All/Pack last filter, add/edit staple, per-day/per-trip cadence |
| Settings | Prototype-only controls | Simulate Saved/Offline/Waiting, reset sample data |
| Weather modal | Controlled simulated suggestion | Accept umbrella or skip; no silent mutation |
| Item editor | Trip/future-scope item changes | Edit name/quantity/timing, remember, remove eligible item |
| Toiletry item modal | Add one canonical Bathroom item | This trip or future, optional Pack last flag |
| Remove dialogs | Confirm reversible changes | Remove trip/item or cancel |

## 5. Visual design system

### Palette tokens

Defined in [`dist/styles.css`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/styles.css):

| Token | Hex | Use |
| --- | --- | --- |
| `--linen` | `#F5F7F2` | App/page background |
| `--paper` | `#FFFFFF` | Cards, forms, modal surfaces |
| `--teal` | `#166D7A` | Primary actions, progress, checked states |
| `--teal-dark` | `#0F5660` | Hover/deeper teal and compact labels |
| `--seafoam` | `#B9DDD0` | Major soft accent |
| `--seafoam-soft` | `#E6F2ED` | Tabs, selected filters, callouts |
| `--ink` | `#183D45` | Primary text |
| `--muted` | `#60777B` | Secondary text |
| `--line` | `#D9E3DF` | Borders/dividers |
| `--warm` | `#F3C994` | Restrained warm accent |
| ready background/text/border | `#D4EADF` / `#185B56` / `#AED2C0` | Ready status |
| remaining background/text/border | `#F6DECB` / `#704322` / `#E8C4A8` | Items-left status |
| `--danger` | `#9B3D46` | Destructive confirmations |

Typography uses Inter when available, then system sans-serif fallbacks. Cards use rounded corners, restrained shadows, high-contrast text, visible focus outlines, minimum touch targets, and reduced-motion support.

### Responsive layout

- Minimum supported layout width: 320 px.
- Phone: one-column cards, bottom navigation, compact trip-art banners, modal sheets.
- At 660 px: two-column trip-card grid and two-column form fields.
- At 900 px: side navigation, two-column builder/trip layouts, sticky trip side panel, larger destination header.
- Packing lists and forms never place body text directly over destination artwork.

### Destination imagery

Artwork is a fixed local prototype lookup keyed by the selected sample location ID. It does **not** call a photo provider, geocoder, or location API.

| Mapping | Asset |
| --- | --- |
| San Diego (`us-ca-san-diego`) | [`dist/assets/destination-san-diego.jpg`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/assets/destination-san-diego.jpg) |
| Lisbon (`pt-lisbon`) | [`dist/assets/destination-lisbon.jpg`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/assets/destination-lisbon.jpg) |
| London, England (`gb-eng-london`) | [`dist/assets/destination-london.jpg`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/assets/destination-london.jpg) |
| All other/unknown destinations | [`dist/assets/destination-fallback.jpg`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/assets/destination-fallback.jpg) |

The images were generated as original raster illustrations with the built-in image generator. Prompt themes were: San Diego coastline, Lisbon hills/tram, London Westminster riverfront, and a landmark-neutral route/hills fallback. They use the approved Lagoon & Linen illustration language and contain no text, logos, or people. A CSS neutral fallback replaces a broken image at runtime.

The earlier approved mockup was used as a style reference while generating these assets. It is not a runtime dependency and no local copy is retained in this project, so this report does not invent a device path for it.

## 6. Current sample data and canonical distinctions

### Sample locations

The local picker contains:

- Palm Springs, California, United States
- London, England, United Kingdom
- London, Ontario, Canada
- Santa Barbara, California, United States
- San Diego, California, United States
- Lisbon, Lisbon District, Portugal
- Paris, Île-de-France, France

### Initial sample trips

- **San Diego**, Oct 23–27, 2026: upcoming, partially packed, Nice outfits enabled.
- **Lisbon**, Sep 3–7, 2026: past, fully packed, toiletry bag confirmed, Ready, simulated umbrella accepted.

The prototype uses `TODAY = "2026-10-16"` for deterministic history and forecast tests. Production must replace this with an explicit timezone/date policy.

### Canonical timing and category model

Do not conflate these concepts:

| Concept | Current representation | Meaning |
| --- | --- | --- |
| Semantic category | `item.category` / `staple.category` | Clothing, Bathroom, Tech, Other essentials, Nice attire, etc. |
| List section/timing | `item.section` | `main`, `return`, or `packlast` |
| Toiletry membership | `item.groupId === "toiletry-bag"` | One canonical Bathroom checkbox whose contents also gate bag placement |
| Future Pack last flag | `staple.packLast` | Seeds a future trip item into `section: "packlast"` without changing category |
| Packed progress | `item.packed` against `item.qty` | Supports partial quantities |

Rules and examples:

- **Chargers** is one collective item, not one row per charger.
- **Everyday glasses** is distinct from **Sunglasses**.
- Bathroom items may carry Pack last timing but remain one canonical toiletry checkbox.
- Dress-specific undergarments are distinct from everyday underwear and return-outfit underwear.
- Return outfit underwear/socks are distinct from everyday quantities.

### Default Pack last items

Seven canonical defaults are flagged Pack last:

1. Laptop
2. Chargers
3. Everyday glasses
4. Contacts
5. Toothbrush
6. Toothpaste
7. Deodorant

Implementation detail: `defaultPackLast` directly creates Laptop, Chargers, and Everyday glasses; the four Bathroom defaults come from initial staples with `packLast: true` and `groupId: "toiletry-bag"`. They still render as Toiletries contents and are not duplicated.

## 7. Data model

The current model exists only as JavaScript objects in [`dist/app.js`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/app.js).

```text
AppState
  view: trips | create | builder | trip | review | staples | settings
  selectedTripId: string
  filter: all | still
  simulatedSync: saved | offline | waiting
  pendingTrip: PendingTrip | null
  tripListView: upcoming | archive
  staplesFilter: all | packlast
  deletedTrips: [{ trip, deletedAt }]
  quickViewOpen: Record<tripId, boolean>
  quickViewFilters: Record<tripId, all | still>
  staples: Staple[]
  trips: Trip[]

Trip
  id: string
  destination: string
  location: SampleLocation | null
  start/end: YYYY-MM-DD
  config: TripConfig
  days: number
  dailyDays: number
  items: TripItem[]
  suggestionMemory: Record<itemId, TripItem>
  suppressedSuggestions: Record<itemId, boolean>
  toiletryBagPacked: boolean
  ready: boolean
  weather: { status: pending | accepted | skipped, label, suggestion }
  copiedFrom: tripId | null
  archived: boolean
  createdFromSample: true

TripItem
  id, name, category
  qty: integer >= 1 for editable items
  packed: integer clamped to 0..qty
  section: main | return | packlast
  groupId?: toiletry-bag
  optional?: boolean
  userEdited?: boolean

Staple
  id, name, category
  qty: integer
  cadence: per day | per trip
  packLast: boolean
  groupId?: toiletry-bag

TripConfig
  laundry: boolean
  spare: boolean
  niceAttire: boolean
  occasionCount: integer 1..8
  reuseNice: boolean
  returnOutfit: boolean

SampleLocation
  id, city, region, country, countryCode, label
```

A production schema should preserve immutable historical trip snapshots while giving future staples independent versioning. Do not directly translate the in-memory object graph into a database without deciding ownership, migrations, deletion/retention, sync conflicts, and privacy fields.

## 8. Calculation rules

The deterministic calculator is [`dist/core.js`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/core.js).

### Dates

- `tripDays` is inclusive: Nov 12 through Nov 16 is 5 days.
- Reversed or missing return dates normalize to the departure date.
- Same-day trips are valid.
- `dailyDays = max(0, tripDays - 2)`.
- The two excluded days are the outbound-worn day and the return-travel day.

### Everyday and nice clothing

```text
niceCount = niceAttire ? max(1, occasionCount) : 0
niceLooks = reuseNice ? min(niceCount, 1) : niceCount
everydayLooks = max(0, dailyDays - niceCount)

everyday tops = laundry ? ceil(everydayLooks / 2) : everydayLooks
everyday bottoms = everydayLooks == 0
  ? 0
  : max(1, ceil(everydayLooks / (laundry ? 4 : 2)))
underwear = dailyDays + (spare ? 1 : 0)
socks = dailyDays + (spare ? 1 : 0)
sleepwear = tripDays > 1 ? 1 : 0
nice top = niceLooks
nice bottom = niceLooks
dress shoes = niceCount ? 1 : 0, optional
makeup = niceCount ? 1 : 0, optional
dress-specific undergarments = niceCount ? 1 : 0, optional
```

Laundry reduces repeatable everyday clothing; it does not reduce underwear or socks in the current implementation.

### Return outfit

When enabled, the trip receives exactly four separate items, each quantity 1:

- Fresh top
- Bottoms
- Underwear
- Socks

These are not merged with everyday items and do not assume reuse.

### Important unresolved calculation point

The builder lets the user turn the return outfit off, but `dailyDays` remains `tripDays - 2` even when it is off. The UI summary changes the displayed return-set count to zero, while everyday quantities still exclude the return day. Before production, explicitly decide whether turning off the dedicated return set means reuse on return day or whether everyday quantities should add that day back; then align calculation, copy behavior, tests, and copy.

### Staples merge

- Per-day staple quantity is `dailyDays × staple.qty`.
- Per-trip staple quantity is `staple.qty`.
- Underwear/socks receive the spare increment when enabled.
- Matching IDs merge into one canonical trip item.
- Matching Makeup/Dress shoes/dress-undergarments semantics deduplicate calculated suggestions against staples.
- Makeup is forced into the toiletry group.

### Forecast label

- Departure 0–10 days from the fixed prototype date: **Close forecast**.
- Otherwise: **Seasonal outlook**.
- This label is simulated and does not fetch weather.

## 9. Readiness state machine

```text
PACKING
  ├─ item checks/partial quantities
  ├─ all ordinary + toiletry contents checked
  └─ if toiletries exist, toiletry bag must also be confirmed in suitcase
          ↓
ALL PACKED, NOT READY
  └─ user opens Review your bag
          ↓
REVIEW
  ├─ corrections can return the trip to incomplete
  └─ explicit "I'm ready to go"
          ↓
READY
  ├─ Mark as not ready → PACKING, progress preserved
  ├─ uncheck/edit/remove/recalculate/accept weather → PACKING
  └─ undo toiletry-bag placement → PACKING, content checks preserved
```

`allPacked(trip)` requires every `item.packed >= item.qty`. If any toiletries exist, it also requires `trip.toiletryBagPacked === true`. Packed totals count the bag-placement gate as one additional completion unit.

## 10. Toiletry-bag state machine

```text
CONTENTS INCOMPLETE
  bag placement = false
  action shown: waiting

ALL CONTENTS CHECKED, BAG OUTSIDE
  automatic prompt may open once
  persistent action remains: Put bag in suitcase

CONFIRMATION DIALOG
  Not yet → remain BAG OUTSIDE
  Confirm → BAG IN SUITCASE

BAG IN SUITCASE
  counts as one additional packed unit
  Undo placement → BAG OUTSIDE, contents remain checked, Ready revoked
```

Changing a Bathroom quantity, adding/removing a Bathroom item, or unchecking any Bathroom content invalidates placement. The final Bathroom content check may prompt for placement, but it never silently confirms it.

## 11. Weather and location mock limitations

### Weather

- Weather cards and labels are explicitly marked **Simulated**.
- Pending suggestion: compact umbrella.
- Reviewing does not mutate the list.
- Accepting adds one canonical `weather-umbrella` item.
- Skipping adds nothing; Review again is available.
- There is no network request, forecast provider, current weather, severe-weather alerting, or timezone handling.

### Location

- The picker searches a hardcoded local array only.
- Ambiguous London results demonstrate city/region/country disambiguation.
- A chosen sample result is required before proceeding.
- There is no live search, geocoding, place ID provider, country database, coordinate storage, or address validation.
- The displayed image is selected from a small local mapping, not fetched from the destination.

Production design must minimize exposure of exact trip dates and locations and decide what is stored locally, remotely, in logs, and in third-party weather/geocoding requests.

## 12. Copy, draft, archive, delete, and history behavior

### Draft

- `pendingTrip` is separate from saved trips.
- Draft edits never appear on the dashboard.
- Cancel clears `pendingTrip`.
- Save constructs a new trip snapshot and inserts it at the front of `state.trips`.

### Copy

- Copy begins as a new draft with the source trip's preference config.
- The user must confirm a new sample location and dates.
- Saving recalculates suggestions for the new dates/preferences.
- Every item check, toiletry placement, and Ready state starts clear.
- The original trip and its item history remain unchanged.
- `copiedFrom` records the source ID in memory.

### Archive

- `archived` moves a trip out of Upcoming even if its dates are future.
- A manually archived future trip can be restored.
- Past-by-date trips appear in the same history view.

### Remove and undo

- Remove is a confirmation-gated move to `deletedTrips`.
- Undo re-inserts the exact trip if its ID is not already present.
- There is no permanent delete or retention timer in this prototype.
- Refreshing the page discards removed/restored state because nothing is durable.

## 13. Source layout

```text
.openai/hosting.json          Site ID and static directory declaration
dist/index.html               Static shell, banner, top bar, navigation
dist/styles.css               Lagoon & Linen tokens, responsive layout, components
dist/core.js                  Pure date and packing calculations
dist/app.js                   In-memory state, screens, rendering, actions, modals
dist/assets/*.jpg             Destination artwork and neutral fallback
tests/core.test.mjs           Deterministic calculation tests
tests/static.test.mjs         Static requirements and asset checks
tests/browser.test.mjs        End-to-end browser flow and screenshots
artifacts/*.png               Browser QA screenshots and design comparisons
artifacts/status-comparison.html  Historical status-palette comparison page
handoff/START_HERE.md         Compact model entry point retained with the prototype
TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md  This report in the production repository
```

There is no package manifest, dependency install, framework build, server code, service worker, database migration, or production environment file.

## 14. Test and verification record

At commit `539c448e4f7d820699fbff344d93db226a73b72a`, the following passed:

```bash
node --check dist/app.js
node --check dist/core.js
node tests/core.test.mjs
node tests/static.test.mjs
node tests/browser.test.mjs
git diff --check
```

Results:

- `Core calculation tests passed`
- `Static requirement checks passed`
- `Browser flow tests passed`
- No uncaught browser exceptions.
- Repository was clean after the published commit.

### Browser-test prerequisites

Terminal 1, from project root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Terminal 2 on this Mac:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new \
  --remote-debugging-port=9223 \
  --user-data-dir=/tmp/caroline-packing-handoff-browser \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-sync \
  --disable-component-update \
  about:blank
```

Terminal 3:

```bash
node tests/browser.test.mjs
```

The browser test exercises phone width (`390 × 844`) and desktop width (`1440 × 1000`), image loading/fallback, create/cancel/save, dates, Nice outfits, partial quantities, trip/future edits, toiletries, weather review, copy, Ready review, revocation, archive/remove/undo, staples, simulated sync, and reset.

## 15. Visual evidence and historical design artifacts

All links below are relative to this report and resolve to checked-in local files.

### Current destination art and dashboard

- [Phone destination trip card](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-destination-card.png)
- [Phone destination trip header](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-destination-header.png)
- [Desktop destination trip header](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-destination-header.png)
- [Phone dashboard](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-dashboard.png)
- [Desktop dashboard statuses](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-dashboard-statuses.png)
- [Phone dashboard Quick view](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-dashboard-quick-view.png)
- [Desktop dashboard Quick view](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-dashboard-quick-view.png)

### Packing, review, and Ready

- [Phone packing list](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-packing-list.png)
- [Phone toiletry-bag gate](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-toiletry-bag.png)
- [Phone Nice outfits](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-nice-outfits.png)
- [Desktop Nice outfits](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-nice-outfits.png)
- [Desktop review screen](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-review.png)
- [Phone Ready actions](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-ready-actions.png)
- [Phone review while Ready](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-review-ready-actions.png)

### History and staples

- [Phone archive](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-archive.png)
- [Desktop archive](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-archive.png)
- [Phone staples](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-staples-all.png)
- [Desktop Pack last staples filter](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/desktop-staples-pack-last.png)

### Historical palette comparison

- [Status comparison image](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/dashboard-status-comparison.png)
- [Status comparison HTML](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/status-comparison.html)
- [Previous status screenshot](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts/phone-dashboard-before-statuses.png)

The final status direction uses green Ready and apricot items-left badges. The historical comparison remains useful context but is not the runtime source of truth.

## 16. Known limitations and implementation caveats

1. **Everything is in memory.** Refreshing discards all edits, checkmarks, archive state, deleted trips, and sync simulation.
2. **Saved/Offline/Waiting are illustrative labels only.** They make no durability claim.
3. **Site privacy is not app authentication.** Owner-private hosting restricts prototype access, but there is no application identity model or row-level ownership.
4. **Fixed prototype date.** `TODAY` is hardcoded to `2026-10-16` for deterministic tests.
5. **Limited local location set.** No real geocoding or provider-backed canonical IDs.
6. **Limited art mapping.** San Diego, Lisbon, and London England have specific art; all other selections use the neutral fallback.
7. **No real offline.** Responsive web access exists, but there is no service worker, install manifest, IndexedDB store, background sync, or merge policy. Those features are not required for the first online-first release.
8. **No export/recovery.** There is no JSON/CSV/PDF export, import, snapshot, backup, restore, or audit log.
9. **No production delete semantics.** Recently deleted is only an in-memory undo buffer.
10. **No timezone policy.** Date math uses UTC parsing and a fixed date string.
11. **Return-outfit-off ambiguity.** The calculator still excludes return day when the dedicated return set is disabled.
12. **Accessibility is not formally audited.** The prototype includes labels, keyboard-focus styles, semantic buttons, live toast status, responsive layouts, and reduced-motion support, but no screen-reader or WCAG audit is recorded.
13. **No sensitive-data controls.** The wireframe warns against real sensitive travel details but does not technically prevent entry.
14. **No production image policy.** Current art is generated and local; long-term sourcing, licensing records, caching, and per-destination coverage are undecided.

## 17. Open product and architecture decisions

The web delivery, Neon backend, Vercel hosting, and initial email/password method are selected. These details remain unresolved:

- Exact same-origin runtime/framework; Next.js is the current candidate, not yet implemented.
- Owner login email, signup allowlist behavior, verification/reset/email delivery, session lifetime, device revocation, and exact trusted production origin.
- Export/import format and disaster-recovery process.
- Encryption, logging, analytics, retention, and deletion policies for dates and destinations.
- Weather provider, geocoding provider, request minimization, caching, and consent.
- Timezone rules for departure/return and current-date classification.
- Whether return-outfit-off means reuse or adds return day to everyday counts.
- How much destination art coverage production needs and whether art is generated, curated, or provider-sourced.
- Whether/when any sharing or additional travelers should exist.

Offline queueing, service workers, and conflict resolution are deferred, not current blockers. Revisit them only if offline use becomes a requirement.

## 18. Selected production architecture direction — provisioned, not built

The services and deployment constraints are selected, but application behavior is not implemented or verified.

### Intended shape

- Responsive device-agnostic web app; no sideloading requirement.
- Same-origin server/API boundary, with Next.js as the current candidate.
- Managed Better Auth email/password login with one explicitly allowed owner at launch.
- Neon Postgres for durable cross-device persistence.
- Ownership checks enforced in server code on every trip, staple, progress, copy, export, and restore operation, even while only one user exists.
- Explicit Saved/Saving/Error states based on real server results; do not retain the prototype's simulated Offline/Waiting claims.
- Encrypted transport, provider-managed encryption at rest, minimized logs, and no precise trip data in analytics.
- User-controlled export and tested restore.
- Weather/geocoding as opt-in server-mediated requests with caching and minimal retained data.

Preview deployments must use isolated synthetic preview data and separate preview credentials. Never expose the Production `DATABASE_URL` to previews. The first deployment must contain synthetic data only.

### Suggested logical data sets

```text
users
staples
trips
trip_preferences
trip_items
trip_item_progress
weather_suggestions
exports/backups metadata (if required)
```

These are logical relational boundaries, not a final schema. Keep historical trip items as snapshots. A staple edit should not cascade into old trip records. Use stable semantic IDs plus per-trip immutable item IDs so similar names do not accidentally merge. Create versioned migrations before any real data exists.

## 19. Production single-user setup checklist

Checked infrastructure items are complete. All unchecked application behavior remains unimplemented or unverified.

### Product/privacy decisions

- [ ] Write a one-page threat model for exact destinations, dates, packing habits, and account recovery.
- [x] Defer offline behavior for the first online-first release; do not build service workers, mutation queues, or conflict sync now.
- [ ] Decide retention, permanent deletion, recently-deleted duration, backups, and restore.
- [ ] Decide export/import formats and whether exports include sensitive dates/locations.
- [ ] Resolve return-outfit-off calculation semantics.
- [ ] Decide timezone behavior.

### Delivery and identity

- [x] Select an online-first responsive web app.
- [x] Select Vercel Hobby hosting and create the empty project.
- [x] Select Neon managed Better Auth with email/password initially.
- [ ] Choose the exact owner login email and enforce a server-side allowlist before provisioning the account.
- [ ] Configure the exact verified production trusted domain and verification/reset/email-delivery behavior with separate approval.
- [ ] Disable unused shared development OAuth as appropriate; Apple OAuth is not part of the initial plan.
- [ ] Define session lifetime, device revocation, rate limits, and emergency access recovery.
- [ ] Preserve owner-private preview separately from production.

### Data and backend

- [x] Select and create Neon Free Postgres + Better Auth in AWS Oregon.
- [x] Create the private GitHub repository and empty Vercel project.
- [x] Configure approved project-scoped deployment and Production runtime credentials without recording their values here.
- [ ] Inspect the approved prototype source, tests, and art before implementation; preserve all approved UX and calculations.
- [ ] Scaffold the same-origin application architecture.
- [ ] Design versioned schema and migrations.
- [ ] Implement ownership authorization in the server/API layer and test signed-out and cross-user denial.
- [ ] Implement managed login and durable cloud persistence.
- [ ] Preserve historical trip snapshots when staples change.
- [ ] Implement trip copying, date constraints, staples/count logic, packing, toiletry-bag confirmation, review, and Ready reversal.
- [ ] Implement truthful Saving/Saved/Error UI states.
- [ ] Implement backup and tested restore.
- [ ] Implement user-triggered export and import validation.

### Deployment and verification

- [ ] Implement GitHub Actions + Vercel CLI deployment on `develop` and `main`, following the pattern in `C-Azzone416/tabletop-sim` without modifying or sharing its credentials.
- [ ] Use isolated preview data/credentials; never make the Production database credential available to preview deployments.
- [ ] Verify no secret is bundled into client JavaScript or printed in build/runtime logs.
- [ ] Test reload and cross-device durability before any real use.
- [ ] Test copied-trip reset/date rules, toiletries placement, Ready reversal, signed-out access, and cross-user access.
- [ ] Run mobile and desktop visual/interaction QA against the approved prototype.
- [ ] Deploy synthetic data first; do not upload real trip data until all security and durability checks pass.

### Weather, locations, and imagery

- [ ] Choose location and weather providers only after privacy review.
- [ ] Minimize and document third-party requests and retained fields.
- [ ] Require review before every suggested list mutation.
- [ ] Decide destination-art source, attribution/licensing records, caching, and fallback.
- [ ] Never infer that a location image is live when it is not.

### Quality and operations

- [ ] Port the current calculation tests unchanged before refactoring logic.
- [ ] Add database authorization, migration, export/restore, reload, and cross-device tests.
- [ ] Add formal accessibility and screen-reader testing.
- [ ] Add dependency, secret, logging, and incident-response practices.
- [ ] Test at phone widths and desktop after every major workflow change.
- [ ] Keep sample data synthetic; no migration from prototype memory is required unless Caroline explicitly asks for it.

### Deferred unless requirements change

- [ ] Reassess installability, service workers, offline queues, local persistence, and conflict resolution only if offline use becomes important.

The credentials already listed in this document were specifically approved and configured. Creating another persistent token, OAuth credential/grant, integration, or changing auth/security settings requires separate action-time approval. Ordinary implementation that consumes the existing server-side variables does not require recreating those credentials.

## 20. Guidance for the next model

1. Start with the [prototype `handoff/START_HERE.md`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/handoff/START_HERE.md), then this report.
2. Inspect [`dist/core.js`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/core.js), [`dist/app.js`](/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist/app.js), and all three test files before changing behavior.
3. Run the existing tests before and after implementation.
4. Preserve the approved readiness and toiletry-placement gates.
5. Preserve item identity: no duplicated Bathroom/Pack last items, no merged everyday/return underwear, no split Chargers collection.
6. Preserve historical trip snapshots when future staples change.
7. Do not silently add live weather, geocoding, analytics, external image providers, or new authentication providers. Neon and Better Auth are selected, but their application behavior is not implemented.
8. Preserve backend history accurately: the former Firebase recommendation is superseded; Neon Free Postgres and managed Better Auth are selected and provisioned, while Firebase, Supabase, and Clerk are not selected.
9. Keep exact trip dates and locations out of logs and analytics by default.
10. If publishing prototype edits, preserve owner-private access and verify the exact deployed commit.
11. Never claim auth isolation, cloud saving, deployment, or cross-device durability is working until it has been implemented and tested.

