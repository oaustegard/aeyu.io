/**
 * Participation Awards — IndexedDB Data Layer
 * Database: participation-awards
 * Stores: auth, activities, segments, sync_state
 */

const DB_NAME = "participation-awards";
const DB_VERSION = 2;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains("auth")) {
        db.createObjectStore("auth");
      }

      if (!db.objectStoreNames.contains("activities")) {
        const activities = db.createObjectStore("activities", { keyPath: "id" });
        activities.createIndex("start_date_local", "start_date_local");
        activities.createIndex("sport_type", "sport_type");
        activities.createIndex("device_watts", "device_watts");
        activities.createIndex("trainer", "trainer");
      }

      if (!db.objectStoreNames.contains("segments")) {
        const segments = db.createObjectStore("segments", { keyPath: "id" });
        segments.createIndex("name", "name");
      }

      if (!db.objectStoreNames.contains("sync_state")) {
        db.createObjectStore("sync_state");
      }

      // Migration from v1 → v2: add power indexes to existing activities store
      if (oldVersion < 2 && db.objectStoreNames.contains("activities")) {
        const activitiesTx = event.target.transaction;
        const activities = activitiesTx.objectStore("activities");
        if (!activities.indexNames.contains("device_watts")) {
          activities.createIndex("device_watts", "device_watts");
        }
        if (!activities.indexNames.contains("trainer")) {
          activities.createIndex("trainer", "trainer");
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// --- Auth ---

export async function getAuth() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readonly");
    const req = tx.objectStore("auth").get("session");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setAuth(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readwrite");
    tx.objectStore("auth").put(session, "session");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAuth() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("auth", "readwrite");
    tx.objectStore("auth").delete("session");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Activities ---

export async function putActivity(activity) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readwrite");
    tx.objectStore("activities").put(activity);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putActivities(activities) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readwrite");
    const store = tx.objectStore("activities");
    for (const activity of activities) {
      store.put(activity);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getActivity(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readonly");
    const req = tx.objectStore("activities").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getActivitiesByYear(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readonly");
    const index = tx.objectStore("activities").index("start_date_local");
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;
    const range = IDBKeyRange.bound(start, end, false, true);
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getActivitiesWithoutEfforts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readonly");
    const req = tx.objectStore("activities").getAll();
    req.onsuccess = () => {
      const results = req.result.filter((a) => !a.has_efforts);
      // Sort by start_date descending (newest first)
      results.sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get activities that were stored before power fields were tracked.
 * These lack the device_watts property entirely (not just false).
 */
export async function getActivitiesWithoutPower() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readonly");
    const req = tx.objectStore("activities").getAll();
    req.onsuccess = () => {
      const results = req.result.filter((a) => !("device_watts" in a));
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllActivities() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("activities", "readonly");
    const req = tx.objectStore("activities").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Segments ---

export async function putSegment(segment) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("segments", "readwrite");
    tx.objectStore("segments").put(segment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSegment(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("segments", "readonly");
    const req = tx.objectStore("segments").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSegments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("segments", "readonly");
    const req = tx.objectStore("segments").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function appendEffort(segmentId, segmentData, effort) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("segments", "readwrite");
    const store = tx.objectStore("segments");
    const req = store.get(segmentId);

    req.onsuccess = () => {
      const existing = req.result;
      if (existing) {
        // Avoid duplicate efforts
        const isDuplicate = existing.efforts.some(
          (e) => e.effort_id === effort.effort_id
        );
        if (!isDuplicate) {
          existing.efforts.push(effort);
          store.put(existing);
        }
      } else {
        store.put({
          id: segmentId,
          name: segmentData.name,
          distance: segmentData.distance,
          average_grade: segmentData.average_grade,
          elevation_high: segmentData.elevation_high,
          elevation_low: segmentData.elevation_low,
          climb_category: segmentData.climb_category,
          efforts: [effort],
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Reset Event (Comeback Mode) ---

/**
 * Get the active reset event, if any.
 * Stored in sync_state under "reset_event" key.
 * Shape: { name: string, date: string (ISO), sport_types: string[]|null, milestones: {} }
 * milestones tracks per-segment recovery thresholds already awarded:
 *   { [segmentId]: [80, 90, ...] }
 */
export async function getResetEvent() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readonly");
    const req = tx.objectStore("sync_state").get("reset_event");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setResetEvent(event) {
  const db = await openDB();
  // Ensure milestones tracker exists
  const stored = { ...event, milestones: event.milestones || {} };
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readwrite");
    tx.objectStore("sync_state").put(stored, "reset_event");
    tx.oncomplete = () => resolve(stored);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearResetEvent() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readwrite");
    tx.objectStore("sync_state").delete("reset_event");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Record that a recovery milestone threshold was awarded for a segment.
 * Prevents re-awarding the same threshold.
 */
export async function recordRecoveryMilestone(segmentId, threshold) {
  const event = await getResetEvent();
  if (!event) return;
  if (!event.milestones) event.milestones = {};
  if (!event.milestones[segmentId]) event.milestones[segmentId] = [];
  if (!event.milestones[segmentId].includes(threshold)) {
    event.milestones[segmentId].push(threshold);
    await setResetEvent(event);
  }
}

// --- User Config (Reference Points) ---

/**
 * Get user configuration (reference points for custom awards).
 * Stored in sync_state under "user_config" key.
 * Shape: { referencePoints: Array<{ id, type, label, date?, count?, birthday?, age? }> }
 */
export async function getUserConfig() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readonly");
    const req = tx.objectStore("sync_state").get("user_config");
    req.onsuccess = () => resolve(req.result || { referencePoints: [] });
    req.onerror = () => reject(req.error);
  });
}

export async function setUserConfig(config) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readwrite");
    tx.objectStore("sync_state").put(config, "user_config");
    tx.oncomplete = () => resolve(config);
    tx.onerror = () => reject(tx.error);
  });
}

// --- Sync State ---

const DEFAULT_SYNC_STATE = {
  last_activity_fetch: null,
  backfill_complete: false,
  backfill_page: 1,
  total_activities: null,
  fetched_activities: 0,
  detailed_activities: 0,
  last_sync: null,
  power_backfill_complete: false,
  schema_version: 0,
};

export async function getSyncState() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readonly");
    const req = tx.objectStore("sync_state").get("state");
    req.onsuccess = () => resolve(req.result || { ...DEFAULT_SYNC_STATE });
    req.onerror = () => reject(req.error);
  });
}

export async function updateSyncState(updates) {
  const db = await openDB();
  const current = await getSyncState();
  const next = { ...current, ...updates };
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_state", "readwrite");
    tx.objectStore("sync_state").put(next, "state");
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = ["auth", "activities", "segments", "sync_state"];
    const tx = db.transaction(storeNames, "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
