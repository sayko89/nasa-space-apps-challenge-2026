import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestTargets, levelMean, standouts, chemAnomalies } from '../src/utils/chemistry.js';

const chem = {
  rmsep: { SiO2: 4, FeOT: 3, MgO: 1.5, CaO: 1.5 },
  targets: [
    { name: 'A', x: 0, z: 0, bedrock: 2, oxides: { SiO2: 50, FeOT: 20, MgO: 6, CaO: 2 } },
    { name: 'B', x: 30, z: 40, bedrock: 2, oxides: { SiO2: 42, FeOT: 18, MgO: 9, CaO: 3 } },
    { name: 'C', x: 300, z: 0, bedrock: 1, oxides: { SiO2: 40 } },
  ],
  by_bedrock: [{ code: 2, name: 'Boxwork-bearing layer', mean: { SiO2: 44, FeOT: 19, MgO: 6.5, CaO: 2.6 } }],
};

test('nearest targets are sorted by distance and limited by radius', () => {
  const t = nearestTargets(chem, 5, 0, 60);
  assert.deepEqual(t.map(x => x.name), ['A', 'B']);
  assert.equal(Math.round(t[1].dist), Math.round(Math.hypot(25, 40)));
  assert.equal(nearestTargets(chem, 1000, 1000).length, 0);
  assert.equal(nearestTargets(null, 0, 0).length, 0);
});

test('standouts are oxides beyond the ChemCam accuracy, largest first', () => {
  const lvl = levelMean(chem, 2);
  assert.equal(lvl.name, 'Boxwork-bearing layer');
  const s = standouts(chem, chem.targets[0], lvl, 1);
  assert.deepEqual(s.map(x => x.oxide), ['SiO2']);            // +6 > 4; FeOT +1 < 3; MgO -0.5 < 1.5
  assert.deepEqual(standouts(chem, chem.targets[1], lvl, 1).map(x => x.oxide), ['MgO']); // +2.5 > 1.5
  assert.deepEqual(standouts(chem, chem.targets[0], lvl), []);   // default 2×RMSEP: +6 < 8
  assert.equal(levelMean(chem, 9), null);
  assert.deepEqual(standouts(chem, chem.targets[0], null), []);
});

test('chemAnomalies: only beyond 2× RMSEP, tagged by oxide and direction', () => {
  const c = { ...chem, targets: [...chem.targets, { name: 'D', x: 0, z: 0, bedrock: 2, oxides: { MgO: 1, CaO: 9 } }] };
  const a = chemAnomalies(c);
  assert.deepEqual(a.map(x => `${x.target.name} ${x.tag}`), ['D MgO low', 'D CaO high']);
  assert.equal(chemAnomalies(null).length, 0);
});
