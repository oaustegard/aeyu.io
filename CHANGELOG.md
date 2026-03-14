# aeyu.io Changelog

All merged pull requests for [aeyu.io](https://aeyu.io), a Strava-powered cycling analytics dashboard.

-----

## 2026-03-14

### Features

- **Per-segment LLM export for effort history analysis** — Export a single segment’s effort history as structured data for AI coaching analysis. [#194](https://github.com/oaustegard/aeyu.io/pull/194)
- **Increase LLM export data limits** — Raised export caps to support larger LLM context windows. [#195](https://github.com/oaustegard/aeyu.io/pull/195)
- **Single-ride LLM export with optional form context** — Export one ride’s data for AI analysis, optionally including current form indicators. [#191](https://github.com/oaustegard/aeyu.io/pull/191)
- **Award type toggles in settings** — Users can now enable/disable specific award categories from the settings panel. [#192](https://github.com/oaustegard/aeyu.io/pull/192)
- **Redesigned Form Indicators** — Renamed “Performance Capacity” → “Climb Form” with 6-month sparkline; replaced noisy Aerobic Efficiency scatter plot with monthly bar chart; shortened trend windows from 90 → 42 days to better reflect form. [#190](https://github.com/oaustegard/aeyu.io/pull/190)

### Fixes

- **Fix indoor power display** — Show VirtualRide power data and correctly track power-only rides. [#196](https://github.com/oaustegard/aeyu.io/pull/196)
- **Fix aerobic efficiency chart/text inconsistencies** — Resolved mismatches between chart visuals and textual interpretations. [#193](https://github.com/oaustegard/aeyu.io/pull/193)
- **Relax aerobic efficiency filters and prioritize recent data** — Loosened minimum-data filters so the chart renders for more users; weighted recent rides higher. [#188](https://github.com/oaustegard/aeyu.io/pull/188)
- **Fix aerobic efficiency to include VirtualRide power data** — Indoor rides with power now contribute to the efficiency chart. [#184](https://github.com/oaustegard/aeyu.io/pull/184)
- **Fix clipboard copy for AI Coach export** — Resolved issue where copy-to-clipboard silently failed. [#186](https://github.com/oaustegard/aeyu.io/pull/186)
- **Fix AI Coach export after clipboard timeout** — Export no longer errors out when the clipboard API times out. [#185](https://github.com/oaustegard/aeyu.io/pull/185)
- **Fix touch interaction on aerobic efficiency chart dots** — Tap targets now register correctly on mobile. [#183](https://github.com/oaustegard/aeyu.io/pull/183)
- **Fix aerobic efficiency to follow Friel methodology** — Corrected the calculation to align with Joe Friel’s published approach. [#182](https://github.com/oaustegard/aeyu.io/pull/182)
- **Fix aerobic efficiency: separate power/HR from speed/HR** — Split the two efficiency modes into distinct charts instead of blending them. [#181](https://github.com/oaustegard/aeyu.io/pull/181)

### AI Coaching

- **Add LLM export feature** — New “Export for AI Coach” button generates a structured data snapshot of your training for use with ChatGPT, Claude, etc. [#180](https://github.com/oaustegard/aeyu.io/pull/180)

### UX

- **Help icons with overlay explanations on all charts** — Added (?) icons that reveal contextual explanations for every chart. [#179](https://github.com/oaustegard/aeyu.io/pull/179)

-----

## 2026-03-13

### Fixes

- **Non-breaking spaces between values and units** — Prevents awkward line wraps like “42\nkm” on narrow screens. [#178](https://github.com/oaustegard/aeyu.io/pull/178)
- **Fix demo mode stuck on “Loading demo…”** — Resolved infinite loading state when entering demo mode. [#177](https://github.com/oaustegard/aeyu.io/pull/177)
- **Display average speed on activity cards** — Dashboard activity cards now show avg speed. [#176](https://github.com/oaustegard/aeyu.io/pull/176)
- **Fix poisoned `power_curve:null` entries** — Activities with failed power curve fetches are now retried instead of permanently skipped. [#175](https://github.com/oaustegard/aeyu.io/pull/175)
- **Fix power curve not showing + segment tooltip overflow** — Power curve chart renders correctly; tooltip no longer overflows viewport on segments. [#174](https://github.com/oaustegard/aeyu.io/pull/174)

-----

## 2026-03-12

### Features

- **Wire up power curve** — Integrated power curve sync from Strava streams and added a Dashboard power curve display. [#173](https://github.com/oaustegard/aeyu.io/pull/173)
- **Add speed to ride summary and share card** — Average and max speed now appear on ride summaries and shareable cards. [#172](https://github.com/oaustegard/aeyu.io/pull/172)

-----

## 2026-03-11

### Features

- **Average speed in segment effort details** — Segment efforts now display computed avg speed. [#170](https://github.com/oaustegard/aeyu.io/pull/170)
- **Cadence in segment effort details** — Added cadence column with sortable header. [#166](https://github.com/oaustegard/aeyu.io/pull/166)
- **Heart rate in segment effort details** — Segment efforts show avg/max HR. [#164](https://github.com/oaustegard/aeyu.io/pull/164)
- **Full-width touch-friendly segment chart** — Replaced sparkline with an interactive chart supporting tap and pan. [#158](https://github.com/oaustegard/aeyu.io/pull/158)
- **Hard reload option** — Menu item to bust the service worker cache and force a fresh code load. [#160](https://github.com/oaustegard/aeyu.io/pull/160)
- **FAQ entry for GitHub issue tracker** — Users can now discover and file issues from the FAQ. [#169](https://github.com/oaustegard/aeyu.io/pull/169)
- **FAQ, wordmark tooltip, tooltip persistence fix** — Added an aeyu-specific FAQ, a tooltip on the wordmark, and fixed tooltips staying open. [#167](https://github.com/oaustegard/aeyu.io/pull/167)

### Fixes

- **Fix scroll broken after long-press tooltip** — Touch scrolling no longer locks up after dismissing a tooltip. [#171](https://github.com/oaustegard/aeyu.io/pull/171)
- **Fix long-press selecting text** — Long press now shows tooltip instead of triggering text selection. [#156](https://github.com/oaustegard/aeyu.io/pull/156)
- **Fix chart tooltip overlapping data points** — Tooltip now repositions to avoid covering the data it describes. [#161](https://github.com/oaustegard/aeyu.io/pull/161)
- **Fix segment Strava links position** — Moved links to expected location; removed unnecessary sort X button. [#159](https://github.com/oaustegard/aeyu.io/pull/159)

### Awards

- **Reduce award noise** — Smarter ranking logic and tighter per-segment caps cut visual clutter. [#163](https://github.com/oaustegard/aeyu.io/pull/163)

### UX

- **Improved share card design** — Better space utilization, contrast, and readability. [#165](https://github.com/oaustegard/aeyu.io/pull/165)

### Infra

- **Limit backfill to 13 months, cycling only** — Initial sync now caps at 13 months and filters non-cycling activities. [#157](https://github.com/oaustegard/aeyu.io/pull/157)
- **Auto-generate codemap at session start** — `SessionStart` hook regenerates `_MAP.md` files. [#168](https://github.com/oaustegard/aeyu.io/pull/168)
- **`_MAP.md` navigation notes in `CLAUDE.md`** — Developer docs updated with codemap usage. [#162](https://github.com/oaustegard/aeyu.io/pull/162)

-----

## 2026-03-10

### Features

- **Sortable segment efforts** — Segment list in ActivityDetail supports sort by time, date, HR, power, cadence. [#136](https://github.com/oaustegard/aeyu.io/pull/136)
- **Effort trend sparklines per segment** — Visual mini-charts showing performance history for each segment. [#137](https://github.com/oaustegard/aeyu.io/pull/137)
- **Performance chart on segment share cards** — Shareable segment cards now include a trend chart. [#146](https://github.com/oaustegard/aeyu.io/pull/146)
- **Tooltips on award pills and Form Indicator charts** — Hover/tap for explanations on awards and fitness charts. [#148](https://github.com/oaustegard/aeyu.io/pull/148)
- **Long-press tooltip support for touch** — Mobile users can now long-press any tooltip target. [#153](https://github.com/oaustegard/aeyu.io/pull/153)
- **Enhanced Dashboard visualizations** — Added bar charts and scatter plots to the Dashboard. [#154](https://github.com/oaustegard/aeyu.io/pull/154)
- **Comprehensive FAQ section** — Full FAQ added to Dashboard. [#150](https://github.com/oaustegard/aeyu.io/pull/150)
- **Activity search in Dashboard header** — Search/filter activities by name. [#124](https://github.com/oaustegard/aeyu.io/pull/124)
- **Sticky header with compact scroll mode and avatar menu** — Header collapses on scroll; user avatar opens settings menu. [#125](https://github.com/oaustegard/aeyu.io/pull/125)
- **Path-based routing** — Switched from hash-based (`#/activity/123`) to clean path routing (`/activity/123`) using the History API. [#127](https://github.com/oaustegard/aeyu.io/pull/127)
- **Enrich comparative awards** — Awards now show rank position and percentage delta. [#138](https://github.com/oaustegard/aeyu.io/pull/138)
- **Rate limit details in sync banner** — When Strava rate-limits, the banner shows remaining cooldown. [#120](https://github.com/oaustegard/aeyu.io/pull/120)
- **Demo mode toggle for logged-in users** — Authenticated users can preview demo mode. [#151](https://github.com/oaustegard/aeyu.io/pull/151)
- **Heart rate data in demo activities** — Demo mode now includes realistic HR data. [#152](https://github.com/oaustegard/aeyu.io/pull/152)

### Design

- **Redesigned header and footer** — New layout across Dashboard and ActivityDetail. [#123](https://github.com/oaustegard/aeyu.io/pull/123)
- **Branding update to aeyu.io** — Consistent branding throughout the app. [#131](https://github.com/oaustegard/aeyu.io/pull/131)
- **OG-image banner color** — Lightened to dusty peach for logo contrast. [#126](https://github.com/oaustegard/aeyu.io/pull/126)
- **Darken header background** — Improved contrast with logo. [#143](https://github.com/oaustegard/aeyu.io/pull/143)
- **Form Indicators vertical stack on mobile** — Fixed layout overflow. [#142](https://github.com/oaustegard/aeyu.io/pull/142)

### Fixes

- **Fix sync ordering: newest first** — Backfill now fetches most recent rides first. [#122](https://github.com/oaustegard/aeyu.io/pull/122)
- **Refresh dashboard during backfill** — New activities appear immediately as they sync. [#135](https://github.com/oaustegard/aeyu.io/pull/135)
- **Fix demo mode leaking into user sessions** — Demo data no longer contaminates real data. [#155](https://github.com/oaustegard/aeyu.io/pull/155)
- **Fix demo mode destroying real data on exit** — Exiting demo now restores user data correctly. [#141](https://github.com/oaustegard/aeyu.io/pull/141)
- **Fix demo mode not replacing real activities** — Demo mode fully swaps in sample data. [#139](https://github.com/oaustegard/aeyu.io/pull/139)
- **Fix demo mode exit re-entry loop** — Exiting demo no longer re-triggers demo mode. [#147](https://github.com/oaustegard/aeyu.io/pull/147)
- **Fix broken import map** — Resolved a dependency map error preventing app load. [#144](https://github.com/oaustegard/aeyu.io/pull/144)
- **Hide Form Indicators when no data** — Renamed from “Fitness” to “Form Indicators”; hidden when insufficient data. [#134](https://github.com/oaustegard/aeyu.io/pull/134)

### Settings & Navigation

- **Move settings from FAQ to avatar menu** — Settings now accessible from the header avatar. [#132](https://github.com/oaustegard/aeyu.io/pull/132)
- **Move avatar to right of help button** — Increased spacing for touch targets. [#133](https://github.com/oaustegard/aeyu.io/pull/133)
- **Move delete data into settings modal** — Destructive action now behind a confirmation in settings. [#149](https://github.com/oaustegard/aeyu.io/pull/149)

### Infra

- **Vendor all dependencies** — Bundled Preact 10.28.4 and Signals 2.8.2; no more CDN dependency. [#140](https://github.com/oaustegard/aeyu.io/pull/140)

-----

## 2026-03-09

### Major Features

- **Fitness Indicators: Performance Capacity + Aerobic Efficiency** — New `fitness.js` module computing climb-based performance capacity and HR-derived aerobic efficiency. Includes schema v3 migration to capture HR data. [#113](https://github.com/oaustegard/aeyu.io/pull/113)
- **Power curve computation + trend/milestone awards** — Fetches second-by-second power streams from Strava, computes best power at standard durations (5s → 60min), estimates FTP. Awards include Watt Milestone, kJ Milestone, Power Progression, and FTP Record. [#97](https://github.com/oaustegard/aeyu.io/pull/97)
- **Weekly ride streaks and group ride detection** — Tracks consecutive weeks of riding (with mulligan support), detects group rides via day/time/location clustering, shows streak danger warnings. [#96](https://github.com/oaustegard/aeyu.io/pull/96)
- **Route detection via segment fingerprinting** — Clusters activities by shared segments (Jaccard ≥0.7) to identify routes; collapses multiple Season First awards into a single Route Season First badge. IndexedDB v3 adds routes store. [#77](https://github.com/oaustegard/aeyu.io/pull/77)
- **Indoor training awards** — Four new award types for trainer rides: Indoor NP Year Best, Indoor Work Year Best, Trainer Streak, and Indoor vs Outdoor NP comparison. [#76](https://github.com/oaustegard/aeyu.io/pull/76)
- **Activity-level power awards** — Awards engine for power metrics at the ride level. [#73](https://github.com/oaustegard/aeyu.io/pull/73)
- **Terrain v2 style guide** — Full visual overhaul: Instrument Serif, DM Sans, IBM Plex Mono fonts; CSS custom properties for surfaces/colors; SVG award icons; warm-paper share cards with topo texture. [#82](https://github.com/oaustegard/aeyu.io/pull/82)
- **Share card enhancements** — Logo watermark, per-segment share cards, clipboard copy support. [#102](https://github.com/oaustegard/aeyu.io/pull/102)
- **Comeback Mode** — Reset events for injury recovery: `comeback_pb`, `recovery_milestone`, `comeback_full`, and more. Tracks awarded thresholds per segment to prevent re-awarding. [#61](https://github.com/oaustegard/aeyu.io/pull/61)
- **User-defined reference points** — Custom “best since” awards based on user-set dates. [#68](https://github.com/oaustegard/aeyu.io/pull/68)
- **Demo mode with sample data** — Try the app without connecting Strava. [#71](https://github.com/oaustegard/aeyu.io/pull/71)
- **Mobile install interstitial** — Landing page prompts mobile users to add to home screen. [#95](https://github.com/oaustegard/aeyu.io/pull/95)

### Awards Engine

- **Consolidate AWARD_LABELS + segment award ranking** — Single source of truth for labels/colors in `award-config.js`; subsumption rules (year_best removes recent_best/monthly_best); per-segment cap of 3+1 awards. [#83](https://github.com/oaustegard/aeyu.io/pull/83)
- **Tighten award thresholds** — Reduced grade inflation by raising minimum bars. [#116](https://github.com/oaustegard/aeyu.io/pull/116)
- **Fix missing award icons and #demo route** — Restored icons; authenticated users can access `/demo`. [#117](https://github.com/oaustegard/aeyu.io/pull/117)

### Sync & Data

- **Power fields in IndexedDB + sync engine** — DB v2 with `device_watts` and `trainer` indexes; captures 6 power fields from Strava. [#69](https://github.com/oaustegard/aeyu.io/pull/69)
- **Power backfill via reset-and-refetch** — One-time migration re-processes legacy activities for power+segment data. [#70](https://github.com/oaustegard/aeyu.io/pull/70)
- **Interleaved sync with auto-scheduling** — Fetches in pages of 100 with detail fetch between pages; fully automatic sync replaces manual button; respects rate limits. [#93](https://github.com/oaustegard/aeyu.io/pull/93)
- **Configurable sync window** — Users can limit historical backfill depth. [#119](https://github.com/oaustegard/aeyu.io/pull/119)
- **Fix backfill syncing oldest first** — Backfill now processes newest activities first. [#112](https://github.com/oaustegard/aeyu.io/pull/112), [#114](https://github.com/oaustegard/aeyu.io/pull/114)
- **Resync button for individual activities** — Re-fetch a single activity from Strava. [#78](https://github.com/oaustegard/aeyu.io/pull/78)
- **Fix disconnect clearing all data** — Disconnect now removes only auth, not synced activities. [#92](https://github.com/oaustegard/aeyu.io/pull/92)

### UX

- **Consolidated ActivityDetail segment view** — Compact pill counts replace flat award list; expandable detail per award; segments without awards shown at reduced opacity. [#94](https://github.com/oaustegard/aeyu.io/pull/94)
- **FAQ rendered as modal overlay** — Moved from inline at page bottom to a centered overlay. [#75](https://github.com/oaustegard/aeyu.io/pull/75)
- **Strava deep links on activity detail** — Link directly to the activity on Strava. [#100](https://github.com/oaustegard/aeyu.io/pull/100)
- **Manual sync button in FAQ & Settings** — Fallback for users who want to trigger sync manually. [#98](https://github.com/oaustegard/aeyu.io/pull/98)

### Fixes

- **Resolve bugs in ActivityDetail and share card** — Route collapse in ActivityDetail, `device_watts` propagation, stacked segment layout, share card missing data. [#91](https://github.com/oaustegard/aeyu.io/pull/91)
- **Fix activity refresh showing Loading screen** — Refreshing stays on the activity page. [#79](https://github.com/oaustegard/aeyu.io/pull/79)
- **Fix loading screen stuck** — Added error boundary, safe render fallback, flag-based detection. [#99](https://github.com/oaustegard/aeyu.io/pull/99), [#101](https://github.com/oaustegard/aeyu.io/pull/101), [#103](https://github.com/oaustegard/aeyu.io/pull/103)
- **Fix duplicate `isoWeekKey`** — Resolved collision causing app load failure. [#105](https://github.com/oaustegard/aeyu.io/pull/105)
- **Fix demo mode with complete power data** — Demo now showcases full power features. [#104](https://github.com/oaustegard/aeyu.io/pull/104)
- **Fix award gate blocking badges** — Badges no longer suppressed when any activity lacks details. [#55](https://github.com/oaustegard/aeyu.io/pull/55)
- **Fix award badges not showing + Top 10% hierarchy** — Restored rendering; added superseding logic. [#52](https://github.com/oaustegard/aeyu.io/pull/52)
- **Fix missing import** — `getActivitiesWithoutEfforts` import and auto-trigger fix. [#66](https://github.com/oaustegard/aeyu.io/pull/66)

### Compliance

- **Strava Brand Guidelines compliance** — Updated logos, attribution, and link behavior per Strava requirements. [#118](https://github.com/oaustegard/aeyu.io/pull/118)

### Docs & Testing

- **CLAUDE.md and `_MAP.md` code maps** — Developer documentation and codebase navigation. [#72](https://github.com/oaustegard/aeyu.io/pull/72)
- **Comprehensive awards test harness** — Covers all 26 award types + comeback mode. [#65](https://github.com/oaustegard/aeyu.io/pull/65), [#67](https://github.com/oaustegard/aeyu.io/pull/67)

-----

## 2026-03-08

### Initial Launch

- **Full Participation Awards MVP** — Complete client app: IndexedDB data layer, Strava OAuth flow, paginated sync engine with rate limiting, awards engine (Year Best, Season First, Recent Best), and UI screens (Landing, Sync Progress, Dashboard, Activity Detail). [#37](https://github.com/oaustegard/aeyu.io/pull/37)
- **Fix callback stuck on “Exchanging authorization code”** — OAuth callback page error handling. [#41](https://github.com/oaustegard/aeyu.io/pull/41)
- **Minimum effort threshold + calendar gate for Year Best** — Year Best awards require meaningful effort and calendar spread. [#42](https://github.com/oaustegard/aeyu.io/pull/42)
- **Comparative awards, consistency, CV filtering** — Beat Median, Top Quartile, Metronome (CV <5%), high-variance segment suppression (CV >0.5). [#49](https://github.com/oaustegard/aeyu.io/pull/49)
- **Temporal, trend, milestone, and ride-level awards** — Monthly Best, Improvement Streak, Comeback, Milestone (10th/25th/50th/100th attempts), Distance Record, Elevation Record, Segment Count. [#50](https://github.com/oaustegard/aeyu.io/pull/50)
- **Best Month Ever, Closing In, Anniversary, Endurance Record** — Additional award types. [#51](https://github.com/oaustegard/aeyu.io/pull/51)

-----

## 2025-05-24 – 2025-05-25

### Prototype

- **Initial commit** — [#1](https://github.com/oaustegard/aeyu.io/pull/1)
- **JS refactoring** — Modularized JavaScript across three PRs. [#2](https://github.com/oaustegard/aeyu.io/pull/2), [#3](https://github.com/oaustegard/aeyu.io/pull/3), [#4](https://github.com/oaustegard/aeyu.io/pull/4)
- **Feed pagination fix** — [#14](https://github.com/oaustegard/aeyu.io/pull/14)
- **Fix relative time display** — [#16](https://github.com/oaustegard/aeyu.io/pull/16)