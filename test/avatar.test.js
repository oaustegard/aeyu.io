import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvatarUrl } from '../src/avatar.js';

// Strava sends this bare relative path for any athlete with no uploaded photo.
// It is truthy, which is why the old `profile ? <img> : <initial>` check drew
// a broken-image glyph instead of the initial. Reported 2026-08-19.
test('the Strava default-avatar sentinel resolves to no avatar', () => {
  assert.equal(resolveAvatarUrl('avatar/athlete/large.png'), null);
  assert.equal(resolveAvatarUrl('avatar/athlete/medium.png'), null);
  assert.equal(resolveAvatarUrl('  avatar/athlete/large.png  '), null);
});

test('a real Strava CDN url passes through', () => {
  const url = 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/2/5/large.jpg';
  assert.equal(resolveAvatarUrl(url), url);
});

test('an absolute url still carrying the default-avatar path resolves to none', () => {
  assert.equal(
    resolveAvatarUrl('https://d3nn82uaxijpm6.cloudfront.net/assets/avatar/athlete/large-63758b99.png'),
    null,
  );
});

test('any non-absolute or non-string value resolves to no avatar', () => {
  for (const v of ['', '   ', '//cdn.example.com/a.jpg', 'ftp://x/a.jpg', null, undefined, 0, {}]) {
    assert.equal(resolveAvatarUrl(v), null, `${JSON.stringify(v)} should not resolve`);
  }
});
