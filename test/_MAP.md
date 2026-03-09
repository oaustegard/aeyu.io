# test/
*Files: 4*

## Files

### harness.py
> Imports: `json, math, os, random, sys`...
- **seasonal_prob** (f) `(month)` :86
- **fitness_curve** (f) `(year, month)` :89
- **seg_by_id** (f) `(sid)` :94
- **make_effort** (f) `(eid, seg, elapsed, dt, device_watts=False, avg_watts=None)` :97
- **make_seg_record** (f) `(eid, aid, elapsed, moving, dt, device_watts=False, avg_watts=None)` :115
- **next_eid** (f) `()` :132
- **next_aid** (f) `()` :134
- **make_ride** (f) `(dt, efforts_data, seg_efforts_store, name=None, extra_dist=0,
              extra_time=0, extra_elev=0, device_watts=False, avg_watts=None)` :137
- **generate_mock_data** (f) `(seed=42)` :187
- **QHandler** (C) :423
  - **__init__** (m) `(self, *a, directory=None, **kw)` :424
  - **log_message** (m) `(self, *a)` :426
  - **guess_type** (m) `(self, path)` :427
- **start_server** (f) `(directory, port=8765)` :432
- **setup_cdn_routes** (f) `(page, vendor_dir)` :447
- **stub_cdn** (f) `(page)` :476
- **run_harness** (f) `(screen="all", output_dir=None, audit_only=False)` :595

### inject.html
- *No top-level symbols*

## Other Files

- fixture-real.json
- setup.sh

