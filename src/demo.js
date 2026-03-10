/**
 * Demo Mode — loads canned data into IndexedDB for preview without Strava auth.
 * Data: ~60 activities, 10 segments, 3 years of riding history.
 *
 * When an authenticated user enters demo mode, their real session is backed up
 * to sessionStorage and restored on demo exit — no real data is destroyed.
 */

import { signal } from "@preact/signals";
import { openDB } from "./db.js";
import { authState } from "./auth.js";

export const isDemo = signal(false);

const DEMO_DATA_URL = "./demo-data.json";
const DEMO_ATHLETE = {
  id: 99999999,
  firstname: "Demo",
  lastname: "Rider",
  profile: "",
};
const BACKUP_KEY = "aeyu_real_session_backup";

/** Check if current session is demo mode */
export async function checkDemo() {
  const db = await openDB();
  const session = await new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readonly");
    const req = tx.objectStore("auth").get("session");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (session && session.athlete && session.athlete.id === DEMO_ATHLETE.id) {
    isDemo.value = true;
  }
}

/** Load demo data into IndexedDB and set fake auth.
 *  If a real session exists, it is backed up to sessionStorage first. */
export async function startDemo() {
  const resp = await fetch(DEMO_DATA_URL);
  if (!resp.ok) throw new Error("Failed to load demo data");
  const data = await resp.json();

  const db = await openDB();

  // Back up existing real session (if any) so we can restore on demo exit
  const existingSession = await new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readonly");
    const req = tx.objectStore("auth").get("session");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (existingSession && existingSession.athlete && existingSession.athlete.id !== DEMO_ATHLETE.id) {
    try {
      sessionStorage.setItem(BACKUP_KEY, JSON.stringify(existingSession));
    } catch { /* sessionStorage unavailable — real session will be lost */ }
  }

  // Set fake auth session
  const session = {
    access_token: "demo_token",
    refresh_token: "demo_refresh",
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    athlete: DEMO_ATHLETE,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readwrite");
    tx.objectStore("auth").put(session, "session");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Clear existing data then store demo activities, segments, and sync state
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["activities", "segments", "sync_state"], "readwrite");
    tx.objectStore("activities").clear();
    tx.objectStore("segments").clear();
    tx.objectStore("sync_state").clear();
    for (const act of data.activities) {
      tx.objectStore("activities").put(act);
    }
    for (const seg of data.segments) {
      tx.objectStore("segments").put(seg);
    }
    tx.objectStore("sync_state").put(
      {
        last_activity_fetch: new Date().toISOString(),
        backfill_complete: true,
        backfill_page: 1,
        total_activities: data.activities.length,
        fetched_activities: data.activities.length,
        detailed_activities: data.activities.length,
        last_sync: new Date().toISOString(),
        power_backfill_complete: true,
        schema_version: 2,
      },
      "state"
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  authState.value = session;
  isDemo.value = true;
}

/** Exit demo — clear demo data, restore real session if backed up */
export async function exitDemo() {
  const db = await openDB();
  const storeNames = ["auth", "activities", "segments", "sync_state"];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  isDemo.value = false;

  // Restore backed-up real session if present
  try {
    const backup = sessionStorage.getItem(BACKUP_KEY);
    if (backup) {
      const realSession = JSON.parse(backup);
      await new Promise((resolve, reject) => {
        const tx = db.transaction("auth", "readwrite");
        tx.objectStore("auth").put(realSession, "session");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      sessionStorage.removeItem(BACKUP_KEY);
      return realSession;
    }
  } catch { /* sessionStorage unavailable — user will need to re-auth */ }
  return null;
}
