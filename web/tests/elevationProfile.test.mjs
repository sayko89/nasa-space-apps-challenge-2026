import test from 'node:test';
import assert from 'node:assert/strict';
import { elevationProfile, profileGeometry } from '../src/utils/elevationProfile.js';

// 0 → 300 m east climbing 30 m, then 400 m south down to −10 m, back to start height
const path = [[0, 0, 0], [100, 10, 0], [200, 20, 0], [300, 30, 0], [300, 5, 200], [300, -10, 400], [0, 0, 0]];
const stats = { stops: [{ idx: 5, label: 'B' }, { idx: 3, label: 'A' }] };

test('profile: distance, absolute elevation, extremes, stops in route order', () => {
  const p = elevationProfile(path, stats, -2600);
  assert.equal(p.totalM, 300 + 400 + 500);
  assert.equal(p.minM, -2610); assert.equal(p.maxM, -2570); assert.equal(p.startM, -2600);
  assert.deepEqual(p.stops.map(s => [s.n, s.label, s.distM, s.elevM]), [[1, 'A', 300, -2570], [2, 'B', 700, -2610]]);
  assert.equal(p.points[0].distM, 0); assert.equal(p.points.at(-1).distM, 1200);
});

test('thinning keeps stops and extremes', () => {
  const long = Array.from({ length: 5000 }, (_, i) => [i, Math.sin(i / 300) * 20 + (i === 1234 ? 90 : 0), 0]);
  const p = elevationProfile(long, { stops: [{ idx: 777 }] }, 0, 100);
  assert.ok(p.points.length <= 110);
  assert.equal(p.maxM, long[1234][1]);
  assert.ok(p.points.some(q => q.distM === 1234) && p.points.some(q => q.distM === 777));
  assert.equal(elevationProfile([[0, 0, 0]]), null);
});

test('geometry stays inside the box and puts higher ground higher', () => {
  const p = elevationProfile(path, stats, 0);
  const g = profileGeometry(p, 300, 60, { l: 30, r: 5, t: 10, b: 10 });
  assert.equal(g.X(0), 30); assert.equal(g.X(p.totalM), 295);
  assert.ok(g.Y(p.maxM) > 10 && g.Y(p.minM) < 50 && g.Y(p.maxM) < g.Y(p.minM));
  assert.match(g.line, /^M30\.00,/);
});
