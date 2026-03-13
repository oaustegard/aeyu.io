/**
 * Participation Awards — Unit Formatting
 * Supports metric (default) and imperial (US) display.
 * Preference persisted in IndexedDB sync_state store under "preferences" key.
 */

import { signal } from "@preact/signals";
import { openDB } from "./db.js";

export const unitSystem = signal("metric"); // "metric" | "imperial"

/** Load saved unit preference from IndexedDB */
export async function loadUnitPreference() {
  try {
    const db = await openDB();
    const tx = db.transaction("sync_state", "readonly");
    const req = tx.objectStore("sync_state").get("preferences");
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const prefs = req.result;
        if (prefs && prefs.units) {
          unitSystem.value = prefs.units;
        }
        resolve(unitSystem.value);
      };
      req.onerror = () => resolve(unitSystem.value);
    });
  } catch {
    return unitSystem.value;
  }
}

/** Save unit preference to IndexedDB */
export async function setUnitPreference(system) {
  unitSystem.value = system;
  try {
    const db = await openDB();
    // Read existing preferences
    const readTx = db.transaction("sync_state", "readonly");
    const readReq = readTx.objectStore("sync_state").get("preferences");
    const existing = await new Promise((resolve) => {
      readReq.onsuccess = () => resolve(readReq.result || {});
      readReq.onerror = () => resolve({});
    });
    // Write updated preferences
    const writeTx = db.transaction("sync_state", "readwrite");
    writeTx.objectStore("sync_state").put({ ...existing, units: system }, "preferences");
    await new Promise((resolve, reject) => {
      writeTx.oncomplete = () => resolve();
      writeTx.onerror = () => reject(writeTx.error);
    });
  } catch (err) {
    console.warn("Failed to persist unit preference:", err);
  }
}

/** Format distance (input: meters) */
export function formatDistance(meters) {
  if (unitSystem.value === "imperial") {
    const miles = meters / 1609.344;
    if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
    return `${Math.round(meters * 3.28084)} ft`;
  }
  const km = meters / 1000;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(meters)} m`;
}

/** Format elevation (input: meters) */
export function formatElevation(meters) {
  if (unitSystem.value === "imperial") {
    return `${Math.round(meters * 3.28084)} ft`;
  }
  return `${Math.round(meters)}m`;
}

/** Format speed (input: meters/second) */
export function formatSpeed(metersPerSecond) {
  if (unitSystem.value === "imperial") {
    const mph = metersPerSecond * 2.23694;
    return `${mph.toFixed(1)} mph`;
  }
  const kmh = metersPerSecond * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

/** Format time (input: seconds) — same regardless of unit system */
export function formatTime(seconds) {
  const total = Math.round(seconds);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/** Format date (short) */
export function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format date with weekday */
export function formatDateWeekday(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Format date for detail header */
export function formatDateFull(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format power (watts) — returns null if no power data */
export function formatPower(watts) {
  if (watts == null || watts === 0) return null;
  return `${Math.round(watts)}W`;
}
