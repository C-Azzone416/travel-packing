# START HERE — Caroline's Travel Packing App

This folder is the model-readable handoff for the approved **clickable wireframe**, not a production system.

## Absolute paths

- Project root: `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe`
- Full design and implementation plan: `/Users/cazzone/Repos/travel-packing/TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md`
- This index: `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/handoff/START_HERE.md`
- Static app: `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/dist`
- Tests: `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/tests`
- QA screenshots: `/Users/cazzone/Documents/Codex/2026-10-16/task/caroline-packing-wireframe/artifacts`

## Current status

- Approved mobile-first wireframe for Caroline alone.
- Published owner-private Site: <https://caroline-packing-wireframe.choicelyric4.chatgpt.site>
- Current published/source commit: `539c448e4f7d820699fbff344d93db226a73b72a`
- Site version at handoff: `14`
- Build type: static HTML/CSS/JavaScript with in-memory sample state.
- Selected production direction: online-first, responsive web app; private single-user launch, designed to expand to roughly 1–5 users without a lift-and-shift migration.
- Selected production foundation: Neon Free Postgres with managed Better Auth (email/password initially), a private GitHub repository, and Vercel Hobby deployed through GitHub Actions plus the Vercel CLI.
- Not built: application login, schema/migrations, ownership enforcement, durable cloud persistence, export/restore, deployment workflow, production deployment, live weather/geocoding, or verified production security behavior.
- Offline queues, service workers, and conflict synchronization are intentionally not first-version requirements.

## Provisioned production foundation

- Private repository: <https://github.com/C-Azzone416/travel-packing>
- Empty Vercel Hobby project: <https://vercel.com/c-azzone416s-projects/travel-packing> (`prj_QxQOEprSd7SWg3LOiG1i7nmgwC5S`)
- Neon project: [Caroline Travel Packing](https://console.neon.tech/app/projects/quiet-leaf-68107705/branches/br-frosty-recipe-arxh54js) (`quiet-leaf-68107705`), Free plan, Caroline / `owner@example.test`, AWS US West 2 (Oregon), `production` branch
- GitHub Actions variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are configured.
- GitHub Actions secret `VERCEL_TOKEN` is configured with a new project-only Vercel token expiring October 17, 2027.
- Vercel Production-only variables are configured: `DATABASE_URL` and `NEON_AUTH_COOKIE_SECRET` as Secret, and `NEON_AUTH_BASE_URL` as Config. Never copy secret values into source, docs, logs, or client bundles.
- Direct GitHub–Vercel integration is forbidden. Follow `C-Azzone416/tabletop-sim`'s GitHub Actions + Vercel CLI pattern on `develop` and `main`, without modifying that repository.
- There is no connection to Agent-Clubhouse.

The Vercel warning last verified at 16:54 UTC on October 17, 2026 was only a name-based heuristic on the non-secret `NEON_AUTH_BASE_URL` endpoint. The genuine secrets were masked.

## Read in this order

1. [Full design and implementation plan](/Users/cazzone/Repos/travel-packing/TRAVEL_PACKING_DESIGN_AND_IMPLEMENTATION_PLAN.md)
2. [Calculation source](../dist/core.js)
3. [Application source](../dist/app.js)
4. [Browser flow tests](../tests/browser.test.mjs)
5. [Core calculation tests](../tests/core.test.mjs)
6. [Static requirement tests](../tests/static.test.mjs)

## Run locally

From the project root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Then open `http://127.0.0.1:4173/`.

Fast checks:

```bash
node --check dist/app.js
node --check dist/core.js
node tests/core.test.mjs
node tests/static.test.mjs
```

The browser suite additionally expects a local server on port `4173` and headless Chrome remote debugging on port `9223`; see the full report.

## Non-negotiable approved behavior

- One traveler: Caroline. No shared-traveler model yet.
- Outbound-worn outfit is excluded from bag quantities.
- Return travel outfit defaults on and is a separate fresh top, bottoms, underwear, and socks.
- Last checklist completion never marks a trip Ready automatically.
- Ready requires a full review and explicit **I'm ready to go** confirmation.
- Any correction after Ready revokes Ready.
- Toiletry contents and placing the completed toiletry bag in the suitcase are separate completion gates.
- Weather suggestions never mutate the list silently.
- Pack last is a timing flag/view, not a category or duplicate item.
- Historical trips are not rewritten by future staple edits.
- Prototype remains sample-data-only and owner-private.

## Ordered next steps

1. Inspect the approved prototype source, tests, and art; preserve the approved Lagoon & Linen design and all non-negotiable behaviors.
2. Scaffold a same-origin web architecture (Next.js is the current candidate) without replacing the approved UI.
3. Add a versioned Postgres schema and migrations with server-enforced ownership on every trip, staple, progress, and export/restore operation.
4. Implement managed email/password login and durable persistence. Restrict actual access to the chosen owner email in server logic; hiding signup UI is not sufficient.
5. Implement trip copying, staples, calculation rules, packing/readiness flows, explicit saving/error states, and export/restore.
6. Add GitHub Actions deployment using the Vercel CLI on `develop` and `main`. Preview deployments must use isolated preview data, never the production database credential.
7. Before real use, review auth settings with separate approval: choose the owner email, set the exact verified production domain, define verification/reset/email delivery, and disable unused development OAuth as appropriate.
8. Test reload and cross-device durability, date/copy rules, toiletry-bag and Ready reversal, signed-out/cross-user denial, absence of client-bundled secrets, export/restore, and mobile visual/interaction quality.
9. Make the first deployment with synthetic data only. Do not enter real trip data until the security and durability checks pass.

This setup task created infrastructure and stored approved credentials, but uploaded no app source, workflow, schema, migration, deployment, or real trip data. The app is not ready for real use. Any new persistent credential, OAuth grant, or auth/security-setting change needs separate action-time approval.

