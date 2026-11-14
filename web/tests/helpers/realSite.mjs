/**
 * Loads a real site (public/sites/<name>/) in Node through the app's own loader, then runs the
 * whole planning chain the app runs: mission objective → science stops → four routes → decision.
 * Used by realJezero.test.mjs and realGale.test.mjs (one site per process: the modules are singletons).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function loadRealSite(name) {
  const dir = new URL(`../../public/sites/${name}/`, import.meta.url);
  globalThis.fetch = async (u) => {
    const path = fileURLToPath(new URL(String(u).replace(/^file:\/\//, 'file://')));
    if (!fs.existsSync(path)) return { ok: false, status: 404 };
    const buf = fs.readFileSync(path);
    return { ok: true, status: 200, text: async () => buf.toString('utf8'),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  const { loadSite, localToLatLon } = await import('../../src/terrain/siteData.js');
  const site = await loadSite(name, dir.href);
  if (site.mode !== 'dem') throw new Error(`site ${name} did not load: ${site.loadError}`);
  const T = await import('../../src/three/terrainGenerator.js');
  const P = await import('../../src/utils/pathfinder.js');
  const O = await import('../../src/config/objectives.js');
  const SC = await import('../../src/utils/science.js');
  const MS = await import('../../src/utils/missionStatus.js');
  const HZ = await import('../../src/utils/hazards.js');
  const PV = await import('../../src/config/provenance.js');
  const CFG = await import('../../src/config/marswalkProfile.js');
  const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
  return { site, T, P, O, SC, MS, HZ, PV, CFG, hm, sm, cm, localToLatLon };
}

/** Plan one objective from the site centre and return the science result + SAFE route. */
export function planObjective(ctx, objectiveId, startMs) {
  const { P, hm, sm, cm } = ctx;
  const home = { x: 0, z: 0 };
  const sci = P.planScience(home, hm, { objectiveId, slopeMap: sm });
  const wps = [home, ...sci.stops.map(s => ({ x: s.x, z: s.z, dwellS: sci.dwellS, label: s.label })), home];
  const routes = P.planAllRoutes(wps, sm, cm, hm, 45, null, { modes: ['SAFE'], startMs });
  return { sci, safe: routes.SAFE };
}
