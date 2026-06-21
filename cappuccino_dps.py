#!/usr/bin/env python3
"""
Cappuccino Double Paceline Quality — scorer + leaderboard renderer.

Two-number score per ride, computed over the MacArthur Blvd
"Walhonding -> base of Anglers" segment (the long flat run where a double
paceline either forms or doesn't):

  IND  (Individual)  — how steady YOUR own effort was. A clean rotating line
                       = a steady pull; a failed one = constant surge/coast on
                       the wheel. From power jerk/CV/coasting (real power meter)
                       or cadence jerk/CV/freewheel (cadence-only rides).
  ROT  (Rotation)    — how well the GROUP held a tight, on-target rotation.
                       A good double paceline is a smooth step-wave between a
                       ~21 slow line and ~22 fast line. ROT rewards a tight
                       speed band near that 21-22 target and penalises both
                       chaos (the accordion) and running too hot.
  Q    = (IND + ROT) / 2, the headline leaderboard number.

All scores are 0-100, relative to the population of logged Cappuccino rides
(percentile-calibrated). Higher = smoother / better-formed line.

Update procedure (run during a Cappuccino ride review):
  1. append the new ride's raw features to cappuccino-dps.json
  2. python cappuccino_dps.py cappuccino-dps.json cappuccino.html
  3. commit both straight to main
"""
import json, sys
import numpy as np

SEGMENT = "MacArthur Blvd — Walhonding to base of Anglers (~5.7 mi)"

# ---- scoring -----------------------------------------------------------------

def _norm_factory(key, pool):
    vals = np.array([r[key] for r in pool if r.get(key) is not None], dtype=float)
    lo, hi = np.percentile(vals, 5), np.percentile(vals, 95)
    return lambda x: None if x is None else float(np.clip((x - lo) / (hi - lo + 1e-9), 0, 1))

def _true_avg(r):
    s, e = r["seg"]
    return r["dist_mi"] / ((e - s) / 3600.0)

def _target_pen(v):
    # 20-22 mph free (the social rotation target); ramps outside, high side harsher
    if v > 22:  return min((v - 22) / 4.0, 1.0)        # 22->0, 26->1
    if v < 20:  return min((20 - v) / 4.0, 1.0) * 0.7  # crawl = off-target, lighter
    return 0.0

def score_rides(rows):
    rows = [r for r in rows if r.get("seg")]
    pw = [r for r in rows if r.get("has_pwr") and r.get("p_jerk_pct") is not None]
    npj, npcv, npco = (_norm_factory(k, pw) for k in ("p_jerk_pct", "p_cv", "p_coast_pct"))
    ncj, nccv, ncfw = (_norm_factory(k, rows) for k in ("cad_jerk_pct", "cad_cv", "cad_freewheel_pct"))
    nacc = _norm_factory("spd_accordion", rows)
    for r in rows:
        if r.get("has_pwr") and r.get("p_jerk_pct") is not None:
            ind = np.mean([npj(r["p_jerk_pct"]), npcv(r["p_cv"]), npco(r["p_coast_pct"])])
            r["src"] = "power"
        else:
            ind = np.mean([ncj(r["cad_jerk_pct"]), nccv(r["cad_cv"]), ncfw(r["cad_freewheel_pct"])])
            r["src"] = "cadence"
        ta = _true_avg(r)
        rot = 0.6 * nacc(r["spd_accordion"]) + 0.4 * _target_pen(ta)
        r["avg"] = round(ta, 1)
        r["IND"] = int(round(100 * (1 - ind)))
        r["ROT"] = int(round(100 * (1 - rot)))
        r["Q"]   = int(round((r["IND"] + r["ROT"]) / 2))
    rows.sort(key=lambda r: -r["Q"])
    return rows

# ---- rendering ---------------------------------------------------------------

MEDAL = {1: "\U0001F947", 2: "\U0001F948", 3: "\U0001F949"}

def _bar(v, color):
    return (f'<span class="bar"><span class="fill" style="width:{v}%;background:{color}"></span>'
            f'</span><span class="num">{v}</span>')

def render_html(rows, updated):
    best, worst = rows[0], rows[-1]
    body_rows = []
    for i, r in enumerate(rows, 1):
        medal = MEDAL.get(i, f'<span class="rk">{i}</span>')
        src_badge = ('<span class="badge pwr">power</span>' if r["src"] == "power"
                     else '<span class="badge cad">cadence</span>')
        name = (r.get("name", "") or "").replace("<", "&lt;").replace(">", "&gt;")
        body_rows.append(f"""<tr>
  <td class="c-rk">{medal}</td>
  <td class="c-q"><b>{r['Q']}</b></td>
  <td class="c-sub">{_bar(r['IND'], 'var(--steel)')}</td>
  <td class="c-sub">{_bar(r['ROT'], 'var(--accent)')}</td>
  <td class="c-avg">{r['avg']}</td>
  <td class="c-date">{r['date']}</td>
  <td class="c-name">{name} {src_badge}</td>
</tr>""")
    rows_html = "\n".join(body_rows)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Cappuccino Double Paceline Quality \u2014 aeyu.io</title>
<meta name="description" content="A for-fun leaderboard ranking how well the Cappuccino ride's double paceline actually formed, ride by ride.">
<meta property="og:type" content="website">
<meta property="og:title" content="Cappuccino Double Paceline Quality">
<meta property="og:description" content="Ranking how well the double paceline formed, ride by ride. A smooth steady line scores high; a herky-jerky one that never forms scores low.">
<meta property="og:url" content="https://aeyu.io/cappuccino.html">
<meta property="og:image" content="https://aeyu.io/og-image.png">
<meta name="theme-color" content="#F6F3EE">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"></noscript>
<style>
  :root {{
    --bg:#F6F3EE; --surface:#FFFFFF; --surface-hover:#FAF8F4;
    --border:#E5DFD4; --border-light:#EDE8E0;
    --text:#1A1610; --text-secondary:#5C5548; --text-tertiary:#8C8374;
    --strava:#FC4C02; --accent:#B85A28; --accent-dark:#6B3518; --steel:#4A5759;
    --font-display:'Instrument Serif',serif; --font-body:'DM Sans',sans-serif; --font-mono:'IBM Plex Mono',monospace;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text); font-family:var(--font-body);
         line-height:1.5; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:880px; margin:0 auto; padding:32px 20px 80px; }}
  header h1 {{ font-family:var(--font-display); font-weight:400; font-size:2.7rem;
              line-height:1.05; margin:0 0 6px; letter-spacing:-.01em; }}
  header .tag {{ color:var(--accent); font-weight:600; font-size:.82rem;
                text-transform:uppercase; letter-spacing:.08em; }}
  header p.lede {{ color:var(--text-secondary); font-size:1.05rem; max-width:60ch; margin:14px 0 0; }}
  .legend {{ display:flex; flex-wrap:wrap; gap:18px; margin:26px 0 8px;
             padding:16px 18px; background:var(--surface); border:1px solid var(--border);
             border-radius:14px; font-size:.9rem; }}
  .legend div {{ flex:1; min-width:200px; }}
  .legend b {{ font-family:var(--font-mono); }}
  .ind-k {{ color:var(--steel); }} .rot-k {{ color:var(--accent); }}
  .podium {{ display:flex; gap:12px; margin:20px 0 6px; }}
  .podium .card {{ flex:1; background:var(--surface); border:1px solid var(--border);
                   border-radius:14px; padding:14px 16px; }}
  .podium .card.win {{ border-color:var(--accent); box-shadow:0 1px 0 var(--accent) inset; }}
  .podium .lab {{ font-size:.72rem; text-transform:uppercase; letter-spacing:.07em;
                  color:var(--text-tertiary); }}
  .podium .q {{ font-family:var(--font-mono); font-size:1.8rem; font-weight:500; }}
  .podium .nm {{ font-size:.85rem; color:var(--text-secondary); margin-top:2px;
                 white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  table {{ width:100%; border-collapse:collapse; margin-top:18px; font-size:.92rem; }}
  thead th {{ text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.06em;
              color:var(--text-tertiary); font-weight:600; padding:8px 8px; border-bottom:1px solid var(--border); }}
  tbody td {{ padding:9px 8px; border-bottom:1px solid var(--border-light); vertical-align:middle; }}
  tbody tr:hover {{ background:var(--surface-hover); }}
  .c-rk {{ width:34px; text-align:center; font-family:var(--font-mono); }}
  .c-rk .rk {{ color:var(--text-tertiary); font-size:.85rem; }}
  .c-q b {{ font-family:var(--font-mono); font-size:1.15rem; }}
  .c-sub {{ width:150px; }}
  .bar {{ display:inline-block; width:74px; height:7px; background:var(--border);
          border-radius:4px; overflow:hidden; vertical-align:middle; margin-right:8px; }}
  .bar .fill {{ display:block; height:100%; border-radius:4px; }}
  .num {{ font-family:var(--font-mono); font-size:.85rem; color:var(--text-secondary); }}
  .c-avg {{ font-family:var(--font-mono); color:var(--text-secondary); }}
  .c-date {{ font-family:var(--font-mono); font-size:.82rem; color:var(--text-tertiary); white-space:nowrap; }}
  .c-name {{ color:var(--text); }}
  .badge {{ font-size:.62rem; text-transform:uppercase; letter-spacing:.05em; padding:2px 6px;
            border-radius:6px; margin-left:4px; vertical-align:middle; }}
  .badge.pwr {{ background:#F0E7DF; color:var(--accent-dark); }}
  .badge.cad {{ background:var(--steel-light,#D8DBE2); color:var(--steel); }}
  .method {{ margin-top:34px; padding:18px 20px; background:var(--surface);
             border:1px solid var(--border); border-radius:14px; font-size:.86rem;
             color:var(--text-secondary); }}
  .method h3 {{ font-family:var(--font-display); font-weight:400; font-size:1.3rem;
                margin:0 0 8px; color:var(--text); }}
  .method code {{ font-family:var(--font-mono); font-size:.8rem; background:var(--bg);
                  padding:1px 5px; border-radius:5px; }}
  footer {{ margin-top:26px; font-size:.78rem; color:var(--text-tertiary); }}
  footer a {{ color:var(--accent); }}
  @media (max-width:620px) {{
    .c-sub {{ width:auto; }} .bar {{ width:46px; }}
    .c-name .badge {{ display:none; }}
    header h1 {{ font-size:2.1rem; }}
  }}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="tag">aeyu.io \u00b7 participation awards</div>
    <h1>Cappuccino Double&nbsp;Paceline Quality</h1>
    <p class="lede">A clean double paceline is a smooth step-wave: a ~21&nbsp;mph slow
    line and a ~22&nbsp;mph fast line, rotating steadily. This ranks every logged
    Cappuccino by how well that line actually <em>formed</em> \u2014 measured from the
    long flat run up MacArthur to the base of Anglers.</p>
  </header>

  <div class="legend">
    <div><b class="ind-k">IND</b> \u2014 <b>your own steadiness.</b> A formed line lets you
      hold a steady pull; a broken one means constant surge-and-coast on the wheel.</div>
    <div><b class="rot-k">ROT</b> \u2014 <b>the group's rotation.</b> Rewards a tight speed band
      near the 21\u201322 target; penalises both the accordion and running too hot.</div>
    <div><b>Q</b> \u2014 the headline, <code>(IND + ROT) / 2</code>. 100 = a beautiful
      steady line. Low = it never came together.</div>
  </div>

  <div class="podium">
    <div class="card win"><div class="lab">\U0001F947 best-formed line</div>
      <div class="q">{best['Q']}</div><div class="nm">{best['date']} \u00b7 {(best.get('name','') or '')[:30]}</div></div>
    <div class="card"><div class="lab">\U0001F4A9 most herky-jerky</div>
      <div class="q">{worst['Q']}</div><div class="nm">{worst['date']} \u00b7 {(worst.get('name','') or '')[:30]}</div></div>
  </div>

  <table>
    <thead><tr>
      <th></th><th>Q</th><th class="ind-k">IND</th><th class="rot-k">ROT</th>
      <th>avg&nbsp;mph</th><th>date</th><th>ride</th>
    </tr></thead>
    <tbody>
{rows_html}
    </tbody>
  </table>

  <div class="method">
    <h3>How it's scored</h3>
    <p><b>IND</b> comes from your power trace (jerk = how often watts jump &gt;50W
    second-to-second, plus variability and coasting) \u2014 or, on rides with no power
    meter, from cadence (which tracks the power chop closely). <b>ROT</b> comes from
    the speed trace: how tightly it held a band, and whether that band sat near the
    21\u201322&nbsp;mph social target rather than running hot. Both are scored relative to
    the field of logged Cappuccino rides. Segment: <code>{SEGMENT}</code>.</p>
    <p>The two numbers are deliberately separate \u2014 a ride can be a steady pull through
    a chaotic pack (high IND, low ROT) or a calm pack you personally surged all over,
    e.g. on gravel (low IND, high ROT).</p>
  </div>

  <footer>
    {len(rows)} rides \u00b7 updated {updated} \u00b7 a bit of fun, take the rankings in the
    spirit of the ride \u00b7 <a href="https://aeyu.io/">aeyu.io</a>
  </footer>
</div>
</body>
</html>"""

# ---- cli ---------------------------------------------------------------------

if __name__ == "__main__":
    import datetime
    src = sys.argv[1] if len(sys.argv) > 1 else "cappuccino-dps.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "cappuccino.html"
    data = json.load(open(src))
    rows = list(data.values()) if isinstance(data, dict) else data
    scored = score_rides(rows)
    html = render_html(scored, datetime.date.today().isoformat())
    open(out, "w").write(html)
    print(f"rendered {len(scored)} rides -> {out}")
