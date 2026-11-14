/**
 * ?site=moon — the procedural Moon rover simulator this project grew from must keep working:
 * no DEM, no Mars objectives / provenance, routes still planned with the original cost model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');
assert.notEqual(site.mode, 'dem');                    // nothing loaded → procedural (the Moon)
const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const { objectivesFor } = await import('../src/config/objectives.js');

test('moon: procedural terrain, no Mars objectives', () => {
  assert.equal(T.IS_DEM, false);
  assert.equal(T.GRID_RES, 256);
  assert.deepEqual(objectivesFor('moon'), []);
  assert.ok(T.CRATERS.length > 0);
});

test('moon: all four route modes plan around craters with risk / cost stats', () => {
  const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
  const wall = P.getWallMap();
  const free = [];
  const half = T.TERRAIN_SIZE / 2;
  for (const [x, z] of [[-0.35, -0.35], [0.35, 0.35], [-0.3, 0.3], [0.3, -0.3], [0, -0.4], [0, 0.4]]) {
    const wx = x * T.TERRAIN_SIZE, wz = z * T.TERRAIN_SIZE;
    if (!P.isWallAt(wx, wz)) free.push({ x: wx, z: wz });
  }
  assert.ok(free.length >= 2, 'two free cells');
  const routes = P.planAllRoutes([free[0], free[1]], sm, cm, hm, 45);
  for (const m of ['SAFE', 'ECO', 'FAST', 'AUTO']) {
    const r = routes[m];
    assert.ok(r?.path?.length > 1, `${m} path`);
    assert.ok(Number.isFinite(r.stats.distance) && r.stats.distance > 0);
    assert.equal(r.stats.checks, undefined);            // Marswalk GO checks are DEM-only
    for (const [x, , z] of r.path) {
      assert.ok(Math.abs(x) <= half + 1 && Math.abs(z) <= half + 1);
    }
  }
  assert.ok(wall.some(v => v === 1));
});

test('moon: the oxygen model stays out — no walk-back profile, so no oxygen check is applied', async () => {
  const { planOxygenCheck, oxygenConfig } = await import('../src/utils/oxygen.js');
  const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
  const half = T.TERRAIN_SIZE / 2;
  const pts = [[-0.35, -0.35], [0.35, 0.35], [-0.3, 0.3], [0.3, -0.3], [0, -0.4], [0, 0.4]].map(([x, z]) => ({ x: x * T.TERRAIN_SIZE, z: z * T.TERRAIN_SIZE })).filter(p => !P.isWallAt(p.x, p.z));
  const r = P.planAllRoutes(pts.slice(0, 2), sm, cm, hm);
  assert.equal(r.SAFE.stats.budgetS, undefined);
  assert.equal(planOxygenCheck(oxygenConfig({ suit: 'mars', equipmentKg: 10 }), r.SAFE.stats).valid, false);
  void half;
});
