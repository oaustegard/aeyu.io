# Architecture

Client-side PWA with zero server-side user data storage. The only backend component is a Cloudflare Worker that proxies OAuth token exchange because Strava requires a server-side client_secret.

## Tech Stack

Preact + HTM + Signals with no build step. ESM dependencies are vendored in `vendor/`. Tailwind CSS is pre-built via `@tailwindcss/cli`. Hosted on GitHub Pages at aeyu.io.

Key choices: HTM tagged template literals (`html\`...\``) instead of JSX, Preact Signals for reactive state, IndexedDB for all persistent storage. No localStorage, no cookies, no server database.

## Data Flow

All data originates from the Strava API and lives exclusively in the user's browser.

1. [[architecture#OAuth]] establishes a session via the [[architecture#Worker Proxy]]
2. [[data#Sync Pipeline]] fetches activities and segment efforts from Strava
3. Data is stored in [[data#IndexedDB Schema]] across four object stores
4. [[awards#Award Computation]] loads segment history and computes awards client-side
5. [[fitness]] computes form indicators from the same local data
6. UI components render awards with share card generation via Canvas

## OAuth

Standard OAuth 2.0 authorization code flow with PKCE-less exchange via proxy. [[src/auth.js#startOAuth]] redirects to Strava, `callback.html` receives the code, [[src/auth.js#handleOAuthCallback]] exchanges it for tokens through the worker.

Token refresh is transparent — [[src/auth.js#getValidToken]] checks expiry (with 5-minute buffer) and refreshes automatically before any API call. Tokens persist in the `auth` IndexedDB store across sessions.

## Worker Proxy

Minimal Cloudflare Worker at [[worker/worker.js]] exposing two POST endpoints: `/auth/token` (code exchange) and `/auth/refresh` (token refresh). Holds `STRAVA_CLIENT_SECRET` as a Wrangler secret. CORS-restricted to `aeyu.io` and localhost origins.

The worker is intentionally thin — it adds the client_secret to Strava token requests and passes through the response. No user data touches the server.

## Routing

Path-based routing via History API. [[src/app.js#navigate]] pushes state and updates the `route` signal. A legacy hash-based URL migration runs on startup.

Routes: `/` (landing or dashboard based on auth), `/demo` (demo mode), `/activity?id=N` (activity detail), `/dashboard` (main view). Unauthenticated users see [[src/components/Landing.js]] regardless of path.

## Signals

Reactive state management via `@preact/signals`. Key signals defined across modules: `authState` ([[src/auth.js]]), `route`/`routeParams` ([[src/app.js]]), `syncProgress`/`rateLimitStatus`/`isSyncing` ([[src/sync.js]]), `unitSystem` ([[src/units.js]]), `isDemo` ([[src/demo.js]]).

Components subscribe by reading `.value` in render — Preact Signals handles granular re-rendering without explicit subscriptions or reducers.
