# Participation Awards — Technical Spec
## "Giving recognition for efforts where effort was given"

**Version:** 0.1 (MVP)
**Date:** 2026-03-07
**Author:** Muninn (architecture), CCotw (implementation)

---

## 1. Problem

Strava's achievement system only recognizes PRs and podium finishes. Athletes past their peak — or simply early in their season — get zero recognition for genuine effort. The core demographic most likely paying for Strava (40+) is the least served by this system.

## 2. Solution

A companion web app that pulls a user's Strava history, caches it client-side, and runs an awards engine to surface meaningful recognition. MVP scope: **temporal window awards** (best this year).

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Browser (Preact SPA on GitHub Pages — aeyu.io)  │
│                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────┐ │
│  │ Strava API   │  │ IndexedDB    │  │ Awards │ │
│  │ Client       │  │ Cache        │  │ Engine │ │
│  │ (direct)     │  │ (all data)   │  │        │ │
│  └──────┬───────┘  └──────────────┘  └────────┘ │
│         │                                        │
└─────────┼────────────────────────────────────────┘
          │ access_token (from IndexedDB)
          │
          ▼
┌─────────────────────┐     ┌──────────────────────┐
│  Strava API         │     │  CF Worker            │
│  api.strava.com     │     │  (OAuth proxy only)   │
│                     │     │  - token exchange      │
│                     │     │  - token refresh       │
│                     │     │  Holds: client_secret  │
└─────────────────────┘     └──────────────────────┘
```

### Key Principle
The Worker is a thin OAuth proxy. It holds ONE secret (the app's client_secret) and performs TWO operations (token exchange, token refresh). All Strava data flows directly between the browser and Strava's API. No user data ever touches our server.

## 4. Components

### 4.1 Cloudflare Worker (OAuth Proxy)

**Deployment:** Single Worker on Oskar's CF account
**Secrets (via `wrangler secret put`):**
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

**Endpoints:**

#### `POST /auth/token`
Exchange authorization code for tokens.

```
Request:  { code: string }
Response: { access_token, refresh_token, expires_at, athlete }
```

Implementation:
```
POST https://www.strava.com/oauth/token
  client_id=<from secret>
  client_secret=<from secret>
  code=<from request>
  grant_type=authorization_code
```

#### `POST /auth/refresh`
Refresh an expired access token.

```
Request:  { refresh_token: string }
Response: { access_token, refresh_token, expires_at }
```

Implementation:
```
POST https://www.strava.com/oauth/token
  client_id=<from secret>
  client_secret=<from secret>
  refresh_token=<from request>
  grant_type=refresh_token
```

#### CORS
Both endpoints must return appropriate CORS headers for the Pages domain.

```
Access-Control-Allow-Origin: https://aeyu.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

For local dev, also allow `http://localhost:*`.

### 4.2 Client App (Preact SPA on CF Pages)

**Stack:** Preact + HTM + Signals, zero-build (CDN imports via esm.sh), hosted on GitHub Pages
**Domain:** `aeyu.io` (existing site — "the sound you make at the top of the climb")
**Path:** Root — the app IS the site
**Repo:** `oaustegard/aeyu.io` (GitHub Pages, deploys from `main` branch root)

**Existing infrastructure:** The site already uses the exact stack — Preact 10.23.1, HTM 3.1.1, Signals 1.3.0 via esm.sh import maps, Tailwind via CDN. Currently hosts Bluesky utilities as standalone HTML pages linked from a landing page. Participation Awards follows the same pattern.

**Import map** (already present in site, use same pattern — note existing site doesn't use `*` prefix, match convention):
```html
<script type="importmap">
  {
    "imports": {
      "preact": "https://esm.sh/preact@10.23.1",
      "preact/": "https://esm.sh/preact@10.23.1/",
      "@preact/signals": "https://esm.sh/@preact/signals@1.3.0?external=preact",
      "htm/preact": "https://esm.sh/htm@3.1.1/preact?external=preact"
    }
  }
</script>
```
Note: existing site uses `?external=preact` pattern instead of `*` prefix. Match this convention.

**State management:** Signals for all shared state (sync progress, current awards, auth state). Each module exports signals that components subscribe to reactively. No prop drilling, no context boilerplate.

**Code organization:** ES modules loaded via `<script type="module">`. No bundler, no transpiler. Hash-based routing for the 4-5 screens.

**Easter egg:** The domain name explanation — "it's the sound you make at the top of the climb" — dynamically injects the name of the user's hardest segment (highest avg grade or most elevation gain).

#### 4.2.1 Auth Flow

1. User clicks "Connect with Strava"
2. Browser redirects to:
   ```
   https://www.strava.com/oauth/authorize?
     client_id=69734 (from src/config.js)
     &redirect_uri=https://aeyu.io/callback.html
     &response_type=code
     &scope=activity:read_all
     &approval_prompt=auto
   ```
3. User authorizes on Strava
4. Strava redirects back with `?code=XXXXX`
5. Client POSTs code to Worker's `/auth/token`
6. Worker exchanges code for tokens, returns them
7. Client stores in IndexedDB:
   - `access_token`
   - `refresh_token`
   - `expires_at` (unix timestamp)
   - `athlete` (id, firstname, lastname, profile pic)

**Scope:** `activity:read_all` — needed to access all activities including private ones. `read` scope is insufficient for segment effort data.

**Token refresh:** Before any API call, check `expires_at`. If expired (or within 5 min of expiry), call Worker's `/auth/refresh` first.

#### 4.2.2 IndexedDB Schema

Database name: `participation-awards`

**Store: `auth`**
```
Key: "session"
Value: {
  access_token: string,
  refresh_token: string,
  expires_at: number,
  athlete: {
    id: number,
    firstname: string,
    lastname: string,
    profile: string  // avatar URL
  }
}
```

**Store: `activities`**
```
Key: activity.id (number)
Value: {
  id: number,
  name: string,
  sport_type: string,
  start_date: string,        // ISO 8601
  start_date_local: string,
  distance: number,           // meters
  moving_time: number,        // seconds
  elapsed_time: number,
  total_elevation_gain: number,
  average_speed: number,
  max_speed: number,
  has_efforts: boolean,       // true if we've fetched full detail
  segment_efforts: [{         // from detailed fetch
    id: number,
    name: string,
    segment: {
      id: number,
      name: string,
      distance: number,
      average_grade: number,
      elevation_high: number,
      elevation_low: number,
      climb_category: number
    },
    elapsed_time: number,
    moving_time: number,
    start_date: string,
    start_date_local: string,
    pr_rank: number | null,    // Strava's own PR rank (1, 2, 3, or null)
    achievements: [{           // Strava's built-in achievements
      type_id: number,
      type: string,
      rank: number
    }]
  }]
}
Indexes:
  - start_date_local (for temporal queries)
  - sport_type (for filtering)
```

**Store: `segments`** (denormalized for fast lookup)
```
Key: segment.id (number)
Value: {
  id: number,
  name: string,
  distance: number,
  average_grade: number,
  elevation_high: number,
  elevation_low: number,
  climb_category: number,
  efforts: [{                  // all user's efforts on this segment
    effort_id: number,
    activity_id: number,
    elapsed_time: number,
    moving_time: number,
    start_date: string,
    start_date_local: string,
    pr_rank: number | null
  }]
}
Indexes:
  - name (for search)
```

**Store: `sync_state`**
```
Key: "state"
Value: {
  last_activity_fetch: string | null,   // ISO date of most recent fetched activity
  backfill_complete: boolean,
  backfill_page: number,                // resume point if interrupted
  total_activities: number | null,
  fetched_activities: number,
  detailed_activities: number,          // how many have segment efforts loaded
  last_sync: string                     // ISO date of last successful sync
}
```

#### 4.2.3 Data Sync Engine

**Phase 1: Activity List Backfill**

Fetch all activities using pagination:
```
GET https://www.strava.com/api/v3/athlete/activities
  ?per_page=200
  &page=N
  &after=0  (epoch, to get everything)
```

- 200 per page, so 10 pages for 2000 activities = 10 API calls
- Store summary data in `activities` store with `has_efforts: false`
- Track progress in `sync_state`
- This is cheap — just list endpoints

**Phase 2: Detail Backfill (the expensive part)**

For each activity where `has_efforts === false`:
```
GET https://www.strava.com/api/v3/activities/{id}?include_all_efforts=true
```

- Returns full segment efforts for the activity
- **1 API call per activity** — this is the bottleneck
- Rate limit: 100 read requests per 15 minutes, 1000 per day

**Backfill throttling strategy:**
- Fetch in batches of 80 (leaving headroom below 100/15min limit)
- After each batch, wait until the next 15-minute boundary
- Show progress: "Loading activity details: 247/1,832 — next batch in 8 minutes"
- Persist after each batch (survives tab close)
- On reopen, resume from where we left off (check `has_efforts` flag)
- Estimated time for 2000 activities: ~6-7 hours spread across a day or two
- **Priority: fetch newest first** (most relevant for awards)

**Phase 3: Incremental Sync**

After backfill, on each visit or manual "sync" button:
```
GET /athlete/activities?after={last_activity_timestamp}&per_page=200
```
Then fetch detail for each new activity. Typically 1-3 API calls total.

**Denormalization:**

After fetching activity details, also update the `segments` store:
- For each segment_effort in the activity, append to the segment's efforts array
- This enables fast "all my times on segment X" lookups without scanning all activities

#### 4.2.4 Rate Limit Handling

Read the `X-Ratelimit-Usage` and `X-Ratelimit-Limit` headers from every response.
- Display current usage in UI (small indicator)
- If approaching limit (>80% of 15-min or daily), pause and show countdown
- On 429 response: parse retry timing, show to user, auto-retry

### 4.3 Awards Engine (MVP: Temporal Windows)

**Runs entirely client-side against IndexedDB data. No API calls needed.**

#### MVP Award Types

For each segment the user has ridden in the current year:

**1. Year Best (YB)**
- Compare this effort's elapsed_time to all efforts on the same segment in the current calendar year
- If it's the fastest: "Year Best on [Segment Name]! [time] (previous best: [time] on [date])"

**2. Season First**
- First effort on this segment in the current calendar year
- "First ride on [Segment Name] this year! Last rode it [date]"

**3. Recent Best**
- Best time in last N efforts on this segment (N = 5 for MVP)
- "Best of your last 5 on [Segment Name]!"

#### Award Computation Flow

Triggered after incremental sync completes (new activity loaded). Use Preact Signals for reactive state — awards signal updates automatically trigger UI re-render:

```
for each segment_effort in new_activity:
  segment = segments_store.get(effort.segment.id)
  this_year_efforts = segment.efforts.filter(e => year(e.start_date) === currentYear)

  // Year Best
  if effort.elapsed_time === min(this_year_efforts.map(e => e.elapsed_time)):
    if this_year_efforts.length > 1:
      emit YearBest award

  // Season First
  if this_year_efforts.length === 1:
    previous = segment.efforts.filter(e => year(e.start_date) < currentYear)
    emit SeasonFirst award (with last effort date if available)

  // Recent Best
  last_5 = segment.efforts.sort(by date desc).slice(0, 5)
  if effort.elapsed_time === min(last_5.map(e => e.elapsed_time)):
    if last_5.length >= 3:  // need enough history for this to be meaningful
      emit RecentBest award
```

#### Award Display

After computing awards for a synced activity, show a summary screen:
- Activity name + date at top
- List of awards earned, grouped by type
- Each award shows: segment name, your time, comparison time, delta
- Celebratory but not obnoxious — think "quiet pride" not "gamification dopamine"

### 4.4 UI Screens

**Screen 1: Landing / Connect**
- App name + tagline
- "Connect with Strava" button (use Strava brand guidelines for button)
- Brief explanation of what the app does

**Screen 2: Sync Progress**
- Shown during initial backfill
- Progress bar + stats (activities loaded, segments found)
- "You can close this tab and come back — we'll pick up where we left off"
- Rate limit indicator

**Screen 3: Dashboard (main screen after sync)**
- Recent activity at top with any awards earned
- "Sync Now" button for manual refresh
- List of recent activities with award badges
- Stats: total segments tracked, awards earned this year

**Screen 4: Activity Detail**
- All segment efforts for an activity
- Awards highlighted
- Historical context for each segment (your history on it)

**Screen 5: Segment History** (stretch, not MVP-critical)
- All your efforts on a single segment
- Timeline visualization
- Awards earned on this segment

## 5. Strava App Registration

Oskar needs to register at https://www.strava.com/settings/api:
- **Application Name:** Participation Awards
- **Category:** Training
- **Club:** (optional)
- **Website:** https://aeyu.io/
- **Authorization Callback Domain:** aeyu.io
- **Description:** Surfaces meaningful achievements from your Strava history that Strava's built-in system misses.

This yields a `client_id` (public, embedded in client app) and `client_secret` (private, stored in Worker).

Note: New apps start in "Single Player Mode" (1 connected athlete). For the biking group, Oskar will need to request an athlete capacity increase by emailing developers@strava.com with app ID and screenshots showing Strava branding compliance.

## 6. Deployment

### CF Worker
```bash
wrangler init participation-awards-worker
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET
wrangler deploy
```

### GitHub Pages (aeyu.io)
```
# Add files to existing repo: oaustegard/aeyu.io
# Directory structure:
#   /index.html       (import map + app shell)
#   /callback.html    (OAuth redirect handler)
#   /app.js           (main app component)
#   /auth.js          (OAuth flow)
#   /sync.js          (Strava API client + backfill)
#   /db.js            (IndexedDB wrapper)
#   /awards.js        (awards engine)
#   /components/      (UI components)

# index.html becomes the app shell (placeholder already deployed)
```

Deploy is just a git push to `main` — GitHub Pages auto-publishes.

## 7. Future Iterations (post-MVP)

Listed in rough priority order:

1. **More temporal windows:** best this month, best since [date], best in last N rides
2. **Trend awards:** consecutive improvements, closing in on PR (within X%)
3. **Comparative awards:** beat your median, top quartile of own history
4. **Milestone awards:** Nth time on segment, first of season
5. **Ride-level awards:** longest ride this month, most climbing, most segments hit
6. **Webhook support:** Worker receives Strava webhook, stores event; client polls Worker for pending events instead of hitting Strava API directly
7. **Export/share:** Generate shareable card image for an award
8. **PWA:** Installable, offline awards viewing

## 8. Open Questions

1. **Naming:** "Participation Awards" is funny but self-deprecating. Is that the vibe? Alternatives: "Effort Awards", "Personal Bests+", "Season's Best"
2. **Strava branding:** Their API agreement requires "Powered by Strava" attribution and specific button styles. Need to review https://developers.strava.com/guidelines/
3. **Data retention:** When a user disconnects, should we offer to wipe IndexedDB? Probably yes.
4. **Multiple sport types:** MVP is cycling-focused but the architecture works for running. Filter by sport_type or include all?
