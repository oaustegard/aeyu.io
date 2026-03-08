#!/usr/bin/env python3
"""
aeyu.io Test Harness

Generates realistic Strava mock data with deterministic scenarios that
guarantee every award type fires. Serves the app locally, injects data
into IndexedDB via Playwright, runs an awards audit, and takes screenshots.

Award coverage (26 types):
  Segment-level: year_best, season_first, recent_best, beat_median,
    top_quartile, top_decile, consistency, monthly_best, improvement_streak,
    comeback, milestone, best_month_ever, closing_in, anniversary,
    ytd_best_time, ytd_best_power
  Comeback: comeback_pb, recovery_milestone, comeback_full
  Ride-level: distance_record, elevation_record, segment_count,
    endurance_record, comeback_distance, comeback_elevation, comeback_endurance

Data quality rules tested:
  - Min 3 efforts gate
  - Calendar gate (Year Best suppressed before March 1)
  - High-variance filter (CV > 0.5 suppresses most awards)
  - device_watts requirement for power awards
  - Comeback mode: recovery zone suppression, transition zone, recovered

Usage:
    python3 test/harness.py                    # Full run: generate + screenshot + audit
    python3 test/harness.py --screen landing   # Specific screen only
    python3 test/harness.py --screen comeback  # Comeback mode dashboard
    python3 test/harness.py --audit-only       # Skip screenshots, just audit awards
"""

import json, math, os, random, sys, socket, threading, time, functools
from datetime import datetime, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/opt/pw-browsers'

# ── Segments ──────────────────────────────────────────────────────────
# 12 route segments + 5 controlled scenario segments

SEGMENTS = [
    # Route segments (used in random rides)
    {"id": 100001, "name": "River Road Climb",     "distance": 2400, "average_grade": 5.2, "elevation_high": 180, "elevation_low": 55,  "climb_category": 3, "base_time": 480},
    {"id": 100002, "name": "Greenway Sprint",       "distance": 800,  "average_grade": 0.3, "elevation_high": 42,  "elevation_low": 40,  "climb_category": 0, "base_time": 90},
    {"id": 100003, "name": "Ridge Road to Summit",  "distance": 4200, "average_grade": 6.8, "elevation_high": 340, "elevation_low": 52,  "climb_category": 2, "base_time": 960},
    {"id": 100004, "name": "Lakeside Loop Segment", "distance": 3100, "average_grade": 1.1, "elevation_high": 85,  "elevation_low": 50,  "climb_category": 0, "base_time": 380},
    {"id": 100005, "name": "Old Mill Hill",         "distance": 1100, "average_grade": 8.5, "elevation_high": 155, "elevation_low": 62,  "climb_category": 3, "base_time": 320},
    {"id": 100006, "name": "Park Avenue Dash",      "distance": 600,  "average_grade": 0.1, "elevation_high": 35,  "elevation_low": 34,  "climb_category": 0, "base_time": 65},
    {"id": 100007, "name": "Cemetery Rollers",      "distance": 1800, "average_grade": 3.2, "elevation_high": 120, "elevation_low": 62,  "climb_category": 4, "base_time": 280},
    {"id": 100008, "name": "Valley Floor TT",       "distance": 5200, "average_grade": 0.4, "elevation_high": 48,  "elevation_low": 30,  "climb_category": 0, "base_time": 620},
    {"id": 100009, "name": "Hawk Mountain Ascent",  "distance": 6800, "average_grade": 7.1, "elevation_high": 520, "elevation_low": 38,  "climb_category": 1, "base_time": 1800},
    {"id": 100010, "name": "Bridge Street Kicker",  "distance": 400,  "average_grade": 9.2, "elevation_high": 78,  "elevation_low": 41,  "climb_category": 4, "base_time": 95},
    {"id": 100011, "name": "Covered Bridge Sprint", "distance": 950,  "average_grade": 0.8, "elevation_high": 55,  "elevation_low": 48,  "climb_category": 0, "base_time": 110},
    {"id": 100012, "name": "Church Lane Grind",     "distance": 1500, "average_grade": 6.1, "elevation_high": 145, "elevation_low": 53,  "climb_category": 3, "base_time": 380},

    # Controlled scenario segments
    {"id": 200001, "name": "Anniversary Lane",      "distance": 1200, "average_grade": 2.0, "elevation_high": 80,  "elevation_low": 55,  "climb_category": 0, "base_time": 180},
    {"id": 200002, "name": "Metronome Mile",        "distance": 1600, "average_grade": 0.5, "elevation_high": 45,  "elevation_low": 40,  "climb_category": 0, "base_time": 200},
    {"id": 200003, "name": "Streak Hill",           "distance": 900,  "average_grade": 4.0, "elevation_high": 90,  "elevation_low": 54,  "climb_category": 4, "base_time": 150},
    {"id": 200004, "name": "Slump & Rally Rd",      "distance": 1400, "average_grade": 3.5, "elevation_high": 100, "elevation_low": 51,  "climb_category": 4, "base_time": 220},
    {"id": 200005, "name": "Recovery Ridge",         "distance": 2000, "average_grade": 5.0, "elevation_high": 150, "elevation_low": 50,  "climb_category": 3, "base_time": 400},
]

ROUTES = {
    "River Loop":  [100001, 100002, 100004, 100006],
    "Ridge Epic":  [100001, 100003, 100005, 100007, 100009],
    "Valley Flat": [100002, 100004, 100006, 100008, 100011],
    "Short Hills": [100005, 100007, 100010, 100012],
    "Full Tour":   [100001, 100002, 100003, 100004, 100005, 100007, 100008],
    "Quick Spin":  [100002, 100006, 100011],
    "Hawk Day":    [100001, 100007, 100009, 100012],
    "Bridge Run":  [100004, 100010, 100011, 100006],
}

RIDE_NAMES = ["Morning Ride", "Afternoon Ride", "Lunch Ride", "Evening Ride",
    "Weekend Long Ride", "Recovery Ride", "Group Ride", "Solo Ride",
    "Coffee Shop Ride", "Sunrise Ride", "Sunset Cruise", "Interval Session",
    "Hill Repeats", "Base Miles", "Endurance Ride", "Tempo Ride"]
RUN_NAMES = ["Morning Run", "Easy Run", "Recovery Jog", "Tempo Run",
    "Long Run", "Trail Run", "Interval Session", "Hill Sprints"]


# ── Helpers ───────────────────────────────────────────────────────────

def seasonal_prob(month):
    return {1:.05,2:.05,3:.15,4:.45,5:.7,6:.85,7:.9,8:.9,9:.8,10:.5,11:.2,12:.08}[month]

def fitness_curve(year, month):
    yf = max(1.0 - (year - 2020) * 0.015, 0.90)
    sf = {1:1.15,2:1.12,3:1.08,4:1.02,5:.97,6:.94,7:.92,8:.93,9:.95,10:1.0,11:1.05,12:1.10}[month]
    return yf * sf

def seg_by_id(sid):
    return next(s for s in SEGMENTS if s["id"] == sid)

def make_effort(eid, seg, elapsed, dt, device_watts=False, avg_watts=None):
    """Create a segment effort dict for activity.segment_efforts."""
    moving = max(elapsed - random.randint(0, 10), int(elapsed * 0.92))
    effort = {
        "id": eid, "name": seg["name"],
        "segment": {"id": seg["id"], "name": seg["name"], "distance": seg["distance"],
                     "average_grade": seg["average_grade"], "elevation_high": seg["elevation_high"],
                     "elevation_low": seg["elevation_low"], "climb_category": seg["climb_category"]},
        "elapsed_time": elapsed, "moving_time": moving,
        "start_date": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_date_local": dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "pr_rank": None, "achievements": [],
    }
    if device_watts:
        effort["device_watts"] = True
        effort["average_watts"] = avg_watts or int(200 + random.uniform(-30, 30))
    return effort

def make_seg_record(eid, aid, elapsed, moving, dt, device_watts=False, avg_watts=None):
    """Create a segment effort record for segment.efforts store."""
    rec = {
        "effort_id": eid, "activity_id": aid,
        "elapsed_time": elapsed, "moving_time": moving,
        "start_date": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_date_local": dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "pr_rank": None,
    }
    if device_watts:
        rec["device_watts"] = True
        rec["average_watts"] = avg_watts
    return rec

# Counters
_eid = [500000]
_aid = [10000000]
def next_eid():
    _eid[0] += 1; return _eid[0]
def next_aid():
    _aid[0] += 1; return _aid[0]

def make_ride(dt, efforts_data, seg_efforts_store, name=None, extra_dist=0,
              extra_time=0, extra_elev=0, device_watts=False, avg_watts=None):
    """Build a complete ride activity from a list of (segment, elapsed, watts?) tuples."""
    aid = next_aid()
    efforts = []
    t_time, t_dist = 0, 0

    for item in efforts_data:
        seg, elapsed = item[0], item[1]
        dw = item[2] if len(item) > 2 else device_watts
        aw = item[3] if len(item) > 3 else avg_watts

        eid = next_eid()
        edt = dt + timedelta(seconds=t_time + random.randint(120, 300))
        moving = max(elapsed - random.randint(0, 8), int(elapsed * 0.93))

        effort = make_effort(eid, seg, elapsed, edt, device_watts=dw, avg_watts=aw)
        efforts.append(effort)
        seg_efforts_store[seg["id"]].append(
            make_seg_record(eid, aid, elapsed, moving, edt, device_watts=dw, avg_watts=aw))
        t_time += elapsed
        t_dist += seg["distance"]

    cd = extra_dist or random.uniform(5000, 15000)
    ct = extra_time or int(cd / random.uniform(6, 9))
    elev = extra_elev or sum(seg_by_id(e["segment"]["id"])["elevation_high"] -
                              seg_by_id(e["segment"]["id"])["elevation_low"]
                              for e in efforts)
    act = {
        "id": aid, "name": name or random.choice(RIDE_NAMES), "sport_type": "Ride",
        "start_date": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_date_local": dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "distance": round(t_dist + cd, 1),
        "moving_time": t_time + ct,
        "elapsed_time": t_time + ct + random.randint(60, 600),
        "total_elevation_gain": round(elev * random.uniform(0.95, 1.05), 1),
        "average_speed": round((t_dist + cd) / (t_time + ct), 2),
        "max_speed": round((t_dist + cd) / (t_time + ct) * 1.5, 2),
        "has_efforts": True, "segment_efforts": efforts,
    }
    if device_watts:
        act["device_watts"] = True
        act["average_watts"] = avg_watts or int(sum(
            e.get("average_watts", 0) for e in efforts if e.get("average_watts")
        ) / max(1, sum(1 for e in efforts if e.get("average_watts"))))
    return act, aid


# ── Mock Data Generator ──────────────────────────────────────────────

def generate_mock_data(seed=42):
    """Generate mock data with random history + deterministic scenarios."""
    random.seed(seed)
    activities = []
    seg_efforts = {s["id"]: [] for s in SEGMENTS}

    # ─── Phase 1: Random history (2021–2026 Feb) ─────────────────
    # Provides depth for medians, quartiles, YTD comparisons.
    # Now includes power data on ~60% of rides.

    for year in range(2021, 2027):
        for month in range(1, 13):
            if year == 2026 and month > 2:  # stop at Feb 2026 — March is scenarios
                break
            n_rides = sum(1 for _ in range(15) if random.random() < seasonal_prob(month))
            n_runs = random.randint(0, 3) if 4 <= month <= 10 else random.randint(0, 1)
            days = sorted(random.sample(range(1, 29), min(n_rides + n_runs, 27)))

            for i, day in enumerate(days):
                aid = next_aid()
                is_run = i >= n_rides
                dt = datetime(year, month, min(day, 28),
                              random.choice([6,7,8,9,10,11,12,14,16,17]),
                              random.randint(0, 59))
                if is_run:
                    dist = random.uniform(3000, 15000)
                    mv = int(dist/1000 * random.uniform(4.5, 6.5) * 60)
                    activities.append({
                        "id": aid, "name": random.choice(RUN_NAMES), "sport_type": "Run",
                        "start_date": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "start_date_local": dt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "distance": round(dist, 1), "moving_time": mv,
                        "elapsed_time": mv + random.randint(0, 300),
                        "total_elevation_gain": round(random.uniform(10, 120), 1),
                        "average_speed": round(dist/mv, 2),
                        "max_speed": round(dist/mv*1.4, 2),
                        "has_efforts": True, "segment_efforts": [],
                    })
                    continue

                route = ROUTES[random.choice(list(ROUTES.keys()))]
                day_rng = random.random()
                has_power = random.random() < 0.6
                effort_tuples = []

                for sid in route:
                    seg = seg_by_id(sid)
                    fit = fitness_curve(year, month)
                    elapsed = max(int(seg["base_time"] * fit * (1 + day_rng*0.16 - 0.08)),
                                  int(seg["base_time"] * 0.8))
                    watts = int(180 + random.uniform(-40, 60)) if has_power else None
                    effort_tuples.append((seg, elapsed, has_power, watts))

                act, _ = make_ride(dt, effort_tuples, seg_efforts,
                                   device_watts=has_power,
                                   avg_watts=int(190 + random.uniform(-20, 30)) if has_power else None)
                activities.append(act)

    # ─── Phase 2: Deterministic scenario activities ───────────────
    # Placed in 2026 March to appear in recent 20 dashboard view.
    # Each scenario guarantees one or more specific award types.

    print("  Building deterministic scenarios...")

    # Helper refs
    seg_a = seg_by_id(200001)  # Anniversary Lane
    seg_b = seg_by_id(200002)  # Metronome Mile
    seg_c = seg_by_id(200003)  # Streak Hill
    seg_d = seg_by_id(200004)  # Slump & Rally Rd
    seg_g = seg_by_id(200005)  # Recovery Ridge

    # --- Scenario A: Anniversary (200001) ---
    # Efforts on March 8 in 2023, 2024, 2025 → 2026 March 8 triggers anniversary
    for yr in [2023, 2024, 2025]:
        dt = datetime(yr, 3, 8, 9, 0)
        elapsed = 185 + (2025 - yr) * 5
        act, _ = make_ride(dt, [(seg_a, elapsed)], seg_efforts,
                           name="Anniversary Baseline")
        activities.append(act)

    # Also add 6 more efforts on Anniversary Lane (various months) to reach 10 total
    # = milestone trigger at effort #10
    for i in range(6):
        dt = datetime(2025, 4 + i, 20, 11, 0)
        elapsed = 185 + random.randint(-5, 10)
        act, _ = make_ride(dt, [(seg_a, elapsed)], seg_efforts,
                           name="Milestone Builder")
        activities.append(act)

    # --- Scenario B: Consistency / Metronome (200002) ---
    # 5 efforts with nearly identical times (CV ≈ 0.005)
    # Also establishes YTD baseline for power comparison
    for yr in [2024, 2025]:
        dt = datetime(yr, 2, 15, 9, 0)
        act, _ = make_ride(dt, [(seg_b, 210, True, 180 + (yr - 2024) * 5)],
                           seg_efforts, name="YTD Power Baseline",
                           device_watts=True, avg_watts=180 + (yr - 2024) * 5)
        activities.append(act)

    consistency_times = [200, 201, 199, 200, 202]
    for i, t in enumerate(consistency_times):
        dt = datetime(2026, 2, 10 + i * 3, 8, 0)
        act, _ = make_ride(dt, [(seg_b, t, True, 210)], seg_efforts,
                           name="Metronome Test", device_watts=True, avg_watts=210)
        activities.append(act)

    # --- Scenario C: Improvement Streak (200003) ---
    # 4 consecutive faster times
    streak_times = [170, 165, 158, 150]
    for i, t in enumerate(streak_times):
        dt = datetime(2026, 2, 5 + i * 7, 10, 0)
        act, _ = make_ride(dt, [(seg_c, t)], seg_efforts, name="Streak Test")
        activities.append(act)

    # --- Scenario D: Micro-Comeback (200004) ---
    # History establishing median, then slump, then beat median
    history_times = [220, 210, 230, 225, 215, 228]
    for i, t in enumerate(history_times):
        dt = datetime(2025, 6 + i, 15, 9, 0)
        act, _ = make_ride(dt, [(seg_d, t)], seg_efforts, name="Slump History")
        activities.append(act)
    # Slump: 3 sub-median efforts
    for i, t in enumerate([240, 245, 238]):
        dt = datetime(2026, 1, 5 + i * 10, 9, 0)
        act, _ = make_ride(dt, [(seg_d, t)], seg_efforts, name="Slump Ride")
        activities.append(act)

    # --- Scenario G: Recovery Ridge (200005) — Comeback mode awards ---
    # Pre-injury best: 380s
    pre_times = [420, 405, 395, 380, 390, 385, 400, 388]
    for i, t in enumerate(pre_times):
        dt = datetime(2024, 3 + i, 12, 9, 0)
        watts = int(250 * 380 / t)
        act, _ = make_ride(dt, [(seg_g, t, True, watts)], seg_efforts,
                           name="Pre-Injury Training",
                           extra_dist=20000, extra_time=3000, extra_elev=300,
                           device_watts=True, avg_watts=watts)
        activities.append(act)

    # Post-injury recovery progression
    recovery_data = [
        (datetime(2025, 11, 5, 10, 0),  520, 15000, 2500, 200),   # deep recovery
        (datetime(2025, 12, 10, 10, 0), 480, 16000, 2700, 220),
        (datetime(2026, 1, 15, 10, 0),  440, 18000, 2900, 250),
        (datetime(2026, 2, 12, 10, 0),  410, 19000, 3100, 270),   # transition zone
        (datetime(2026, 2, 28, 10, 0),  385, 21000, 3300, 290),
        (datetime(2026, 3, 7, 10, 0),   375, 24000, 3600, 310),   # recovered!
    ]
    for dt, t, dist, mv_time, elev in recovery_data:
        watts = int(250 * 380 / t)
        act, _ = make_ride(dt, [(seg_g, t, True, watts)], seg_efforts,
                           name="Recovery Ride",
                           extra_dist=dist, extra_time=mv_time, extra_elev=elev,
                           device_watts=True, avg_watts=watts)
        activities.append(act)

    # --- Scenario F: Closing In on PR (River Road 100001) ---
    rr_efforts = seg_efforts.get(100001, [])
    if rr_efforts:
        rr_best = min(e["elapsed_time"] for e in rr_efforts)
        closing_time = int(rr_best * 1.07)
        dt = datetime(2026, 3, 6, 8, 30)
        act, _ = make_ride(dt, [(seg_by_id(100001), closing_time, True, 225)],
                           seg_efforts, name="Almost PR Ride",
                           device_watts=True, avg_watts=225)
        activities.append(act)

    # --- Big Combo: March 8 2026 ---
    # Triggers: anniversary, micro-comeback, milestone, ride-level records
    # Include many segments for segment_count record
    dt_combo = datetime(2026, 3, 8, 8, 0)
    combo_tuples = [
        (seg_d, 208),                          # comeback (beats median after slump)
        (seg_a, 178, True, 230),               # anniversary + milestone (#10+)
        (seg_by_id(100001), int(seg_by_id(100001)["base_time"] * 0.91), True, 220),
        (seg_by_id(100002), int(seg_by_id(100002)["base_time"] * 0.90), True, 215),
        (seg_by_id(100003), int(seg_by_id(100003)["base_time"] * 0.92), True, 218),
        (seg_by_id(100004), int(seg_by_id(100004)["base_time"] * 0.91)),
        (seg_by_id(100005), int(seg_by_id(100005)["base_time"] * 0.89), True, 235),
        (seg_by_id(100007), int(seg_by_id(100007)["base_time"] * 0.90)),
    ]
    act_combo, _ = make_ride(dt_combo, combo_tuples, seg_efforts,
                              name="Big Comeback Ride",
                              extra_dist=50000,    # longest distance → distance_record
                              extra_time=7200,     # longest time → endurance_record
                              extra_elev=1200,     # most climbing → elevation_record
                              device_watts=True, avg_watts=220)
    activities.append(act_combo)

    # ─── Phase 3: Build segment store + PR ranks ─────────────────

    segments = []
    for seg in SEGMENTS:
        effs = seg_efforts[seg["id"]]
        if not effs:
            continue
        sorted_e = sorted(effs, key=lambda e: e["start_date_local"])
        best = float('inf')
        for e in sorted_e:
            if e["elapsed_time"] < best:
                best = e["elapsed_time"]
                e["pr_rank"] = 1
                for a in activities:
                    for ae in a.get("segment_efforts", []):
                        if ae["id"] == e.get("effort_id", e.get("id")):
                            ae["pr_rank"] = 1
        segments.append({
            "id": seg["id"], "name": seg["name"], "distance": seg["distance"],
            "average_grade": seg["average_grade"], "elevation_high": seg["elevation_high"],
            "elevation_low": seg["elevation_low"], "climb_category": seg["climb_category"],
            "efforts": effs,
        })

    activities.sort(key=lambda a: a["start_date_local"], reverse=True)

    rides = sum(1 for a in activities if a["sport_type"] == "Ride")
    powered = sum(1 for a in activities if a.get("device_watts"))
    total_efforts = sum(len(s["efforts"]) for s in segments)
    print(f"  {len(activities)} activities ({rides} rides, {powered} with power)")
    print(f"  {len(segments)} segments, {total_efforts} efforts")

    return activities, segments


# ── Reset Event (Comeback Mode) ──────────────────────────────────────

RESET_EVENT = {
    "name": "Knee surgery",
    "date": "2025-09-01",
    "sport_types": None,
    "milestones": {},
}


# ── Server ────────────────────────────────────────────────────────────

class QHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, directory=None, **kw):
        super().__init__(*a, directory=directory, **kw)
    def log_message(self, *a): pass
    def guess_type(self, path):
        if path.endswith('.js'): return 'application/javascript'
        if path.endswith('.json'): return 'application/json'
        return super().guess_type(path)

def start_server(directory, port=8765):
    handler = functools.partial(QHandler, directory=directory)
    for p in range(port, port+10):
        try:
            srv = HTTPServer(("127.0.0.1", p), handler)
            srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return srv, p
        except OSError:
            continue
    raise RuntimeError("No port available")


# ── CDN Interception ──────────────────────────────────────────────────

def setup_cdn_routes(page, vendor_dir):
    """Intercept CDN to serve local vendor bundles."""
    vendor = Path(vendor_dir)
    tw_css = (vendor / "tailwind.css").read_bytes()
    tw_inject = (b"(function(){var s=document.createElement('style');"
                 b"s.textContent=" + json.dumps(tw_css.decode()).encode() + b";"
                 b"document.head.appendChild(s);})()")
    preact_js = (vendor / "preact.mjs").read_bytes()
    hooks_js = (vendor / "preact-hooks.mjs").read_bytes()
    signals_js = (vendor / "preact-signals.mjs").read_bytes()
    htm_js = (vendor / "htm-preact.mjs").read_bytes()

    def handle(route):
        url = route.request.url
        if "cdn.tailwindcss.com" in url:
            route.fulfill(status=200, content_type="application/javascript", body=tw_inject)
        elif "esm.sh/preact@" in url and "/hooks" in url:
            route.fulfill(status=200, content_type="application/javascript", body=hooks_js)
        elif "esm.sh/preact@" in url:
            route.fulfill(status=200, content_type="application/javascript", body=preact_js)
        elif "esm.sh/@preact/signals" in url:
            route.fulfill(status=200, content_type="application/javascript", body=signals_js)
        elif "esm.sh/htm@" in url:
            route.fulfill(status=200, content_type="application/javascript", body=htm_js)
        else:
            route.fulfill(status=200, content_type="application/javascript", body=b"")

    page.route(lambda url: "esm.sh" in url or "cdn.tailwindcss.com" in url, handle)

def stub_cdn(page):
    """Stub all CDN to empty."""
    page.route(lambda url: "esm.sh" in url or "cdn.tailwindcss.com" in url,
               lambda route: route.fulfill(status=200, content_type="application/javascript", body=b""))


# ── Injection ─────────────────────────────────────────────────────────

INJECT_JS = """(async () => {
    const resp = await fetch("/test/mock-data.json");
    const data = await resp.json();
    const DB = "participation-awards";
    await new Promise(r => { const q = indexedDB.deleteDatabase(DB); q.onsuccess = r; q.onerror = r; });
    const db = await new Promise((res, rej) => {
        const q = indexedDB.open(DB, 1);
        q.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains("auth")) d.createObjectStore("auth");
            if (!d.objectStoreNames.contains("activities")) {
                const s = d.createObjectStore("activities", { keyPath: "id" });
                s.createIndex("start_date_local", "start_date_local");
                s.createIndex("sport_type", "sport_type");
            }
            if (!d.objectStoreNames.contains("segments")) {
                const s = d.createObjectStore("segments", { keyPath: "id" });
                s.createIndex("name", "name");
            }
            if (!d.objectStoreNames.contains("sync_state")) d.createObjectStore("sync_state");
        };
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
    });
    const put = (store, items) => new Promise((res, rej) => {
        const tx = db.transaction(store, "readwrite");
        const s = tx.objectStore(store);
        for (const i of items) s.put(i);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
    const putK = (store, val, key) => new Promise((res, rej) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
    await putK("auth", data.auth, "session");
    for (let i = 0; i < data.activities.length; i += 50)
        await put("activities", data.activities.slice(i, i+50));
    await put("segments", data.segments);
    await putK("sync_state", data.sync_state, "state");
    if (data.reset_event) {
        await putK("sync_state", data.reset_event, "reset_event");
    }
    if (data.preferences) {
        await putK("sync_state", data.preferences, "preferences");
    }
    db.close();
    return { activities: data.activities.length, segments: data.segments.length,
             reset_event: !!data.reset_event };
})()"""


# ── Awards Audit ──────────────────────────────────────────────────────

AUDIT_JS = """(async () => {
    const { computeAwardsForActivities } = await import("/src/awards.js");
    const { getAllActivities } = await import("/src/db.js");

    const activities = await getAllActivities();
    activities.sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

    // Scan recent 40 activities to catch scenario activities
    const recent = activities.filter(a => a.has_efforts).slice(0, 40);
    const awardsMap = await computeAwardsForActivities(recent);

    const typeCounts = {};
    const typeExamples = {};
    let totalAwards = 0;

    for (const [actId, awards] of awardsMap) {
        for (const award of awards) {
            totalAwards++;
            typeCounts[award.type] = (typeCounts[award.type] || 0) + 1;
            if (!typeExamples[award.type]) {
                typeExamples[award.type] = award.message;
            }
        }
    }

    const ALL_TYPES = [
        "year_best", "season_first", "recent_best", "beat_median",
        "top_quartile", "top_decile", "consistency", "monthly_best",
        "improvement_streak", "comeback", "milestone",
        "best_month_ever", "closing_in", "anniversary",
        "ytd_best_time", "ytd_best_power",
        "comeback_pb", "recovery_milestone", "comeback_full",
        "distance_record", "elevation_record", "segment_count",
        "endurance_record",
        "comeback_distance", "comeback_elevation", "comeback_endurance",
    ];

    const found = Object.keys(typeCounts);
    const missing = ALL_TYPES.filter(t => !found.includes(t));

    return {
        totalAwards,
        activitiesWithAwards: awardsMap.size,
        activitiesScanned: recent.length,
        typeCounts,
        typeExamples,
        found,
        missing,
        coverage: found.length + "/" + ALL_TYPES.length,
    };
})()"""


# ── Harness ───────────────────────────────────────────────────────────

def run_harness(screen="all", output_dir=None, audit_only=False):
    from playwright.sync_api import sync_playwright

    app_dir = str(Path(__file__).parent.parent)
    vendor_dir = str(Path(__file__).parent / "vendor")
    if output_dir is None:
        output_dir = os.path.join(app_dir, "test", "screenshots")
    os.makedirs(output_dir, exist_ok=True)

    # Generate data
    print("Generating mock data...")
    activities, segments = generate_mock_data()
    auth = {
        "access_token": "mock", "refresh_token": "mock",
        "expires_at": int(time.time()) + 86400,
        "athlete": {"id": 12345678, "firstname": "Test", "lastname": "Rider", "profile": ""},
    }
    sync_state = {
        "last_activity_fetch": activities[0]["start_date"],
        "backfill_complete": True,
        "backfill_page": 1,
        "total_activities": len(activities),
        "fetched_activities": len(activities),
        "detailed_activities": len(activities),
        "last_sync": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    mock_base = {"auth": auth, "activities": activities, "segments": segments,
                 "sync_state": sync_state, "preferences": {"units": "imperial"}}

    mock_path = os.path.join(app_dir, "test", "mock-data.json")
    size_kb = len(json.dumps(mock_base)) / 1024
    print(f"  Mock data: {size_kb:.0f}KB")

    server, port = start_server(app_dir)
    base = f"http://127.0.0.1:{port}"
    print(f"  Server: {base}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        def make_page(ctx_opts, comeback=False):
            """Create context + page with CDN interception + data injected."""
            data = {**mock_base}
            if comeback:
                data["reset_event"] = RESET_EVENT
            else:
                data["reset_event"] = None
            with open(mock_path, "w") as f:
                json.dump(data, f)
            ctx = browser.new_context(**ctx_opts)
            pg = ctx.new_page()
            setup_cdn_routes(pg, vendor_dir)
            pg.goto(f"{base}/test/inject.html", wait_until="load")
            pg.wait_for_timeout(200)
            result = pg.evaluate(INJECT_JS)
            mode = "comeback" if comeback else "normal"
            print(f"  Injected ({mode}): {result}")
            return ctx, pg

        mobile = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2}
        desktop = {"viewport": {"width": 1280, "height": 800}, "device_scale_factor": 1}

        # ── Awards Audit (always runs) ────────────────────────────

        def run_audit(label, comeback=False):
            print(f"\n── Awards Audit ({label}) ──")
            ctx, pg = make_page(mobile, comeback=comeback)
            pg.goto(base, wait_until="load")
            pg.wait_for_timeout(4000)
            try:
                audit = pg.evaluate(AUDIT_JS)
                print(f"  Coverage: {audit['coverage']}")
                print(f"  Total awards: {audit['totalAwards']} across "
                      f"{audit['activitiesWithAwards']} activities "
                      f"({audit['activitiesScanned']} scanned)")
                for t in sorted(audit['found']):
                    n = audit['typeCounts'].get(t, 0)
                    ex = audit['typeExamples'].get(t, '')[:80]
                    print(f"    \u2713 {t}: {n}x \u2014 {ex}")
                if audit['missing']:
                    comeback_types = {"comeback_pb", "recovery_milestone", "comeback_full",
                                      "comeback_distance", "comeback_elevation", "comeback_endurance"}
                    for t in audit['missing']:
                        tag = " (comeback-only)" if t in comeback_types else ""
                        suppressed = not comeback and t in comeback_types
                        if suppressed:
                            print(f"    - {t}: expected absent{tag}")
                        else:
                            print(f"    \u2717 {t}: MISSING{tag}")
                else:
                    print("  ALL TYPES COVERED!")
                ctx.close()
                return audit
            except Exception as e:
                print(f"  Audit error: {e}")
                ctx.close()
                return None

        audit_normal = run_audit("normal mode", comeback=False)
        audit_comeback = run_audit("comeback mode", comeback=True)

        if audit_only:
            browser.close()
            server.shutdown()
            # Return coverage summary
            return {
                "normal": audit_normal,
                "comeback": audit_comeback,
            }

        # ── Screenshots ───────────────────────────────────────────

        print("\n── Screenshots ──")

        # 01 Landing (no auth)
        if screen in ("all", "landing"):
            ctx = browser.new_context(**mobile)
            pg = ctx.new_page()
            setup_cdn_routes(pg, vendor_dir)
            pg.goto(base, wait_until="load")
            pg.wait_for_timeout(2000)
            pg.screenshot(path=f"{output_dir}/01-landing.png", full_page=True)
            print("  01-landing.png")
            ctx.close()

        # 02 Dashboard (normal)
        if screen in ("all", "dashboard"):
            ctx, pg = make_page(mobile, comeback=False)
            pg.goto(base, wait_until="load")
            pg.wait_for_selector("button.w-full", timeout=15000)
            pg.wait_for_timeout(500)
            pg.screenshot(path=f"{output_dir}/02-dashboard.png", full_page=True)
            print("  02-dashboard.png")

            # 03 Activity detail
            if screen in ("all", "detail"):
                buttons = pg.query_selector_all("button.w-full")
                if buttons:
                    buttons[0].click()
                    pg.wait_for_timeout(2000)
                    pg.screenshot(path=f"{output_dir}/03-activity-detail.png", full_page=True)
                    print("  03-activity-detail.png")
            ctx.close()

        # 04 Comeback dashboard
        if screen in ("all", "comeback"):
            ctx, pg = make_page(mobile, comeback=True)
            pg.goto(base, wait_until="load")
            pg.wait_for_selector("button.w-full", timeout=15000)
            pg.wait_for_timeout(500)
            pg.screenshot(path=f"{output_dir}/04-comeback-dashboard.png", full_page=True)
            print("  04-comeback-dashboard.png")

            # 05 Comeback detail
            buttons = pg.query_selector_all("button.w-full")
            if buttons:
                buttons[0].click()
                pg.wait_for_timeout(2000)
                pg.screenshot(path=f"{output_dir}/05-comeback-detail.png", full_page=True)
                print("  05-comeback-detail.png")
            ctx.close()

        # 06 Desktop normal
        if screen in ("all", "desktop"):
            ctx, pg = make_page(desktop, comeback=False)
            pg.goto(base, wait_until="load")
            pg.wait_for_selector("button.w-full", timeout=15000)
            pg.wait_for_timeout(500)
            pg.screenshot(path=f"{output_dir}/06-desktop-dashboard.png", full_page=True)
            print("  06-desktop-dashboard.png")
            ctx.close()

        # 07 Desktop comeback
        if screen in ("all", "desktop-comeback"):
            ctx, pg = make_page(desktop, comeback=True)
            pg.goto(base, wait_until="load")
            pg.wait_for_selector("button.w-full", timeout=15000)
            pg.wait_for_timeout(500)
            pg.screenshot(path=f"{output_dir}/07-desktop-comeback.png", full_page=True)
            print("  07-desktop-comeback.png")
            ctx.close()

        browser.close()
    server.shutdown()
    print(f"\nDone! Screenshots in {output_dir}/")
    return output_dir


if __name__ == "__main__":
    screen = "all"
    audit_only = False
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--screen" and i < len(sys.argv) - 1:
            screen = sys.argv[i + 1]
        elif arg == "--audit-only":
            audit_only = True
        elif arg in ("landing", "dashboard", "detail", "comeback",
                     "desktop", "desktop-comeback"):
            screen = arg
    run_harness(screen=screen, audit_only=audit_only)
