# test/
*Files: 4 | Subdirectories: 1*

## Subdirectories

- [screenshots/](./screenshots/_MAP.md)

## Files

### harness.py
> Imports: `json, math, os, random, sys`...
- **seasonal_prob** (f) `(month)` :89
- **fitness_curve** (f) `(year, month)` :92
- **seg_by_id** (f) `(sid)` :97
- **make_effort** (f) `(eid, seg, elapsed, dt, device_watts=False, avg_watts=None)` :100
- **make_seg_record** (f) `(eid, aid, elapsed, moving, dt, device_watts=False, avg_watts=None)` :118
- **next_eid** (f) `()` :135
- **next_aid** (f) `()` :137
- **make_ride** (f) `(dt, efforts_data, seg_efforts_store, name=None, extra_dist=0,
              extra_time=0, extra_elev=0, device_watts=False, avg_watts=None)` :140
- **generate_mock_data** (f) `(seed=42)` :203
- **QHandler** (C) :490
  - **__init__** (m) `(self, *a, directory=None, **kw)` :491
  - **log_message** (m) `(self, *a)` :493
  - **guess_type** (m) `(self, path)` :494
- **start_server** (f) `(directory, port=8765)` :499
- **setup_cdn_routes** (f) `(page, vendor_dir)` :514
- **stub_cdn** (f) `(page)` :518
- **run_harness** (f) `(screen="all", output_dir=None, audit_only=False)` :641

### inject.html
- *No top-level symbols*

## Other Files

- fixture-real.json
- setup.sh

