// Long-press tooltip support for touch devices.
// On desktop, native title= attributes handle tooltips via hover.
// On touch devices, a 500ms long-press on any element with a title attribute
// shows a tooltip overlay. Tapping elsewhere dismisses it.

let overlay = null;
let timer = null;
let startX = 0;
let startY = 0;
let pressTarget = null;
let suppressContextMenu = false;

function findTitled(el) {
  while (el && el !== document.body) {
    if (el.getAttribute && el.getAttribute("title")) return el;
    el = el.parentElement;
  }
  return null;
}

function show(text, x, y) {
  dismiss();
  overlay = document.createElement("div");
  overlay.className = "touch-tooltip";
  overlay.textContent = text;
  // Position near the long-press point
  overlay.style.cssText =
    "position:fixed;z-index:9999;max-width:260px;padding:8px 12px;" +
    "border-radius:8px;font-size:13px;line-height:1.4;pointer-events:none;" +
    "font-family:var(--font-body);color:var(--bg);background:var(--text);" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.15s;";
  document.body.appendChild(overlay);
  // Compute position: center horizontally on press point, above it
  const rect = overlay.getBoundingClientRect();
  let left = x - rect.width / 2;
  let top = y - rect.height - 12;
  // Keep on screen
  if (left < 8) left = 8;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top < 8) top = y + 20; // flip below if no room above
  overlay.style.left = left + "px";
  overlay.style.top = top + "px";
  // Fade in
  requestAnimationFrame(() => { if (overlay) overlay.style.opacity = "1"; });
  // Auto-dismiss after 3s
  setTimeout(dismiss, 3000);
}

function dismiss() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function cancel() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pressTarget) {
    pressTarget.style.removeProperty("-webkit-user-select");
    pressTarget.style.removeProperty("user-select");
    pressTarget = null;
  }
}

export function initTouchTooltips() {
  if (!("ontouchstart" in window)) return;

  document.addEventListener("touchstart", (e) => {
    cancel();
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    const target = findTitled(e.target);
    if (!target) return;
    pressTarget = target;
    target.style.setProperty("-webkit-user-select", "none");
    target.style.setProperty("user-select", "none");
    timer = setTimeout(() => {
      suppressContextMenu = true;
      if (pressTarget) {
        pressTarget.style.removeProperty("-webkit-user-select");
        pressTarget.style.removeProperty("user-select");
        pressTarget = null;
      }
      const text = target.getAttribute("title");
      if (text) show(text, startX, startY);
    }, 500);
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!timer) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dx * dx + dy * dy > 100) cancel(); // moved > 10px
  }, { passive: true });

  document.addEventListener("touchend", () => {
    cancel();
    setTimeout(() => { suppressContextMenu = false; }, 50);
  }, { passive: true });

  document.addEventListener("contextmenu", (e) => {
    if (suppressContextMenu) {
      e.preventDefault();
      suppressContextMenu = false;
    }
  });

  // Dismiss on any tap
  document.addEventListener("click", dismiss, { passive: true });
}
