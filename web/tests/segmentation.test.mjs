/**
 * Mars AI terrain segmentation: display helpers, and the integrity of every site's prediction index
 * (source image, rover position, sizes, model version, confidence range, not georeferenced).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SEG_CLASSES, UNKNOWN, colorizeMask, colorizeConfidence, maskStats, nearestPrediction, validateIndex, DEFAULT_PALETTE } from '../src/utils/segmentation.js';

const file = (p) => new URL(`../public/${p}`, import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(file(p), 'utf8'));

test('class mapping: the AI4Mars NAV key, unknown = 255', () => {
  assert.deepEqual(SEG_CLASSES.map(c => [c.value, c.key]), [[0, 'soil'], [1, 'bedrock'], [2, 'sand'], [3, 'big_rock']]);
  assert.equal(UNKNOWN, 255);
});

test('mask colouring: classes opaque, unknown and unexpected values shown as unknown', () => {
  const rgba = colorizeMask([0, 3, 255, 7], DEFAULT_PALETTE, 255, 100);
  assert.deepEqual([...rgba.slice(0, 4)], [...DEFAULT_PALETTE[0], 255]);
  assert.deepEqual([...rgba.slice(4, 8)], [...DEFAULT_PALETTE[3], 255]);
  assert.deepEqual([...rgba.slice(8, 12)], [...DEFAULT_PALETTE[255], 100]);
  assert.deepEqual([...rgba.slice(12, 16)], [...DEFAULT_PALETTE[255], 100]);
  const c = colorizeConfidence([0, 255], 0.6);
  assert.ok(c[0] > c[1] && c[5] > c[4]);                          // low → red, high → green
});

test('mask statistics count unknown separately and sum to the pixel count', () => {
  const s = maskStats([0, 0, 1, 2, 3, 255, 255, 9]);
  assert.equal(s.pixels, 8);
  assert.deepEqual(s.counts, { soil: 2, bedrock: 1, sand: 1, big_rock: 1, unknown: 3 });
  assert.ok(Math.abs(Object.values(s.shares).reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('nearest prediction by rover position', () => {
  const items = [{ id: 'a', rover_x: 0, rover_z: 0 }, { id: 'b', rover_x: 100, rover_z: 0 }];
  assert.equal(nearestPrediction(items, 80, 5).item.id, 'b');
  assert.ok(Math.abs(nearestPrediction(items, 80, 5).distanceM - Math.hypot(20, 5)) < 1e-9);
  assert.equal(nearestPrediction([], 0, 0), null);
});

test('index validation catches missing provenance, bad shares, confidence and aspect', () => {
  const good = { model: 'm', kind: 'model prediction (image level) — not a NASA measurement, not georeferenced', items: [{
    id: 'x', image_url: 'u', mission: 'MSL', camera: 'NAV', sol: 1, station: 's', rover_x: 0, rover_z: 0, rover_lat: 0, rover_lon: 0,
    image_size: [1024, 1024], mask_size: [256, 256], fractions: { soil: 0.5, bedrock: 0.2, sand: 0.1, big_rock: 0, unknown: 0.2 },
    confidence: { mean: 0.8, median: 0.9, p10: 0.4 } }] };
  assert.deepEqual(validateIndex(good, 1022), []);
  const bad = structuredClone(good);
  bad.kind = 'map layer'; bad.items[0].confidence.mean = 1.4; bad.items[0].fractions.soil = 0.9; bad.items[0].mask_size = [256, 200]; delete bad.items[0].sol;
  bad.items[0].rover_x = 5000;
  const e = validateIndex(bad, 1022).join(' | ');
  for (const re of [/not georeferenced/, /confidence mean/, /shares sum/, /aspect/, /missing sol/, /outside the site/]) assert.match(e, re);
});

for (const site of ['jezero', 'gale']) {
  test(`${site}: prediction index — complete, linked to real rover positions, files present`, async (t) => {
    if (!fs.existsSync(file(`sites/${site}/segmentation/index.json`))) { t.skip('no predictions generated yet'); return; }
    const idx = read(`sites/${site}/segmentation/index.json`), meta = read(`sites/${site}/meta.json`);
    assert.deepEqual(validateIndex(idx, meta.grid.span_m / 2), []);
    assert.ok(idx.items.length > 0);
    const pov = read(`sites/${site}/pov.json`);
    const stations = new Map(pov.stations.map(s => [s.rmc, s]));
    const { site: S, localToLatLon } = await import('../src/terrain/siteData.js');
    S.meta = meta;
    for (const it of idx.items) {
      const st = stations.get(it.station);
      assert.ok(st, `${it.id}: station ${it.station} exists in pov.json`);
      assert.equal(it.rover_x, st.x); assert.equal(it.rover_z, st.z);           // the rover position is the one the frame was taken from
      const ll = localToLatLon(it.rover_x, it.rover_z);
      assert.ok(Math.abs(ll.lat - it.rover_lat) < 1e-4 && Math.abs(ll.lon - it.rover_lon) < 1e-4, `${it.id}: lat/lon agree with the site frame`);
      assert.ok(st.frames.some(f => (f.medium || f.small) === it.image_url), `${it.id}: image is one of the station's frames`);
      if (site === 'jezero') assert.match(it.camera, /^NAVCAM/);                // Mastcam-Z is outside the training domain
      for (const ext of ['.png', '.conf.png']) assert.ok(fs.existsSync(file(`sites/${site}/segmentation/${it.id}${ext}`)), `${it.id}${ext}`);
    }
    S.meta = null;
  });
}

test('model card: classes, unknown value, threshold in range, dataset provenance, no lunar claim', (t) => {
  if (!fs.existsSync(file('models/mars-terrain-v1.json'))) { t.skip('no model exported yet'); return; }
  const c = read('models/mars-terrain-v1.json');
  assert.deepEqual(c.classes, ['soil', 'bedrock', 'sand', 'big_rock']);
  assert.equal(c.unknown_value, 255);
  assert.ok(c.low_confidence_threshold > 0 && c.low_confidence_threshold < 1);
  assert.match(c.dataset.doi, /15995036/);
  assert.match(c.lunar_model, /not available/);
  assert.ok(fs.existsSync(file(`models/${c.file}`)));
});
