/**
 * Browser tests on the production build (vite preview): the checks the final validation made by hand.
 *   pnpm --filter martian-map build && pnpm --filter martian-map e2e
 * WebGL runs in software (SwiftShader), so the timeouts are generous. Screenshots of every step
 * are written to e2e/out/ (uploaded by the CI workflow when a test fails).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const OUT = new URL('./out/', import.meta.url);
const PORT = 4318;
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

// A shared plan: Jezero, Olivine-Smectite objective, itemised payload, dust and oxygen settings
const { encodePlan } = await import('../src/utils/shareLink.js');
const PLAN = encodePlan({ waypoints: [{ x: 0, z: 0 }], science: true, objectiveId: 'olivine-smectite',
  mission: { suit: 'mars', equipmentKg: 8, rover: false, limits: 'lunar',
    payload: { instruments: 3, comms: 1, sampling: 2.5, emergency: 1.5, other: 0 },
    dust: { outerLayer: 'ortho-fabric', jointProtection: 'standard', equipmentProtection: 'exposed', covers: 'fitted' },
    o2: { scenario: 'swing-bed', initialKg: null, reserveMin: 30 } } });

let server, browser;
before(async () => {
  if (!fs.existsSync(new URL('../dist/index.html', import.meta.url))) throw new Error('build first: pnpm --filter martian-map build');
  server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: WEB, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(url, viewport, mobile = false) {
  const page = await browser.newPage({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await page.goto(url);
  return { page, errors };
}
const click = (page, re) => page.evaluate((src) => {
  const b = [...document.querySelectorAll('button')].find(x => new RegExp(src).test(x.innerText.trim()));
  if (!b) throw new Error(`no button ${src}`);
  b.click();
}, re);
const layout = (page) => page.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, hud: box('#eva-hud'), wf: box('[aria-label="Mission workflow"]'),
    steps: document.querySelectorAll('[aria-label="Mission workflow"] button').length };
});
/** Open a workspace from the top bar (EXPLORE / ANALYZE / PLAN / OPS). */
const workspace = (page, name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('nav[aria-label="Workspaces"] button')].find(x => x.innerText.includes(n));
  if (!b) throw new Error(`no workspace ${n}`);
  b.click();
}, name);
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/** A shared science plan is re-planned by the app on load; press PLAN SCIENCE EVA only if it has not started. */
async function planScience(page) {
  const done = () => page.waitForSelector('[aria-label="EVA assessment"]', { state: 'attached' });
  try { await page.waitForSelector('[aria-label="EVA assessment"]', { state: 'attached', timeout: 60_000 }); return; } catch { /* not planned yet */ }
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'PLAN SCIENCE EVA'));
  await click(page, '^PLAN SCIENCE EVA$');
  await done();
}

test('Jezero, desktop: plan → decision and three assessments → EVA HUD → one-page cuff card', { timeout: 900_000 }, async () => {
  const { page, errors } = await open(`${BASE}/?site=jezero&plan=${PLAN}`, { width: 1500, height: 950 });
  await planScience(page);
  // a shared plan opens in PLAN MISSION; the four workspaces are in the top bar, the decision stays visible there
  const tabs = await page.innerText('nav[aria-label="Workspaces"]');
  for (const w of ['EXPLORE', 'ANALYZE', 'PLAN MISSION', 'OPERATIONS']) assert.ok(tabs.includes(w), w);
  assert.match(await page.innerText('[aria-label="Mission status"]'), /GO|CONDITIONAL|NO-GO|INSUFFICIENT DATA/);
  assert.match(await page.innerText('[aria-label="EVA timeline"]'), /EVA TIMELINE[\s\S]*S1/);
  const L = await layout(page);
  assert.equal(L.steps, 13, '13-step workflow');
  assert.ok(L.scrollW <= L.innerW, 'no horizontal scroll');
  // the assessments and the decision reasons sit in closed slots: read their text without opening them
  const panel = await page.evaluate(() => document.querySelector('[aria-label="EVA assessment"]').textContent);
  for (const s of ['A. Payload & Mass', 'B. Dust Exposure & Equipment Reliability', 'C. Terrain & Mobility']) assert.ok(panel.includes(s), s);
  const body = await page.evaluate(() => document.body.textContent);
  assert.match(body, /Oxygen for a safe return from every point/);
  assert.match(body, /(GO|CONDITIONAL|NO-GO|INSUFFICIENT DATA): /);
  await page.screenshot({ path: fileURLToPath(new URL('jezero-desktop-plan.png', OUT)) });

  await workspace(page, 'OPERATIONS');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /START EVA/.test(b.innerText)));
  await click(page, 'START EVA');
  await page.waitForSelector('#eva-hud');
  const hud = await page.innerText('#eva-hud');
  assert.match(hud, /Olivine-Smectite Alteration Analysis/);
  assert.match(hud, /payload within limit/);
  assert.match(hud, /O₂ & MASS/);
  assert.match(hud, /CARRIED MASS/);
  await page.screenshot({ path: fileURLToPath(new URL('jezero-desktop-eva.png', OUT)) });

  await page.evaluate(() => [...document.querySelectorAll('#eva-hud button')].find(b => b.innerText.trim() === '✕')?.click());
  await click(page, 'PRINT CUFF CARD');
  await page.waitForSelector('.cuff-sheet');
  const cuff = await page.innerText('.cuff-sheet');
  for (const re of [/OBJECTIVE: OLIVINE-SMECTITE ALTERATION ANALYSIS/, /H = 18\.\d+°N 77\.\d+°E/, /BACK →H/, /HAZARDS ON ROUTE/, /EQUIPMENT: payload WITHIN LIMIT/, /DUST:/, /DATA LIMITS:/]) {
    assert.match(cuff, re);
  }
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  assert.equal(pdfPages(pdf), 1, 'cuff card prints on one page');
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');

  // EXPLORE: data catalog + inspector (map point from a terrain click, layer metadata from ⓘ)
  await workspace(page, 'EXPLORE');
  const cat = await page.innerText('aside[aria-label="Data catalog"]');
  for (const c of ['IMAGERY', 'TOPOGRAPHY', 'GEOLOGY', 'MINERALOGY', 'HAZARDS']) assert.ok(cat.includes(c), c);
  assert.ok(!cat.includes('AI TERRAIN SEGMENTATION'), 'no fake AI layer');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Data catalog"] button')].find(b => b.getAttribute('aria-label') === 'Information on Dominant minerals (CRISM)').click());
  await page.waitForFunction(() => /MAP LAYER/.test(document.querySelector('[aria-label="Inspector"]')?.innerText || ''));
  const insp = await page.innerText('[aria-label="Inspector"]');
  for (const t of ['Dominant minerals (CRISM)', 'Data source', 'Technical']) assert.ok(insp.includes(t), t);
  await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Data catalog"] input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Show Hazard classes').click());
  await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Data catalog"] input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Show Surface units').click());
  assert.equal(await page.locator('aside[aria-label="Data catalog"] input[type=range]').count(), 2, 'two draped layers, each with its opacity');
  const map = page.locator('[aria-label="Inspector"]');
  const sitemap = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find(x => x.width === x.height && x.getBoundingClientRect().left > innerWidth / 2); const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.7 }; });
  await page.mouse.click(sitemap.x, sitemap.y);
  await page.waitForFunction(() => /MAP POINT/.test(document.querySelector('[aria-label="Inspector"]')?.innerText || ''));
  assert.match(await map.innerText(), /Elevation[\s\S]*m \(MOLA datum\)[\s\S]*Slope/);
  await page.screenshot({ path: fileURLToPath(new URL('jezero-desktop-explore.png', OUT)) });

  // ANALYZE: terrain analysis + science data with what is missing at this site
  await workspace(page, 'ANALYZE');
  await page.waitForFunction(() => /Scientific data — available and missing/i.test(document.body.innerText));
  assert.match(await page.innerText('body'), /NOT AVAILABLE AT THIS SITE/);
  await page.screenshot({ path: fileURLToPath(new URL('jezero-desktop-analyze.png', OUT)) });
  assert.deepEqual(errors, []);
  await page.close();
});

test('Jezero, phone and tablet: workflow reachable, no horizontal scroll, HUD clear of the site switcher and the sheet', { timeout: 1_200_000 }, async () => {
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const { page, errors } = await open(`${BASE}/?site=jezero&plan=${PLAN}`, vp, true);
    await planScience(page);
    await workspace(page, 'OPS');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /START EVA/.test(b.innerText)));
    await click(page, 'START EVA');
    await page.waitForSelector('#eva-hud');
    const L = await layout(page);
    assert.equal(L.steps, 13, name);
    assert.ok(L.scrollW <= L.innerW, `${name}: no horizontal scroll`);
    const sw = await page.evaluate(() => { const e = [...document.querySelectorAll('button')].find(b => /MOUNT SHARP/.test(b.innerText)); return e.getBoundingClientRect().bottom; });
    assert.ok(L.hud.top >= sw, `${name}: HUD (${L.hud.top}) below the site switcher (${sw})`);
    if (name === 'phone') assert.ok(L.hud.bottom <= L.wf.top, `phone: HUD (${L.hud.bottom}) above the bottom sheet (${L.wf.top})`);
    else assert.ok(L.hud.right <= L.wf.left, `tablet: HUD (${L.hud.right}) left of the panel (${L.wf.left})`);
    await page.screenshot({ path: fileURLToPath(new URL(`jezero-${name}-eva.png`, OUT)) });
    assert.deepEqual(errors, [], name);
    await page.close();
  }
});

test('Gale loads with its objectives; Moon keeps the original simulator', { timeout: 600_000 }, async () => {
  const g = await open(`${BASE}/?site=gale&ws=plan`, { width: 1500, height: 950 });
  await g.page.waitForSelector('text=PLAN SCIENCE EVA');
  const gt = await g.page.innerText('body');
  for (const s of ['Boxwork Ridge and Hollow Investigation', 'ChemCam Target Re-investigation']) assert.ok(gt.includes(s), s);
  assert.equal((await layout(g.page)).steps, 13);
  // 1 m DTM relief shading: map served; in the data catalog (EXPLORE) the emphasis switch renders without errors
  assert.ok((await g.page.request.get(`${BASE}/sites/gale/relief.jpg`)).ok(), 'relief.jpg served');
  await workspace(g.page, 'EXPLORE');
  await g.page.waitForSelector('aside[aria-label="Data catalog"]');
  const gc = await g.page.innerText('aside[aria-label="Data catalog"]');
  assert.match(gc, /RELIEF ×1/);
  assert.match(gc, /CHEMISTRY[\s\S]*ChemCam major oxides/);
  await click(g.page, '^×4$');
  await g.page.waitForFunction(() => /emphasised/.test(document.querySelector('aside[aria-label="Data catalog"]').innerText));
  await g.page.waitForTimeout(2000);
  assert.deepEqual(g.errors, []);
  await g.page.close();

  // first visit (no shared plan): the welcome guide explains the four workspaces; it closes into EXPLORE
  const w = await open(`${BASE}/?site=jezero`, { width: 1500, height: 950 });
  await w.page.waitForSelector('[aria-label="Welcome to Martian Map"]');
  const guide = await w.page.innerText('[aria-label="Welcome to Martian Map"]');
  for (const t of ['EXPLORE', 'ANALYZE', 'PLAN MISSION', 'OPERATIONS', 'QUICK START']) assert.ok(guide.includes(t), t);
  await click(w.page, '^Explore the map first$');
  await w.page.waitForSelector('[aria-label="Welcome to Martian Map"]', { state: 'detached' });
  assert.match(await w.page.innerText('[aria-label="Inspector"]'), /NOTHING SELECTED YET/);
  assert.deepEqual(w.errors, []);
  await w.page.close();

  const m = await open(`${BASE}/?site=moon`, { width: 1500, height: 950 });
  await m.page.waitForSelector('text=PLAN PATH');
  await m.page.waitForTimeout(3000);
  assert.equal((await layout(m.page)).steps, 0, 'no Mars workflow on the Moon');
  assert.ok(!(await m.page.innerText('body')).includes('MISSION OBJECTIVE'));
  assert.deepEqual(m.errors, []);
  await m.page.close();
});
