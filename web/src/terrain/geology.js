/**
 * geology.json (pipeline/build_geology.py) çözücü — bağımlılıksız (siteData ve worker kullanır).
 */

/** RLE [kod, adet] → Uint8Array; uzunluk tutmazsa hata. */
export function decodeRle(rle, len) {
  const out = new Uint8Array(len);
  let p = 0;
  for (const [v, c] of rle) {
    if (p + c > len) throw new Error('RLE exceeds the grid size');
    out.fill(v, p, p + c); p += c;
  }
  if (p !== len) throw new Error(`RLE has ${p} cells, expected ${len}`);
  return out;
}

/** geology.json → { n, surface, bedrock, surfaceUnits, bedrockUnits, source }; geçersizse null. */
export function decodeGeology(g, n) {
  if (g?.format !== 'martian-map-geology/1' || g?.grid?.n !== n) return null;
  try {
    return {
      n,
      surface: decodeRle(g.surface.rle, n * n),
      bedrock: decodeRle(g.bedrock.rle, n * n),
      surfaceUnits: g.surface.units,
      bedrockUnits: g.bedrock.units,
      source: g.source,
    };
  } catch {
    return null;
  }
}
