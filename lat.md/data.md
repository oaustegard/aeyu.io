# Data

All persistent state lives in IndexedDB in the user's browser. The sync pipeline fetches from Strava's API, and demo mode provides a parallel database with canned data. Data layer: [[src/db.js]].

## IndexedDB Schema

Database `participation-awards` (version 3) with five object stores.

**auth** — Single key `"session"` holding OAuth tokens and athlete profile. No keyPath.

**activities** — Keyed by Strava activity ID. Indexes on `start_date_local`, `sport_type`, `device_watts`, `trainer`. Contains both summary fields (from list endpoint) and detail fields (segment efforts, embedded after detail-fetch). The `has_efforts` flag distinguishes summary-only from detail-fetched activities.

**segments** — Keyed by Strava segment ID. Index on `name`. Each segment accumulates an `efforts` array via [[src/db.js#appendEffort]] — efforts are stored here AND embedded in activities. Both must stay in sync.

**sync_state** — Single key `"state"` tracking backfill progress, last sync timestamp, and the sync window epoch. Enables resumable sync across sessions.

**routes** — Auto-incrementing ID. Stores detected route clusters from [[routes]].

Schema migrations handle v1→v2 (add `device_watts`/`trainer` indexes) and v2→v3 (add `routes` store).

## Sync Pipeline

Multi-phase sync managed by [[src/sync.js]]. Designed for Strava's rate limits and large activity histories.

### Backfill

[[src/sync.js#startBackfill]] fetches the full activity history within the sync window (default 5 years). Paginates through the list endpoint, then detail-fetches each for segment efforts.

Batched in groups of 80 to manage rate limits. Progress is checkpointed in `sync_state` so backfill resumes where it left off if interrupted.

### Incremental Sync

[[src/sync.js#incrementalSync]] fetches only activities newer than the last known activity date. Runs automatically every 5 minutes via [[src/sync.js#startAutoSync]]. Detail-fetches new activities and runs [[data#Data Enrichment]] passes.

### Rate Limiting

Strava enforces 15-minute and daily request limits. [[src/sync.js]] tracks both via response headers (`X-RateLimit-Usage`). The `rateLimitStatus` signal drives UI warnings. Sync pauses when usage exceeds 80% of either limit.

### Data Enrichment

After fetching activities, additional passes fill in missing data: power curves for rides with power meters, heart rate zone data, and Strava-saved routes. Each pass queries IndexedDB for activities missing the relevant fields ([[src/db.js#getActivitiesWithoutPower]], [[src/db.js#getActivitiesWithoutHeartRate]], [[src/db.js#getActivitiesWithoutZones]]).

### Data Enrichment

After fetching activities, additional passes fill in missing data. Each pass queries IndexedDB for activities missing the relevant fields.

Power curves for rides with power meters ([[src/db.js#getActivitiesWithoutPower]]), heart rate zone data ([[src/db.js#getActivitiesWithoutHeartRate]]), zone distributions ([[src/db.js#getActivitiesWithoutZones]]), and Strava-saved routes are each fetched in separate enrichment passes.

## Demo Mode

[[src/demo.js]] provides a complete app experience using canned data. Switches IndexedDB to a separate `participation-awards-demo` database via [[src/db.js#switchToDemoDB]], loads `demo-data.json`, and creates a fake auth session (athlete ID 99999999).

Demo mode uses identical code paths to real mode — the only difference is the data source and the `isDemo` signal that triggers UI changes (amber badge, hidden sync, exit button). Demo data must stay in sync with app features when new data fields are added.

## Settings Export

[[src/db.js#exportSettings]] and [[src/db.js#importSettings]] enable backup/restore of user configuration (disabled award types, unit preferences, reset events). Activity and segment data are not exported — they can be re-synced from Strava.
