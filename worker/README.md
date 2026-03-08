# Participation Awards — OAuth Proxy Worker

Cloudflare Worker that proxies Strava OAuth token operations.
Holds the app's `client_secret` so it never touches the browser.

## Setup

```bash
cd worker
npm install -g wrangler    # if not already installed
wrangler login             # authenticate with your CF account

# Set secrets (from Strava API app registration)
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET

# Deploy
wrangler deploy
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/token` | Exchange auth code for tokens. Body: `{ code }` |
| POST | `/auth/refresh` | Refresh expired token. Body: `{ refresh_token }` |

Both return Strava's token response (access_token, refresh_token, expires_at, athlete).

## After Deploy

Note the Worker URL (e.g., `https://participation-awards-worker.<your-subdomain>.workers.dev`).
The client app needs this URL configured in `awards/auth.js`.
