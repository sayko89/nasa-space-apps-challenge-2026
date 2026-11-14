/**
 * Mission objectives: every objective is tied to real site data, and changing the objective
 * changes which stops the planner can and does choose (not a decorative selector).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { site } = await import('../src/terrain/siteData.js');
const N = 120, CELL = 4;
Object.assign(site, {
  mode: 'dem', name: 'objtest', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights: new Float32Array(N * N), heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});
const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const S = await import('../src/utils/science.js');
const WB = await import('../src/utils/walkback.js');
const { OBJECTIVES, findObjective, objectivesFor } = await import('../src/config/objectives.js');
const { buildStopCard, terrainRisk, dataConfidence } = await import('../src/utils/stopCards.js');

const hm = T.buildHeightMap();
const sites = (s) => new URL(`../public/sites/${s}/`, import.meta.url);
const readJson = (s, f) => JSON.parse(fs.readFileSync(new URL(f, sites(s))));

// Synthetic site: bedrock A (west) / B (east); surface "Ridge" strip in the north, "Hollow" square;
// CRISM: Olivine block west, Smectite block east; two ChemCam targets.
function synth() {
  const surface = new Uint8Array(N * N), bedrock = new Uint8Array(N * N);
  const code = new Uint8Array(N * N), confidence = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c;
    bedrock[i] = c < 70 ? 1 : 2;
    surface[i] = r < 30 ? 1 : (r >= 80 && r < 90 && c >= 80 && c < 90) ? 2 : 0;
    if (r >= 40 && r < 50 && c >= 40 && c < 50) { code[i] = 1; confidence[i] = 2; }
    if (r >= 40 && r < 50 && c >= 75 && c < 85) { code[i] = 2; confidence[i] = 1; }
  }
  const geo = { n: N, surface, bedrock, surfaceUnits: ['', 'Ridge', 'Hollow'], bedrockUnits: ['', 'Floor A', 'Floor B'] };
  const minerals = { classes: ['none', 'Olivine', 'Smectite'], code, confidence };
  const targetCells = new Map([[55 * N + 52, [{ name: 'Rock One', sol: 10 }]], [66 * N + 64, [{ name: 'Rock Two', sol: 11 }]]]);
  const chemCells = new Map([[55 * N + 52, [{ tag: 'CaO high', name: 'Rock One', sol: 10, diff: 6 }]],
                            [66 * N + 64, [{ tag: 'MgO low', name: 'Rock Two', sol: 11, diff: -4 }]]]);
  return { geo, minerals, targetCells, chemCells };
}
const homeIdx = 60 * N + 60;
const home = WB.homeTimeMaps(homeIdx, hm, P.getWallMap(), N, CELL);
const base = { cellM: CELL, wall: P.getWallMap(), budgetS: 8 * 3600, dwellS: 600, maxRadialM: 2000, interiorR: 2, maxCandidates: 14 };

test('no filter: planner unchanged (units, contact, minerals, chemistry; no targets)', () => {
  const { geo, minerals, chemCells, targetCells } = synth();
  const c = S.candidateStops(geo, home, { ...base, minerals, chemCells, targetCells });
  const kinds = new Set(c.map(s => s.kind));
  assert.deepEqual([...kinds].sort(), ['chemistry', 'contact', 'mineral', 'unit']);
});

test('filters decide which candidates exist', () => {
  const { geo, minerals, chemCells, targetCells } = synth();
  const cand = (filter) => S.candidateStops(geo, home, { ...base, minerals, chemCells, targetCells, filter });
  const noContacts = cand({ contacts: false, minerals: [], chemTags: [] });
  assert.ok(!noContacts.some(s => s.kind === 'contact' || s.kind === 'mineral' || s.kind === 'chemistry'));
  const olivine = cand({ units: 'none', contacts: false, minerals: ['Olivine'], chemTags: [] });
  assert.deepEqual(olivine.map(s => s.label.split(' (')[0]), ['Olivine']);
  assert.ok(olivine.every(s => !s.tags.includes('M:Smectite')));
  const ridges = cand({ units: { surface: ['Ridge'] }, contacts: false, minerals: [], chemTags: [] });
  assert.ok(ridges.length >= 1 && ridges.every(s => s.tags.includes('S:Ridge')));
  const cao = cand({ units: 'none', contacts: false, minerals: [], chemTags: ['CaO high'] });
  assert.deepEqual(cao.map(s => s.chem.tag), ['CaO high']);
  const targets = cand({ units: 'none', contacts: false, minerals: [], chemTags: [], targets: 5 });
  assert.deepEqual(targets.map(s => s.target.name).sort(), ['Rock One', 'Rock Two']);
  assert.ok(targets.every(s => s.kind === 'target' && s.tags.some(t => t.startsWith('T:'))));
});

test('different objectives → different stop sets from the same start', () => {
  const { geo, minerals, chemCells, targetCells } = synth();
  const plan = (filter, weights) => S.planScienceEva(geo, home, hm, P.getWallMap(),
    { ...base, budgetS: 3 * 3600, minerals, chemCells, targetCells, filter, weights }).stops.map(s => s.kind);
  const contacts = plan({ contacts: true, minerals: [], chemTags: [] }, { bedrock: 3, surface: 0, contact: 4, mineral: 0, chemistry: 0 });
  const mins = plan({ units: 'none', contacts: false, minerals: null, chemTags: [] }, { bedrock: 0, surface: 0, contact: 0, mineral: 4, chemistry: 0 });
  const chem = plan({ units: 'none', contacts: false, minerals: [], chemTags: null }, { bedrock: 0, surface: 0, contact: 0, mineral: 0, chemistry: 4 });
  assert.ok(contacts.includes('contact') && !contacts.includes('mineral'));
  assert.deepEqual(mins, ['mineral', 'mineral'].slice(0, mins.length)); assert.equal(mins.length, 2);
  assert.ok(chem.length === 2 && chem.every(k => k === 'chemistry'));
  // zero-weight tags do not count toward the score
  assert.equal(S.tagWeight('S:Ridge', { surface: 0 }), 0);
  assert.equal(S.tagWeight('S:Ridge', { surface: 1, surfaceUnits: { Ridge: 5 } }), 5);
});

test('every objective is complete and points at data that exists for its site', () => {
  const need = ['id', 'name', 'purpose', 'relevance', 'sources', 'layers', 'candidates', 'criteria', 'uncertainty', 'availability', 'plan'];
  assert.deepEqual(OBJECTIVES.jezero.map(o => o.name), ['Ancient Lake and Delta Investigation', 'Mineralogical Diversity Exploration',
    'Bedrock and Geological Contact Analysis', 'Olivine and Pyroxene Investigation', 'Olivine-Smectite Alteration Analysis']);
  assert.deepEqual(OBJECTIVES.gale.map(o => o.name), ['Boxwork Ridge and Hollow Investigation', 'Geological Contact Exploration',
    'Chemical Anomaly Investigation', 'Water-Related Alteration Evidence', 'ChemCam Target Re-investigation']);
  for (const siteName of ['jezero', 'gale']) {
    const geo = readJson(siteName, 'geology.json');
    const layers = readJson(siteName, 'layers.json').layers;
    const crism = layers.minerals?.classes || [];
    for (const o of objectivesFor(siteName)) {
      for (const k of need) assert.ok(o[k] != null && o[k] !== '', `${siteName}/${o.id}: ${k}`);
      assert.ok(o.sources.every(s => /^https:\/\//.test(s.url)), `${o.id} sources`);
      const f = o.plan.filter;
      if (f.units && typeof f.units === 'object') {
        for (const u of f.units.surface || []) assert.ok(geo.surface.units.includes(u), `${o.id}: surface unit ${u}`);
        for (const u of f.units.bedrock || []) assert.ok(geo.bedrock.units.includes(u), `${o.id}: bedrock unit ${u}`);
      }
      if (f.minerals?.length) {
        assert.ok(crism.length, `${o.id} uses CRISM but ${siteName} has none`);
        for (const m of f.minerals) assert.ok(crism.includes(m), `${o.id}: CRISM class ${m}`);
        const present = f.minerals.filter(m => layers.minerals.cells?.[m] > 0);
        assert.ok(present.length > 0, `${o.id}: none of its minerals occurs in ${siteName}`);
      }
      if (f.chemTags == null || f.chemTags.length || f.targets) {
        assert.ok(fs.existsSync(new URL('chemistry.json', sites(siteName))), `${o.id} needs ChemCam data`);
      }
      // weights: something must count, and filtered-out kinds must not
      const w = o.plan.weights;
      const flat = Object.values(w).flatMap(v => (typeof v === 'object' ? Object.values(v) : [v]));
      assert.ok(flat.some(v => v > 0), `${o.id}: something must count`);
      for (const u of Object.keys(w.surfaceUnits || {})) assert.ok(geo.surface.units.includes(u), `${o.id}: weighted surface unit ${u}`);
      for (const u of Object.keys(w.bedrockUnits || {})) assert.ok(geo.bedrock.units.includes(u), `${o.id}: weighted bedrock unit ${u}`);
      if (f.minerals?.length === 0) assert.equal(o.plan.weights.mineral, 0, `${o.id}: mineral weight`);
    }
  }
  assert.equal(findObjective('gale', 'boxwork').name, 'Boxwork Ridge and Hollow Investigation');
  assert.equal(findObjective('jezero', 'boxwork'), null);
  assert.deepEqual(objectivesFor('moon'), []);
});

test('stop card: reasons, risk classes and confidence from the planner\'s own data', () => {
  const limits = { maxSlopeDeg: 20, maxRockReliefM: 0.5 };
  assert.equal(terrainRisk({ slopeDeg: 5, rockReliefM: 0.1 }, limits).level, 'low');
  assert.equal(terrainRisk({ slopeDeg: 17, rockReliefM: 0.1 }, limits).level, 'moderate');
  assert.equal(terrainRisk({ slopeDeg: 5, rockReliefM: 0.3 }, limits).level, 'moderate');
  assert.equal(terrainRisk({ slopeDeg: 22, rockReliefM: 0.1 }, limits).level, 'high');
  assert.equal(terrainRisk({}, limits).level, 'unknown');
  const stop = { kind: 'chemistry', tags: ['B:Floor A', 'X:CaO high'], label: 'Re-sample Rock One', x: 1, z: 2,
    chem: { name: 'Rock One', sol: 10, tag: 'CaO high', diff: 6 }, terrain: { slopeDeg: 4, rockReliefM: 0.1 } };
  const card = buildStopCard(stop, 1, { objective: findObjective('gale', 'water-alteration'), weights: { bedrock: 1, chemistry: 3 },
    dwellS: 1200, site: { geologyDerived: true }, limits });
  assert.match(card.why, /CaO high \(chemistry, weight 3\)/);
  assert.ok(card.layers.includes('chemistry') && card.layers.includes('geology'));
  assert.equal(card.visitMin, 20);
  assert.equal(card.confidence.level, 'measured');
  assert.match(card.evidence.join(' '), /\+6\.0 wt%/);
  assert.equal(dataConfidence({ kind: 'unit', tags: [] }, { geologyDerived: true }).level, 'derived');
  assert.equal(dataConfidence({ kind: 'mineral', tags: [], terrain: { mineralConfidence: 'high' } }, {}).level, 'mapped (high)');
});

test('contactOnlyTags: a contact stop no longer stands in for both units', () => {
  const { geo } = synth();
  const c = S.candidateStops(geo, home, { ...base, filter: { contactOnlyTags: true, minerals: [], chemTags: [] } });
  const contact = c.find(s => s.kind === 'contact');
  assert.deepEqual(contact.tags, ['C:Floor A | Floor B']);
  const plan = S.planScienceEva(geo, home, hm, P.getWallMap(), { ...base, budgetS: 3 * 3600,
    filter: { contactOnlyTags: true, units: 'all', contacts: true, minerals: [], chemTags: [] },
    weights: { bedrock: 3, surface: 0, contact: 4, mineral: 0, chemistry: 0 } });
  const kinds = plan.stops.map(s => s.kind).sort();
  assert.deepEqual(kinds, ['contact', 'unit', 'unit']);
});

test('two anomalies of one rock make one stop, not two', () => {
  const { geo } = synth();
  const chemCells = new Map([[55 * N + 52, [{ tag: 'Al2O3 low', name: 'Totora', sol: 4682, diff: -8.7 },
    { tag: 'Na2O low', name: 'Totora', sol: 4682, diff: -1.9 }]]]);
  const c = S.candidateStops(geo, home, { ...base, chemCells, filter: { units: 'none', contacts: false, minerals: [], chemTags: null, maxChem: 8 } });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].tags.filter(t => t[0] === 'X'), ['X:Al2O3 low', 'X:Na2O low']);
  assert.match(c[0].label, /Al2O3 low \(-8\.7 wt%\), Na2O low \(-1\.9 wt%\)/);
});

test('unit weights: only the named terrain classes score (no credit for other ground)', () => {
  const o = findObjective('gale', 'water-alteration');
  assert.equal(S.tagWeight('S:Smooth ground', o.plan.weights), 0);
  assert.equal(S.tagWeight('S:Ridge or butte crest', o.plan.weights), 3);
  assert.equal(S.tagWeight('B:Sulfate unit above the boxwork', o.plan.weights), 0);
  assert.equal(S.tagWeight('B:Boxwork-bearing layer', o.plan.weights), 1);
  assert.equal(S.tagWeight('X:CaO high', o.plan.weights), 3);
});
