import { test } from 'node:test';
import assert from 'node:assert/strict';

// Renderer modules hold WGSL in template literals; a stray backtick in a
// shader comment ends the string and breaks the whole app at load
for (const m of ['heatmap-render', 'ride-render', 'ride-scene', 'heatmap', 'demo-streams']) {
  test(`src/${m}.js parses and loads`, async () => {
    const mod = await import(`../src/${m}.js`);
    assert.ok(Object.keys(mod).length > 0);
  });
}
