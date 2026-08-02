#!/usr/bin/env python3
"""Extract Cappuccino DPS raw features for one or more Strava activity ids.

Self-contained: needs only STRAVA_ACCESS_TOKEN in the environment and numpy.

    STRAVA_ACCESS_TOKEN=... python3 cappuccino_gather.py 19572154597

Emits the raw feature dicts consumed by cappuccino-dps.json. The scoring window
is located GEOGRAPHICALLY (nearest latlng to the two anchors below), not by
segment-effort name -- no Strava segment covers exactly this window, and the
name-based lookup documented earlier never matched.

spd_* come from velocity_smooth; dist_mi from the distance stream. True average
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

    # speed from velocity_smooth (matches the calibrated feature set), mph
    spd = arr("velocity_smooth")[s:e + 1] * 2.23694

    r = {
        "id": int(aid), "name": d.get("name"),
        "date": d.get("start_date_local", "")[:10],
        "seg": [int(s), int(e)],
        "dist_mi": round(dist_mi, 1),
        "dur_s": round(dur, 1),
        "_anchor_err_m": [round(ds_err), round(de_err)],
        "spd_mean": round(float(np.mean(spd)), 1),
        "spd_cv": round(float(np.std(spd) / np.mean(spd)), 3),
        "spd_accordion": round(float((np.percentile(spd, 90) - np.percentile(spd, 10))
                                     / np.median(spd)), 3),
    }

    has_pwr = bool(d.get("device_watts")) and w is not None
    r["has_pwr"] = has_pwr
    if w is not None:
        ws = w[s:e + 1]
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
