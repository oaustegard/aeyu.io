/**
 * Demo Mode — loads canned data into a separate IndexedDB for preview without Strava auth.
 * Uses an isolated "participation-awards-demo" database so real user data is never touched.
 */

import { signal } from "@preact/signals";
import { openDB, switchToDemoDB, switchToRealDB, deleteDemoDB } from "./db.js";
import { authState } from "./auth.js";

export const isDemo = signal(false);

const DEMO_DATA_URL = "./demo-data.json";
const DEMO_ATHLETE = {
  id: 99999999,
  firstname: "Demo",
  lastname: "Rider",
  profile: "",
};

/** Check if current session is demo mode (checks for demo flag in sessionStorage) */
export async function checkDemo() {
  if (sessionStorage.getItem("aeyu_demo_active") !== "true") return;
  switchToDemoDB();
  const db = await openDB();
  const session = await new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readonly");
    const req = tx.objectStore("auth").get("session");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (session && session.athlete && session.athlete.id === DEMO_ATHLETE.id) {
    isDemo.value = true;
    authState.value = session;
  } else {
    // Demo DB doesn't have valid session — switch back to real
    switchToRealDB();
    sessionStorage.removeItem("aeyu_demo_active");
  }
}

/** Load demo data into a separate demo database. Real data is never touched. */
export async function startDemo() {
  const resp = await fetch(DEMO_DATA_URL);
  if (!resp.ok) throw new Error("Failed to load demo data");
  const data = await resp.json();

  // Switch to the isolated demo database
  switchToDemoDB();
  const db = await openDB();

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

  // Store demo activities, segments, and sync state
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["activities", "segments", "sync_state"], "readwrite");
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

  sessionStorage.setItem("aeyu_demo_active", "true");
  authState.value = session;
  isDemo.value = true;
}

/** Exit demo — clear auth state, delete demo DB, switch back to real DB */
export async function exitDemo() {
  authState.value = null;
  isDemo.value = false;
  sessionStorage.removeItem("aeyu_demo_active");
  switchToRealDB();
  await deleteDemoDB();
}
