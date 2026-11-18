---
name: verify
description: Drive aeyu.io's main flow in headless Chromium (landing, "try the demo", dashboard, an activity with awards, back, exit demo, demo again) and run the fatigue kernel's GPU-vs-CPU differential. Run before every commit that touches src/, the HTML entry points, demo-data.json, sw.js or vendor/, and whenever an app change is called done.
---

# Verify: aeyu.io

Run from the repo root:

```bash
node .claude/skills/verify/verify.mjs
```

It exits 0 and prints `OK: 13/13 checks` when the app works. The flow takes
about 2 s and the GPU differential about 8 s.

| option | effect |
|---|---|
| `--no-gpu` | skip the fatigue kernel differential (flow only, ~2 s) |
| `--shots DIR` | save a screenshot of the landing page, the dashboard and the activity |
| `--base https://aeyu.io` | drive the deployed site instead of a local server (also skips the GPU check) |

## The flow

A Python `http.server` serves the repo root on a free port. Chromium runs
with the SwiftShader WebGPU flags from CLAUDE.md, so the ride replay and the
kernel take their GPU paths.

1. **Landing** (`/`): the pitch, the Connect with Strava button (its image
   loaded) and "or try the demo →".
2. **Demo**: clicks the landing page's own demo button and waits for the
   dashboard. It checks the Demo Mode banner, a positive awards count and at
   least 5 activity cards.
3. **Activity**: opens the first card that shows award chips. It checks that
   the URL is `/activity?id=…`, that the activity's name and Segment Efforts are
   shown, and that the ride replay mounted its canvases.
4. **Back** returns to the demo dashboard.
5. **Exit Demo** from the avatar menu returns to the landing page. **Demo again**
   reaches the dashboard. This catches state that leaks out of an exit.
6. **No Strava request** during any of it. `_FEATURES.md` requires that demo
   mode never touches the Strava API.
7. **No page errors, no console errors and no failed same-origin requests.**
   Requests to other origins (Google Fonts, Strava) are aborted, so the run
   needs no network, and the "Failed to load resource" console lines that
   those aborts cause are ignored.

Then `test/fatigue-gpu-check.mjs` runs: the WebGPU fatigue table must equal the
CPU reference cell for cell. That script imports `playwright` as ESM, which
ignores `NODE_PATH`, so verify.mjs links `node_modules/playwright` to the
container's copy when it is missing (`node_modules/` is gitignored).

## Stress test (2026-11-18)

- 20 sequential full runs: 20/20 passed in 192 s.
- Against the deployed site (`--base https://aeyu.io`): 3/3 passed in about 3.5 s.
  The first deployed run found a second race: the Connect with Strava image
  was still loading when the landing check read it. The check now waits for it.
- 4 runners at once, 5 flow-only runs each: 20/20 passed.
- One flake was found and fixed by its cause: the replay canvases mount after
  the streams load, so the check waits for them (up to 10 s) instead of
  counting once.
- Red runs: each of the three demo bugs fixed alongside this skill was
  restored on its own (the landing button, the open-connection delete and
  the exit order), and each fails. So do a missing Segment Efforts heading and
  an activity link built from the name instead of the id.

## Limits

- The signed-in path (Try Demo from a real dashboard, then Exit Demo back to
  it) needs a real session in IndexedDB and stubbed Strava responses. It is
  not part of this flow. It was checked by hand once on 2026-11-18.
- The local server does not map `/demo` to `demo.html` as GitHub Pages does,
  so a reload on a client-side route 404s locally. The flow never reloads.
- SwiftShader proves the kernel is correct, not how fast it is. Timing comes
  from `power-bench.html` on a real GPU.
