/**
 * Suit / equipment carry check and rover safe-haven numbers (Ogilvie et al., ICES 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../src/config/mission.js');

test('Mars suit (104 kg) fits the 45 kg Earth-equivalent carry limit, lunar xEMU (170 kg) does not', () => {
  const mars = M.carryCheck({ suit: 'mars', equipmentKg: 0 });
  assert.ok(Math.abs(mars.earthEqKg - 104 * 3.711 / 9.80665) < 1e-9);
  assert.equal(mars.limitKg, 45);
  assert.ok(mars.ok);
  assert.ok(!M.carryCheck({ suit: 'xemu', equipmentKg: 0 }).ok);
});

test('equipment allowance: exactly at the limit passes, 1 kg more fails', () => {
  const max = M.carryCheck({ suit: 'mars' }).maxEquipmentKg;
  assert.ok(max > 14 && max < 16);
  assert.ok(M.carryCheck({ suit: 'mars', equipmentKg: max - 1e-6 }).ok);
  assert.ok(!M.carryCheck({ suit: 'mars', equipmentKg: max + 1 }).ok);
});

test('rover drive estimate: 1 km at 10 km/h = 6 min', () => {
  const d = M.roverDrive(600, 800);
  assert.ok(Math.abs(d.km - 1) < 1e-12);
  assert.ok(Math.abs(d.minutes - 6) < 1e-9);
});
