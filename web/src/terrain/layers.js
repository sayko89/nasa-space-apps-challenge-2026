/**
 * layers.json decoder (pipeline/build_layers.py) — dependency-free, used by siteData,
 * the planner worker and the tests.
 *
 *   continuous  { scale, offset, n, b64 }  uint16 LE, raw 0 = no data, value = raw*scale + offset
 *   categorical { classes, colors, rle, confidence_rle }
 */
import { decodeRle } from './geology.js';

function b64ToBytes(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64')); // Node (tests)
}

/** continuous layer → Float32Array (NaN = no data). */
export function decodeContinuous(l, n) {
  if (l?.n !== n || typeof l.b64 !== 'string') throw new Error('continuous layer does not match the grid');
  const bytes = b64ToBytes(l.b64);
  if (bytes.length !== n * n * 2) throw new Error(`layer is ${bytes.length} B, expected ${n * n * 2} B`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) {
    const raw = dv.getUint16(i * 2, true);
    out[i] = raw === 0 ? NaN : raw * l.scale + l.offset;
  }
  return out;
}

const META = (l) => ({ label: l.label, unit: l.unit, dataType: l.dataType, stats: l.stats, source: l.source,
  note: l.note, method: l.method, interpretation: l.interpretation });

/** layers.json → { thermal, minerals, rock } (each null if absent); null if the file is invalid. */
export function decodeLayers(j, n) {
  if (j?.format !== 'martian-map-layers/1' || j?.grid?.n !== n || !j.layers) return null;
  const L = j.layers;
  const out = { thermal: null, minerals: null, rock: null };
  try {
    if (L.thermal_inertia) out.thermal = { ...META(L.thermal_inertia), values: decodeContinuous(L.thermal_inertia, n) };
    if (L.rock_relief) out.rock = { ...META(L.rock_relief), values: decodeContinuous(L.rock_relief, n) };
    if (L.minerals) {
      const m = L.minerals;
      out.minerals = { ...META(m), classes: m.classes, colors: m.colors,
        code: decodeRle(m.rle, n * n), confidence: decodeRle(m.confidence_rle, n * n) };
    }
  } catch {
    return null;
  }
  return out;
}

/** Thermal-inertia class text for a value (dataset interpretation table). */
export function thermalClass(layer, v) {
  if (!layer?.interpretation || !Number.isFinite(v)) return null;
  const hit = layer.interpretation.find(([lo, hi]) => v >= lo && v < hi);
  return hit ? hit[2] : null;
}
