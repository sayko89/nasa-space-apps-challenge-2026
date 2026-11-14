import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dustAssessment, lsAt, inDustySeason } from '../src/utils/dust.js';
import { DUST_COMPONENTS, DUST_SOURCES, DUST_OPTIONS, APPLICABILITY, sourceById } from '../src/config/dust.js';

const ALL_SET = { outerLayer: 'ortho-fabric', jointProtection: 'standard', equipmentProtection: 'exposed', covers: 'none' };
const PROTECTED = { outerLayer: 'epg-development', jointProtection: 'dust-tolerant', equipmentProtection: 'enclosed', covers: 'fitted' };
const T = Date.UTC(2026, 10, 14, 12);

test('components are assessed separately, not all with the same vulnerability; each has mechanism, rationale, evidence', () => {
  const required = ['joints', 'bearings', 'connectors', 'sampling', 'optics', 'rover', 'mechanisms'];
  assert.deepEqual(DUST_COMPONENTS.map(c => c.key).sort(), required.sort());
  assert.ok(new Set(DUST_COMPONENTS.map(c => c.vulnerability)).size >= 2);
  for (const c of DUST_COMPONENTS) {
    assert.ok(['low', 'moderate', 'high'].includes(c.vulnerability), c.key);
    for (const f of ['mechanism', 'rationale', 'uncertainty', 'confidence', 'warning']) assert.ok(c[f], `${c.key}.${f}`);
    assert.ok(c.precautions.length >= 1 && c.evidence.length >= 1, c.key);
    for (const id of c.evidence) assert.ok(sourceById(id), `${c.key}: source ${id}`);
    assert.ok(DUST_OPTIONS[c.protectedBy], c.key);
  }
});

test('lunar, analog and Mars sources are kept apart; xEMU never called Mars-certified', () => {
  for (const s of DUST_SOURCES) {
    assert.ok(APPLICABILITY[s.applicability], s.id);
    for (const f of ['title', 'program', 'date', 'context', 'relevance', 'limitations']) assert.ok(s[f], `${s.id}.${f}`);
  }
  const cat = (id) => sourceById(id).applicability;
  assert.equal(cat('gaier2005'), 'lunar-analogy');                // Apollo
  assert.equal(cat('jones2025'), 'lunar-analogy');                // lunar simulant
  assert.equal(cat('evagap2020'), 'lunar-analogy');               // xEMU programme
  assert.equal(cat('litofsky2026'), 'lunar-analogy');
  assert.equal(cat('sherloc2025'), 'mars-direct');                // on Perseverance
  assert.equal(cat('marsv'), 'mars-analog');                      // Gobi analog
  assert.ok(!DUST_COMPONENTS.some(c => c.evidence.includes('marsv')), 'analog without results is not used to classify');
  const text = JSON.stringify(DUST_SOURCES) + JSON.stringify(DUST_COMPONENTS) + JSON.stringify(DUST_OPTIONS);
  assert.ok(!/xEMU[^.]*\bMars[- ]certified\b(?![^.]*not)/i.test(text.replace(/not (?:a )?Mars-certified/gi, '')));
  assert.match(sourceById('evagap2020').limitations, /not Mars-certified/);
});

test('no fabricated probabilities, percentages or degradation rates in the assessment', () => {
  const a = dustAssessment({ dust: ALL_SET, startMs: T, stopCount: 6, dustGroundShare: 0.2 });
  const walk = (o, path = '') => {
    if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`); return; }
    assert.ok(!/prob|failure_?rate|reliab|degrad.*rate|percent|lifetime/i.test(path), `field ${path}`);
  };
  walk(a);
  for (const c of a.components) assert.ok(!/\d+(\.\d+)? ?%/.test(`${c.protection.choice} ${c.protection.note || ''}`), `protection % on ${c.key}`);
  for (const w of a.warnings) assert.ok(!/\d+(\.\d+)? ?%/.test(w.text) || /route/.test(w.text), w.text);
  assert.equal(a.affectsDecision, false);
  assert.ok(a.warnings.some(w => /insufficient to quantify degradation/.test(w.text)));
});

test('protective features: shown as protected but not Mars-validated, and never lower the class', () => {
  const open = dustAssessment({ dust: ALL_SET, startMs: T });
  const shut = dustAssessment({ dust: PROTECTED, startMs: T });
  for (let i = 0; i < open.components.length; i++) {
    assert.equal(open.components[i].vulnerability, shut.components[i].vulnerability);
    assert.equal(open.components[i].protection.state, 'unprotected');
    assert.equal(shut.components[i].protection.state, 'protected');
  }
  assert.ok(open.warnings.some(w => /Exposed mechanical interfaces may be vulnerable to regolith intrusion/.test(w.text)));
  assert.ok(open.warnings.some(w => /Unprotected joints may require inspection or maintenance/.test(w.text)));
  assert.ok(open.warnings.some(w => /Optical surfaces may require additional protection/.test(w.text)));
  assert.ok(!shut.warnings.some(w => w.level === 'high'));
  assert.equal(new Set(open.warnings.map(w => w.text)).size, open.warnings.length, 'no duplicate warnings');
  assert.ok(shut.notes.every(n => /not validated against Martian dust/.test(n.text)));
  assert.equal(shut.status, 'WARNINGS');
});

test('missing data is explicit: unknown settings, no date, no thermal layer', () => {
  const a = dustAssessment({});
  assert.equal(a.status, 'INSUFFICIENT DATA');
  assert.equal(a.level, 'unknown');
  const keys = a.missing.map(m => m.key);
  for (const k of ['season', 'ground', 'cfg-outerLayer', 'cfg-jointProtection', 'cfg-equipmentProtection', 'cfg-covers']) assert.ok(keys.includes(k), k);
  assert.ok(a.components.every(c => c.protection.state === 'unknown'));
  assert.ok(!a.warnings.some(w => w.level === 'high'), 'unknown is not turned into a warning or a pass');
});

test('exposure factors: dusty season (Ls 180–360) and dust-mantled ground', () => {
  assert.equal(inDustySeason(null), null);
  assert.equal(inDustySeason(179.9), false);
  assert.equal(inDustySeason(180), true);
  assert.equal(inDustySeason(359), true);
  // find one date in and one out of season (a Mars year is ~687 days)
  let inS = null, outS = null;
  for (let d = 0; d < 700 && (inS == null || outS == null); d += 10) {
    const ms = T + d * 86400e3; if (inDustySeason(lsAt(ms))) inS ??= ms; else outS ??= ms;
  }
  const a = dustAssessment({ dust: ALL_SET, startMs: inS, dustGroundShare: 0 });
  const b = dustAssessment({ dust: ALL_SET, startMs: outS, dustGroundShare: 0 });
  assert.equal(a.level, 'elevated');
  assert.equal(b.level, 'baseline');
  assert.ok(a.warnings.some(w => /dusty season/.test(w.text) && /not a storm forecast/.test(w.text)));
  assert.equal(dustAssessment({ dust: ALL_SET, startMs: outS, dustGroundShare: 0.3 }).level, 'elevated');
});
