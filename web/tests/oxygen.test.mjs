/** Dynamic oxygen consumption and carried mass: model, planning check, EVA playback. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oxygenConfig, consumedKg, oxygenState, carriedMass, planOxygenCheck } from '../src/utils/oxygen.js';
import { O2_SCENARIOS, O2_SIZING } from '../src/config/oxygen.js';
import { carryCheck, DEFAULT_MISSION } from '../src/config/mission.js';
import { missionDecision } from '../src/utils/missionStatus.js';
import { EvaPlayback } from '../src/utils/evaPlayback.js';
import { walkTimeS } from '../src/utils/walkModel.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const M = (o2, over = {}) => ({ suit: 'mars', equipmentKg: 10, ...over, o2: { scenario: 'swing-bed', initialKg: null, reserveMin: 30, ...o2 } });

test('BVAD reference scenarios: values and per-sortie consistency (0.3 / 0.6 / 4.0 kg per 4 h)', () => {
  assert.equal(O2_SCENARIOS['closed-loop'].rateKgH, 0.076);
  assert.equal(O2_SCENARIOS['swing-bed'].rateKgH, 0.15);
  assert.equal(O2_SCENARIOS.cryogenic.rateKgH, 1.0);
  for (const s of Object.values(O2_SCENARIOS)) {
    assert.ok(Math.abs(s.rateKgH * 4 - s.kgPer4h) < 0.01, s.label);
    assert.match(s.source, /NASA\/TP-2015-218570\/REV2/);
  }
  assert.ok(DEFAULT_MISSION.o2 && O2_SCENARIOS[DEFAULT_MISSION.o2.scenario]);
});

test('depletion differs by scenario; remaining = max(0, initial − consumed)', () => {
  const t = 3 * 3600;
  for (const [k, s] of Object.entries(O2_SCENARIOS)) {
    const cfg = oxygenConfig(M({ scenario: k, initialKg: 2 }));
    const o = oxygenState(cfg, [{ t: 0, rateKgH: s.rateKgH }], t, 600);
    assert.ok(close(o.consumedKg, Math.min(2, s.rateKgH * 3)), k);
    assert.ok(close(o.remainingKg, Math.max(0, 2 - s.rateKgH * 3)), k);
  }
  // sized initial oxygen: rate × design duration (documented assumption)
  const sized = oxygenConfig(M({ scenario: 'closed-loop' }));
  assert.equal(sized.sized, true);
  assert.ok(close(sized.initialKg, 0.076 * O2_SIZING.designDurationH));
  // piecewise rate history
  assert.ok(close(consumedKg([{ t: 0, rateKgH: 0.15 }, { t: 3600, rateKgH: 1.0 }], 5400), 0.15 + 0.5));
});

test('zero-oxygen boundary: never negative, endurance 0, return infeasible', () => {
  const cfg = oxygenConfig(M({ scenario: 'cryogenic', initialKg: 1 }));
  const o = oxygenState(cfg, [{ t: 0, rateKgH: 1 }], 2 * 3600, 300);
  assert.equal(o.remainingKg, 0);
  assert.equal(o.consumedKg, 1);
  assert.equal(o.empty, true);
  assert.equal(o.enduranceS, 0);
  assert.equal(o.returnFeasible, false);
  assert.equal(o.reservePct, 0);
});

test('reserve warning: return feasible but reserve not kept', () => {
  const cfg = oxygenConfig(M({ scenario: 'swing-bed', initialKg: 1.2, reserveMin: 30 }));    // 8 h at 0.15
  const h = [{ t: 0, rateKgH: 0.15 }];
  const ok = oxygenState(cfg, h, 3600, 1800);
  assert.equal(ok.reserveOk, true);
  const tight = oxygenState(cfg, h, 7.1 * 3600, 1800);   // 0.135 kg left; home 0.075 + reserve 0.075
  assert.equal(tight.returnFeasible, true);
  assert.equal(tight.reserveOk, false);
  assert.equal(oxygenState(cfg, h, 7.9 * 3600, 1800).returnFeasible, false);
});

test('carried mass: fixed + remaining O₂ + equipment; O₂ not counted twice; falls only by the O₂ used', () => {
  const cfg = oxygenConfig(M({ scenario: 'cryogenic', initialKg: 8 }));
  const start = carriedMass(cfg, cfg.initialKg);
  assert.equal(start.totalKg, 104 + 10);                                       // = existing carry-check mass
  assert.equal(start.totalKg, carryCheck({ suit: 'mars', equipmentKg: 10 }).massKg);
  assert.equal(start.fixedKg, 96);                                              // suit taken as charged
  const later = carriedMass(cfg, 3);
  assert.equal(start.totalKg - later.totalKg, 5);
  assert.equal(later.fixedKg, start.fixedKg);                                  // the suit itself does not get lighter
  assert.equal(carriedMass(oxygenConfig(M({}, { equipmentKg: -1 })), 1), null);
});

test('invalid settings → INSUFFICIENT DATA, never a silent default', () => {
  for (const o2 of [{ scenario: 'magic' }, { initialKg: -1 }, { initialKg: 999 }, { reserveMin: -5 }, { reserveMin: null }]) {
    const cfg = oxygenConfig(M(o2));
    assert.equal(cfg.valid, false, JSON.stringify(o2));
    const d = missionDecision(STATS(), { limits, wx: clearWx, hazards: [], oxygen: planOxygenCheck(cfg, STATS()) });
    assert.equal(d.status, 'INSUFFICIENT DATA');
    assert.ok(d.missing.some(m => m.key === 'oxygen'));
  }
});

const limits = { maxSlopeDeg: 20, maxRadialM: 2000 };
const clearWx = { advisory: 'clear', near: [], sep: [] };
function STATS(over = {}) {
  return { minMarginS: 3 * 3600, budgetS: 8 * 3600, ponrIdx: -1, maxSlopeDeg: 12, maxRadialM: 900, light: { homeBySunset: true },
    ...over, checks: { budget: true, slope: true, radial: true, daylight: true, ...(over.checks || {}) } };
}

test('planning: never GO when O₂ cannot cover the safe return; reserve → CONDITIONAL', () => {
  const s = STATS();                                       // worst point needs 8 h − 3 h = 5 h
  const go = missionDecision(s, { limits, wx: clearWx, hazards: [], oxygen: planOxygenCheck(oxygenConfig(M({ initialKg: 1.0 })), s) });   // 6.67 h
  assert.equal(go.status, 'GO');
  const res = missionDecision(s, { limits, wx: clearWx, hazards: [], oxygen: planOxygenCheck(oxygenConfig(M({ initialKg: 0.8 })), s) });  // 5.33 h < 5.5
  assert.equal(res.status, 'CONDITIONAL');
  assert.match(res.summary, /oxygen reserve not kept/);
  const no = missionDecision(s, { limits, wx: clearWx, hazards: [], oxygen: planOxygenCheck(oxygenConfig(M({ initialKg: 0.7 })), s) });   // 4.67 h < 5
  assert.equal(no.status, 'NO-GO');
  assert.match(no.summary, /oxygen/);
  // the cryogenic architecture empties a sized-for-1.2 kg tank long before the route ends
  const cryo = planOxygenCheck(oxygenConfig(M({ scenario: 'cryogenic', initialKg: 1.2 })), s);
  assert.equal(cryo.returnOk, false);
  // recalculated when the scenario changes: same tank, lower rate → feasible again
  assert.equal(planOxygenCheck(oxygenConfig(M({ scenario: 'closed-loop', initialKg: 1.2 })), s).reserveOk, true);
  // without oxygen context the decision is exactly as before
  assert.deepEqual(missionDecision(s, { limits, wx: clearWx, hazards: [] }).hard.map(h => h.key), ['budget', 'slope', 'radial', 'daylight']);
});

// ---- playback with a synthetic straight route: 1800 m out (1 m/s), 600 s stop, 1800 m back
function loaded(o2) {
  const pb = new EvaPlayback();
  pb.setOxygen(oxygenConfig(M(o2)));
  const path = [[0, 0, 0], [1800, 0, 0], [1800, 0, 0], [0, 0, 0]];
  const elapsedS = [0, 1800, 2400, 4200];
  const env = { toHomeAt: (x, z) => Math.hypot(x, z), returnPath: (x, z) => ({ path: [[x, 0, z], [0, 0, 0]] }), heightAt: () => 0 };
  pb.load(path, { elapsedS, stops: [{ idx: 2, dwellS: 600, label: 'rock' }] }, { mode: 'SAFE', budgetS: 8 * 3600 }, env);
  return pb;
}

test('playback: paused EVA does not consume; speed multiplier changes mission time only', () => {
  const pb = loaded({ initialKg: 1.2 });
  pb.play(); pb.setSpeed(30); pb.tick(10);                  // 300 s mission time
  const a = pb.oxygenAt();
  assert.ok(close(a.consumedKg, 0.15 * 300 / 3600));
  pb.pause();
  for (let i = 0; i < 50; i++) pb.tick(10);
  assert.ok(close(pb.oxygenAt().consumedKg, a.consumedKg), 'paused');
  pb.play(); pb.setSpeed(600); pb.tick(1);                  // +600 s
  assert.ok(close(pb.oxygenAt().consumedKg, 0.15 * 900 / 3600));
  // same mission time reached at ×1 → same oxygen
  const pb1 = loaded({ initialKg: 1.2 }); pb1.play(); pb1.setSpeed(1); for (let i = 0; i < 900; i++) pb1.tick(1);
  assert.ok(close(pb1.oxygenAt().consumedKg, pb.oxygenAt().consumedKg, 1e-9));
  // walking, science stop and walking home all consume at the scenario rate
  pb.setSpeed(600); while (pb.status === 'playing') pb.tick(1);
  assert.ok(close(pb.oxygenAt().consumedKg, 0.15 * 4200 / 3600));
  assert.equal(pb.status, 'done');
});

test('playback: abort and walk home keep consuming; rate change mid-EVA re-evaluates the return', () => {
  const pb = loaded({ scenario: 'swing-bed', initialKg: 0.5 });
  pb.play(); pb.setSpeed(600); pb.tick(2);                   // t = 1200 s, 1200 m out
  assert.ok(pb.abort('manual abort'));
  while (pb.status === 'playing') pb.tick(1);
  const etaS = walkTimeS(1200, 0);                           // abort timeline walks home with the walk model
  assert.ok(close(pb.t, 1200 + etaS, 1e-6));
  assert.ok(close(pb.oxygenAt().consumedKg, 0.15 * pb.t / 3600, 1e-9));
  // rate change: cryogenic from t = 1200 s with 0.5 kg tank → return no longer feasible, event raised
  const pc = loaded({ scenario: 'swing-bed', initialKg: 0.5 });
  pc.play(); pc.setSpeed(600); pc.tick(2);
  assert.equal(pc.oxygenAt().returnFeasible, true);
  pc.setOxygen(oxygenConfig(M({ scenario: 'cryogenic', initialKg: 0.5 })));
  const o = pc.oxygenAt();
  assert.ok(close(o.consumedKg, 0.15 * 1200 / 3600));        // the past is not re-priced
  assert.equal(o.rateKgH, 1.0);
  pc.tick(1);
  assert.ok(pc.events.some(e => e.kind === 'o2-rate'));
  assert.ok(pc.events.some(e => e.kind === 'o2-return' || e.kind === 'o2-reserve'));
  // a sized tank is not re-sized by a scenario change mid-EVA; a restart takes the new settings
  const pd = loaded({ scenario: 'swing-bed' });                 // sized 1.2 kg
  pd.play(); pd.setSpeed(600); pd.tick(1);
  pd.setOxygen(oxygenConfig(M({ scenario: 'cryogenic' })));    // would size 8 kg before the EVA
  assert.equal(pd.oxygenAt().initialKg, 1.2);
  assert.equal(pd.oxygenAt().mass.totalKg + pd.oxygenAt().consumedKg, 114);
  pd.restart(false);
  assert.equal(pd.oxygenAt().initialKg, 8);
  assert.equal(pd.oxygenAt().rateKgH, 1.0);
});

test('playback: reserve warning, then depletion, as events; seek back restores the state', () => {
  const pb = loaded({ scenario: 'cryogenic', initialKg: 1.0, reserveMin: 30 });   // 1 h of O₂
  pb.play(); pb.setSpeed(30);
  const kinds = () => pb.events.map(e => e.kind);
  while (pb.status === 'playing' && !kinds().includes('o2-empty')) pb.tick(1);
  assert.ok(kinds().includes('o2-reserve') || kinds().includes('o2-return'));
  assert.ok(kinds().includes('o2-empty'));
  assert.equal(pb.oxygenAt().remainingKg, 0);
  const tEmpty = pb.t;
  pb.seek(600);
  assert.ok(close(pb.oxygenAt().consumedKg, 600 / 3600));
  assert.ok(pb.t < tEmpty);
  const ser = pb.oxygenSeries(20);
  assert.equal(ser.pts.length, 21);
  assert.ok(ser.pts.every((p, i) => i === 0 || p.remainingKg <= ser.pts[i - 1].remainingKg));
  assert.ok(ser.pts.every((p, i) => i === 0 || p.massKg <= ser.pts[i - 1].massKg));
});
