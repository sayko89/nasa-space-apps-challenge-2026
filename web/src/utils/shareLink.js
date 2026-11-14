/**
 * Share link — the plan in the URL, so a link opens the same site with the same EVA.
 *
 *   ?site=gale&plan=<base64url JSON>
 *
 * The JSON holds what is needed to rebuild the plan, not the plan itself:
 *   v  format version
 *   w  waypoints [[x, z], …] (m, 0.1 m) — for a hand-made route
 *   sci true → re-run the science-stop planner from w[0] (the stops are deterministic)
 *   r  active route (SAFE / ECO / FAST / AUTO)
 *   t  EVA start, ms since 1970 (UTC) — drives sun, temperature, DONKI
 *   m  mission setup { suit, equipmentKg, rover, limits, buffer?, p?: payload items [5 kg], du?: dust protection settings }
 *   d  time per science stop, min
 *   o  mission objective id (config/objectives.js)
 *
 * Pure (no React): tested in Node (tests/shareLink.test.mjs).
 */

import { PAYLOAD_CATEGORIES } from './payload.js';
import { DUST_OPTIONS } from '../config/dust.js';

const PAYLOAD_KEYS = PAYLOAD_CATEGORIES.map(c => c.key);
const VERSION = 1;
const ROUTES = ['SAFE', 'ECO', 'FAST', 'AUTO'];

const b64urlEncode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
const r1 = (v) => Math.round(v * 10) / 10;

/** @returns {string} the `plan` query value */
export function encodePlan({ waypoints = [], science = false, route, startMs, mission, dwellMin, objectiveId }) {
  const st = {
    v: VERSION,
    w: (science ? waypoints.slice(0, 1) : waypoints).map((p) => [r1(p.x), r1(p.z)]),
  };
  if (science) st.sci = true;
  if (ROUTES.includes(route)) st.r = route;
  if (Number.isFinite(startMs)) st.t = Math.round(startMs);
  if (mission) {
    st.m = { suit: mission.suit, equipmentKg: mission.equipmentKg, rover: !!mission.rover, limits: mission.limits, ...(mission.obstacleBuffer ? { buffer: true } : {}) };
    if (mission.payload) st.m.p = PAYLOAD_KEYS.map(k => mission.payload[k]);
    const du = mission.dust ? Object.fromEntries(Object.entries(mission.dust).filter(([k, v]) => DUST_OPTIONS[k]?.options[v] && v !== 'unknown')) : {};
    if (Object.keys(du).length) st.m.du = du;
  }
  if (Number.isFinite(dwellMin)) st.d = dwellMin;
  if (typeof objectiveId === 'string' && objectiveId) st.o = objectiveId;
  return b64urlEncode(JSON.stringify(st));
}

/** Full share URL for the current page and site. */
export function buildShareURL(base, siteName, state) {
  const q = new URLSearchParams();
  if (siteName) q.set('site', siteName);
  q.set('plan', encodePlan(state));
  return `${base.split(/[?#]/)[0]}?${q}`;
}

/**
 * Reads ?plan= — returns null if absent or unreadable (a bad link must not break the app).
 * Values are checked and clamped; unknown fields are ignored.
 */
export function decodePlan(search) {
  let raw;
  try { raw = new URLSearchParams(search).get('plan'); } catch { return null; }
  if (!raw) return null;
  let st;
  try { st = JSON.parse(b64urlDecode(raw)); } catch { return null; }
  if (!st || typeof st !== 'object' || st.v !== VERSION) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const waypoints = Array.isArray(st.w)
    ? st.w.filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null)
      .slice(0, 64).map(([x, z]) => ({ x, z }))
    : [];
  const out = {
    waypoints,
    science: st.sci === true,
    route: ROUTES.includes(st.r) ? st.r : null,
    startMs: num(st.t),
    dwellMin: num(st.d) != null ? Math.min(120, Math.max(1, st.d)) : null,
    mission: null,
    objectiveId: typeof st.o === 'string' && /^[a-z0-9-]{1,40}$/.test(st.o) ? st.o : null,
  };
  if (st.m && typeof st.m === 'object') {
    out.mission = {
      ...(typeof st.m.suit === 'string' ? { suit: st.m.suit } : {}),
      ...(num(st.m.equipmentKg) != null ? { equipmentKg: Math.min(100, Math.max(0, st.m.equipmentKg)) } : {}),
      rover: st.m.rover === true,
      ...(st.m.buffer === true ? { obstacleBuffer: true } : {}),
      ...(st.m.limits === 'mars' || st.m.limits === 'lunar' ? { limits: st.m.limits } : {}),
    };
    if (Array.isArray(st.m.p) && st.m.p.length === PAYLOAD_KEYS.length && st.m.p.every(v => num(v) != null && v >= 0 && v <= 100)) {
      out.mission.payload = Object.fromEntries(PAYLOAD_KEYS.map((k, i) => [k, st.m.p[i]]));
      out.mission.equipmentKg = Math.min(100, st.m.p.reduce((a, b) => a + b, 0));
    }
    if (st.m.du && typeof st.m.du === 'object') {
      const du = Object.fromEntries(Object.keys(DUST_OPTIONS).map(k => [k, DUST_OPTIONS[k].options[st.m.du[k]] ? st.m.du[k] : 'unknown']));
      if (Object.values(du).some(v => v !== 'unknown')) out.mission.dust = du;
    }
  }
  return out;
}
