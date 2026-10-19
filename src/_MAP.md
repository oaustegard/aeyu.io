# src/
*Files: 27 | Subdirectories: 1*

## Subdirectories

- [components/](./components/_MAP.md)

## Files

### app.js
> Imports: `preact, preact, signals, auth.js, demo.js`...
- **route** (variable) :27
- **routeParams** (variable) :28
- **navigate** (f) `(url)` :49

### auth.js
> Imports: `signals, config.js, db.js`
- **authState** (variable) :17
- **initAuth** (f) `()` :20
- **startOAuth** (f) `()` :28
- **handleOAuthCallback** (f) `(code)` :43
- **getValidToken** (f) `()` :77
- **disconnect** (f) `()` :114

### avatar.js
- **resolveAvatarUrl** (f) `(profile)` :13

### award-config.js
- **AWARD_LABELS** (variable) :9
- **AWARD_COLORS** (variable) :73
- **AWARD_PRIORITY** (variable) :91
- **ALL_TIME_PRIORITY_FLOOR** (variable) :158
- **isCapReinstatable** (f) `(award)` :180
- **awardStrength** (f) `(award)` :205
- **awardScore** (f) `(award)` :222
- **AWARD_GROUPS** (variable) :228
- **marginOverRunnerUp** (f) `(current, values, lowerIsBetter = true)` :337

### awards.js
> Imports: `db.js, units.js, routes.js, critical-power.js, award-config.js`
- **rankSegmentAwards** (f) `(awards)` :243
- **computeAwards** (f) `(activity, resetEvent = null, referencePoints = [])` :648
- **computeRideLevelAwards** (f) `(activity, allActivities, resetEvent = null)` :1302
- **computeAwardsForActivities** (f) `(activities, disabledAwardTypes = null)` :2048
- **computeWeeklyStreaks** (f) `(allActivities)` :2206
- **detectGroupRides** (f) `(allActivities, routes = [])` :2328
- **computeStreakData** (f) `(allActivities, routes = [])` :2529

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
- **getAuth** (f) `()` :101
- **setAuth** (f) `(session)` :111
- **clearAuth** (f) `()` :121
- **putActivity** (f) `(activity)` :133
- **putActivities** (f) `(activities)` :143
- **getActivity** (f) `(id)` :156
- **getActivitiesByIds** (f) `(ids)` :166
- **getActivitiesByYear** (f) `(year)` :178
- **getActivitiesWithoutEfforts** (f) `()` :192
- **getActivitiesWithoutPower** (f) `()` :211
- **getActivitiesWithoutHeartRate** (f) `()` :228
- **getActivitiesWithoutZones** (f) `()` :241
- **getAllActivities** (f) `()` :257
- **putSegment** (f) `(segment)` :269
- **getSegment** (f) `(id)` :279
- **getAllSegments** (f) `()` :289
- **appendEffort** (f) `(segmentId, segmentData, effort)` :299
- **setSegmentKom** (f) `(segmentId, komSeconds, athleteCount = null)` :346
- **removeEffortsForActivity** (f) `(activityId)` :372
- **getResetEvent** (f) `()` :408
- **setResetEvent** (f) `(event)` :418
- **clearResetEvent** (f) `()` :430
- **recordRecoveryMilestone** (f) `(segmentId, threshold)` :444
- **getUserConfig** (f) `()` :462
- **setUserConfig** (f) `(config)` :472
- **getSyncState** (f) `()` :498
- **updateSyncState** (f) `(updates)` :508
- **putRoutes** (f) `(routes)` :522
- **getAllRoutes** (f) `()` :536
- **putStravaRoutes** (f) `(routes)` :548
- **getStravaRoutes** (f) `()` :558
- **exportSettings** (f) `()` :570
- **importSettings** (f) `(data)` :590
- **getStreams** (f) `(activityId)` :626
- **putStreams** (f) `(record)` :635
- **clearAllData** (f) `()` :645

### demo-streams.js
> Imports: `heatmap.js`
- **synthesizeStreams** (f) `(activity)` :14

### demo.js
> Imports: `signals, db.js, auth.js, routes.js, demo-streams.js`
- **isDemo** (variable) :12
- **demoError** (variable) :13
- **checkDemo** (f) `()` :25
- **startDemo** (f) `()` :54
- **exitDemo** (f) `()` :130

### durability.js
- **computeDecoupling** (f) `(watts, hr)` :38
- **computeSustainedBlocks** (f) `(hr, thresholds)` :99
- **computeDurability** (f) `(watts, hr, hrThresholds)` :124

### export-llm.js
> Imports: `db.js, fitness.js, awards.js, units.js, award-config.js`...
- **buildLLMContext** (f) `(options = {})` :318
- **convertContextUnits** (f) `(ctx)` :416
- **contextToMarkdown** (f) `(ctx)` :423
- **buildRideExport** (f) `(activityId, options = {})` :655
- **rideToMarkdown** (f) `(ctx)` :796
- **buildSegmentExport** (f) `(segmentId)` :947
- **segmentToMarkdown** (f) `(ctx)` :1001

### fitness.js
> Imports: `db.js`
- **computePerformanceCapacity** (f) `()` :79
- **computeAerobicEfficiency** (f) `()` :280
- **computeFitnessSummary** (f) `()` :447

### gear-stats.js
- **bikeStats** (f) `(activities, gears)` :49
- **gearAwards** (f) `(stats)` :130

### heatmap-render.js
> Imports: `heatmap.js`
- **webgpuAvailable** (f) `()` :118
- **createWebGPURenderer** (f) `(canvas, data)` :122
- **createCanvasRenderer** (f) `(canvas, data)` :252

### heatmap.js
- **NO_GEAR** (variable) :6
- **MAX_SLOTS** (variable) :7
- **SEG_STRIDE** (variable) :8
- **decodePolyline** (f) `(str)` :11
- **encodePolyline** (f) `(points)` :30
- **project** (f) `(lat, lng)` :47
- **dayNumber** (f) `(isoLocal)` :52
- **buildHeatmapData** (f) `(activities)` :71
- **matchesFilter** (f) `(m, f)` :149
- **fitBounds** (f) `(meta, f)` :160

### icons.js
> Imports: `preact`
- **renderIconSVG** (f) `(type, { size = 16, color = "#6B6260", strokeWidth } = {})` :369
- **AwardIcon** (f) `({ type, size, color, strokeWidth })` :416
- **drawIcon** (f) `(ctx, type, x, y, size, color, strokeWidth = 2)` :435
- **ICON_TYPES** (variable) :519

### install.js
> Imports: `signals`
- **installContext** (variable) :9
- **initInstallDetection** (f) `()` :23
- **triggerInstall** (f) `()` :52
- **dismissInstallBanner** (f) `()` :62

### places.js
> Imports: `heatmap.js`
- **unproject** (f) `(x, y)` :13
- **tilesForTracks** (f) `(meta, origin)` :25
- **placesNearTracks** (f) `(rows, meta, origin)` :44
- **loadPlaces** (f) `(meta, origin, fetchFn = fetch)` :59
- **placeCounts** (f) `(places, meta, filter, playhead = null)` :73
- **layoutLabels** (f) `(places, counts, view, width, height, measure, { max = 40, pad = 0, reserved = [] } = {})` :90

### power-curve.js
> Imports: `db.js`
- **POWER_CURVE_DURATIONS** (variable) :22
- **DURATION_LABELS** (variable) :25
- **computePowerCurve** (f) `(watts)` :39
- **estimateFTP** (f) `(powerCurve)` :66
- **getAllTimeBestCurve** (f) `()` :75

### ride-render.js
> Imports: `ride-scene.js`
- **createRideGPURenderer** (f) `(canvas, ribbon)` :127
- **createRideCanvasRenderer** (f) `(canvas, ribbon)` :197

### ride-scene.js
- **buildRideScene** (f) `(streams, activity, awardsBySegment = new Map(), colors = {}, score = () => 0)` :29
- **sampleAt** (f) `(scene, time)` :123
- **pointAtDistance** (f) `(scene, dist)` :138
- **RIBBON_FLOATS** (variable) :151
- **packRibbon** (f) `(scene, baseRgb = [0.98, 0.93, 0.86])` :152
- **hexToRgb** (f) `(hex)` :170
- **buildGhostRace** (f) `(scene, effort, history)` :182
- **crowdDensity** (f) `(race, clock, bins = 128)` :224
- **standings** (f) `(race, clock)` :245
- **makeCamera** (f) `(b, width, height, { yaw = 0, pitch = 0.9, zoom = 1 } = {})` :295
- **sideOnYaw** (f) `(scene, tA = -Infinity, tB = Infinity)` :329
- **sliceBounds** (f) `(scene, tA, tB)` :345

### routes.js
- **detectRoutes** (f) `(activities, stravaRoutes = [])` :102
- **findRouteForActivity** (f) `(activity, routes)` :223

### share-video.js
- **FPS** (variable) :33
- **videoDuration** (f) `(slideCount)` :48
- **slideAt** (f) `(t, slideCount)` :57
- **drawFrame** (f) `(ctx, slides, layout, t)` :71
- **pickEncoderConfig** (f) `(width, height)` :131
- **renderShareVideo** (f) `(drawSlides, { onProgress } = {})` :159

### sync.js
> Imports: `signals, config.js, auth.js, db.js, power-curve.js`...
- **syncProgress** (variable) :37
- **rateLimitStatus** (variable) :46
- **isSyncing** (variable) :53
- **parseXomTime** (f) `(str)` :125
- **syncRoutes** (f) `()` :662
- **STREAM_KEYS** (variable) :750
- **fetchRideStreams** (f) `(activityId)` :756
- **backfillMapData** (f) `(onProgress)` :774
- **startBackfill** (f) `(onProgress)` :913
- **incrementalSync** (f) `()` :1035
- **updateSyncWindow** (f) `(newEpoch)` :1110
- **manualSync** (f) `(onProgress)` :1135
- **startAutoSync** (f) `(onComplete)` :1161
- **stopAutoSync** (f) `()` :1170
- **resyncActivity** (f) `(activityId)` :1237

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

