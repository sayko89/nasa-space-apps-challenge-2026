/**
 * README route figures, computed from the real site files by the planner itself.
 *
 *   pnpm --filter martian-map readme:figures         rewrite every <!--fig:key-->value<!--/fig--> in README.md
 *   pnpm --filter martian-map readme:figures:check   exit 1 if any value differs (run in CI)
 *
 * Each site is planned in its own process (the site modules are singletons): SAFE route,
 * start 09:00 LTST on 14 Nov 2026, clear space weather, for every objective and both EVA limit sets,
 * plus the obstacle-buffer example at Gale.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const README = new URL('../../README.md', import.meta.url);
const SITES = { jezero: 77.45, gale: 137.384 };
const EXAMPLE = { jezero: 'mineral-diversity', gale: 'contacts' };   // objective shown in the site table and the limit-set table
const hm = (s) => { const m = Math.round(Math.abs(s) / 60); return `${s < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

async function computeSite(name) {
  const { loadRealSite, planObjective } = await import('../tests/helpers/realSite.mjs');
  const ctx = await loadRealSite(name);
  const { msAtLtst } = await import('../src/utils/marsTime.js');
  const start = msAtLtst(Date.UTC(2026, 10, 14), 9, SITES[name]);
  const out = {};
  for (const prof of ['lunar', 'mars']) {
    ctx.CFG.setEvaProfile(prof); ctx.P.clearPathCache();
    for (const o of ctx.O.objectivesFor(name)) {
      const { sci, safe } = planObjective(ctx, o.id, start);
      const s = safe.stats, k = `${name}.${prof}.${o.id}`;
      const km = (s.distance / 1000).toFixed(2), t = hm(s.roundTripS), m = hm(s.minMarginS);
      out[`${k}.row`] = prof === 'lunar' ? `${sci.stops.length} stops · ${km} km · ${t} · margin ${m}` : `${t} · margin ${m}`;
      if (o.id === EXAMPLE[name]) {
        if (prof === 'lunar') out[`${k}.example`] = `${sci.stops.length} stops · ${km} km · ${t} · tightest margin ${m}`;
        out[`${k}.stops`] = String(sci.stops.length);
        out[`${k}.time`] = t;
        out[`${k}.share`] = `${Math.round(s.budgetFrac * 100)} % of ${s.budgetS / 3600} h`;
        out[`${k}.margin`] = m;
        out[`${k}.farthest`] = `${(s.maxRadialM / 1000).toFixed(2)} / ${ctx.CFG.param('maxRadialDistanceKm')} km`;
      }
    }
  }
  ctx.CFG.setEvaProfile('lunar');
  if (name === 'gale') {
    const r = [];
    for (const b of [0, 4]) {
      ctx.CFG.setObstacleBufferM(b); ctx.P.clearPathCache();
      const { sci, safe } = planObjective(ctx, 'chem-anomaly', start);
      r.push({ km: (safe.stats.distance / 1000).toFixed(2), n: sci.stops.length });
    }
    ctx.CFG.setObstacleBufferM(0);
    out['gale.buffer.chem-anomaly'] = `from ${r[0].km} to ${r[1].km} km and keeps ${r[1].n} of its ${r[0].n} stops`;
  }
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--site') {
  process.stdout.write(JSON.stringify(await computeSite(args[1])));
} else {
  const check = args.includes('--check');
  const self = fileURLToPath(import.meta.url);
  const values = {};
  for (const name of Object.keys(SITES)) Object.assign(values, JSON.parse(execFileSync(process.execPath, [self, '--site', name], { encoding: 'utf8', maxBuffer: 1 << 24 })));
  const text = fs.readFileSync(README, 'utf8');
  const seen = new Set(), diffs = [];
  const next = text.replace(/<!--fig:([\w.-]+)-->([\s\S]*?)<!--\/fig-->/g, (all, key, old) => {
    seen.add(key);
    if (!(key in values)) { diffs.push(`${key}: no such figure`); return all; }
    if (old !== values[key]) diffs.push(`${key}: "${old}" → "${values[key]}"`);
    return `<!--fig:${key}-->${values[key]}<!--/fig-->`;
  });
  if (!seen.size) { console.error('no <!--fig:…--> markers found in README.md'); process.exit(1); }
  if (check) {
    if (diffs.length) { console.error(`README figures out of date (run pnpm --filter martian-map readme:figures):\n  ${diffs.join('\n  ')}`); process.exit(1); }
    console.log(`README figures up to date (${seen.size} values).`);
  } else {
    fs.writeFileSync(README, next);
    console.log(diffs.length ? `updated ${diffs.length} of ${seen.size} values:\n  ${diffs.join('\n  ')}` : `all ${seen.size} values already up to date`);
  }
}
