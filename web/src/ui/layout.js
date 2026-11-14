/**
 * Panel layout constants. The Martian Map (DEM) panel is drawn 25% larger than
 * the legacy Moon panel so it stays readable on a projector / in the demo video.
 */
import { IS_DEM } from '../three/terrainGenerator';

export const UI_SCALE = IS_DEM ? 1.25 : 1;
export const PANEL_W = Math.round(218 * UI_SCALE);          // right panel width [px]
export const MAP_S = PANEL_W - 16;                           // mini-map / heatmap canvas [px]
/** Scaled font size. */
export const fs = (px) => Math.round(px * UI_SCALE * 10) / 10;

// ---- Phone layout: below this width the panel becomes a bottom sheet under the 3D view
import { useEffect, useState } from 'react';
export const NARROW_QUERY = '(max-width: 700px)';
export const SHEET_VH = 55;                                   // bottom sheet height [vh]
export const isNarrow = () => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_QUERY).matches;
/** true on phone-width screens; follows rotation / resizing. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW_QUERY);
    if (!m) return undefined;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

// Short or narrow screens (phones either way round): smaller title, compact EVA HUD
export const COMPACT_QUERY = '(max-width: 700px), (max-height: 500px)';
export function useCompact() {
  const q = () => typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_QUERY).matches;
  const [c, setC] = useState(q);
  useEffect(() => {
    const m = window.matchMedia?.(COMPACT_QUERY);
    if (!m) return undefined;
    const on = () => setC(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return c;
}

// Wide screens (desktop / laptop): the data catalog is docked; below this it opens as a drawer
export const WIDE_QUERY = '(min-width: 1100px)';
export function useWide() {
  const q = () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches;
  const [w, setW] = useState(q);
  useEffect(() => {
    const m = window.matchMedia?.(WIDE_QUERY);
    if (!m) return undefined;
    const on = () => setW(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return w;
}
