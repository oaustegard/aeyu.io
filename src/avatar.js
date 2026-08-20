/**
 * Strava sends `athlete.profile` as the bare relative path
 * "avatar/athlete/large.png" for any athlete who has not uploaded a profile
 * picture. It is a truthy string, so a plain `profile ? <img> : <initial>`
 * check renders an <img> whose src the browser resolves against aeyu.io,
 * 404s, and draws the broken-image glyph. Reported 2026-08-19.
 *
 * Anything that is not an absolute http(s) URL is treated as "no avatar" so
 * the existing initial-letter circle takes over. Normalising here rather than
 * at login means sessions that already stored the sentinel are fixed without
 * re-authorising.
 */
export function resolveAvatarUrl(profile) {
  if (typeof profile !== "string") return null;
  const url = profile.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/\/avatar\/athlete\//i.test(url)) return null;
  return url;
}
