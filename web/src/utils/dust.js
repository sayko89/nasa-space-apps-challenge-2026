/**
 * Dust Exposure & Equipment Reliability assessment (qualitative, config/dust.js).
 *
 * Independent of the payload and terrain assessments. It never rejects a route, never changes
 * walking speed or mass, and never produces a failure probability or degradation rate: the
 * evidence found does not support any. It reports
 *   - exposure factors for this EVA (dusty season, dust-mantled ground on the route, contact work)
 *   - each equipment group: mechanism, vulnerability class, protection state, precautions
 *   - warnings, and what is missing.
 * Pure: tested in Node (tests/dust.test.mjs).
 */
import { DUST_COMPONENTS, DUST_OPTIONS, DEFAULT_DUST, DUSTY_SEASON_LS, DUST_TI_MAX, sourceById } from '../config/dust.js';
import { j2000tt, solarLongitude } from './marsTime.js';

/** Solar longitude Ls [deg] at a UTC time, or null. */
export function lsAt(ms) { return Number.isFinite(ms) ? solarLongitude(j2000tt(ms)) : null; }
export const inDustySeason = (ls) => (ls == null ? null : ls >= DUSTY_SEASON_LS.from && ls < DUSTY_SEASON_LS.to);

/**
 * @param {object} ctx { dust: mission.dust settings, startMs, stopCount, dustGroundShare: 0..1 | null (null = no layer),
 *                       site: 'jezero' | 'gale' | … }
 */
export function dustAssessment(ctx = {}) {
  const cfg = { ...DEFAULT_DUST, ...(ctx.dust || {}) };
  const missing = [], warnings = [], notes = [];

  // ---- exposure factors (each with its source; no score)
  const exposure = [];
  const ls = lsAt(ctx.startMs);
  const season = inDustySeason(ls);
  if (season == null) {
    missing.push({ key: 'season', label: 'EVA date', detail: 'no EVA start time — dusty season cannot be checked' });
  } else {
    exposure.push({ key: 'season', label: 'Season', present: season, source: DUSTY_SEASON_LS.source,
      detail: `Ls ${ls.toFixed(0)}° — ${season ? 'southern spring / summer, the dustiest part of the Martian year' : 'outside the dusty season (southern spring / summer, Ls 180°–360°)'}` });
  }
  if (ctx.dustGroundShare == null) {
    missing.push({ key: 'ground', label: 'Dust-mantled ground', detail: 'no thermal-inertia layer for this site — cannot tell whether the route crosses dust-mantled ground' });
  } else {
    const p = ctx.dustGroundShare;
    exposure.push({ key: 'ground', label: 'Dust-mantled ground on the route', present: p > 0, source: DUST_TI_MAX.source,
      detail: p > 0 ? `${Math.round(p * 100)} % of the route on thermal inertia < ${DUST_TI_MAX.value} (dust / fine sand)`
        : `none of the route below thermal inertia ${DUST_TI_MAX.value} (100 m pixels — a thin coating does not show)` });
  }
  const n = Number.isFinite(ctx.stopCount) ? ctx.stopCount : 0;
  exposure.push({ key: 'contact', label: 'Regolith contact work', present: n > 0, source: 'gaier2005',
    detail: n > 0 ? `${n} sampling stop${n > 1 ? 's' : ''}: kneeling, scooping and handling samples bring dust onto suit and tools` : 'no sampling stops planned' });
  const level = exposure.some(e => e.present && e.key !== 'contact') ? 'elevated'
    : (missing.some(m => m.key === 'season') ? 'unknown' : 'baseline');

  // ---- components
  const components = DUST_COMPONENTS.map(c => {
    const opt = DUST_OPTIONS[c.protectedBy];
    const choice = opt.options[cfg[c.protectedBy]] || opt.options.unknown;
    const state = choice.protects === true ? 'protected' : choice.protects === false ? 'unprotected' : 'unknown';
    return { ...c, protection: { setting: c.protectedBy, label: opt.label, choice: choice.label, note: choice.note || null, state },
      sources: c.evidence.map(sourceById).filter(Boolean).map(s => ({ id: s.id, title: s.title, applicability: s.applicability, url: s.url })) };
  });

  // ---- warnings (rules, in this order)
  for (const c of components) {
    if (c.protection.state === 'unknown') continue;
    if (c.protection.state === 'unprotected') {
      warnings.push({ key: c.key, level: c.vulnerability, text: c.warning });
    }
    if (c.protection.state === 'protected') {
      notes.push({ key: c.key, text: `${c.name}: relies on "${c.protection.choice}" — not validated against Martian dust.` });
    }
  }
  const unknownSettings = Object.keys(DUST_OPTIONS).filter(k => !DUST_OPTIONS[k].options[cfg[k]] || DUST_OPTIONS[k].options[cfg[k]].protects == null);
  for (const k of unknownSettings) {
    missing.push({ key: `cfg-${k}`, label: DUST_OPTIONS[k].label,
      detail: `not specified — ${components.filter(c => c.protectedBy === k).map(c => c.name.split(' (')[0].toLowerCase()).join(', ')} cannot be assessed for protection` });
  }
  if (season) warnings.push({ key: 'season', level: 'moderate', text: 'EVA in the dusty season (southern spring / summer): more airborne dust is likely; this is not a storm forecast.' });
  warnings.push({ key: 'quantify', level: 'info', text: 'Dust exposure information is insufficient to quantify degradation.' });

  const status = unknownSettings.length ? 'INSUFFICIENT DATA' : 'WARNINGS';
  const summary = `${level === 'elevated' ? 'Elevated' : level === 'baseline' ? 'Baseline' : 'Unknown'} exposure · `
    + `${components.filter(c => c.vulnerability === 'high').length} high- and ${components.filter(c => c.vulnerability === 'moderate').length} moderate-vulnerability groups`
    + `${unknownSettings.length ? ` · ${unknownSettings.length} protection setting${unknownSettings.length > 1 ? 's' : ''} not specified` : ''} · degradation not quantified`;
  return { status, level, exposure, components, warnings, notes, missing, summary, affectsDecision: false };
}
