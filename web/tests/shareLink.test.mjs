import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePlan, decodePlan, buildShareURL } from '../src/utils/shareLink.js';

const mission = { suit: 'xemu', equipmentKg: 12, rover: true, limits: 'mars', obstacleBuffer: true };

test('science plan: link keeps the start and the settings, not the stops', () => {
  const url = buildShareURL('https://x.io/app/?site=jezero#h', 'gale', {
    waypoints: [{ x: 1.04, z: -2.06 }, { x: 50, z: 50, dwellS: 1200 }, { x: 1.04, z: -2.06 }],
    science: true, route: 'ECO', startMs: 1.8e12, mission, dwellMin: 25, objectiveId: 'water-alteration',
  });
  assert.match(url, /^https:\/\/x\.io\/app\/\?site=gale&plan=[A-Za-z0-9_-]+$/);
  const p = decodePlan(new URL(url).search);
  assert.deepEqual(p.waypoints, [{ x: 1, z: -2.1 }]);
  assert.equal(p.science, true);
  assert.equal(p.route, 'ECO');
  assert.equal(p.startMs, 1.8e12);
  assert.equal(p.dwellMin, 25);
  assert.deepEqual(p.mission, mission);
  assert.equal(p.objectiveId, 'water-alteration');
});

test('hand-made route keeps every waypoint', () => {
  const plan = encodePlan({ waypoints: [{ x: 0, z: 0 }, { x: 10, z: 20 }, { x: -5, z: 3 }], route: 'FAST' });
  const p = decodePlan(`?plan=${plan}`);
  assert.equal(p.science, false);
  assert.deepEqual(p.waypoints.map(w => [w.x, w.z]), [[0, 0], [10, 20], [-5, 3]]);
  assert.equal(p.mission, null);
  assert.equal(p.objectiveId, null);
});

test('bad or missing links are ignored, values are checked', () => {
  assert.equal(decodePlan(''), null);
  assert.equal(decodePlan('?plan=%%%'), null);
  assert.equal(decodePlan('?plan=' + Buffer.from('{"v":99}').toString('base64url')), null);
  const odd = Buffer.from(JSON.stringify({ v: 1, w: [[1, 2], ['a', 3], [4]], r: 'WARP', d: 999,
    m: { suit: 3, equipmentKg: -5, rover: 'yes', limits: 'venus' } })).toString('base64url');
  const p = decodePlan('?plan=' + odd);
  assert.deepEqual(p.waypoints, [{ x: 1, z: 2 }]);
  assert.equal(p.route, null);
  assert.equal(p.dwellMin, 120);
  assert.deepEqual(p.mission, { equipmentKg: 0, rover: false });
});

test('payload items and dust settings round-trip; bad values are dropped', async () => {
  const { encodePlan: enc, decodePlan: dec } = await import('../src/utils/shareLink.js');
  const m = { suit: 'mars', equipmentKg: 11, rover: false, limits: 'lunar',
    payload: { instruments: 4, comms: 1.5, sampling: 3, emergency: 2, other: 0.5 },
    dust: { outerLayer: 'ortho-fabric', jointProtection: 'unknown', equipmentProtection: 'enclosed', covers: 'fitted' } };
  const p = dec(`?plan=${enc({ waypoints: [{ x: 0, z: 0 }], mission: m })}`);
  assert.deepEqual(p.mission.payload, m.payload);
  assert.equal(p.mission.equipmentKg, 11);
  assert.deepEqual(p.mission.dust, m.dust);
  const raw = Buffer.from(JSON.stringify({ v: 1, w: [[0, 0]], m: { suit: 'mars', p: [1, -2, 3, 4, 5], du: { covers: 'magic', outerLayer: 'ortho-fabric' } } })).toString('base64url');
  const q = dec(`?plan=${raw}`);
  assert.equal(q.mission.payload, undefined);
  assert.deepEqual(q.mission.dust, { outerLayer: 'ortho-fabric', jointProtection: 'unknown', equipmentProtection: 'unknown', covers: 'unknown' });
});
