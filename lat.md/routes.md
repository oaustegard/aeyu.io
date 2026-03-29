# Routes

Route detection via segment fingerprinting. Groups activities into recurring routes by comparing which Strava segments they traverse. Used by [[awards#Streaks]] for group ride consistency tracking. Implementation: [[src/routes.js]].

## Detection Algorithm

[[src/routes.js#detectRoutes]] clusters activities in three phases.

**Phase 1 — Organic clustering**: Activities are processed chronologically. Each activity's segment set is compared against existing clusters using a two-gate filter: distance gate (±30% of cluster's median distance) then Jaccard similarity (≥0.50). First matching cluster wins; unmatched activities seed new clusters. Segment fingerprints are frozen after initial formation — the first activity defines the cluster's segments.

**Phase 2 — Strava name adoption**: Strava-saved routes (fetched via API) are matched to organic clusters using containment (Strava segments ⊆ cluster segments) plus distance gate. Containment is used here instead of Jaccard because the Strava API only returns ~25 of a route's 50+ segments. This direction is safe — the Strava set is always smaller, checking if it fits inside a larger organic cluster.

**Phase 3 — Finalize**: Clusters with ≥2 activities become named routes. Strava name takes priority; otherwise the most common activity name is used.

## Matching Activities to Routes

[[src/routes.js#findRouteForActivity]] matches a single activity against known routes using the same distance gate + Jaccard filter. Virtual rides are excluded — they have no real-world segments.

## Design Decisions

Containment was removed from activity→route matching because it's one-directional — short rides matched long routes when sharing a subset of segments. Jaccard treats both sets symmetrically, preventing this.

The `MIN_SEGMENTS_FOR_ROUTE` threshold (2) keeps singleton-segment activities from forming false routes. Activities without segment efforts (indoor rides, very short rides) are silently excluded.
