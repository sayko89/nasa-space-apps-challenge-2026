/** Helmet camera elevation readouts: heights ahead from the DTM, contour interval, colour ramp. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aheadProfile, contourInterval, elevationColor, AHEAD_M } from '../src/utils/helmetView.js';

const plane = (x, z) => 0.1 * x - 0.02 * z;          // rises 10 % to the east, 2 % to the north

test('heights ahead follow the walking direction (forward = sin h, cos h)', () => {
  const east = aheadProfile(plane, 0, 0, Math.PI / 2, 1000, -2600);
  assert.equal(east.absM, -2600);
  assert.deepEqual(east.ahead.map(a => Math.round(a.dhM * 100) / 100), AHEAD_M.map(d => d * 0.1));
  assert.ok(east.ahead.every(a => Math.abs(a.gradePct - 10) < 1e-9));
  const south = aheadProfile(plane, 0, 0, 0, 1000);               // +z = south: height falls 2 %
  assert.ok(south.ahead.every(a => Math.abs(a.gradePct + 2) < 1e-9));
  const west = aheadProfile(plane, 50, 0, -Math.PI / 2, 1000, 0);
  assert.ok(Math.abs(west.ahead[0].absM - (plane(40, 0))) < 1e-9);
});

test('points outside the site are not invented', () => {
  const r = aheadProfile(plane, 990, 0, Math.PI / 2, 1000);
  assert.ok(r.ahead[0]);                                          // 10 m → x = 1000 (edge)
  assert.deepEqual(r.ahead.slice(1), [null, null, null]);
  assert.equal(aheadProfile(() => NaN, 0, 0, 0, 1000).ahead.every(a => a === null), true);
});

test('contour interval gives at most 12 lines; colours diverge around level ground', () => {
  assert.equal(contourInterval(4), 0.5);
  assert.equal(contourInterval(9), 1);
  assert.equal(contourInterval(60), 5);
  assert.equal(contourInterval(400), 50);
  const lvl = elevationColor(0, 5), up = elevationColor(5, 5), down = elevationColor(-5, 5);
  assert.deepEqual(lvl, [178, 150, 112]);
  assert.ok(up[0] > lvl[0] && up[2] < lvl[2]);                  // above: redder
  assert.ok(down[2] > lvl[2] && down[0] < lvl[0]);              // below: bluer
  assert.deepEqual(elevationColor(50, 5), up);                    // saturates
});
