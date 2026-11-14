/**
 * EVA playback controller — "carry out" the planned Marswalk (Stage 7).
 *
 * Plays the planned route on its own timeline (utils/evaTimeline.js): the crew
 * walks each segment in exactly the time the planner budgeted, stops for the
 * planned dwell at science stops, and the mission clock drives the sun and the
 * expected air temperature. At every instant the live walk-back margin is
 *   margin(t) = EVA budget − t − fastest walk home from the current position
 * (same definition as the planner). ABORT switches to the fastest path home
 * on the same Dijkstra map (pathfinder.fastestReturnPath), so the abort ETA is
 * exactly the return time the margin assumed.
 *
 * Framework-free (no React / Three): the scene calls tick(dt) once per frame,
 * the HUD subscribes. All site lookups are injected via `env`, so it is unit
 * tested in Node (tests/eva.test.mjs).
 *
 * Oxygen (utils/oxygen.js): consumed on MISSION time from a rate history, so pausing stops it,
 * the speed multiplier does not change the amount per mission hour, walking, stops and an abort
 * all consume at the scenario rate, and a rate change mid-EVA re-evaluates the return at once.
 */

import {
  buildTimeline, timelineFromPath, sampleTimeline, nextStop, currentStop,
  stopsCompleted, minDistanceAhead,
} from './evaTimeline.js';
import { fmtHM } from './format.js';
import { oxygenState } from './oxygen.js';
import { spliceTimeline, retracePath, safetyZoneRadius, DUST_REROUTE } from './dustReroute.js';

export const SPEEDS = [1, 30, 120, 600];
export const DEFAULT_SPEED = 120;
/** EV2 walks this many mission seconds behind EV1 (visual spacing only). */
export const EV2_LAG_S = 10;
/** HUD warnings when the walk-back margin drops below these (display thresholds, not sourced). */
export const MARGIN_WARN_S = [3600, 1800, 900];
/** A dust devil this far ahead on the route (mission seconds of walking) triggers an abort. */
export const HAZARD_LOOKAHEAD_S = 600;

export class EvaPlayback {
  constructor() {
    this.listeners = new Set();
    this.version = 0;
    this.speed = DEFAULT_SPEED;
    this.hazard = null;
    this.o2cfg = null;             // oxygenConfig() — survives reloads; set by setOxygen()
    this.dustPlanner = null;       // (ctx) → planDustReroute result; null = a dust devil ahead aborts (old behaviour)
    this._clear();
  }

  _clear() {
    this.status = 'idle';          // idle | ready | playing | paused | done
    this.aborted = null;           // { reason, t0, etaS, fromX, fromZ }
    this.rerouted = null;          // { t0, extraS, skipped, path, checks } — route changed around a dust devil
    this._toHomeOverride = null;   // walk-home times avoiding the dust devil (after a re-route)
    this._lastAvoidReturn = null;  // walk home around the dust devil (from the last re-route attempt)
    this.t = 0;                    // mission elapsed time [s]
    this.nominal = null;           // planned timeline
    this.active = null;            // nominal, or the abort (return) timeline
    this.meta = null;
    this.env = null;
    this.events = [];
    this.o2History = [];           // [{ t, rateKgH }] mission-time rate history
    this._seriesCache = null;
    this._resetFlags();
  }

  _resetFlags() {
    this.flags = { ponr: false, warned: new Set(), sunset: false, noPath: false, o2Reserve: false, o2Return: false, o2Empty: false, rerouted: false };
  }

  /**
   * Oxygen settings (oxygenConfig()). Mid-EVA a new rate applies from the current mission time on;
   * the oxygen on board cannot change once the EVA has started, so the initial mass is kept
   * (a restart or a new load takes the requested settings in full).
   */
  setOxygen(cfg) {
    const prevRate = this.o2History.length ? this.o2History[this.o2History.length - 1].rateKgH : null;
    this.o2Requested = cfg || null;
    const started = this.nominal && this.t > 0 && this.o2cfg?.valid;
    this.o2cfg = started && cfg?.valid ? { ...cfg, initialKg: this.o2cfg.initialKg, sized: this.o2cfg.sized } : (cfg || null);
    if (this.nominal) {
      if (!cfg?.valid) this.o2History = [];
      else if (!this.o2History.length) this.o2History = [{ t: 0, rateKgH: cfg.rateKgH }];
      else if (cfg.rateKgH !== prevRate) {
        this.o2History = this.o2History.filter(h => h.t < this.t);
        this.o2History.push({ t: this.t, rateKgH: cfg.rateKgH });
        if (this.t > 0) this._event('o2-rate', `O₂ scenario now ${cfg.scenarioLabel} (${cfg.rateKgH} kg/h) — return re-evaluated`);
      }
      this.flags.o2Reserve = this.flags.o2Return = this.flags.o2Empty = false;
      this._checkOxygen();
    }
    this._seriesCache = null;
    this._emit('oxygen');
  }

  /** Oxygen state at mission time t (null without valid oxygen settings). */
  oxygenAt(t = this.t) {
    if (!this.o2cfg?.valid || !this.active || !this.o2History.length) return null;
    const p = this._poseAt(t);
    return oxygenState(this.o2cfg, this.o2History, t, this._toHome(p.x, p.z), this.active.totalS - t);
  }

  /** Oxygen and carried mass over the whole active timeline (current rate continues), for the charts. */
  oxygenSeries(n = 60) {
    if (!this.o2cfg?.valid || !this.active || !this.o2History.length) return null;
    const key = `${this.active.totalS}|${this.aborted?.t0 ?? ''}|${JSON.stringify(this.o2History)}|${this.o2cfg.initialKg}|${this.o2cfg.reserveS}`;
    if (this._seriesCache?.key === key) return this._seriesCache.data;
    const T = this.active.totalS, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = T * i / n, o = this.oxygenAt(t);
      pts.push({ t, remainingKg: o.remainingKg, returnNeedKg: o.returnNeedKg + o.reserveKg,
        planNeedKg: o.planNeedKg + o.reserveKg, massKg: o.mass ? o.mass.totalKg : null });
    }
    const data = { totalS: T, initialKg: this.o2cfg.initialKg, pts };
    this._seriesCache = { key, data };
    return data;
  }

  /** Walk-home time from (x, z): around the dust devil after a re-route, else the planner's map. */
  _toHome(x, z) { return this._toHomeOverride ? this._toHomeOverride(x, z) : this.env.toHomeAt(x, z); }

  /** Re-plan around a dust devil instead of aborting (App passes a planner bound to the site grids). */
  setDustPlanner(fn) { this.dustPlanner = fn || null; }

  _poseAt(t) {
    if (this.aborted && t < this.aborted.t0) return sampleTimeline(this.nominal, Math.max(0, t));
    return sampleTimeline(this.active, Math.max(this.active.startS ?? 0, t));
  }

  _checkOxygen() {
    const o = this.oxygenAt();
    if (!o) return;
    if (o.empty && !this.flags.o2Empty) { this.flags.o2Empty = true; this._event('o2-empty', 'OXYGEN DEPLETED'); return; }
    if (!o.returnFeasible && !this.flags.o2Return) {
      this.flags.o2Return = true;
      this._event('o2-return', `O₂ NOT ENOUGH TO WALK HOME — ${o.remainingKg.toFixed(2)} kg left, ${o.returnNeedKg.toFixed(2)} kg needed`);
    } else if (o.returnFeasible && !o.reserveOk && !this.flags.o2Reserve) {
      this.flags.o2Reserve = true;
      this._event('o2-reserve', `O₂ reserve insufficient — after the walk home ${(o.remainingKg - o.returnNeedKg).toFixed(2)} kg would be left, reserve is ${o.reserveKg.toFixed(2)} kg`);
    }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _emit(kind) {
    this.version++;
    for (const fn of [...this.listeners]) fn(kind, this);
  }

  _event(kind, text, extra = {}) {
    const e = { t: this.t, kind, text, ...extra };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this._emit('event');
    return e;
  }

  /**
   * @param {Array<[x,y,z]>} path  planned route
   * @param {{elapsedS:ArrayLike<number>, stops?:Array}} stats  planner stats (DEM)
   * @param {{mode?:string, budgetS:number, startMs?:number, ponrIdx?:number, go?:boolean}} meta
   * @param {{toHomeAt:(x,z)=>number, returnPath:(x,z)=>({path}|null), heightAt:(x,z)=>number,
   *          sunAt?:(ms)=>object, airAt?:(ms)=>object}} env
   */
  load(path, stats, meta, env) {
    if (!path || path.length < 2 || !stats?.elapsedS) throw new Error('EVA playback needs a planned DEM route');
    const keepSpeed = this.speed;
    this._clear();
    this.speed = keepSpeed;
    this.nominal = buildTimeline(path, stats.elapsedS, stats.stops || []);
    this.planned = this.nominal;   // the plan as loaded (a re-route replaces nominal; restart returns here)
    this.active = this.nominal;
    this.meta = { ponrIdx: -1, ...meta };
    this.env = env;
    if (this.o2Requested !== undefined) this.o2cfg = this.o2Requested;
    if (this.o2cfg?.valid) this.o2History = [{ t: 0, rateKgH: this.o2cfg.rateKgH }];
    this.status = 'ready';
    this._emit('load');
  }

  get loaded() { return !!this.nominal; }
  get playing() { return this.status === 'playing'; }

  play() {
    if (!this.active) return;
    if (this.status === 'done') { this.restart(true); return; }
    this.status = 'playing';
    this._emit('status');
  }

  pause() {
    if (this.status !== 'playing') return;
    this.status = 'paused';
    this._emit('status');
  }

  toggle() { if (this.status === 'playing') this.pause(); else this.play(); }

  setSpeed(x) {
    if (!(x > 0)) return;
    this.speed = x;
    this._emit('speed');
  }

  restart(autoplay = true) {
    if (!this.nominal) return;
    this.nominal = this.planned || this.nominal;
    this.active = this.nominal;
    this.aborted = null;
    this.rerouted = null;
    this._toHomeOverride = null;
    this._lastAvoidReturn = null;
    this.t = 0;
    this.events = [];
    this._resetFlags();
    if (this.o2Requested !== undefined) this.o2cfg = this.o2Requested;
    this.o2History = this.o2cfg?.valid ? [{ t: 0, rateKgH: this.o2cfg.rateKgH }] : [];
    this._seriesCache = null;
    this.status = autoplay ? 'playing' : 'ready';
    this._emit('status');
  }

  /** Unload the plan (crew back to idle at home). */
  stop() {
    if (this.status === 'idle') return;
    const keepSpeed = this.speed;
    this._clear();
    this.speed = keepSpeed;
    this._emit('status');
  }

  /** Jump on the nominal timeline (disabled after an abort). Re-derives one-shot flags. */
  seek(t) {
    if (!this.nominal || this.aborted) return;
    this.t = Math.max(0, Math.min(this.nominal.totalS, t));
    this._resetFlags();
    const m = this.marginAt(this.t);
    if (m < 0) this.flags.ponr = true;
    for (const th of MARGIN_WARN_S) if (m < th) this.flags.warned.add(th);
    if (this.status === 'done' && this.t < this.nominal.totalS) this.status = 'paused';
    if (this.status === 'ready' && this.t > 0) this.status = 'paused';
    if (this.o2History.length) {
      const rate = this.o2History[this.o2History.length - 1].rateKgH;   // keep the chosen rate from here on
      this.o2History = this.o2History.filter(h => h.t <= this.t);
      if (this.o2History[this.o2History.length - 1].rateKgH !== rate) this.o2History.push({ t: this.t, rateKgH: rate });
      const o = this.oxygenAt();
      if (o) { this.flags.o2Empty = o.empty; this.flags.o2Return = !o.returnFeasible; this.flags.o2Reserve = !o.reserveOk; }
    }
    this._emit('seek');
  }

  /** Abort the EVA: walk home on the fastest path from the current position (or `returnPath`, e.g. around a dust devil). */
  abort(reason = 'manual abort', returnPath = null) {
    if (!this.active || this.aborted) return false;
    if (this.status === 'idle' || this.status === 'done' || this.status === 'ready') return false;
    const p = sampleTimeline(this.active, this.t);
    const r = (returnPath && returnPath(p.x, p.z)) || this.env.returnPath(p.x, p.z);
    if (!r || !r.path || r.path.length < 2) {
      this._event('abort-failed', 'ABORT FAILED — no walkable path home from here');
      return false;
    }
    const tl = timelineFromPath(r.path, this.env.heightAt, this.t);
    this.aborted = { reason, t0: this.t, etaS: tl.totalS - this.t, fromX: p.x, fromZ: p.z };
    this.active = tl;
    this._event('abort', `EVA ABORTED (${reason}) — returning home, ETA ${fmtHM(this.aborted.etaS)}`, { reason });
    this._emit('status');
    return true;
  }

  setHazard(h) {
    if (h !== this.hazard) this.flags.rerouted = false;   // a new dust devil may be avoided again
    this.hazard = h || null;
    this._emit('hazard');
  }

  /**
   * Dust devil on the route ahead: plan around it from here (remaining stops + home, see
   * utils/dustReroute.js). Accepted → the rest of the EVA follows the new route; rejected (or a
   * second time for the same dust devil) → abort, walking home around it when possible.
   */
  _dustAhead() {
    const reason = 'dust devil on the route ahead';
    if (!this.dustPlanner || this.flags.rerouted) {
      if (this.flags.rerouted) this._event('reroute-failed', 'Dust devil on the new route again — returning to the start point for safety.');
      this.abort(reason, this._lastAvoidReturn || null);
      return;
    }
    this.flags.rerouted = true;
    const t = this.t, p = sampleTimeline(this.active, t);
    const stops = this.nominal.stops.filter(s => s.arriveS > t + 1e-6);
    const here = this.nominal.stops.find(s => s.arriveS <= t && s.departS > t);   // sampling now: finish it first
    const wait = here ? here.departS - t : 0;
    const hist = this.o2History;
    const r = this.dustPlanner({
      pos: { x: p.x, z: p.z }, t: t + wait, stops, hazard: this.hazard, budgetS: this.meta.budgetS, nominalEndS: this.active.totalS,
      destination: { x: this.nominal.xs[this.nominal.n - 1], z: this.nominal.zs[this.nominal.n - 1] },
      mode: 'SAFE', startMs: this.meta.startMs, sunAt: this.env.sunAt || null,
      oxygenCheck: (planLeftS, backS) => {
        if (!this.o2cfg?.valid || !hist.length) return { ok: true, detail: 'no oxygen settings' };
        const o = oxygenState(this.o2cfg, hist, t, backS, planLeftS + wait);
        const need = o.planNeedKg + o.reserveKg;
        return { ok: o.remainingKg >= need, detail: `${o.remainingKg.toFixed(2)} kg left, ${need.toFixed(2)} kg needed incl. reserve` };
      },
    });
    this._lastAvoidReturn = r?.returnPath || null;
    if (!r?.ok) {
      // fallback: back to the start the way they came (when that stays clear of the zone), else around it, else fastest
      const back = retracePath(this.active, t, p, this.hazard, safetyZoneRadius(this.hazard));
      const how = back ? 'the way they came' : 'around the safety zone';
      this._event('reroute-failed', `Dust devil detected — no new route to the destination found (${r?.reason || 'planner unavailable'}). Returning to the start point ${how} for safety.`);
      this.abort(`${reason} — no new route found, returning to the start point for safety`, back ? () => back : (r?.returnPath || null));
      return;
    }
    const tl = spliceTimeline(this.nominal, t, p, r.path, r.elapsedS, r.stops, here ? { dwellS: wait, n: here.n, label: here.label } : null);
    this.nominal = tl;
    this.active = tl;
    this._toHomeOverride = r.toHomeAt;
    this.rerouted = { t0: t, extraS: r.extraS, skipped: r.skipped.map(s => s.n), finishing: here ? here.n : null,
      path: r.path, checks: r.checks, fromX: p.x, fromZ: p.z };
    const sk = r.skipped.length ? ` · skipped ${r.skipped.map(s => `S${s.n}`).join(', ')} (inside the safety zone)` : '';
    const ct = here ? ` · S${here.n} finished first` : '';
    const ex = r.extraS >= 0 ? `+${fmtHM(r.extraS)}` : `−${fmtHM(-r.extraS)}`;
    this._event('reroute', `Dust devil detected — ${DUST_REROUTE.safetyMarginM.value} m safety zone set; new SAFE route planned from here to the destination (${ex})${sk}${ct}`, { extraS: r.extraS });
    this._emit('status');
  }

  /** Advance the mission clock by dtReal seconds of wall time. Returns true if it moved. */
  tick(dtReal) {
    if (this.status !== 'playing' || !this.active) return false;
    const prev = this.t;
    this.t = Math.min(this.active.totalS, this.t + Math.max(0, dtReal) * this.speed);
    this._checkEvents(prev, this.t);
    if (this.status === 'playing' && this.t >= this.active.totalS) {
      this.status = 'done';
      this._event('done', this.aborted
        ? `Crew back at the habitat after the abort (${fmtHM(this.t)} EVA)`
        : `EVA complete — crew back at the habitat (${fmtHM(this.t)})`);
      this._emit('status');
    }
    return true;
  }

  /** Live walk-back margin at mission time t [s] (−Infinity if home is unreachable). */
  marginAt(t = this.t) {
    if (!this.active || !this.meta) return NaN;
    const p = sampleTimeline(this.active, t);
    const back = this._toHome(p.x, p.z);
    return Number.isFinite(back) ? this.meta.budgetS - t - back : -Infinity;
  }

  _checkEvents(prev, now) {
    if (!this.aborted) {
      for (const st of this.nominal.stops) {
        const name = st.label || 'science stop';
        if (prev < st.arriveS && st.arriveS <= now) this._event('arrive', `Arrived at stop ${st.n}: ${name}`, { stop: st.n });
        if (prev < st.departS && st.departS <= now) this._event('depart', `Stop ${st.n} sampled — moving on`, { stop: st.n });
      }
    }
    const m = this.marginAt(now);
    if (m === -Infinity) {
      if (!this.flags.noPath) { this.flags.noPath = true; this._event('nopath', 'No walkable path home from here'); }
    } else if (Number.isFinite(m)) {
      for (const th of MARGIN_WARN_S) {
        if (m < th && m >= 0 && !this.flags.warned.has(th)) {
          this.flags.warned.add(th);
          this._event('margin', `Walk-back margin below ${th / 60} min`, { threshold: th });
        }
      }
      if (m < 0 && !this.flags.ponr) {
        this.flags.ponr = true;
        this._event('ponr', 'POINT OF NO RETURN passed — home is no longer reachable within the EVA budget');
      }
    }
    this._checkOxygen();
    if (this.env.sunAt && Number.isFinite(this.meta.startMs) && !this.flags.sunset) {
      const el = this.env.sunAt(this.meta.startMs + now * 1000)?.elevationDeg;
      if (el <= 0) { this.flags.sunset = true; this._event('sunset', 'Sun below the horizon'); }
    }
    if (this.hazard && !this.aborted && this.status === 'playing') {
      const d = minDistanceAhead(this.active, now, HAZARD_LOOKAHEAD_S, this.hazard.x, this.hazard.z);
      if (d <= (this.hazard.interferenceRadius ?? this.hazard.radius)) this._dustAhead();
    }
  }

  /**
   * Pose of a crew member. offsetS > 0 → that many mission seconds behind EV1
   * (before an abort's start the trailing member is still on the nominal route).
   */
  pose(offsetS = 0) {
    if (!this.active) return null;
    const t = this.t - offsetS;
    if (this.aborted && t < this.aborted.t0) return sampleTimeline(this.nominal, Math.max(0, t));
    return sampleTimeline(this.active, Math.max(this.active.startS, t));
  }
}

/** HUD snapshot (plain object) — derived data for display. */
export function evaSnapshot(pb) {
  if (!pb || !pb.active) return { status: 'idle' };
  const tl = pb.active, nom = pb.nominal, t = pb.t;
  const s = pb.pose(0);
  const meta = pb.meta, env = pb.env;
  const back = env.toHomeAt(s.x, s.z);
  const margin = Number.isFinite(back) ? meta.budgetS - t - back : -Infinity;
  const ms = Number.isFinite(meta.startMs) ? meta.startMs + t * 1000 : null;
  const stopNow = pb.aborted ? null : currentStop(nom, s);
  const next = pb.aborted ? null : nextStop(nom, s);
  let activity;
  if (pb.status === 'done') activity = { kind: 'done' };
  else if (pb.aborted) activity = { kind: 'return', etaS: tl.totalS - t };
  else if (stopNow) activity = { kind: 'sample', stop: stopNow, dwellLeftS: stopNow.departS - t };
  else if (pb.status === 'ready' || s.state === 'pre') activity = { kind: 'ready', next };
  else if (next) activity = { kind: 'walk', next, distM: nom.cum[next.idx] - s.distM, etaS: next.arriveS - t };
  else activity = { kind: 'walk-home', distM: nom.cum[nom.n - 1] - s.distM, etaS: nom.totalS - t };
  // Time axis of the HUD bar: 0 … end of the active timeline (abort ETA after an abort)
  const axisS = Math.max(1e-9, tl.totalS);
  const f = (x) => Math.max(0, Math.min(1, x / axisS));
  const reached = (st) => !pb.aborted || st.arriveS <= pb.aborted.t0;
  return {
    status: pb.status,
    speed: pb.speed,
    t,
    totalS: tl.totalS,
    nominalTotalS: nom.totalS,
    progress: f(t),
    aborted: pb.aborted,
    rerouted: pb.rerouted,
    pose: s,
    activity,
    margin,
    backS: back,
    budgetS: meta.budgetS,
    ponrPassed: pb.flags.ponr,
    distHomeM: Math.hypot(s.x - nom.xs[0], s.z - nom.zs[0]),
    walkedM: pb.aborted ? null : s.distM,
    routeLengthM: nom.lengthM,
    clockMs: ms,
    sun: ms != null && env.sunAt ? env.sunAt(ms) : null,
    air: ms != null && env.airAt ? env.airAt(ms) : null,
    stopsDone: stopsCompleted(nom, pb.aborted ? pb.aborted.t0 : t),
    stopsTotal: nom.stops.length,
    marks: {
      stops: nom.stops.filter(reached).map(st => ({ n: st.n, f0: f(st.arriveS), f1: f(Math.min(st.departS, pb.aborted ? pb.aborted.t0 : st.departS)) })),
      ponrF: meta.ponrIdx >= 0 && !pb.aborted ? f(nom.dep[meta.ponrIdx]) : null,
      abortF: pb.aborted ? f(pb.aborted.t0) : null,
    },
    mode: meta.mode,
    oxygen: pb.oxygenAt(t),
    events: pb.events.slice(-5),
  };
}
