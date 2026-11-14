import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dilate, depressionDepth, hazardMap, routeHazards, HAZARD_CLASSES } from '../src/utils/hazards.js';

const P = { steepFraction: 0.75, roughFraction: 0.5, obstacleBufferM: 4, depressionM: 1, unseenM: 100 };

test('dilate: disk of radius r, nothing outside the grid', () => {
  const n = 7, m = new Uint8Array(n * n); m[3 * n + 3] = 1;
  const d = dilate(m, n, 1);
  assert.deepEqual([...d].reduce((a, v, i) => (v ? [...a, i] : a), []), [2 * n + 3, 3 * n + 2, 3 * n + 3, 3 * n + 4, 4 * n + 3]);
  assert.equal(dilate(m, n, 2).reduce((a, v) => a + v, 0), 13);
  assert.deepEqual([...dilate(m, n, 0)], [...m]);
});

test('depressionDepth: a 3 m pit fills to its rim; a slope that drains off the site does not', () => {
  const n = 9, h = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h[r * n + c] = c * 0.5;        // tilted plane: drains west
  const d0 = depressionDepth(h, n);
  assert.ok([...d0].every(v => Math.abs(v) < 1e-6));
  h[4 * n + 4] -= 3;                                                                        // pit
  const d = depressionDepth(h, n);
  assert.ok(Math.abs(d[4 * n + 4] - 2.5) < 1e-6, `pit depth ${d[4 * n + 4]}`);              // spills over the lowest neighbour (−0.5 m)
  assert.equal(d[0], 0);
});

function grid() {
  const n = 40, cellM = 4, N = n * n;
  const heights = new Float32Array(N), slopeDeg = new Float32Array(N), rock = new Float32Array(N);
  slopeDeg[10 * n + 10] = 25;                 // over the 20° limit
  rock[30 * n + 30] = 0.8;                    // rock obstacle
  slopeDeg[20 * n + 5] = 17;                  // steep (> 15°)
  rock[20 * n + 35] = 0.3;                    // rough (> 0.25 m)
  heights[5 * n + 30] = -2;                   // pit, 2 m
  return { n, cellM, heights, slopeDeg, rock, maxSlopeDeg: 20, maxRockReliefM: 0.5, params: P };
}

test('classes follow the documented thresholds and priority', () => {
  const g = grid(), { n } = g;
  const { cls } = hazardMap(g);
  assert.equal(cls[10 * n + 10], 1);          // slope wall
  assert.equal(cls[30 * n + 30], 2);          // rock wall
  assert.equal(cls[10 * n + 11], 3);          // 4 m buffer next to the slope wall
  assert.equal(cls[10 * n + 12], 0);          // 8 m away: nothing
  assert.equal(cls[5 * n + 30], 4);           // depression
  assert.equal(cls[20 * n + 5], 5);           // steep
  assert.equal(cls[20 * n + 35], 6);          // rough
  assert.equal(HAZARD_CLASSES[1].hard && HAZARD_CLASSES[2].hard && !HAZARD_CLASSES[3].hard, true);
});

test('ground known only from orbit, and rover reach, only when that data exists', () => {
  const g = grid(), { n } = g, half = (n - 1) * g.cellM / 2;
  // no stations → no "unseen" class at all (missing data is not invented)
  assert.equal(hazardMap(g).counts[8], 0);
  const station = { x: -half, z: -half };     // north-west corner
  const h = hazardMap({ ...g, stations: [station] });
  assert.equal(h.cls[0], 0);                   // next to the rover's position
  assert.equal(h.cls[39 * n + 39], 8);         // ~220 m away
  const toHome = new Float32Array(n * n).fill(100); toHome[39 * n + 0] = 2400;
  const r = hazardMap({ ...g, toHome, roverLimitS: 1800 });
  assert.equal(r.cls[39 * n + 0], 7);
  assert.equal(hazardMap({ ...g, toHome }).counts[7], 0);   // no rover limit → no rover class
});

test('routeHazards: length on each class, hard ones flagged', () => {
  const g = grid(), { n } = g;
  const { cls } = hazardMap(g);
  const at = (x, z) => Math.round(z) * n + Math.round(x);         // test frame: 1 unit = 1 cell
  const path = [[8, 0, 10], [9, 0, 10], [10, 0, 10], [11, 0, 10], [12, 0, 10]];
  const hz = routeHazards(path, cls, at);
  assert.deepEqual(hz.map(h => [h.key, h.lengthM, h.hard]), [['buffer', 2, false], ['slope', 1, true]]);
});
