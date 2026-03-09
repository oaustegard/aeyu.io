/**
 * Demo Mode — loads canned data into IndexedDB for preview without Strava auth.
 * Data: ~60 activities, 10 segments, 3 years of riding history.
 */

import { signal } from "@preact/signals";
import { openDB } from "./db.js";

export const isDemo = signal(false);

const DEMO_DATA_URL = "./demo-data.json";
const DEMO_ATHLETE = {
  id: 99999999,
  firstname: "Demo",
  lastname: "Rider",
  profile: "",
};

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

/** Load demo data into IndexedDB and set fake auth */
export async function startDemo() {
  const resp = await fetch(DEMO_DATA_URL);
  if (!resp.ok) throw new Error("Failed to load demo data");
  const data = await resp.json();

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

  // Store activities
  await new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readwrite");
    const store = tx.objectStore("activities");
    for (const act of data.activities) {
      store.put(act);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Store segments
  await new Promise((resolve, reject) => {
    const tx = db.transaction("segments", "readwrite");
    const store = tx.objectStore("segments");
    for (const seg of data.segments) {
      store.put(seg);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Set sync state as complete
  await new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readwrite");
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
        schema_version: 0,
      },
      "state"
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  isDemo.value = true;
}

/** Exit demo — clear all data */
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
}
