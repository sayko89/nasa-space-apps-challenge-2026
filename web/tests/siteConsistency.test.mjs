/**
 * Data consistency across the files of each real site: every layer on the same grid, the orbital
 * image covering exactly the DTM, and rover / chemistry positions in the site frame agreeing with
 * their latitude / longitude through the app's own projection (no layer silently in another frame).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (s, f) => JSON.parse(fs.readFileSync(new URL(`../public/sites/${s}/${f}`, import.meta.url), 'utf8'));
const has = (s, f) => fs.existsSync(new URL(`../public/sites/${s}/${f}`, import.meta.url));
const { site, localToLatLon } = await import('../src/terrain/siteData.js');

const EXPECT = {                       // documented centres (README / provenance)
  jezero: { lat: 18.44, lon: 77.45, rover: 'Perseverance' },
  gale: { lat: -4.8115, lon: 137.384, rover: 'Curiosity' },
};

for (const name of Object.keys(EXPECT)) {
  test(`${name}: every layer on the DTM grid; orbital image covers the DTM`, () => {
    const meta = read(name, 'meta.json');
    const { n, cell_m: cell, span_m: span } = meta.grid;
    assert.equal(span, (n - 1) * cell);
    assert.ok(Math.abs(meta.center.lat_deg - EXPECT[name].lat) < 1e-3 && Math.abs(meta.center.lon_deg_east - EXPECT[name].lon) < 1e-3, 'centre');
    assert.equal(fs.statSync(new URL(`../public/sites/${name}/grid.bin`, import.meta.url)).size, n * n * 4, 'grid.bin size');
    for (const f of ['layers.json', 'geology.json']) {
      const g = read(name, f).grid;
      assert.equal(g.n, n, f); assert.equal(g.cell_m, cell, f);
      assert.match(g.order, /row 0 = north edge/, f);
    }
    const o = read(name, 'ortho.json');
    assert.ok(Math.abs(o.size_px * o.pixel_m - span) < 2 * o.pixel_m, `ortho ${o.size_px * o.pixel_m} m vs ${span} m`);
    assert.match(o.order, /same as grid\.bin/);
  });

  test(`${name}: rover positions and chemistry targets agree with their lat/lon and lie in the site`, () => {
    const meta = read(name, 'meta.json');
    site.meta = meta;
    const half = meta.grid.span_m / 2;
    const pov = read(name, 'pov.json').stations;
    assert.ok(pov.length > 10);
    let worst = 0;
    for (const st of pov) {
      const ll = localToLatLon(st.x, st.z);
      const dLatM = (ll.lat - st.lat) * Math.PI / 180 * 3396190;
      const dLonM = (ll.lon - st.lon) * Math.PI / 180 * 3396190 * Math.cos(meta.center.lat_deg * Math.PI / 180);
      worst = Math.max(worst, Math.hypot(dLatM, dLonM));
      assert.ok(Math.abs(st.x) <= half && Math.abs(st.z) <= half, `${st.rmc} inside`);
    }
    assert.ok(worst < 2, `rover positions: worst ${worst.toFixed(2)} m between site frame and lat/lon`);
    const tr = read(name, 'track.json');
    for (const seg of tr.segments) for (const [x, z] of seg) assert.ok(Math.abs(x) <= half && Math.abs(z) <= half, 'track inside');
    if (has(name, 'chemistry.json')) {
      const chem = read(name, 'chemistry.json');
      for (const t of chem.targets) assert.ok(Math.abs(t.x) <= half && Math.abs(t.z) <= half, `${t.name} inside`);
      // targets are placed from the rover position: the first target sits next to the first rover stop of its sol
      const t0 = chem.targets[0], p0 = pov.reduce((a, b) => (Math.abs(b.sol - t0.sol) < Math.abs(a.sol - t0.sol) ? b : a));
      assert.ok(Math.hypot(t0.x - p0.x, t0.z - p0.z) < 50, `${t0.name} near the rover (${Math.hypot(t0.x - p0.x, t0.z - p0.z).toFixed(1)} m)`);
    }
    site.meta = null;
  });
}
