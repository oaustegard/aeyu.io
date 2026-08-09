#!/usr/bin/env python3
"""Extract Cappuccino DPS raw features for one or more Strava activity ids.

Self-contained: needs only STRAVA_ACCESS_TOKEN in the environment and numpy.

    STRAVA_ACCESS_TOKEN=... python3 cappuccino_gather.py 19572154597

Emits the raw feature dicts consumed by cappuccino-dps.json. The scoring window
is located GEOGRAPHICALLY (nearest latlng to the two anchors below), not by
segment-effort name -- no Strava segment covers exactly this window, and the
name-based lookup documented earlier never matched.

spd_* are derived from the distance stream; the target is scored on cruise speed
speed is derived in cappuccino_dps.py from seg index count, not from these.
"""
import os, sys, json, urllib.request
import numpy as np

API = "https://www.strava.com/api/v3"
TOKEN = os.environ.get("STRAVA_ACCESS_TOKEN", "")


def _get(path, params=""):
    tok = TOKEN
    req = urllib.request.Request(f"{API}{path}{params}",
                                 headers={"Authorization": f"Bearer {tok}"})
    return json.loads(urllib.request.urlopen(req).read())


# geographic anchors, taken from the calibration ride 19012090607 seg [2692,3677]
START_LL = (38.95907, -77.131226)   # MacArthur @ Walhonding
END_LL   = (38.981609, -77.224946)  # base of Anglers climb


def _nearest(ll, target, lo=0, hi=None):
    a = np.array(ll[lo:hi], dtype=float)
    d = (a[:, 0] - target[0]) ** 2 + ((a[:, 1] - target[1]) * 0.78) ** 2
    i = int(np.argmin(d))
    return lo + i, float(np.sqrt(d[i])) * 111000  # metres, approx


def _stop_runs(spd, thresh=3.0, min_len=3):
    """Contiguous runs of >=min_len samples below `thresh` mph."""
    slow = spd < thresh
    runs, i, n = [], 0, len(spd)
    while i < n:
        if slow[i]:
            j = i
            while j < n and slow[j]:
                j += 1
            if j - i >= min_len:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _surges(w, win=20, mult=1.6):
    """Maximal runs where the `win`-second rolling mean exceeds mult x mean."""
    if len(w) <= win or np.mean(w) <= 0:
        return 0, []
    roll = np.convolve(w, np.ones(win) / win, mode="valid") > mult * np.mean(w)
    spans, i = [], 0
    while i < len(roll):
        if roll[i]:
            j = i
            while j < len(roll) and roll[j]:
                j += 1
            spans.append((i, j + win - 1))
            i = j
        else:
            i += 1
    return len(spans), spans


def feats(aid):
    d = _get(f"/activities/{aid}")
    st = _get(f"/activities/{aid}/streams",
              "?keys=watts,cadence,distance,time,latlng,velocity_smooth&key_by_type=true")
    ll = st["latlng"]["data"]
    s, ds_err = _nearest(ll, START_LL)
    e, de_err = _nearest(ll, END_LL, lo=s + 60)
    def arr(k):
        return np.array(st[k]["data"], dtype=float) if k in st else None
    t = arr("time"); dist = arr("distance")
    w = arr("watts"); cad = arr("cadence")

    tt = t[s:e + 1]
    dd = dist[s:e + 1]
    dur = float(tt[-1] - tt[0])
    dist_mi = float(dd[-1] - dd[0]) / 1609.34

    # Speed from the DISTANCE stream, not velocity_smooth: velocity_smooth is
    # unreliable in absolute terms (one ride reads 17.8 mph mean against a
    # distance-derived 21.2). 5 s box smooth to kill GPS jitter.
    _d = arr("distance")[s:e + 1]
    _t = arr("time")[s:e + 1].astype(float)
    spd = np.zeros(len(_d))
    spd[1:] = np.where(np.diff(_t) > 0,
                       np.diff(_d) / np.maximum(np.diff(_t), 1e-9), 0.0) * 2.23694
    spd[0] = spd[1]
    spd = np.convolve(spd, np.ones(5) / 5, mode="same")

    # Stop events (<3 mph for >=3 s) plus their decel/accel ramps. MacArthur has
    # 4+ stoplights; catching a red is not the same thing as a slow rotation.
    stops = _stop_runs(spd)
    roll = np.ones(len(spd), dtype=bool)
    for a, b in stops:
        roll[max(0, a - 15):min(len(spd), b + 25)] = False
    roll &= spd >= 3.0
    dd = np.zeros(len(_d)); dd[1:] = np.diff(_d)
    dt = np.zeros(len(_t)); dt[1:] = np.diff(_t)

    r = {
        "id": int(aid), "name": d.get("name"),
        "date": d.get("start_date_local", "")[:10],
        "seg": [int(s), int(e)],
        "dist_mi": round(dist_mi, 1),
        "dur_s": round(dur, 1),
        "_anchor_err_m": [round(ds_err), round(de_err)],
        "spd_mean": round(float(np.mean(spd)), 1),
        "spd_cv": round(float(np.std(spd) / np.mean(spd)), 3),
        "stops_n": len(stops),
        "stop_s": int(sum(b - a for a, b in stops)),
        # CRUISE speed drives the 20-22 target; the elapsed average conflates a
        # slow rotation with a red light (they correlate only r=0.75).
        "cruise_mph": round(float((dd[roll].sum() / 1609.34) / (dt[roll].sum() / 3600)), 2),
        # Accordion uses a ROBUST spread on the UNMASKED trace. p90-p10 is badly
        # stop-contaminated, but masking a dispersion measure deletes the
        # highest-variance seconds for free -- measured at +5.8 Q per red light.
        # p75-p25 is 5.5x less stop-sensitive and cannot be gamed.
        "spd_accordion": round(float((np.percentile(spd, 75) - np.percentile(spd, 25))
                                     / np.median(spd)), 3),
    }

    has_pwr = bool(d.get("device_watts")) and w is not None
    r["has_pwr"] = has_pwr
    if w is not None:
        ws = w[s:e + 1]
        # forced surges: runs of >=20s whose rolling mean exceeds 1.6x the
        # segment mean. Relative, not a fixed 300W cut -- an absolute cut just
        # measures how strong the day was (r=0.18 against this across 29 rides).
        # IND is then computed with these windows MASKED OUT, so chop the group
        # forced belongs to ROT and only your own residual chop lands on IND.
        n_s, spans = _surges(ws)
        r["surge_n"] = n_s
        keep = np.ones(len(ws), dtype=bool)
        for a, b in spans:
            keep[a:min(b, len(ws))] = False
        r["surge_time_pct"] = round(float(100 * (1 - keep.mean())), 1)
        if keep.sum() > 60:
            wm = ws[keep]
            r["p_cv_m"] = round(float(np.std(wm) / np.mean(wm)), 3)
            r["p_jerk_m"] = round(float(np.mean(np.abs(np.diff(wm)) > 50) * 100), 1)
            r["p_coast_m"] = round(float(np.mean(wm < 5) * 100), 1)
        r["p_mean"] = round(float(np.mean(ws)), 1)
        r["p_cv"] = round(float(np.std(ws) / np.mean(ws)), 3)
        r["p_jerk_pct"] = round(float(np.mean(np.abs(np.diff(ws)) > 50) * 100), 1)
        r["p_coast_pct"] = round(float(np.mean(ws < 5) * 100), 1)
        r["p_floor_p25"] = round(float(np.percentile(ws, 25)), 1)
        roll = np.convolve(ws, np.ones(30) / 30, mode="valid")
        np_ = float(np.mean(roll ** 4) ** 0.25)
        r["p_vi"] = round(np_ / float(np.mean(ws)), 3)
    if cad is not None:
        cs = cad[s:e + 1]
        r["cad_mean"] = round(float(np.mean(cs)), 1)
        r["cad_cv"] = round(float(np.std(cs) / np.mean(cs)), 3)
        r["cad_jerk_pct"] = round(float(np.mean(np.abs(np.diff(cs)) > 10) * 100), 1)
        r["cad_freewheel_pct"] = round(float(np.mean(cs < 5) * 100), 1)
        ped = cs[cs > 0]
        r["cad_pedaling_cv"] = round(float(np.std(ped) / np.mean(ped)), 3)
    return r


if __name__ == "__main__":
    out = [feats(int(a)) for a in sys.argv[1:]]
    print(json.dumps(out, indent=1))
