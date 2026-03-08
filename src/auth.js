/**
 * Participation Awards — OAuth Auth Flow
 * Handles Strava OAuth authorization, token exchange, and refresh.
 */

import { signal } from "@preact/signals";
import {
  STRAVA_CLIENT_ID,
  STRAVA_AUTH_URL,
  WORKER_URL,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPE,
} from "./config.js";
import { getAuth, setAuth, clearAuth, clearAllData } from "./db.js";

// Auth state signal — null means not logged in, object means logged in
export const authState = signal(null);

/** Initialize auth state from IndexedDB on app startup */
export async function initAuth() {
  const session = await getAuth();
  if (session) {
    authState.value = session;
  }
}

/** Redirect user to Strava's OAuth authorization page */
export function startOAuth() {
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: OAUTH_SCOPE,
    approval_prompt: "auto",
  });
  window.location.href = `${STRAVA_AUTH_URL}?${params}`;
}

/**
 * Handle the OAuth callback — exchange code for tokens.
 * Called from callback.html after Strava redirects back.
 */
export async function handleOAuthCallback(code) {
  const response = await fetch(`${WORKER_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete: {
      id: data.athlete.id,
      firstname: data.athlete.firstname,
      lastname: data.athlete.lastname,
      profile: data.athlete.profile,
    },
  };

  await setAuth(session);
  authState.value = session;
  return session;
}

/**
 * Get a valid access token, refreshing if needed.
 * Refreshes if expired or within 5 minutes of expiry.
 */
export async function getValidToken() {
  const session = authState.value || (await getAuth());
  if (!session) throw new Error("Not authenticated");

  const now = Math.floor(Date.now() / 1000);
  const FIVE_MINUTES = 300;

  if (session.expires_at > now + FIVE_MINUTES) {
    return session.access_token;
  }

  // Token expired or expiring soon — refresh it
  const response = await fetch(`${WORKER_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const updated = {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };

  await setAuth(updated);
  authState.value = updated;
  return updated.access_token;
}

/** Disconnect — clear all stored data and reset auth state */
export async function disconnect() {
  await clearAllData();
  authState.value = null;
}
