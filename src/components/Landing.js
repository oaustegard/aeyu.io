/**
 * Landing / Connect Screen
 * Shows app branding, "Connect with Strava" button, demo option, and FAQ.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { startOAuth } from "../auth.js";
import { startDemo } from "../demo.js";
import { navigate } from "../app.js";
import { authState } from "../auth.js";
import { renderIconSVG } from "../icons.js";
import { installContext } from "../install.js";
import { InstallBanner } from "./InstallBanner.js";

const demoLoading = signal(false);

async function handleDemo() {
  demoLoading.value = true;
  try {
    await startDemo();
    authState.value = {
      access_token: "demo_token",
      refresh_token: "demo_refresh",
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      athlete: { id: 99999999, firstname: "Demo", lastname: "Rider", profile: "" },
    };
    navigate("dashboard");
  } catch (err) {
    console.error("Demo load failed:", err);
    demoLoading.value = false;
  }
}

// Award colors from style guide for FAQ pills
const FAQ_AWARD_STYLES = {
  season_first:       { bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8", dot: "#3D7A4A" },
  year_best:          { bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0", dot: "#B8862E" },
  recent_best:        { bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4", dot: "#4882A8" },
  beat_median:        { bg: "#ECE4F0", text: "#4A3060", border: "#CCC0D8", dot: "#7A5C8A" },
  top_quartile:       { bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC", dot: "#5B6CA0" },
  top_decile:         { bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4", dot: "#B85A28" },
  consistency:        { bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8", dot: "#6B6260" },
};

function FaqItem({ q, children }) {
  return html`
    <details class="group" style="border-bottom: 1px solid var(--border-light);">
      <summary class="flex items-center justify-between cursor-pointer py-4" style="font-family: var(--font-body); font-size: 16px; font-weight: 500; color: var(--text);">
        ${q}
        <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </summary>
      <div class="pb-4 leading-relaxed" style="font-family: var(--font-body); font-size: 16px; color: var(--text-secondary);">
        ${children}
      </div>
    </details>
  `;
}

function AwardPill({ type, label }) {
  const s = FAQ_AWARD_STYLES[type];
  if (!s) return html`<span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5" style="background: #ECEAE6; color: #3E3A36;">${label}</span>`;
  return html`
    <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5" style="background: ${s.bg}; color: ${s.text}; border: 1px solid ${s.border};">
      ${renderIconSVG(type, { size: 12, color: s.dot })}
      ${label}
    </span>
  `;
}

export function Landing() {
  return html`
    <div class="min-h-screen" style="background: var(--bg);">
      <!-- Hero -->
      <div class="flex items-center justify-center px-6 pt-16 pb-12">
        <div class="text-center max-w-lg">
          <h1 class="mb-2" style="font-family: var(--font-display); font-size: 4rem; font-weight: 400; line-height: 1;">
            <span style="color: var(--text);">aeyu</span><span style="color: var(--accent);">.io</span>
          </h1>
          <p class="mb-8 group relative inline-block cursor-help" style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text-tertiary); font-style: italic;">
            The sound you make at the top of the climb
            <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 top-full mt-2 text-white text-xs rounded px-3 py-2 whitespace-nowrap z-10" style="background: var(--text); font-family: var(--font-body); font-style: normal;">
              It's Norwegian — like "ow" but with more suffering
            </span>
          </p>

          <div class="rounded-xl shadow-sm p-8 mb-8" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 style="font-family: var(--font-display); font-size: 1.5rem; color: var(--text); margin-bottom: 0.25rem;">Participation Awards</h2>
            <p class="mb-4" style="font-family: var(--font-display); font-size: 0.875rem; color: var(--text-tertiary); font-style: italic;">It's just you and your efforts</p>
            <p class="mb-6" style="font-family: var(--font-body); font-size: 16px; color: var(--text-secondary);">
              Giving recognition for efforts where effort was given.
              Connect your Strava to discover year bests, season firsts,
              and personal milestones that Strava doesn't celebrate.
            </p>

            ${(() => {
              const ctx = installContext.value;
              const showInstall = ctx.isMobile && !ctx.isStandalone && !ctx.dismissed;
              if (showInstall) {
                return html`
                  <${InstallBanner} />
                  <div class="mt-4">
                    <button
                      onClick=${handleDemo}
                      disabled=${demoLoading.value}
                      class="transition-colors"
                      style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-tertiary);"
                    >
                      ${demoLoading.value ? "Loading demo..." : "or try the demo →"}
                    </button>
                  </div>
                `;
              }
              return html`
                <a
                  onClick=${(e) => { e.preventDefault(); startOAuth(); }}
                  href="#"
                  role="button"
                  class="inline-block transition-opacity"
                  style="opacity: 1; cursor: pointer;"
                  onMouseOver=${(e) => e.currentTarget.style.opacity = '0.85'}
                  onMouseOut=${(e) => e.currentTarget.style.opacity = '1'}
                >
                  <img src="assets/strava/btn_strava_connect_with_orange.svg" alt="Connect with Strava" width="237" height="48" style="display: block;" />
                </a>
                ${ctx.dismissed && ctx.isMobile && !ctx.isStandalone && html`
                  <p class="mt-2" style="font-family: var(--font-body); font-size: 0.75rem; color: var(--accent);">
                    Tip: If you install as an app later, you'll need to reconnect and sync again.
                  </p>
                `}
                <div class="mt-4">
                  <button
                    onClick=${handleDemo}
                    disabled=${demoLoading.value}
                    class="transition-colors"
                    style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-tertiary);"
                  >
                    ${demoLoading.value ? "Loading demo..." : "or try the demo →"}
                  </button>
                </div>
              `;
            })()}
          </div>

          <div class="space-y-1" style="font-family: var(--font-body);">
            <p style="font-size: 0.75rem; font-weight: 500; color: var(--text-secondary);">
              100% client-side — your data never touches our servers.
            </p>
            <p style="font-size: 0.75rem; color: var(--text-tertiary);">
              Strava's authorization screen asks to share data with this app,
              but all data flows directly from Strava to your browser.
              We have no server, no database, no analytics.
              Nothing leaves your device.
            </p>
          </div>
        </div>
      </div>

      <!-- FAQ -->
      <div class="max-w-lg mx-auto px-6 pb-16">
        <div class="rounded-xl shadow-sm p-6" style="background: var(--surface); border: 1px solid var(--border);">
          <h3 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 0.5rem;">FAQ</h3>

          <${FaqItem} q="How is this different from Strava's medals and achievements?">
            <p class="mb-2">
              Strava celebrates peak performance — all-time PRs, KOM/QOM
              leaderboard positions, and Local Legend streaks. If you're not
              setting a personal record or topping a leaderboard, Strava has
              nothing to say.
            </p>
            <p>
              Participation Awards celebrates the rest — coming back to a
              favorite climb after the off-season, quietly beating last month's
              time on your commute segment, being more consistent than fast.
              These are temporal, personal patterns that Strava ignores entirely
              but that make up the majority of your riding life.
            </p>
          <//>

          <${FaqItem} q="How does this work without a server?">
            <p>
              Everything runs in your browser. When you connect Strava, your
              activity data is fetched directly from Strava's API and stored in
              your browser's local database (IndexedDB). Awards are computed
              entirely on your device. There is no backend — no server receives,
              processes, or stores your data.
            </p>
          <//>

          <${FaqItem} q="Is my data private?">
            <p>
              Completely. Your Strava data never leaves your browser. There are
              no analytics, no tracking pixels, no cookies, no server logs.
              The app is a static page hosted on GitHub Pages. The only network
              requests go directly to Strava's API from your browser.
            </p>
          <//>

          <${FaqItem} q="Why don't I see my data on another device or browser?">
            <p>
              Because your data lives in your browser's local storage, each
              browser maintains its own separate copy. Your phone's Safari,
              your phone's Chrome, a desktop browser, and the installed app
              version are all independent — each needs its own Strava connection
              and sync. This is the trade-off for complete privacy: no server
              means no sync between devices.
            </p>
          <//>

          <${FaqItem} q="Can I install this as an app?">
            <p class="mb-2">
              Yes! Participation Awards is a Progressive Web App (PWA) that can
              be installed on your home screen for a native app experience.
            </p>
            <p class="mb-2">
              <span style="font-weight: 500; color: var(--text);">iOS Safari:</span> Tap the
              share button (box with arrow), then "Add to Home Screen."
            </p>
            <p class="mb-2">
              <span style="font-weight: 500; color: var(--text);">Android Chrome:</span> Tap
              the three-dot menu, then "Add to Home Screen" or "Install App."
            </p>
            <p>
              <span style="font-weight: 500; color: var(--text);">Desktop Chrome/Edge:</span> Click
              the install icon in the address bar, or use the browser menu.
            </p>
            <p class="mt-2" style="font-size: 0.75rem; color: var(--text-tertiary);">
              Note: the installed app and your browser are separate environments
              with separate data — see the question above.
            </p>
          <//>

          <${FaqItem} q="What do the awards mean?">
            <p class="mb-3">
              Awards are computed per segment effort on your rides. Strava
              segments are user-defined stretches of road or trail; each time
              you ride through one, that's an effort.
            </p>
            <div class="space-y-2">
              <div class="flex items-start gap-2">
                <${AwardPill} type="season_first" label="Season First" />
                <span>Your first effort on a segment this calendar year. Only awarded once per segment per year, on the ride that breaks the seal.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="year_best" label="Year Best" />
                <span>Your fastest time on a segment this calendar year, when you've ridden it at least twice. Resets every January.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="recent_best" label="Recent Best" />
                <span>Your fastest time among your last 5 attempts on a segment, regardless of year. Requires at least 3 prior efforts.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="beat_median" label="Beat Median" />
                <span>Faster than your median time on this segment. Shows how you compare to your own typical performance.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="top_quartile" label="Top Quartile" />
                <span>In the top 25% of your own history on this segment. A genuinely strong effort by your standards.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="top_decile" label="Top 10%" />
                <span>In the top 10% of your history. Supersedes Top Quartile and Beat Median — only the highest tier is shown.</span>
              </div>
              <div class="flex items-start gap-2">
                <${AwardPill} type="consistency" label="Metronome" />
                <span>Remarkably consistent — your last 5 efforts have very low variance. Not getting faster, but repeatable.</span>
              </div>
            </div>
            <p class="mt-3" style="font-size: 0.75rem; color: var(--text-tertiary);">
              Segments with highly variable times (traffic lights, stops) have most awards suppressed automatically — those times reflect traffic, not performance.
            </p>
          <//>

          <${FaqItem} q="Why 'Participation Awards'?">
            <p>
              Because not every ride is a PR. Most aren't. But you still showed
              up, clipped in, and turned the pedals. These awards celebrate
              the patterns that emerge from just keeping at it — the first ride
              of the season on a favorite climb, a quietly improving trend,
              a year-best on a segment you'd forgotten about. Effort given,
              effort recognized.
            </p>
          <//>
        </div>
      </div>
    </div>
  `;
}
