# src/
*Files: 15 | Subdirectories: 1*

## Subdirectories

- [components/](./components/_MAP.md)

## Files

### app.js
> Imports: `preact, preact, signals, auth.js, demo.js`...
- **route** (variable) :26
- **routeParams** (variable) :27
- **navigate** (f) `(url)` :48

### auth.js
> Imports: `signals, config.js, db.js`
- **authState** (variable) :17
- **initAuth** (f) `()` :20
- **startOAuth** (f) `()` :28
- **handleOAuthCallback** (f) `(code)` :43
- **getValidToken** (f) `()` :77
- **disconnect** (f) `()` :114

### award-config.js
- **AWARD_LABELS** (variable) :9
- **AWARD_COLORS** (variable) :68

### awards.js
> Imports: `db.js, units.js, routes.js`
- **rankSegmentAwards** (f) `(awards)` :241
- **computeAwards** (f) `(activity, resetEvent = null, referencePoints = [])` :581
- **computeRideLevelAwards** (f) `(activity, allActivities, resetEvent = null)` :1141
- **computeAwardsForActivities** (f) `(activities)` :1848
- **computeWeeklyStreaks** (f) `(allActivities)` :1979
- **detectGroupRides** (f) `(allActivities)` :2087
- **computeStreakData** (f) `(allActivities)` :2247

### config.js
- **STRAVA_CLIENT_ID** (variable) :6
- **WORKER_URL** (variable) :7
- **STRAVA_AUTH_URL** (variable) :8
- **STRAVA_API_BASE** (variable) :9
- **OAUTH_REDIRECT_URI** (variable) :10
- **OAUTH_SCOPE** (variable) :11

### db.js
- **switchToDemoDB** (f) `()` :14
- **switchToRealDB** (f) `()` :20
- **deleteDemoDB** (f) `()` :26
- **openDB** (f) `()` :35
- **getAuth** (f) `()` :96
- **setAuth** (f) `(session)` :106
- **clearAuth** (f) `()` :116
- **putActivity** (f) `(activity)` :128
- **putActivities** (f) `(activities)` :138
- **getActivity** (f) `(id)` :151
- **getActivitiesByYear** (f) `(year)` :161
- **getActivitiesWithoutEfforts** (f) `()` :175
- **getActivitiesWithoutPower** (f) `()` :194
- **getActivitiesWithoutHeartRate** (f) `()` :211
- **getAllActivities** (f) `()` :224
- **putSegment** (f) `(segment)` :236
- **getSegment** (f) `(id)` :246
- **getAllSegments** (f) `()` :256
- **appendEffort** (f) `(segmentId, segmentData, effort)` :266
- **removeEffortsForActivity** (f) `(activityId)` :307
- **getResetEvent** (f) `()` :343
- **setResetEvent** (f) `(event)` :353
- **clearResetEvent** (f) `()` :365
- **recordRecoveryMilestone** (f) `(segmentId, threshold)` :379
- **getUserConfig** (f) `()` :397
- **setUserConfig** (f) `(config)` :407
- **getSyncState** (f) `()` :433
- **updateSyncState** (f) `(updates)` :443
- **putRoutes** (f) `(routes)` :457
- **getAllRoutes** (f) `()` :471
- **clearAllData** (f) `()` :481

### demo.js
> Imports: `signals, db.js, auth.js`
- **isDemo** (variable) :10
- **checkDemo** (f) `()` :21
- **startDemo** (f) `()` :50
- **exitDemo** (f) `()` :106

### fitness.js
> Imports: `db.js`
- **computePerformanceCapacity** (f) `()` :74
- **computeAerobicEfficiency** (f) `()` :217
- **computeFitnessSummary** (f) `()` :340

### icons.js
> Imports: `preact`
- **renderIconSVG** (f) `(type, { size = 16, color = "#6B6260", strokeWidth } = {})` :366
- **AwardIcon** (f) `({ type, size, color, strokeWidth })` :413
- **drawIcon** (f) `(ctx, type, x, y, size, color, strokeWidth = 2)` :432
- **ICON_TYPES** (variable) :516

### install.js
> Imports: `signals`
- **installContext** (variable) :9
- **initInstallDetection** (f) `()` :23
- **triggerInstall** (f) `()` :52
- **dismissInstallBanner** (f) `()` :62

### power-curve.js
> Imports: `config.js, auth.js, db.js, signals`
- **POWER_CURVE_DURATIONS** (variable) :25
- **DURATION_LABELS** (variable) :28
- **powerCurveProgress** (variable) :38
- **computePowerCurve** (f) `(watts)` :53
- **estimateFTP** (f) `(powerCurve)` :81
- **fetchAndComputePowerCurve** (f) `(activityId)` :137
- **getActivitiesNeedingPowerCurves** (f) `()` :170
- **getAllTimeBestCurve** (f) `()` :181

### routes.js
- **detectRoutes** (f) `(activities)` :57
- **findRouteForActivity** (f) `(activity, routes)` :125

### sync.js
> Imports: `signals, config.js, auth.js, db.js`
- **syncProgress** (variable) :24
- **rateLimitStatus** (variable) :33
- **isSyncing** (variable) :40
- **startBackfill** (f) `(onProgress)` :547
- **incrementalSync** (f) `()` :659
- **updateSyncWindow** (f) `(newEpoch)` :727
- **manualSync** (f) `(onProgress)` :752
- **startAutoSync** (f) `(onComplete)` :778
- **stopAutoSync** (f) `()` :787
- **resyncActivity** (f) `(activityId)` :854

### touch-tooltip.js
- **initTouchTooltips** (f) `()` :64

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

