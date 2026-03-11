# CLAUDE.md — aeyu.io (Participation Awards)

## What This Is

A 100% client-side cycling awards app. Connects to Strava via OAuth, syncs activity/segment data into IndexedDB, computes personal awards that Strava doesn't offer (year bests, season firsts, consistency streaks, comeback tracking, etc.), and displays them in a PWA.

**No backend stores user data.** The only server component is a Cloudflare Worker (`worker/`) that proxies OAuth token exchange (Strava requires server-side client_secret). All data lives in the user's browser.

## Code Navigation

**Always start by reading `_MAP.md` to orient yourself.** Before exploring or modifying any code, read the root `_MAP.md` first, then follow links to subdirectory maps. This gives you the full picture of exports, signatures, and line numbers without reading thousands of lines of source. Only open source files when you need implementation details.

```
_MAP.md              → root overview, subdirectory links
src/_MAP.md          → all src modules with exports and signatures
src/components/_MAP.md → component exports
worker/_MAP.md       → worker endpoints
test/_MAP.md         → harness functions
```

## Tech Stack

- **Preact + HTM + Signals** — no build step, vendored ESM bundles in `vendor/`
- **IndexedDB** — client-side storage (activities, segments, sync_state, auth)
- **Tailwind CSS** — pre-built via `@tailwindcss/cli`, output in `vendor/tailwind.css`
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
vendor/
  preact.mjs        Preact 10.28.4 ESM bundle
  hooks.mjs         Preact hooks ESM bundle
  signals.mjs       @preact/signals 2.8.2 ESM bundle
  signals-core.mjs  @preact/signals-core 1.14.0 ESM bundle
  htm.mjs           HTM 3.1.1 base module
  htm-preact.mjs    HTM/Preact bindings (exports html tagged template)
  tailwind.css      Pre-built Tailwind CSS (generated from tailwind-input.css)
  tailwind-input.css  Tailwind CLI input with @source directives
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

- **Minimal comments.** Only add comments that explain non-obvious logic (e.g. why a zero-height div exists, what a cryptic calculation does). Do not add section labels, JSDoc, file docblocks, or comments that restate what the code already says.
- **No build step.** Edit JS files directly, refresh browser. ESM deps are vendored locally.
- **Tailwind rebuild.** After adding new Tailwind utility classes, regenerate: `npx @tailwindcss/cli -i vendor/tailwind-input.css -o vendor/tailwind.css --minify`
- **Signals for state.** Preact signals (`@preact/signals`) drive reactivity. Key signals: `authState`, `route`, `syncProgress`, `isSyncing`, `unitSystem`, `isDemo`.
- **HTM templating.** `html\`...\`` tagged template literals instead of JSX. Closing tags use `<//>`.
- **IndexedDB everywhere.** All persistent state in IndexedDB. No localStorage, no cookies.
- **Test harness.** `test/harness.py` generates deterministic mock data, injects via Playwright, takes screenshots, audits award coverage. Requires Playwright + vendor bundles.
- **`_MAP.md` auto-generated at session start.** The SessionStart hook regenerates all `_MAP.md` files automatically. To manually regenerate:
  ```bash
  python3 .claude/skills/mapping-codebases/scripts/codemap.py . --skip vendor,design,assets,icons
  ```

## Common Tasks

**Add a new award type:**
1. Add computation logic in `awards.js` (in `computeAwards` for segment-level, `computeRideLevelAwards` for ride-level)
2. Add label/color in `AWARD_LABELS` in `src/award-config.js` (single source of truth for both Dashboard and ActivityDetail)
3. Add tier ranking in `AWARD_TIER` in `awards.js` (for segment award ranking)
4. Add FAQ entry in Dashboard.js FAQ section (both the "What do the awards mean?" list and a dedicated entry if the feature is complex)
5. Add to test harness scenario in `test/harness.py`

**Add any new user-facing feature:**
1. Add an FAQ entry in the Dashboard.js FAQ modal explaining what it does and how to use it
2. If relevant to pre-auth users (explains what the app offers), also add an entry in the Landing.js FAQ section

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
- **Demo data must stay in sync with the app.** Demo mode loads `demo-data.json` into an isolated IndexedDB — it uses the same code paths as real data, just with canned activities/segments. When adding new features that depend on data structure (new fields on activities, segments, or efforts), update `demo-data.json` to include those fields so demo mode exercises the same functionality as real usage. The demo is NOT a separate code path — it's the same app with fake auth and pre-loaded data.
