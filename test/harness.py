#!/usr/bin/env python3
"""
aeyu.io Test Harness

Generates realistic Strava mock data, serves the app locally,
injects data into IndexedDB via Playwright, and provides screenshots.

Usage:
    python3 test/harness.py                    # Screenshot all screens
    python3 test/harness.py --screen landing   # Specific screen
    python3 test/harness.py --screen dashboard
"""

import json, math, os, random, sys, socket, threading, time, functools
from datetime import datetime, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/opt/pw-browsers'

# ── Mock Data ─────────────────────────────────────────────────────────

SEGMENTS = [
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


def seasonal_prob(month):
    return {1:.05,2:.05,3:.15,4:.45,5:.7,6:.85,7:.9,8:.9,9:.8,10:.5,11:.2,12:.08}[month]

def fitness_curve(year, month):
    yf = max(1.0 - (year - 2020) * 0.015, 0.90)
    sf = {1:1.15,2:1.12,3:1.08,4:1.02,5:.97,6:.94,7:.92,8:.93,9:.95,10:1.0,11:1.05,12:1.10}[month]
    return yf * sf

def generate_mock_data(seed=42):
    random.seed(seed)
    activities, seg_efforts = [], {s["id"]: [] for s in SEGMENTS}
    eid, aid = 500000, 10000000

    for year in range(2021, 2027):
        for month in range(1, 13):
            if year == 2026 and month > 3: break
            n_rides = sum(1 for _ in range(15) if random.random() < seasonal_prob(month))
            n_runs = random.randint(0, 3) if 4 <= month <= 10 else random.randint(0, 1)
            days = sorted(random.sample(range(1, 29), min(n_rides + n_runs, 27)))

            for i, day in enumerate(days):
                aid += 1
                is_run = i >= n_rides
                dt = datetime(year, month, min(day, 28),
                              random.choice([6,7,8,9,10,11,12,14,16,17]), random.randint(0,59))
                if is_run:
                    dist = random.uniform(3000, 15000)
                    mv = int(dist/1000 * random.uniform(4.5,6.5) * 60)
                    activities.append({"id":aid, "name":random.choice(RUN_NAMES), "sport_type":"Run",
                        "start_date":dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "start_date_local":dt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "distance":round(dist,1), "moving_time":mv, "elapsed_time":mv+random.randint(0,300),
                        "total_elevation_gain":round(random.uniform(10,120),1),
                        "average_speed":round(dist/mv,2), "max_speed":round(dist/mv*1.4,2),
                        "has_efforts":True, "segment_efforts":[]})
                    continue

                route = ROUTES[random.choice(list(ROUTES.keys()))]
                day_rng = random.random()
                efforts, t_time, t_dist = [], 0, 0

                for sid in route:
                    seg = next(s for s in SEGMENTS if s["id"] == sid)
                    eid += 1
                    fit = fitness_curve(year, month)
                    elapsed = max(int(seg["base_time"] * fit * (1 + day_rng*0.16 - 0.08)),
                                  int(seg["base_time"] * 0.8))
                    moving = max(elapsed - random.randint(0,15), int(elapsed*0.9))
                    edt = dt + timedelta(seconds=t_time + random.randint(120,600))

                    effort = {"id":eid, "name":seg["name"],
                        "segment":{"id":seg["id"],"name":seg["name"],"distance":seg["distance"],
                            "average_grade":seg["average_grade"],"elevation_high":seg["elevation_high"],
                            "elevation_low":seg["elevation_low"],"climb_category":seg["climb_category"]},
                        "elapsed_time":elapsed, "moving_time":moving,
                        "start_date":edt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "start_date_local":edt.strftime("%Y-%m-%dT%H:%M:%S"),
                        "pr_rank":None, "achievements":[]}
                    efforts.append(effort)
                    t_time += elapsed; t_dist += seg["distance"]
                    seg_efforts[sid].append({"effort_id":eid,"activity_id":aid,
                        "elapsed_time":elapsed,"moving_time":moving,
                        "start_date":edt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "start_date_local":edt.strftime("%Y-%m-%dT%H:%M:%S"),"pr_rank":None})

                cd = random.uniform(5000,25000); ct = int(cd/random.uniform(6,9))
                elev = sum(next(s for s in SEGMENTS if s["id"]==sid)["elevation_high"] -
                           next(s for s in SEGMENTS if s["id"]==sid)["elevation_low"] for sid in route)
                activities.append({"id":aid, "name":random.choice(RIDE_NAMES), "sport_type":"Ride",
                    "start_date":dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "start_date_local":dt.strftime("%Y-%m-%dT%H:%M:%S"),
                    "distance":round(t_dist+cd,1), "moving_time":t_time+ct,
                    "elapsed_time":t_time+ct+random.randint(60,1200),
                    "total_elevation_gain":round(elev*random.uniform(0.9,1.1),1),
                    "average_speed":round((t_dist+cd)/(t_time+ct),2),
                    "max_speed":round((t_dist+cd)/(t_time+ct)*1.6,2),
                    "has_efforts":True, "segment_efforts":efforts})

    # PR ranks
    segments = []
    for seg in SEGMENTS:
        effs = seg_efforts[seg["id"]]
        if not effs: continue
        sorted_e = sorted(effs, key=lambda e: e["start_date_local"])
        best = float('inf')
        for e in sorted_e:
            if e["elapsed_time"] < best:
                best = e["elapsed_time"]; e["pr_rank"] = 1
                for a in activities:
                    for ae in a.get("segment_efforts",[]):
                        if ae["id"] == e["effort_id"]: ae["pr_rank"] = 1
        segments.append({"id":seg["id"],"name":seg["name"],"distance":seg["distance"],
            "average_grade":seg["average_grade"],"elevation_high":seg["elevation_high"],
            "elevation_low":seg["elevation_low"],"climb_category":seg["climb_category"],"efforts":effs})

    activities.sort(key=lambda a: a["start_date_local"], reverse=True)
    return activities, segments


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
        except OSError: continue
    raise RuntimeError("No port available")


# ── CDN Interception ──────────────────────────────────────────────────

def setup_cdn_routes(page, vendor_dir):
    """Intercept CDN → serve local vendor bundles."""
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
    """Stub all CDN → empty (for injection phase where app doesn't need to render)."""
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
    db.close();
    return { activities: data.activities.length, segments: data.segments.length };
})()"""


# ── Harness ───────────────────────────────────────────────────────────

def run_harness(screen="all", output_dir="/home/claude/aeyu.io/test/screenshots"):
    from playwright.sync_api import sync_playwright

    app_dir = str(Path(__file__).parent.parent)
    vendor_dir = str(Path(__file__).parent / "vendor")
    os.makedirs(output_dir, exist_ok=True)

    # Generate data
    print("Generating mock data...")
    activities, segments = generate_mock_data()
    auth = {"access_token":"mock","refresh_token":"mock","expires_at":int(time.time())+86400,
            "athlete":{"id":12345678,"firstname":"Test","lastname":"Rider","profile":""}}
    sync_state = {"last_activity_fetch":activities[0]["start_date"],"backfill_complete":True,
                  "backfill_page":1,"total_activities":len(activities),
                  "fetched_activities":len(activities),"detailed_activities":len(activities),
                  "last_sync":datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")}

    rides = sum(1 for a in activities if a["sport_type"]=="Ride")
    efforts = sum(len(s["efforts"]) for s in segments)
    print(f"  {len(activities)} activities ({rides} rides), {len(segments)} segments, {efforts} efforts")

    # Write mock data file (fetched by injection script)
    mock_path = os.path.join(app_dir, "test", "mock-data.json")
    with open(mock_path, "w") as f:
        json.dump({"auth":auth,"activities":activities,"segments":segments,"sync_state":sync_state}, f)
    print(f"  Mock data: {os.path.getsize(mock_path)/1024:.0f}KB")

    server, port = start_server(app_dir)
    base = f"http://127.0.0.1:{port}"
    print(f"  Server: {base}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        def make_page(ctx_opts):
            """Create context + page with CDN interception + data injected."""
            ctx = browser.new_context(**ctx_opts)
            pg = ctx.new_page()
            setup_cdn_routes(pg, vendor_dir)
            # Inject on blank page to avoid Preact interference
            pg.goto(f"{base}/test/inject.html", wait_until="load")
            pg.wait_for_timeout(200)
            pg.evaluate(INJECT_JS)
            return ctx, pg

        # === MOBILE (iPhone 14) ===
        mobile_opts = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2}

        # 01 Landing (no auth — fresh context)
        if screen in ("all", "landing"):
            ctx_l = browser.new_context(**mobile_opts)
            pg_l = ctx_l.new_page()
            setup_cdn_routes(pg_l, vendor_dir)
            pg_l.goto(base, wait_until="load")
            pg_l.wait_for_timeout(2000)
            pg_l.screenshot(path=f"{output_dir}/01-landing.png", full_page=True)
            print("  01-landing.png")
            ctx_l.close()

        # Create data-loaded mobile context
        ctx, pg = make_page(mobile_opts)

        # Navigate to dashboard once
        need_dashboard = screen in ("all", "dashboard", "detail")
        if need_dashboard:
            pg.goto(base, wait_until="load")
            pg.wait_for_selector("button.w-full", timeout=15000)
            pg.wait_for_timeout(500)

        # 02 Dashboard
        if screen in ("all", "dashboard"):
            pg.screenshot(path=f"{output_dir}/02-dashboard.png", full_page=True)
            print("  02-dashboard.png")

        # 03 Activity detail — click from already-loaded dashboard
        if screen in ("all", "detail"):
            buttons = pg.query_selector_all("button.w-full")
            if buttons:
                buttons[0].click()
                pg.wait_for_timeout(2000)
                pg.screenshot(path=f"{output_dir}/03-activity-detail.png", full_page=True)
                print("  03-activity-detail.png")

        # 04 Sync page
        if screen in ("all", "sync"):
            pg.goto(f"{base}/#sync", wait_until="load")
            pg.wait_for_timeout(2000)
            pg.screenshot(path=f"{output_dir}/04-sync-page.png", full_page=True)
            print("  04-sync-page.png")

        ctx.close()

        # === DESKTOP ===
        if screen in ("all", "desktop"):
            ctx_d, pg_d = make_page({"viewport": {"width": 1280, "height": 800}, "device_scale_factor": 1})
            pg_d.goto(base, wait_until="load")
            pg_d.wait_for_selector("button.w-full", timeout=15000)
            pg_d.wait_for_timeout(500)
            pg_d.screenshot(path=f"{output_dir}/05-desktop-dashboard.png", full_page=True)
            print("  05-desktop-dashboard.png")
            ctx_d.close()

        browser.close()
    server.shutdown()
    print(f"\nDone! Screenshots in {output_dir}/")
    return output_dir


if __name__ == "__main__":
    screen = "all"
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--screen" and i < len(sys.argv) - 1:
            screen = sys.argv[i + 1]
        elif arg in ("landing", "dashboard", "detail", "sync", "desktop"):
            screen = arg
    run_harness(screen=screen)
