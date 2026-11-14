/**
 * Dynamic oxygen consumption and carried mass (config/oxygen.js for the values and sources).
 *
 *   O2_consumed(t)  = ∫ rate dt over the rate history (piecewise constant; the rate can change mid-EVA)
 *   O2_remaining(t) = max(0, O2_initial − O2_consumed(t))
 *   total carried(t) = fixed suit & PLSS mass + O2_remaining(t) + other equipment
 *
 * Time is MISSION time: a paused EVA does not advance it, and the speed multiplier only changes
 * how fast mission time runs, never the amount consumed per mission hour. Carried mass is shown
 * as an operational figure; it does not change walking speed (no validated model).
 * Pure: tested in Node (tests/oxygen.test.mjs).
 */
import { O2_SCENARIOS, DEFAULT_O2, O2_SIZING, O2_INITIAL_LIMITS, O2_RESERVE } from '../config/oxygen.js';
import { SUITS, MARS_G, EARTH_G } from '../config/mission.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Settings → config. Missing or invalid values are reported in `invalid`, never replaced silently
 * (except the documented sizing assumption when no initial oxygen is entered).
 */
export function oxygenConfig(mission) {
  const o = { ...DEFAULT_O2, ...(mission?.o2 || {}) };
  const invalid = [];
  const sc = O2_SCENARIOS[o.scenario];
  if (!sc) invalid.push({ key: 'scenario', detail: `unknown consumption scenario "${o.scenario}"` });
  const sized = o.initialKg == null;
  let initialKg = null;
  if (sized) initialKg = sc ? sc.rateKgH * O2_SIZING.designDurationH : null;
  else if (num(o.initialKg) && o.initialKg >= O2_INITIAL_LIMITS.min && o.initialKg <= O2_INITIAL_LIMITS.max) initialKg = o.initialKg;
  else invalid.push({ key: 'initialKg', detail: `initial oxygen ${String(o.initialKg)} kg is outside ${O2_INITIAL_LIMITS.min}–${O2_INITIAL_LIMITS.max} kg` });
  let reserveS = null;
  if (num(o.reserveMin) && o.reserveMin >= O2_RESERVE.min && o.reserveMin <= O2_RESERVE.max) reserveS = o.reserveMin * 60;
  else invalid.push({ key: 'reserveMin', detail: `reserve ${String(o.reserveMin)} min is outside ${O2_RESERVE.min}–${O2_RESERVE.max} min` });
  const suit = SUITS[mission?.suit] || null;
  const equipmentKg = num(mission?.equipmentKg) && mission.equipmentKg >= 0 ? mission.equipmentKg : null;
  return {
    scenario: sc ? o.scenario : null, scenarioLabel: sc?.label ?? null, rateKgH: sc?.rateKgH ?? null,
    initialKg, sized, reserveS, invalid, valid: invalid.length === 0,
    mass: { suitKg: suit?.massKg ?? null, equipmentKg },
  };
}

/** Oxygen consumed up to mission time t [s] for a rate history [{ t, rateKgH }] (sorted, first at t = 0). */
export function consumedKg(history, t) {
  if (!history?.length || !(t > 0)) return 0;
  let kg = 0;
  for (let i = 0; i < history.length; i++) {
    const a = history[i].t, b = i + 1 < history.length ? history[i + 1].t : Infinity;
    if (a >= t) break;
    kg += history[i].rateKgH * (Math.min(b, t) - a) / 3600;
  }
  return kg;
}

/** Carried mass with the oxygen still on board (suit mass taken as charged: see O2_MASS_CONVENTION). */
export function carriedMass(cfg, remainingKg) {
  const { suitKg, equipmentKg } = cfg?.mass || {};
  if (!num(suitKg) || !num(equipmentKg) || !num(cfg.initialKg) || !num(remainingKg)) return null;
  const fixedKg = suitKg - cfg.initialKg;
  const totalKg = fixedKg + remainingKg + equipmentKg;
  return { fixedKg, o2Kg: remainingKg, equipmentKg, totalKg, earthEqKg: totalKg * MARS_G / EARTH_G };
}

/**
 * State at mission time t.
 * @param {object} cfg       oxygenConfig()
 * @param {Array}  history   rate history
 * @param {number} t         mission time [s]
 * @param {number} backS     fastest walk home from the current position [s] (Infinity = no path)
 * @param {number} planLeftS time left on the active timeline [s]
 */
export function oxygenState(cfg, history, t, backS, planLeftS = NaN) {
  if (!cfg?.valid) return { valid: false, invalid: cfg?.invalid || [] };
  const rate = history?.length ? history[history.length - 1].rateKgH : cfg.rateKgH;
  const used = consumedKg(history, t);
  const remainingKg = Math.max(0, cfg.initialKg - used);
  const reserveKg = rate * cfg.reserveS / 3600;
  const returnNeedKg = Number.isFinite(backS) ? rate * backS / 3600 : Infinity;
  const planNeedKg = Number.isFinite(planLeftS) ? rate * Math.max(0, planLeftS) / 3600 : null;
  return {
    valid: true, scenario: cfg.scenario, scenarioLabel: cfg.scenarioLabel, rateKgH: rate,
    initialKg: cfg.initialKg, consumedKg: Math.min(used, cfg.initialKg), remainingKg,
    reservePct: cfg.initialKg > 0 ? 100 * remainingKg / cfg.initialKg : 0,
    enduranceS: rate > 0 ? remainingKg / rate * 3600 : Infinity,
    reserveKg, returnNeedKg, planNeedKg,
    returnFeasible: remainingKg >= returnNeedKg,             // enough to walk home from here
    reserveOk: remainingKg >= returnNeedKg + reserveKg,      // … and keep the reserve
    planOk: planNeedKg == null ? null : remainingKg >= planNeedKg + reserveKg,
    empty: remainingKg <= 0,
    mass: carriedMass(cfg, remainingKg),
  };
}

/**
 * Planning check for a route (no playback needed). The worst point of an EVA for oxygen is where
 * elapsed time + fastest walk home is largest; the planner already knows it:
 *   max(t + back) = EVA budget − tightest walk-back margin.
 * Enough oxygen for a safe return from every point:  endurance ≥ max(t + back)
 * … with the reserve:                                 endurance − reserve ≥ max(t + back)
 */
export function planOxygenCheck(cfg, stats) {
  if (!cfg?.valid) return { valid: false, invalid: cfg?.invalid || [] };
  if (!stats || !Number.isFinite(stats.budgetS) || !Number.isFinite(stats.minMarginS)) {
    return { valid: false, invalid: [{ key: 'route', detail: 'no walk-back profile for this route' }] };
  }
  const enduranceS = cfg.initialKg / cfg.rateKgH * 3600;
  const needS = stats.budgetS - stats.minMarginS;            // max over the route of elapsed + walk home
  const needKg = cfg.rateKgH * needS / 3600, reserveKg = cfg.rateKgH * cfg.reserveS / 3600;
  return {
    valid: true, scenarioLabel: cfg.scenarioLabel, rateKgH: cfg.rateKgH, initialKg: cfg.initialKg, sized: cfg.sized,
    enduranceS, needS, needKg, reserveKg, reserveS: cfg.reserveS,
    returnOk: enduranceS >= needS, reserveOk: enduranceS - cfg.reserveS >= needS,
    spareKg: cfg.initialKg - needKg - reserveKg,
  };
}
