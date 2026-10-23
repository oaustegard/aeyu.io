import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { FAQ_ENTRIES } from "./Dashboard.js";

/** (?) that opens the FAQ answer for `faqId` in a popover, on light or dark cards. */
export function HelpButton({ faqId, dark = false, align = "right", below = false }) {
  const [open, setOpen] = useState(false);
  const entry = FAQ_ENTRIES.find((f) => f.id === faqId);
  if (!entry) return null;
  const ink = dark ? "rgba(255,255,255,0.6)" : "var(--text-tertiary)";
  return html`
    <span class="relative inline-flex">
      <button
        onClick=${(e) => { e.stopPropagation(); setOpen(!open); }}
        style="width: 20px; height: 20px; font-size: 11px; font-weight: 600; color: ${ink}; border: 1.5px solid ${ink}; background: transparent; cursor: pointer; line-height: 1; padding: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent;"
        aria-label=${entry.question}
        aria-expanded=${open}
        data-testid=${`help-${faqId}`}
      >?</button>
      ${open && html`
        <div
          onClick=${(e) => e.stopPropagation()}
          class="absolute z-30 rounded-lg shadow-lg p-3"
          data-testid=${`help-${faqId}-text`}
          style="${below ? "top" : "bottom"}: calc(100% + 8px); ${align}: 0; width: min(300px, 80vw); background: var(--surface, #fff); border: 1px solid var(--border); font-family: var(--font-body); font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; text-transform: none; letter-spacing: normal; font-weight: 400;"
        >
          <button
            onClick=${() => setOpen(false)}
            style="position: absolute; top: 4px; right: 6px; background: none; border: none; cursor: pointer; color: var(--text-tertiary); font-size: 14px; line-height: 1; padding: 2px;"
            aria-label="Close"
          >\u00D7</button>
          <div style="font-weight: 600; color: var(--text); margin-bottom: 0.25rem; padding-right: 1rem;">${entry.question}</div>
          ${entry.answer}
        </div>`}
    </span>`;
}
