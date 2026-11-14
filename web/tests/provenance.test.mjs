/**
 * Data provenance (config/provenance.js) against the real site files: every layer says what
 * kind of knowledge it is; transferred / derived data are never labelled as local measurements;
 * missing layers are shown as unavailable with a reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { provenanceFor, CATEGORIES } from '../src/config/provenance.js';

const dir = (s) => new URL(`../public/sites/${s}/`, import.meta.url);
const read = (s, f) => (fs.existsSync(new URL(f, dir(s))) ? JSON.parse(fs.readFileSync(new URL(f, dir(s)))) : null);

/** The fields the app's loader keeps (terrain/siteData.js), enough for provenance. */
function loadSite(name) {
  const layers = read(name, 'layers.json')?.layers || {};
  return {
    meta: read(name, 'meta.json'), ortho: read(name, 'ortho.json'), climate: read(name, 'climate.json'),
    pov: read(name, 'pov.json'), chemistry: read(name, 'chemistry.json'), track: read(name, 'track.json'),
    geology: { source: read(name, 'geology.json')?.source }, spaceWeather: read(name, 'space_weather.json'), relief: read(name, 'relief.json'),
    layers: { minerals: layers.minerals || null, thermal: layers.thermal_inertia || null, rock: layers.rock_relief || null },
  };
}
const FIELDS = ['name', 'category', 'mission', 'instrument', 'source', 'observed', 'resolution', 'coverage',
  'dataType', 'processing', 'status', 'uncertainty', 'limitations'];
const byKey = (list) => Object.fromEntries(list.map(r => [r.key, r]));

for (const siteName of ['jezero', 'gale']) {
  test(`${siteName}: every available record is complete and categorised`, () => {
    const list = provenanceFor(siteName, loadSite(siteName));
    assert.ok(list.length >= 12);
    for (const r of list) {
      assert.ok(CATEGORIES[r.category], `${r.key}: category ${r.category}`);
      if (!r.available) { assert.ok(r.reason?.length > 20, `${r.key}: reason`); continue; }
      for (const f of FIELDS) assert.ok(r[f] != null && r[f] !== '', `${siteName}/${r.key}: ${f}`);
    }
  });
}

test('Jezero: RAD is a transferred reference, not a local measurement', () => {
  const p = byKey(provenanceFor('jezero', loadSite('jezero')));
  assert.equal(p.radiation.category, 'transferred-reference');
  assert.match(p.radiation.limitations, /NOT a Jezero measurement/);
  assert.match(p.radiation.coverage, /Gale/);
  assert.equal(p.minerals.category, 'orbital-observation');
  assert.equal(p.minerals.instrument, 'CRISM');
  assert.equal(p.thermal.instrument, 'THEMIS');
  assert.equal(p.orthoImage.instrument, 'HiRISE');
  assert.equal(p.reliefShading.category, 'derived');
  assert.match(p.reliefShading.limitations, /Lighting only/);
  assert.equal(p.air.instrument, 'MEDA ATS');
  assert.equal(p.air.category, 'direct-measurement');
  // SuperCam / PIXL: investigated, not integrated
  assert.equal(p.chemistry.available, false);
  assert.match(p.chemistry.reason, /SuperCam/);
  assert.equal(p.geology.category, 'orbital-observation');
});

test('Gale: ChemCam, RAD, REMS local; derived geology says it is not a published map', () => {
  const p = byKey(provenanceFor('gale', loadSite('gale')));
  assert.equal(p.chemistry.category, 'direct-measurement');
  assert.equal(p.chemistry.instrument, 'ChemCam (LIBS)');
  assert.match(p.chemistry.observed, /^sols \d+–\d+$/);
  assert.equal(p.radiation.category, 'direct-measurement');
  assert.equal(p.air.instrument, 'REMS ATS');
  assert.equal(p.geology.category, 'derived');
  assert.match(p.geology.limitations, /NOT an official published GIS geologic map/);
  // CRISM / THEMIS: investigated, shown as unavailable
  assert.equal(p.minerals.available, false);
  assert.equal(p.thermal.available, false);
  assert.match(p.thermal.reason, /qualitative/);
});

test('space weather is never presented as a forecast; simulation is labelled as such', () => {
  for (const s of ['jezero', 'gale']) {
    const p = byKey(provenanceFor(s, loadSite(s)));
    assert.match(p.spaceWeather.limitations, /not a forecast/);
    assert.equal(p.evaSimulation.category, 'simulated');
    assert.equal(p.walkModel.status, 'assumption');
  }
});
