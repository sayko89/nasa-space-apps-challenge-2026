import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCuffCard, fmtMET, bearingDeg, compass } from '../src/utils/cuffCard.js';

test('fmtMET writes Apollo h+mm', () => {
  assert.equal(fmtMET(3960), '1+06');
  assert.equal(fmtMET(0), '0+00');
  assert.equal(fmtMET(-720), '−0+12');
  assert.equal(fmtMET(NaN), '—');
});

test('bearing: +x east, +z south', () => {
  assert.equal(Math.round(bearingDeg(0, 0, 0, -10)), 0);     // north
  assert.equal(Math.round(bearingDeg(0, 0, 10, 0)), 90);     // east
  assert.equal(Math.round(bearingDeg(0, 0, 0, 10)), 180);    // south
  assert.equal(Math.round(bearingDeg(0, 0, -10, 0)), 270);   // west
  assert.equal(compass(44), 'NE');
});

// home (0,0) → 100 m east → stop A (dwell 600) → 100 m north → stop B (dwell 300) → home
const path = [[0, 0, 0], [100, 0, 0], [100, 0, -100], [0, 0, 0]];
const budgetS = 8 * 3600;
const elapsedS = [0, 100 + 600, 100 + 600 + 100 + 300, 100 + 600 + 100 + 300 + 141];
const back = [0, 100, 141, 0];                     // fastest walk home from each point
const stats = {
  elapsedS, budgetS, returnTimeS: 0,
  marginS: elapsedS.map((e, i) => budgetS - e - back[i]),
  stops: [{ idx: 2, dwellS: 300, label: 'B' }, { idx: 1, dwellS: 600, label: 'A' }],   // unsorted on purpose
  minMarginS: budgetS - 1100 - 141, ponrIdx: -1, go: true,
};

test('rows: arrival, stay, leg, bearing, back, leave-by, margin', () => {
  const c = buildCuffCard(path, stats, {});
  assert.deepEqual(c.rows.map(r => r.label), ['A', 'B']);
  const [a, b] = c.rows;
  assert.equal(a.arriveS, 100); assert.equal(a.stayS, 600); assert.equal(a.departS, 700);
  assert.equal(a.legM, 100); assert.equal(Math.round(a.bearingDeg), 90);
  assert.equal(a.backS, 100); assert.equal(a.leaveByS, budgetS - 100);
  assert.equal(a.marginS, a.leaveByS - a.departS);
  assert.equal(b.arriveS, 800); assert.equal(b.legM, 100); assert.equal(Math.round(b.bearingDeg), 0);
  assert.equal(b.backS, 141);
  assert.equal(c.home.arriveS, 1241); assert.equal(Math.round(c.home.legM), 141);
  assert.equal(Math.round(c.home.bearingDeg), 225);                 // B (100,-100) → home: south-west
  assert.equal(c.home.reserveS, budgetS - 1241);
  assert.equal(c.totals.stayS, 900); assert.equal(c.totals.tightestStop, 2);
});

test('environment lookups are taken at arrival time', () => {
  const t0 = Date.UTC(2026, 10, 7, 9);
  const c = buildCuffCard(path, stats, {
    startMs: t0, ltstAt: ms => (ms - t0) / 3600e3 + 9,
    sunAt: () => ({ elevationDeg: 30 }), airAt: ms => ({ median: 200 + (ms - t0) / 1000 / 100 }),
  });
  assert.equal(c.rows[0].ltstH, 9 + 100 / 3600);
  assert.equal(c.rows[1].airK, 208);
  assert.equal(c.rows[0].sunElevDeg, 30);
  assert.throws(() => buildCuffCard(path, {}), /planned DEM route/);
});

test('emergency return: each station gives the direction and distance of the habitat', () => {
  const c = buildCuffCard(path, stats, {});
  const [a, b] = c.rows;
  assert.equal(Math.round(a.homeBearingDeg), 270);   // A (100, 0) → home: west
  assert.equal(compass(a.homeBearingDeg), 'W');
  assert.equal(Math.round(a.homeDistM), 100);
  assert.equal(Math.round(b.homeBearingDeg), 225);   // B (100, −100) → home: south-west
  assert.equal(Math.round(b.homeDistM), 141);
});
