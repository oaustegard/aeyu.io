# src/
*Files: 18 | Subdirectories: 1*

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
- **AWARD_COLORS** (variable) :70
- **AWARD_GROUPS** (variable) :76

### awards.js
> Imports: `db.js, units.js, routes.js`
- **rankSegmentAwards** (f) `(awards)` :248
- **computeAwards** (f) `(activity, resetEvent = null, referencePoints = [])` :643
- **computeRideLevelAwards** (f) `(activity, allActivities, resetEvent = null)` :1228
- **computeAwardsForActivities** (f) `(activities, disabledAwardTypes = null)` :1935
- **computeWeeklyStreaks** (f) `(allActivities)` :2093
- **detectGroupRides** (f) `(allActivities, routes = [])` :2215
- **computeStreakData** (f) `(allActivities, routes = [])` :2416

### config.js
- **STRAVA_CLIENT_ID** (variable) :6
- **WORKER_URL** (variable) :7
- **STRAVA_AUTH_URL** (variable) :8
- **STRAVA_API_BASE** (variable) :9
- **OAUTH_REDIRECT_URI** (variable) :10
- **OAUTH_SCOPE** (variable) :11

### critical-power.js
- **CP_FIT_DURATIONS** (variable) :29
- **estimateCriticalPower** (f) `(powerCurve)` :48
- **timeToExhaustion** (f) `(power, cp, wPrime)` :106
- **sustainablePower** (f) `(seconds, cp, wPrime)` :116
- **canFitCP** (f) `(powerCurve)` :124

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
- **getActivitiesByIds** (f) `(ids)` :161
- **getActivitiesByYear** (f) `(year)` :173
- **getActivitiesWithoutEfforts** (f) `()` :187
- **getActivitiesWithoutPower** (f) `()` :206
- **getActivitiesWithoutHeartRate** (f) `()` :223
- **getActivitiesWithoutZones** (f) `()` :236
- **getAllActivities** (f) `()` :252
- **putSegment** (f) `(segment)` :264
- **getSegment** (f) `(id)` :274
- **getAllSegments** (f) `()` :284
- **appendEffort** (f) `(segmentId, segmentData, effort)` :294
- **removeEffortsForActivity** (f) `(activityId)` :335
- **getResetEvent** (f) `()` :371
- **setResetEvent** (f) `(event)` :381
- **clearResetEvent** (f) `()` :393
- **recordRecoveryMilestone** (f) `(segmentId, threshold)` :407
- **getUserConfig** (f) `()` :425
- **setUserConfig** (f) `(config)` :435
- **getSyncState** (f) `()` :461
- **updateSyncState** (f) `(updates)` :471
- **putRoutes** (f) `(routes)` :485
- **getAllRoutes** (f) `()` :499
- **putStravaRoutes** (f) `(routes)` :511
- **getStravaRoutes** (f) `()` :521
- **exportSettings** (f) `()` :533
- **importSettings** (f) `(data)` :553
- **clearAllData** (f) `()` :589

### demo.js
> Imports: `signals, db.js, auth.js, routes.js`
- **isDemo** (variable) :11
- **demoError** (variable) :12
- **checkDemo** (f) `()` :24
- **startDemo** (f) `()` :53
- **exitDemo** (f) `()` :127

### export-llm.js
> Imports: `db.js, fitness.js, awards.js, units.js, award-config.js`...
- **buildLLMContext** (f) `(options = {})` :318
- **convertContextUnits** (f) `(ctx)` :416
- **contextToMarkdown** (f) `(ctx)` :423
- **buildRideExport** (f) `(activityId, options = {})` :655
- **rideToMarkdown** (f) `(ctx)` :775
- **buildSegmentExport** (f) `(segmentId)` :926
- **segmentToMarkdown** (f) `(ctx)` :980

### fitness.js
> Imports: `db.js`
- **computePerformanceCapacity** (f) `()` :79
- **computeAerobicEfficiency** (f) `()` :280
- **computeFitnessSummary** (f) `()` :447

### gear-stats.js
- **bikeStats** (f) `(activities, gears)` :49
- **gearAwards** (f) `(stats)` :130

### icons.js
> Imports: `preact`
- **renderIconSVG** (f) `(type, { size = 16, color = "#6B6260", strokeWidth } = {})` :368
- **AwardIcon** (f) `({ type, size, color, strokeWidth })` :415
- **drawIcon** (f) `(ctx, type, x, y, size, color, strokeWidth = 2)` :434
- **ICON_TYPES** (variable) :518

### install.js
> Imports: `signals`
- **installContext** (variable) :9
- **initInstallDetection** (f) `()` :23
- **triggerInstall** (f) `()` :52
- **dismissInstallBanner** (f) `()` :62

### power-curve.js
> Imports: `db.js`
- **POWER_CURVE_DURATIONS** (variable) :22
- **DURATION_LABELS** (variable) :25
- **computePowerCurve** (f) `(watts)` :39
- **estimateFTP** (f) `(powerCurve)` :66
- **getAllTimeBestCurve** (f) `()` :75

### routes.js
- **detectRoutes** (f) `(activities, stravaRoutes = [])` :102
- **findRouteForActivity** (f) `(activity, routes)` :223

### sync.js
> Imports: `signals, config.js, auth.js, db.js, power-curve.js`
- **syncProgress** (variable) :29
- **rateLimitStatus** (variable) :38
- **isSyncing** (variable) :45
- **syncRoutes** (f) `()` :590
- **startBackfill** (f) `(onProgress)` :759
- **incrementalSync** (f) `()` :881
- **updateSyncWindow** (f) `(newEpoch)` :956
- **manualSync** (f) `(onProgress)` :981
- **startAutoSync** (f) `(onComplete)` :1007
- **stopAutoSync** (f) `()` :1016
- **resyncActivity** (f) `(activityId)` :1083

### touch-tooltip.js
- **initTouchTooltips** (f) `()` :69

### units.js
> Imports: `signals, db.js`
- **unitSystem** (variable) :10
- **loadUnitPreference** (f) `()` :13
- **setUnitPreference** (f) `(system)` :34
- **formatDistance** (f) `(meters)` :58
- **formatElevation** (f) `(meters)` :69
- **formatSpeed** (f) `(metersPerSecond)` :77
- **formatTime** (f) `(seconds)` :87
- **formatDate** (f) `(isoString)` :101
- **formatDateWeekday** (f) `(isoString)` :110
- **formatDateFull** (f) `(isoString)` :119
- **formatPower** (f) `(watts)` :129

