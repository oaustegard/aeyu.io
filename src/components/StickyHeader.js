import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { authState } from "../auth.js";
import { isDemo } from "../demo.js";

// Whether the header has been scrolled past — drives compact mode
export const headerCompact = signal(false);
const avatarMenuOpen = signal(false);
export function StickyHeader({
  onHelp,
  onBack,
  backLabel = "Dashboard",
  contextLabel,
  rightSlot,
  menuItems = [],
  syncing = false,
  unitSystem: units,
  onUnitToggle,
  onSearch,
  searchActive = false,
}) {
  const auth = authState.value;
  const athlete = auth?.athlete;
  const avatarUrl = athlete?.profile;
  const sentinelRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        headerCompact.value = !entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!avatarMenuOpen.value) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        avatarMenuOpen.value = false;
      }
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [avatarMenuOpen.value]);

  const isCompact = headerCompact.value;

  const visibleMenuItems = menuItems.filter((item) => !item.hidden);

  return html`
    <!-- Scroll sentinel: leaving viewport triggers compact mode -->
    <div ref=${sentinelRef} style="height: 0; overflow: hidden;" />
    <header
      class="sticky-header-full ${isCompact ? 'sticky-header-full--hidden' : ''}"
      style="background: var(--accent);"
    >
      <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          ${onBack ? html`
            <button
              onClick=${onBack}
              class="flex items-center gap-1 text-sm flex-shrink-0"
              style="color: rgba(255,255,255,0.8);"
              title="Back to ${backLabel}"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
          ` : html`
            <img src="icons/icon-192.png" alt="aeyu.io" style="height: 44px; width: 44px; border-radius: 8px;" />
          `}
          <div>
            <h1 style="font-family: var(--font-display); font-size: 1.75rem; color: var(--text-on-dark); line-height: 1.1; white-space: nowrap;">
              aeyu<span style="color: var(--accent);">.io</span>
            </h1>
            <p style="font-family: var(--font-body); font-size: 0.7rem; color: rgba(255,255,255,0.6); letter-spacing: 0.04em; margin-top: 1px;">
              Participation Awards
            </p>
            ${athlete && html`
              <p style="font-family: var(--font-body); font-size: 0.75rem; color: rgba(255,255,255,0.75); margin-top: 1px;">
                ${athlete.firstname} ${athlete.lastname}
                ${isDemo.value && html`<span class="ml-2 text-xs px-2 py-0.5 rounded-full font-medium" style="background: rgba(255,255,255,0.2); color: white;">Demo</span>`}
              </p>
            `}
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${syncing && html`
            <div class="inline-flex items-center gap-1.5 text-xs px-2 py-1" style="color: rgba(255,255,255,0.8);">
              <div class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style="border-color: white; border-top-color: transparent;"></div>
              <span>Syncing</span>
            </div>
          `}

          ${onSearch && html`
            <button
              onClick=${onSearch}
              class="transition-colors flex-shrink-0"
              style="color: ${searchActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.7)'};"
              title="Search activities"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
              </svg>
            </button>
          `}

          ${onHelp && html`
            <button
              onClick=${onHelp}
              class="transition-colors flex-shrink-0"
              style="color: rgba(255,255,255,0.7);"
              title="FAQ & Help"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
          `}

          ${avatarUrl ? html`
            <button
              onClick=${(e) => { e.stopPropagation(); avatarMenuOpen.value = !avatarMenuOpen.value; }}
              class="rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
              style="width: 32px; height: 32px; border: 2px solid rgba(255,255,255,0.4);"
              title="${athlete.firstname}'s menu"
            >
              <img src=${avatarUrl} alt="" class="rounded-full" style="width: 100%; height: 100%; object-fit: cover;" />
            </button>
          ` : html`
            <button
              onClick=${(e) => { e.stopPropagation(); avatarMenuOpen.value = !avatarMenuOpen.value; }}
              class="rounded-full flex items-center justify-center flex-shrink-0"
              style="width: 32px; height: 32px; background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.4); color: rgba(255,255,255,0.9); font-size: 0.75rem; font-family: var(--font-body); font-weight: 600;"
              title="Menu"
            >
              ${athlete ? athlete.firstname[0] : "?"}
            </button>
          `}
        </div>
      </div>
    </header>

    <header
      class="sticky-header-compact ${isCompact ? 'sticky-header-compact--visible' : ''}"
      style="background: var(--accent); position: fixed; top: 0; left: 0; right: 0; z-index: 50;"
    >
      <div class="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          ${onBack ? html`
            <button
              onClick=${onBack}
              class="flex items-center gap-1 text-xs"
              style="color: rgba(255,255,255,0.8);"
              title="Back to ${backLabel}"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
          ` : html`
            <img src="icons/icon-192.png" alt="aeyu.io" style="height: 24px; width: 24px; border-radius: 4px;" />
          `}
          <span style="font-family: var(--font-display); font-size: 1rem; color: var(--text-on-dark); white-space: nowrap;">
            ${onBack && contextLabel ? contextLabel : "aeyu.io"}
          </span>
          ${syncing && !onBack && html`
            <div class="inline-flex items-center gap-1 text-xs" style="color: rgba(255,255,255,0.7);">
              <div class="w-2.5 h-2.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style="border-color: rgba(255,255,255,0.7); border-top-color: transparent;"></div>
            </div>
          `}
        </div>
        <div class="flex items-center gap-3">
          ${rightSlot}

          ${onSearch && html`
            <button
              onClick=${onSearch}
              class="transition-colors flex-shrink-0"
              style="color: ${searchActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.7)'};"
              title="Search activities"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
              </svg>
            </button>
          `}

          ${onHelp && html`
            <button
              onClick=${onHelp}
              class="transition-colors flex-shrink-0"
              style="color: rgba(255,255,255,0.7);"
              title="FAQ & Help"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
          `}

          ${avatarUrl ? html`
            <button
              onClick=${(e) => { e.stopPropagation(); avatarMenuOpen.value = !avatarMenuOpen.value; }}
              class="rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
              style="width: 26px; height: 26px; border: 1.5px solid rgba(255,255,255,0.4);"
            >
              <img src=${avatarUrl} alt="" class="rounded-full" style="width: 100%; height: 100%; object-fit: cover;" />
            </button>
          ` : html`
            <button
              onClick=${(e) => { e.stopPropagation(); avatarMenuOpen.value = !avatarMenuOpen.value; }}
              class="rounded-full flex items-center justify-center flex-shrink-0"
              style="width: 26px; height: 26px; background: rgba(255,255,255,0.2); border: 1.5px solid rgba(255,255,255,0.4); color: rgba(255,255,255,0.9); font-size: 0.65rem; font-family: var(--font-body); font-weight: 600;"
            >
              ${athlete ? athlete.firstname[0] : "?"}
            </button>
          `}
        </div>
      </div>
    </header>

    ${avatarMenuOpen.value && html`
      <div
        ref=${menuRef}
        class="avatar-dropdown"
        style="
          position: fixed;
          top: ${isCompact ? '44px' : '70px'};
          right: max(calc((100vw - 48rem) / 2 + 1rem), 1rem);
          z-index: 60;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 0.75rem;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          min-width: 200px;
          overflow: hidden;
        "
      >
        ${athlete && html`
          <div class="px-4 py-3" style="border-bottom: 1px solid var(--border-light);">
            <div class="flex items-center gap-2.5">
              ${avatarUrl && html`
                <img src=${avatarUrl} alt="" class="rounded-full flex-shrink-0" style="width: 36px; height: 36px; object-fit: cover;" />
              `}
              <div>
                <p class="text-sm font-medium" style="color: var(--text);">${athlete.firstname} ${athlete.lastname}</p>
                ${isDemo.value && html`<span class="text-xs px-1.5 py-0.5 rounded-full" style="background: #FEF3C7; color: #92400E;">Demo</span>`}
              </div>
            </div>
          </div>
        `}

        ${onUnitToggle && html`
          <button
            onClick=${() => { onUnitToggle(); }}
            class="w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between"
            style="color: var(--text); border-bottom: 1px solid var(--border-light);"
            onMouseOver=${(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseOut=${(e) => e.currentTarget.style.background = 'transparent'}
          >
            <span>Units</span>
            <span class="text-xs px-2 py-0.5 rounded" style="background: var(--bg); font-family: var(--font-mono); color: var(--text-secondary);">
              ${units === "metric" ? "km" : "mi"}
            </span>
          </button>
        `}

        ${visibleMenuItems.map((item, i) => html`
          <button
            key=${i}
            onClick=${() => { avatarMenuOpen.value = false; item.onClick(); }}
            class="w-full text-left px-4 py-2.5 text-sm transition-colors"
            style="color: ${item.danger ? '#A03020' : 'var(--text)'}; ${i < visibleMenuItems.length - 1 ? 'border-bottom: 1px solid var(--border-light);' : ''}"
            onMouseOver=${(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseOut=${(e) => e.currentTarget.style.background = 'transparent'}
          >
            ${item.label}
          </button>
        `)}
      </div>
    `}
  `;
}
