/** Relief shading (utils/relief.js): the site loads its 1 m DTM normal map; decoding and emphasis are exact. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadRealSite } from './helpers/realSite.mjs';

const { site } = await loadRealSite('jezero');
const R = await import('../src/utils/relief.js');

test('jezero loads relief.json and it covers the site grid exactly', () => {
  assert.ok(R.hasRelief());
  assert.equal(site.relief.format, 'martian-map-relief/1');
  assert.ok(Math.abs(site.relief.size_px * site.relief.pixel_m - site.sizeM) < 0.5);
  assert.match(R.reliefUrl(), /sites\/jezero\/relief\.jpg$/);
});

test('decoding: neutral pixel is straight up; a 45° east-facing pixel decodes to 45°', () => {
  const up = R.decodeReliefPixel(127.5, 127.5, 255);
  assert.ok(Math.abs(up.up - 1) < 1e-9 && Math.abs(R.shadedSlopeDeg(up)) < 1e-9);
  const s = Math.SQRT1_2, enc = (v) => 127.5 * (v + 1);
  const e45 = R.decodeReliefPixel(enc(s), enc(0), enc(s));
  assert.ok(e45.east > 0.7);
  assert.ok(Math.abs(R.shadedSlopeDeg(e45) - 45) < 1e-6);
});

test('emphasis multiplies the slope tangent (shading only); ×1 is the true slope', () => {
  const n = { east: Math.sin(0.1), north: 0, up: Math.cos(0.1) };    // 5.73°
  assert.ok(Math.abs(R.shadedSlopeDeg(n, 1) - 0.1 * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(Math.tan(R.shadedSlopeDeg(n, 4) * Math.PI / 180) - 4 * Math.tan(0.1)) < 1e-9);
  assert.deepEqual(R.RELIEF_SCALES, [1, 2, 4]);
});

test('flat-normal geometry keeps every position (heights unchanged) and points every normal up', () => {
  const geo = new THREE.PlaneGeometry(10, 10, 4, 4); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(i));
  geo.computeVertexNormals();
  const flat = R.flatNormalGeometry(geo);
  assert.deepEqual(Array.from(flat.attributes.position.array), Array.from(geo.attributes.position.array));
  for (let i = 0; i < flat.attributes.normal.count; i++) assert.deepEqual([flat.attributes.normal.getX(i), flat.attributes.normal.getY(i), flat.attributes.normal.getZ(i)], [0, 1, 0]);
  assert.notEqual(geo.attributes.normal.getY(5), 1, 'source geometry untouched');
});
