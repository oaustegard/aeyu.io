# CLAUDE.md — aeyu.io (Participation Awards)

## What This Is

A 100% client-side cycling awards app. Connects to Strava via OAuth, syncs activity/segment data into IndexedDB, computes personal awards that Strava doesn't offer (year bests, season firsts, consistency streaks, comeback tracking, etc.), and displays them in a PWA.

**No backend stores user data.** The only server component is a Cloudflare Worker (`worker/`) that proxies OAuth token exchange (Strava requires server-side client_secret). All data lives in the user's browser.

## Code Navigation

**Read `_MAP.md` files before reading source files.** Every directory has a `_MAP.md` showing all exported functions with signatures, classes, imports, and line numbers. Start with the root `_MAP.md`, follow links to subdirectory maps, and only open source files when you need implementation details. This avoids reading thousands of lines to find a function signature.

```
_MAP.md              → root overview, subdirectory links
src/_MAP.md          → all src modules with exports and signatures
src/components/_MAP.md → component exports
worker/_MAP.md       → worker endpoints
test/_MAP.md         → harness functions
```

## Tech Stack

- **Preact + HTM + Signals** — no build step, ESM imports from esm.sh CDN
- **IndexedDB** — client-side storage (activities, segments, sync_state, auth)
- **Tailwind CSS** — via CDN (play.tailwindcss.com)
- **Cloudflare Worker** — OAuth proxy only (`worker/worker.js`)
- **GitHub Pages** — static hosting at aeyu.io
- **Playwright** — test harness (`test/harness.py`)

## Architecture

```
index.html          Entry point, loads src/app.js as ESM module
src/
  app.js            Router (hash-based), init, render loop
  auth.js           OAuth flow, token management, authState signal
  config.js         Public config (client ID, worker URL, redirect URI)
  db.js             IndexedDB wrapper — all data access goes through here
  sync.js           Strava API sync: backfill, incremental, rate limiting
  awards.js         Award computation engine (26+ award types)
  units.js          Metric/imperial formatting, signal-based preference
  demo.js           Demo mode: load canned data, fake auth, isDemo signal
  icons.js          SVG icon rendering (Preact components + Canvas drawing)
  components/
    Landing.js      Pre-auth landing page with FAQ, demo link
    Dashboard.js    Main screen: activities, awards, sync, settings
    ActivityDetail.js  Per-activity view with segment efforts and share card
    SyncProgress.js    Legacy sync screen (now inline in Dashboard)
callback.html       OAuth redirect target
demo-data.json      Canned demo data (~60 activities, 10 segments)
sw.js               Service worker for PWA offline support
worker/
  worker.js         Cloudflare Worker: /auth/token, /auth/refresh
  wrangler.toml     Worker config (STRAVA_CLIENT_SECRET in env)
test/
  harness.py        Playwright-based test harness with mock data generation
  fixture-real.json Real Strava data fixture (owner's data, do not publish)
  inject.html       Helper page for IndexedDB injection during tests
  setup.sh          Test environment setup script
```

## Key Concepts

### Award Types (in awards.js)
Awards are per-segment-effort or per-ride. Segment awards require history depth (min efforts, calendar gates). The CV filter suppresses awards on high-variance segments (traffic lights). Key types: `season_first`, `year_best`, `recent_best`, `beat_median`, `top_quartile`, `top_decile`, `consistency`, `monthly_best`, `improvement_streak`, `comeback`, `milestone`, `best_month_ever`, `closing_in`, `anniversary`, `ytd_best_time`, `ytd_best_power`, `reference_best`. Comeback mode adds: `comeback_pb`, `recovery_milestone`, `comeback_full`.

### Data Flow
1. OAuth → `auth.js` gets tokens via worker proxy
2. `sync.js` fetches activity list, then detail-fetches each for segment efforts
3. Efforts stored in both `activities` (embedded) and `segments` (by segment ID) stores
4. `awards.js` computes awards by loading segment history from IndexedDB
5. Dashboard/ActivityDetail render awards with share card generation (Canvas)

### Sync & Rate Limiting
Strava API has 15-min and daily rate limits. Sync is resumable — `sync_state` tracks progress. Backfill happens over multiple sessions. `syncProgress` and `rateLimitStatus` are signals that drive UI.

### Demo Mode (demo.js)
Loads `demo-data.json` into IndexedDB with a fake auth session (athlete ID 99999999). Dashboard detects demo via `isDemo` signal and shows amber badge, hides sync, shows exit button. `exitDemo()` clears all stores.

## Development Patterns

- **No build step.** Edit JS files directly, refresh browser. ESM imports resolve via CDN.
- **Signals for state.** Preact signals (`@preact/signals`) drive reactivity. Key signals: `authState`, `route`, `syncProgress`, `isSyncing`, `unitSystem`, `isDemo`.
- **HTM templating.** `html\`...\`` tagged template literals instead of JSX. Closing tags use `<//>`.
- **IndexedDB everywhere.** All persistent state in IndexedDB. No localStorage, no cookies.
- **Test harness.** `test/harness.py` generates deterministic mock data, injects via Playwright, takes screenshots, audits award coverage. Requires Playwright + vendor bundles.

## Common Tasks

**Add a new award type:**
1. Add computation logic in `awards.js` (in `computeAwards` for segment-level, `computeRideLevelAwards` for ride-level)
2. Add label/color in `AWARD_LABELS` in `src/award-config.js` (single source of truth for both Dashboard and ActivityDetail)
3. Add tier ranking in `AWARD_TIER` in `awards.js` (for segment award ranking)
4. Add FAQ entry in Dashboard.js FAQ section
5. Add to test harness scenario in `test/harness.py`

**Modify sync behavior:**
Edit `sync.js`. Rate limit tracking is automatic. New fields from Strava API need to be added to both the activity summary storage and the segment effort extraction.

**Deploy:**
Push to `main` → GitHub Pages auto-deploys. Worker changes need `wrangler deploy` separately.

## Gotchas

- **No `gh` CLI available.** Use the GitHub REST API with `$GH_TOKEN` env var for auth. Example PR creation:
  ```bash
  curl -s -X POST "https://api.github.com/repos/oaustegard/aeyu.io/pulls" \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"...","head":"branch-name","base":"main","body":"..."}'
  ```
  Don't attempt `gh issue`, `gh pr`, etc.

- Segment efforts are stored in TWO places: embedded in activities AND in the segments store. Both must be populated.
- The `has_efforts` flag on activities distinguishes summary-only (from list endpoint) from detail-fetched activities
- Power awards require `device_watts: true` — estimated power is excluded
- Calendar gate: Year Best suppressed before March 1 to avoid thin early-season data
- CV filter: segments with coefficient of variation > 0.5 suppress most awards
- `fixture-real.json` contains real user data — never commit changes that expose PII
