/**
 * Install Detection & PWA Install Prompt
 * Detects mobile vs desktop, standalone vs browser, captures beforeinstallprompt.
 * Exports signals consumed by Landing.js / InstallBanner.js.
 */

import { signal } from "@preact/signals";

export const installContext = signal({
  isMobile: false,
  isStandalone: false,
  platform: "unknown", // 'ios' | 'android' | 'other'
  deferredPrompt: null,
  dismissed: false,
});

const DISMISS_KEY = "aeyu-install-dismissed";

function update(patch) {
  installContext.value = { ...installContext.value, ...patch };
}

export function initInstallDetection() {
  // Standalone detection
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  // Mobile detection: touch + narrow viewport
  const hasTouch =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isMobile = hasTouch && window.innerWidth < 768;

  // Platform detection
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);
  const platform = isIOS ? "ios" : isAndroid ? "android" : "other";

  // Dismissal persistence
  const dismissed = localStorage.getItem(DISMISS_KEY) === "1";

  update({ isMobile, isStandalone, platform, dismissed });

  // Capture beforeinstallprompt (Chrome/Edge on Android)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    update({ deferredPrompt: e });
  });
}

export async function triggerInstall() {
  const { deferredPrompt } = installContext.value;
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === "accepted") {
    update({ deferredPrompt: null });
  }
}

export function dismissInstallBanner() {
  localStorage.setItem(DISMISS_KEY, "1");
  update({ dismissed: true });
}
