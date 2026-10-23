# components/
*Files: 13*

## Files

### ActivityDetail.js
> Imports: `preact, signals, hooks, db.js, awards.js`...
- **ActivityDetail** (f) `({ id })` :1259

### Dashboard.js
> Imports: `preact, signals, hooks, auth.js, sync.js`...
- **FAQ_ENTRIES** (variable) :67
- **Dashboard** (f) `()` :590

### Heatmap.js
> Imports: `preact, hooks, db.js, sync.js, demo.js`...
- **Heatmap** (f) `()` :41

### HelpButton.js
> Imports: `preact, hooks, Dashboard.js`
- **HelpButton** (f) `({ faqId, dark = false, align = "right", below = false })` :6

### InstallBanner.js
> Imports: `preact, install.js`
- **InstallBanner** (f) `()` :93

### Landing.js
> Imports: `preact, signals, auth.js, demo.js, app.js`...
- **Landing** (f) `()` :67

### PowerCurve.js
> Imports: `preact, hooks, db.js, sync.js, demo.js`...
- **PowerCurve** (f) `()` :328

### RideReplay.js
> Imports: `preact, hooks, db.js, sync.js, demo.js`...
- **RideReplay** (f) `({ activity, awards, onStatus })` :53

### SegmentSparkline.js
> Imports: `preact, hooks, units.js`
- **SegmentSparkline** (f) `({ segment, currentEffortId, stravaSegmentId, onExportLLM, exportLlmStatus })` :58

### StickyHeader.js
> Imports: `preact, signals, hooks, auth.js, demo.js`...
- **headerCompact** (variable) :9
- **StickyHeader** (f) `({
  onHelp,
  onBack,
  backLabel = "Dashboard",
  contextLabel,
  rightSlot,
  menuItems = [],
  syncing = false,
  unitSystem: units,
  onUnitToggle,
  onSearch,
  searchActive = false,
})` :38

### SyncProgress.js
> Imports: `preact, hooks, sync.js, auth.js, app.js`
- **SyncProgress** (f) `()` :12

### TrendChart.js
> Imports: `preact, units.js`
- **TrendChart** (f) `({ rides: rawRides, highlightId })` :6

### WbalChart.js
> Imports: `preact, db.js, ride-streams.js, wbal.js, critical-power.js`...
- **fmtClock** (f) `(s)` :12
- **WbalChart** (f) `({ series, wPrime, at, testid })` :20
- **loadRideWbal** (f) `(activityId)` :56

