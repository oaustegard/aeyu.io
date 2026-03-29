# Coaching

LLM export pipeline that builds compact context payloads for AI cycling coaching. Aggregates recent rides, fitness trends, streak data, and award distributions into JSON or markdown that fits any LLM context window. Implementation: [[src/export-llm.js]].

## Context Building

[[src/export-llm.js#buildLLMContext]] constructs a full coaching snapshot: recent ride summaries (slimmed to essential fields), weekly rollups with week-over-week deltas, power zone distribution, [[fitness]] summary, [[awards]] highlights, and [[routes#Detection Algorithm]] streak data.

Activities are filtered by a configurable day window (default 90 days). Each ride is compressed by `slimActivity` to ~10 fields — name, date, distance, time, elevation, power metrics, heart rate. Weekly rollups aggregate distance, elevation, moving time, and ride count.

## Single Ride Export

[[src/export-llm.js#buildRideExport]] produces a focused payload for coaching a specific ride. Includes the ride's segment efforts with per-segment history context, awards earned, [[fitness]] form snapshot at the time of the ride, and power curve data.

Segment efforts are slimmed to time, rank within history, delta from PR, and whether a power meter was present. This gives an LLM enough context to comment on pacing and effort distribution.

## Segment Export

[[src/export-llm.js#buildSegmentExport]] produces a history-focused payload for a single segment: all efforts chronologically, best/worst/median times, improvement trends, and which awards have been earned on this segment.

## Markdown Output

[[src/export-llm.js#contextToMarkdown]] and [[src/export-llm.js#rideToMarkdown]] convert JSON payloads to structured markdown. The markdown format is designed for copy-pasting into an LLM chat — section headers, tables, and compact formatting that an LLM can parse efficiently.

## Unit Conversion

[[src/export-llm.js#convertContextUnits]] applies the user's metric/imperial preference to the export payload. The JSON structure uses metric internally; conversion happens only at the markdown rendering stage.

## Integration Points

Triggered from Dashboard (full context), ActivityDetail (single ride/segment), and programmatically via `skill-callback.html`.

`coach-claude.html` offers a standalone coaching interface. The export pipeline feeds [[coaching#Markdown Output]] into any LLM chat context.
