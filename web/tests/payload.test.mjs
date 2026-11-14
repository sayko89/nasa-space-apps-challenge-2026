import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payloadAssessment, PAYLOAD_CATEGORIES, inSuit } from '../src/utils/payload.js';
import { carryCheck, SUITS, MARS_G, EARTH_G } from '../src/config/mission.js';

const items = { instruments: 4, comms: 1.5, sampling: 3, emergency: 2, other: 0.5 };

test('total mass = suit + items; same result as the existing carry check', () => {
  const a = payloadAssessment({ suit: 'mars', payload: items });
  assert.equal(a.equipmentKg, 11);
  assert.equal(a.massKg, SUITS.mars.massKg + 11);
  const c = carryCheck({ suit: 'mars', equipmentKg: 11 });
  assert.equal(a.earthEqKg, c.earthEqKg);
  assert.equal(a.limitKg, 45);                                   // existing limit unchanged (23 + 22)
  assert.equal(a.status, c.ok ? 'WITHIN LIMIT' : 'OVER LIMIT');
  // one equipment figure (not itemised) behaves exactly like before
  const b = payloadAssessment({ suit: 'mars', equipmentKg: 11 });
  assert.equal(b.massKg, a.massKg);
  assert.equal(b.items, null);
});

test('no double counting: suit parts are listed but never added', () => {
  const a = payloadAssessment({ suit: 'mars', payload: { instruments: 0, comms: 0, sampling: 0, emergency: 0, other: 0 } });
  assert.equal(a.massKg, 104);                                   // suit only: life support is inside the 104 kg
  assert.ok(inSuit('mars').some(i => /Life-support/.test(i.label)));
  assert.ok(!PAYLOAD_CATEGORIES.some(c => /life|suit|pressure garment/i.test(c.key + c.label.replace('beyond the suit radio', ''))));
  // unknown keys in the payload object are ignored, not added
  const x = payloadAssessment({ suit: 'mars', payload: { ...items, lifeSupport: 62 } });
  assert.equal(x.equipmentKg, 11);
});

test('limit validation and remaining capacity', () => {
  const max = carryCheck({ suit: 'mars', equipmentKg: 0 }).maxEquipmentKg;
  const ok = payloadAssessment({ suit: 'mars', payload: { ...items, other: 0, instruments: max - 6.5 - 1e-6 } });
  assert.equal(ok.status, 'WITHIN LIMIT');
  assert.ok(ok.remainingKg >= 0 && ok.remainingKg < 1e-3);
  const over = payloadAssessment({ suit: 'mars', payload: { ...items, other: 10 } });
  assert.equal(over.status, max < 20.5 ? 'OVER LIMIT' : 'WITHIN LIMIT');
  const heavy = payloadAssessment({ suit: 'xemu', equipmentKg: 0 });  // 170 kg lunar suit alone is over the Mars limit
  assert.equal(heavy.status, 'OVER LIMIT');
  assert.ok(heavy.remainingKg < 0);
  // remaining mass converts Earth-equivalent back with the Mars / Earth gravity ratio
  assert.ok(Math.abs(ok.remainingEarthEqKg * EARTH_G / MARS_G - ok.remainingKg) < 1e-9);
});

test('missing or invalid values → INSUFFICIENT DATA, never a default', () => {
  for (const bad of [null, undefined, -1, NaN, Infinity, '3']) {
    const a = payloadAssessment({ suit: 'mars', payload: { ...items, sampling: bad } });
    assert.equal(a.status, 'INSUFFICIENT DATA', String(bad));
    assert.equal(a.massKg, null);
    assert.equal(a.invalid[0].key, 'sampling');
  }
  assert.equal(payloadAssessment({ suit: 'mars' }).status, 'INSUFFICIENT DATA');          // no equipment figure
  assert.equal(payloadAssessment({ suit: 'venus', equipmentKg: 5 }).status, 'INSUFFICIENT DATA');
});
