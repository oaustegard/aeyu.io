A 100% client-side cycling awards app. Connects to Strava via OAuth, syncs activity and segment data into IndexedDB, computes personal awards that Strava doesn't offer, and displays them in a PWA. No backend stores user data.

- [architecture.md](architecture.md) — System design: client-only PWA, OAuth proxy worker, data flow
- [awards.md] — Award computation engine: 30+ award types, data quality rules, comeback mode
- [data.md] — IndexedDB schema, Strava sync pipeline, rate limiting, demo mode
- [fitness.md] — Form indicators: Performance Capacity (climb VAM) and Aerobic Efficiency (NP/HR)
- [routes.md] — Route detection via segment fingerprinting and Jaccard similarity
- [coaching.md] — LLM export pipeline for AI cycling coaching integration
