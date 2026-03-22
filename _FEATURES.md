# _FEATURES.md — aeyu.io
Generated: 2026-03-22T03:30:11+0000
App URL: https://aeyu.io

## Feature Inventory

### `/`
![Screenshot of /](screenshots/index.png)

## 1. What the user sees

The page is a centered, minimal landing page on a light beige/off-white background. At the top is the site logo/wordmark **"aeyu.io"** (dark text with the ".io" in burnt orange), with a tagline below it: *"The sound you make at the top of the climb"*.

Below that is a single white card (rounded corners, subtle shadow) containing:
- A heading: **"Participation Awards"**
- A subheading in muted text: *"It's just you and your efforts"*
- A short paragraph explaining the value proposition: connecting Strava to discover year bests, season firsts, and personal milestones Strava doesn't celebrate.
- A prominent orange CTA button: **"CONNECT WITH STRAVA"**
- A secondary text link below it: **"or try the demo →"**

Below the card, a privacy note states: *"100% client-side — your data never touches our servers."* followed by a brief explanation of the data flow architecture. A partially visible FAQ section appears at the very bottom.

Visual hierarchy: logo → tagline → value prop card (CTA dominant) → privacy assurance → FAQ.

---

## 2. Interactions

- **"Connect with Strava" button** → Initiates the Strava OAuth flow; calls `startOAuth()` which redirects the user to Strava's authorization screen
- **"or try the demo →" button** → Activates demo mode; calls `startDemo()` which loads demo data from `demo-data.json` into a local IndexedDB and navigates the user to the dashboard without requiring Strava authentication

---

## 3. Invariants

- Page renders without authentication (unauthenticated users must always see this landing page at `/`)
- If a user is already authenticated (valid token exists in IndexedDB), they must be redirected away from this page (e.g., to `/dashboard`) without manual action
- "Connect with Strava" button must always be present and actionable (never disabled)
- "or try the demo →" must always be present as a secondary option
- No user data is transmitted to any server from this page (all processing is client-side)
- The Strava OAuth redirect URI used by `startOAuth()` must match the configured `OAUTH_REDIRECT_URI` in `config.js`
- Demo mode must not require a Strava token or network access to Strava APIs

---

## 4. Code

| Feature | Source |
|---|---|
| Landing page component (renders the card, buttons, copy) | `src/components/Landing.js` :67 |
| OAuth initiation (`startOAuth`) triggered by "Connect with Strava" | `src/auth.js` :28 |
| Auth state check (redirect if already logged in) | `src/auth.js` :17, `src/auth.js` :20 |
| Demo mode initiation (`startDemo`) triggered by demo button | `src/demo.js` :50 |
| Demo flag signal (`isDemo`) | `src/demo.js` :10 |
| OAuth config (client ID, redirect URI, scope) | `src/config.js` :6–11 |
| Client-side DB (no server storage) | `src/db.js` :14–35 |
| App routing / navigation | `src/app.js` :26–48 |
| HTML entry point importing `app.js` | `index.html` |

---

### `/demo.html`
![Screenshot of /demo.html](screenshots/demo-html.png)

# Page Documentation: `/demo.html`

---

## 1. What the User Sees

The page is a demo dashboard for **aeyu.io (Participation Awards)**, a Strava-connected cycling analytics app. It displays sample data for a fictional rider labeled "Demo Rider."

**Layout (top to bottom):**

- **Header/Nav bar** (dark brown): aeyu.io logo + "Participation Awards" subtitle, "Demo Rider | Demo" label, and three icon buttons (search, help, user avatar "D") on the right.
- **Demo Mode banner** (yellow/amber): Informs the user they are viewing fictional sample data and prompts them to connect Strava for real data.
- **Ride Streak / Group Ride section**: Horizontal row showing:
  - "6-week ride streak"
  - "Coffee Spin — 5w streak (4)"
  - "Saturday Hills (4)"
  - "Interval Session (3)"
  - Three expandable trend rows beneath (Coffee Spin trend, Saturday Hills trend, Interval Session trend) with chevron controls.
- **Stats cards** (two side-by-side): "10 Segments tracked" and "66 Awards (recent 20)".
- **Form Indicators section**: Two metric cards:
  - "Climb Form": Score of **85**, riding climbs at 85% of best, based on 30 efforts across 5 climbs, with a line chart preview.
  - "Aerobic Efficiency": Score of **1.48** EF (W/bpm), 12 rides with HR+power in last 6 weeks, with a bar chart preview.
- **Activity list** (below the fold, visible in accessibility tree): Chronological list of individual rides (e.g., "Indoor Intervals," "Lakeside Ride," "Coffee Spin," "Saturday Hills") each showing date, distance, duration, speed, elevation, power, and earned award badges.

---

## 2. Interactions

- **Button "Search activities"** → Opens an activity search interface
- **Button "FAQ & Help"** → Opens FAQ / help documentation
- **Button "D" (user avatar)** → Opens user account/profile menu
- **Button "Help" (×4, within Form Indicators section)** → Opens contextual help/tooltip for the respective metric (Climb Form, Aerobic Efficiency, and sub-metrics)
- **"Coffee Spin trend ▾"** → Expands/collapses Coffee Spin group ride trend details
- **"Saturday Hills trend ▾"** → Expands/collapses Saturday Hills group ride trend details
- **"Interval Session trend ▾"** → Expands/collapses Interval Session group ride trend details
- **Activity buttons** (e.g., "Indoor Intervals Thu, Mar 19…", "Lakeside Ride Wed, Mar 18…", etc.) → Expands or navigates to detail view for that individual ride activity, showing awards earned
- **"6-week ride streak"** → Likely navigates to or expands streak detail
- **"Coffee Spin — 5w streak (4)"**, **"Saturday Hills (4)"**, **"Interval Session (3)"** → Navigate to or expand group ride streak details

---

## 3. Invariants

- Page renders without authentication (demo mode; no Strava connection required)
- Demo Mode banner is always visible when viewing `/demo.html`
- All data displayed is fictional/static (sourced from `demo-data.json`); no live API calls to Strava are made
- The "D" user avatar button is always present in the header regardless of auth state
- The duplicate banner/nav elements in the accessibility tree (n1 and n11) indicate the header is rendered twice (e.g., sticky + static); both must contain identical controls
- Award count displayed in the stats card ("66 Awards (recent 20)") reflects a capped recent view of 20, though the total count (66) is also shown
- Segment count ("10 Segments tracked") must match the number of tracked segments in demo data
- Activity buttons in the list must display at minimum: activity name, date, distance, duration, speed, elevation, power, and any awards earned
- Form Indicators section must always show both "Climb Form" and "Aerobic Efficiency" cards
- Trend rows (Coffee Spin, Saturday Hills, Interval Session) must be collapsed by default

---

## 4. Code

| Feature | Source |
|---|---|
| Page shell, load error handling, cache reload | `demo.html` :42, :61 |
| App bootstrap / rendering logic | `src/app.js` (imported by `demo.html`) |
| Demo data (fictional rider) | `demo-data.json` (root) |
| Award type definitions | `README.md` :149 |
| Activity/award computation | `worker/` (see `worker/_MAP.md`) |
| Service worker (caching) | `sw.js` |
| Shared load error / cache clear functions | `dashboard.html` :42, :61 (same pattern as `demo.html`) |

---

### `/dashboard.html`
![Screenshot of /dashboard.html](screenshots/dashboard-html.png)

## 1. What the User Sees

The page is a centered, single-column landing/entry screen rendered at `/dashboard.html`. The background is a warm off-white (cream). At the top is the site logo **"aeyu.io"** (dark text with the ".io" in orange/terracotta), with a tagline beneath it: *"The sound you make at the top of the climb"*.

Below that is a white rounded card containing:
- **Title:** "Participation Awards" (large, centered)
- **Subtitle:** *"It's just you and your efforts"* (small, muted)
- **Body copy:** A short paragraph explaining the product — connecting Strava to surface year bests, season firsts, and personal milestones Strava doesn't natively celebrate.
- **Primary CTA:** A large orange button labeled **"CONNECT WITH STRAVA"** (uses the official Strava wordmark/logo).
- **Secondary CTA:** A plain text link/button **"or try the demo →"** beneath the primary button.

Below the card, in small muted text, is a privacy notice:
> "100% client-side — your data never touches our servers."
followed by a brief explanation that all data flows directly from Strava to the browser with no server, database, or analytics.

The page appears to be the unauthenticated entry point — the same content as `index.html` — rendered at the `/dashboard.html` route, likely because the user is not yet authenticated.

---

## 2. Interactions

- **Button "Connect with Strava"** → Initiates the Strava OAuth authorization flow; redirects the user to Strava's authorization screen to grant data access.
- **Button "or try the demo →"** → Navigates to the demo experience (likely `demo.html`) using pre-loaded sample data without requiring Strava authentication.

---

## 3. Invariants

- Page **renders without authentication** (no login required to view this screen).
- The **"Connect with Strava" button must always be present** when the user is unauthenticated.
- The **"or try the demo →" option must always be present** as a fallback that requires no Strava credentials.
- **No user data is transmitted to any server** — all Strava data must remain in the browser (client-side only); this is a stated and testable architectural invariant.
- The page must render at `/dashboard.html` (in addition to `/index.html`), sharing the same entry-point UI logic.
- The privacy notice ("100% client-side...") must be visible on the page without scrolling past the primary CTA card.

---

## 4. Code

- `dashboard.html` — Page shell; imports `app.js`; defines `showLoadError` and `clearCacheAndReload` helpers at lines `:42` and `:61`.
- `index.html` — Mirrors `dashboard.html` structure; same imports and helper functions at `:42`, `:61` — confirms shared unauthenticated landing UI.
- `demo.html` — Target of the "try the demo →" button; also imports `app.js` with the same helper pattern.
- `callback.html` — Handles the OAuth redirect from Strava after "Connect with Strava" is clicked; imports `auth.js`.
- `src/` — Core application logic (app.js, auth.js) lives here per the map structure.

---

### `/activity.html`
![Screenshot of /activity.html](screenshots/activity-html.png)

## 1. What the user sees

The page is the **landing/home page** of **aeyu.io**, a Strava-connected fitness milestone tracker called "Participation Awards." Despite being served at `/activity.html`, it renders the same entry-point UI as the root.

**Visual layout (top to bottom):**
- **Header:** Large logotype "aeyu.**io**" (`.io` in orange/rust) centered at the top, with the tagline *"The sound you make at the top of the climb"* in muted italic text below.
- **Main card:** A centered white rounded card on a warm off-white/beige background containing:
  - Title: **"Participation Awards"** (large, dark)
  - Subtitle: *"It's just you and your efforts"* (small, muted)
  - Body copy explaining the value proposition: connecting Strava to discover year bests, season firsts, and personal milestones Strava doesn't celebrate.
  - A prominent **orange "CONNECT WITH STRAVA"** CTA button.
  - A secondary text link: **"or try the demo →"**
- **Privacy notice:** Below the card, centered small text: *"100% client-side — your data never touches our servers."* followed by a longer explanation that all data flows directly from Strava to the browser with no server, database, or analytics.
- **FAQ section** begins below (partially visible, cut off).

---

## 2. Interactions

- **Button "Connect with Strava"** → Initiates Strava OAuth authorization flow; redirects the user to Strava's authorization screen to grant data access.
- **Button "or try the demo →"** → Loads the app in demo mode using pre-loaded sample data (no Strava account required); likely navigates to `demo.html` or loads `demo-data.json`.

---

## 3. Invariants

- Page renders without authentication (unauthenticated landing page).
- "Connect with Strava" button must always be present and actionable on page load.
- "or try the demo →" button must always be present and actionable on page load.
- No user data is transmitted to a server at any point during this page's lifecycle (client-side only architecture).
- The privacy disclaimer ("100% client-side…") must always be visible on the page.
- Page must not require a service worker, database, or backend API call to render.
- `showLoadError` function must be defined and available for error handling if `app.js` fails to load.
- `clearCacheAndReload` function must be defined and available to recover from stale cache states.

---

## 4. Code

| Feature | Source |
|---|---|
| Page shell & error handlers (`showLoadError`, `clearCacheAndReload`) | `activity.html` :42, :61 |
| App bootstrap / OAuth + demo routing logic | `src/app.js` (imported by `activity.html`) |
| OAuth callback handling | `callback.html` + `src/auth.js` |
| Demo mode data | `demo-data.json` |
| Demo page entry point | `demo.html` :42 |
| Service worker (offline/cache) | `sw.js` |
| App manifest | `manifest.json` |

---

### `/export.html`
![Screenshot of /export.html](screenshots/export-html.png)

## 1. What the User Sees

The page (`/export.html`) has a dark navy background with a single content block in the upper-left quadrant. It displays a heading "🔑 Export Token" in bold white text with a key emoji, followed by a subdued gray message: "No session found in IndexedDB." There are no buttons, inputs, forms, or navigation elements visible. The rest of the page is empty dark space.

---

## 2. Interactions

- *(None)* — The accessibility tree reports 0 interactive elements. The page is purely informational in its current state.

---

## 3. Invariants

- **Page renders without authentication** — it loads and displays content regardless of login state
- **When no session exists in IndexedDB, the message "No session found in IndexedDB." is displayed** — this is the terminal output of a failed `getToken()` call
- **When a session exists in IndexedDB, a token value must be displayed instead of the error message** — the page's purpose is token export; the current state reflects absence of data, not a broken page
- **The page has no interactive controls** — there are no buttons, links, or forms; output is read-only
- **No external scripts (e.g., `app.js`) are imported** — `export.html` is self-contained per the code map

---

## 4. Code

`export.html` `:2` — Contains `getToken` function which reads a session from IndexedDB and renders either the token value or the "No session found in IndexedDB." message. This is the sole logic file for this page; no framework or shared `app.js` is imported.

---
