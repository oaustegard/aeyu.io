/**
 * Landing / Connect Screen
 * Shows app branding, "Connect with Strava" button, and FAQ.
 */

import { html } from "htm/preact";
import { startOAuth } from "../auth.js";

function FaqItem({ q, children }) {
  return html`
    <details class="group border-b border-gray-100 last:border-0">
      <summary class="flex items-center justify-between cursor-pointer py-4 text-sm font-medium text-gray-700 hover:text-gray-900">
        ${q}
        <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </summary>
      <div class="pb-4 text-sm text-gray-600 leading-relaxed">
        ${children}
      </div>
    </details>
  `;
}

export function Landing() {
  return html`
    <div class="min-h-screen bg-gray-50">
      <!-- Hero -->
      <div class="flex items-center justify-center px-6 pt-16 pb-12">
        <div class="text-center max-w-lg">
          <h1 class="text-6xl font-bold mb-2">
            <span class="gradient-text">aeyu.io</span>
          </h1>
          <p class="text-lg text-gray-500 italic mb-8 group relative inline-block cursor-help">
            The sound you make at the top of the climb
            <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-gray-800 text-white text-xs rounded px-3 py-2 whitespace-nowrap z-10">
              It's Norwegian — like "ow" but with more suffering
            </span>
          </p>

          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
            <h2 class="text-2xl font-semibold text-gray-800 mb-1">Participation Awards</h2>
            <p class="text-sm text-gray-400 italic mb-4">It's just you and your efforts</p>
            <p class="text-gray-600 mb-6">
              Giving recognition for efforts where effort was given.
              Connect your Strava to discover year bests, season firsts,
              and personal milestones that Strava doesn't celebrate.
            </p>

            <button
              onClick=${() => startOAuth()}
              class="inline-flex items-center gap-2 bg-[#FC4C02] hover:bg-[#e04400] text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
              </svg>
              Connect with Strava
            </button>
          </div>

          <div class="text-xs text-gray-400 space-y-1">
            <p class="font-medium text-gray-500">
              100% client-side — your data never touches our servers.
            </p>
            <p>
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
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-2">FAQ</h3>

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
              <span class="font-medium text-gray-700">iOS Safari:</span> Tap the
              share button (box with arrow), then "Add to Home Screen."
            </p>
            <p class="mb-2">
              <span class="font-medium text-gray-700">Android Chrome:</span> Tap
              the three-dot menu, then "Add to Home Screen" or "Install App."
            </p>
            <p>
              <span class="font-medium text-gray-700">Desktop Chrome/Edge:</span> Click
              the install icon in the address bar, or use the browser menu.
            </p>
            <p class="mt-2 text-xs text-gray-400">
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
                <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 whitespace-nowrap mt-0.5">Season First</span>
                <span>Your first effort on a segment this calendar year. Only awarded once per segment per year, on the ride that breaks the seal.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 whitespace-nowrap mt-0.5">Year Best</span>
                <span>Your fastest time on a segment this calendar year, when you've ridden it at least twice. Resets every January.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 whitespace-nowrap mt-0.5">Recent Best</span>
                <span>Your fastest time among your last 5 attempts on a segment, regardless of year. Requires at least 3 prior efforts.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 whitespace-nowrap mt-0.5">Beat Median</span>
                <span>Faster than your median time on this segment. Shows how you compare to your own typical performance.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 whitespace-nowrap mt-0.5">Top Quartile</span>
                <span>In the top 25% of your own history on this segment. A genuinely strong effort by your standards.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 whitespace-nowrap mt-0.5">Top 10%</span>
                <span>In the top 10% of your history. Supersedes Top Quartile and Beat Median — only the highest tier is shown.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 whitespace-nowrap mt-0.5">Metronome</span>
                <span>Remarkably consistent — your last 5 efforts have very low variance. Not getting faster, but repeatable.</span>
              </div>
            </div>
            <p class="mt-3 text-xs text-gray-400">
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
