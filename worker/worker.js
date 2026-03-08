/**
 * Participation Awards — OAuth Proxy Worker
 * 
 * Thin proxy that holds the Strava app's client_secret and handles:
 *   POST /auth/token   — exchange authorization code for tokens
 *   POST /auth/refresh — refresh an expired access token
 *
 * Deploy:
 *   cd worker
 *   wrangler secret put STRAVA_CLIENT_ID
 *   wrangler secret put STRAVA_CLIENT_SECRET
 *   wrangler deploy
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

const ALLOWED_ORIGINS = [
  'https://aeyu.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.find(o => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

async function handleTokenExchange(request, env) {
  const { code } = await request.json();
  if (!code) return jsonResponse({ error: 'Missing code' }, 400, request);

  const resp = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  const data = await resp.json();
  return jsonResponse(data, resp.ok ? 200 : resp.status, request);
}

async function handleTokenRefresh(request, env) {
  const { refresh_token } = await request.json();
  if (!refresh_token) return jsonResponse({ error: 'Missing refresh_token' }, 400, request);

  const resp = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await resp.json();
  return jsonResponse(data, resp.ok ? 200 : resp.status, request);
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, request);
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case '/auth/token':
        return handleTokenExchange(request, env);
      case '/auth/refresh':
        return handleTokenRefresh(request, env);
      default:
        return jsonResponse({ error: 'Not found' }, 404, request);
    }
  },
};
