# src/
*Files: 12 | Subdirectories: 1*

## Subdirectories

- [components/](./components/_MAP.md)

## Files

### award-config.js
- **AWARD_LABELS** (variable) :9
- **AWARD_COLORS** (variable) :56

### app.js
> Imports: `preact, preact, signals, auth.js, demo.js`...
- **route** (variable) :17
- **routeParams** (variable) :18
- **navigate** (f) `(path)` :33

### auth.js
> Imports: `signals, config.js, db.js`
- **authState** (variable) :17
- **initAuth** (f) `()` :20
- **startOAuth** (f) `()` :28
- **handleOAuthCallback** (f) `(code)` :43
- **getValidToken** (f) `()` :77
- **disconnect** (f) `()` :114

### awards.js
> Imports: `db.js, units.js`
- **rankSegmentAwards** (f) `(awards)` :174
- **computeAwards** (f) `(activity, resetEvent = null, referencePoints = [])` :472
- **computeRideLevelAwards** (f) `(activity, allActivities, resetEvent = null)` :988
- **computeAwardsForActivities** (f) `(activities)` :1484

### power-curve.js
> Imports: `signals, config.js, auth.js, db.js`
- **POWER_CURVE_DURATIONS** (variable) :27
- **DURATION_LABELS** (variable) :30
- **powerCurveProgress** (variable) :41
- **computePowerCurve** (f) `(watts)` :53
- **estimateFTP** (f) `(powerCurve)` :81
- **fetchAndComputePowerCurve** (f) `(activityId)` :123
- **getActivitiesNeedingPowerCurves** (f) `()` :155
- **getAllTimeBestCurve** (f) `()` :167

### config.js
- **STRAVA_CLIENT_ID** (variable) :6
- **WORKER_URL** (variable) :7
- **STRAVA_AUTH_URL** (variable) :8
- **STRAVA_API_BASE** (variable) :9
- **OAUTH_REDIRECT_URI** (variable) :10
- **OAUTH_SCOPE** (variable) :11

### db.js
- **openDB** (f) `()` :12
- **getAuth** (f) `()` :63
- **setAuth** (f) `(session)` :73
- **clearAuth** (f) `()` :83
- **putActivity** (f) `(activity)` :95
- **putActivities** (f) `(activities)` :105
- **getActivity** (f) `(id)` :118
- **getActivitiesByYear** (f) `(year)` :128
- **getActivitiesWithoutEfforts** (f) `()` :142
- **getActivitiesWithoutPower** (f) `()` :161
- **getActivitiesWithoutHeartRate** (f) `()` :174
- **getAllActivities** (f) `()` :191
- **putSegment** (f) `(segment)` :186
- **getSegment** (f) `(id)` :196
- **getAllSegments** (f) `()` :206
- **appendEffort** (f) `(segmentId, segmentData, effort)` :216
- **getResetEvent** (f) `()` :262
- **setResetEvent** (f) `(event)` :272
- **clearResetEvent** (f) `()` :284
- **recordRecoveryMilestone** (f) `(segmentId, threshold)` :298
- **getUserConfig** (f) `()` :316
- **setUserConfig** (f) `(config)` :326
- **getSyncState** (f) `()` :350
- **updateSyncState** (f) `(updates)` :360
- **clearAllData** (f) `()` :372

### fitness.js
> Imports: `db.js`
- **computePerformanceCapacity** (f) `()` :69
- **computeAerobicEfficiency** (f) `()` :169
- **computeFitnessSummary** (f) `()` :237

### demo.js
> Imports: `signals, db.js`
- **isDemo** (variable) :9
- **checkDemo** (f) `()` :20
- **startDemo** (f) `()` :34
- **exitDemo** (f) `()` :102

### icons.js
> Imports: `preact`
- **renderIconSVG** (f) `(type, { size = 16, color = "#6B6260", strokeWidth } = {})` :304
- **AwardIcon** (f) `({ type, size, color, strokeWidth })` :351
- **drawIcon** (f) `(ctx, type, x, y, size, color, strokeWidth = 2)` :370
- **ICON_TYPES** (variable) :454

### sync.js
> Imports: `signals, config.js, auth.js, db.js`
- **syncProgress** (variable) :21
- **rateLimitStatus** (variable) :30
- **isSyncing** (variable) :37
- **startBackfill** (f) `()` :364
- **incrementalSync** (f) `()` :415

### units.js
> Imports: `signals, db.js`
- **unitSystem** (variable) :10
- **loadUnitPreference** (f) `()` :13
- **setUnitPreference** (f) `(system)` :34
- **formatDistance** (f) `(meters)` :58
- **formatElevation** (f) `(meters)` :69
- **formatSpeed** (f) `(metersPerSecond)` :77
- **formatTime** (f) `(seconds)` :87
- **formatDate** (f) `(isoString)` :100
- **formatDateWeekday** (f) `(isoString)` :109
- **formatDateFull** (f) `(isoString)` :118
- **formatPower** (f) `(watts)` :128

