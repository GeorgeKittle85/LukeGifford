#!/usr/bin/env node
// End-to-end smoke test in a real browser (Playwright + Chromium).
//   npm run test:e2e              -> tests the dev build served over HTTP
//   npm run test:e2e -- --offline-build  -> also opens dist/kittle-skies.html from disk
//
// Plays a short session: new game, open a route, fly, weekly report, every
// tab, save + reload + continue, phone layout, and offline reload.
// Screenshots go to test-results/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run `npm i -D playwright && npx playwright install chromium` first.');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;
const checkOfflineBuild = process.argv.includes('--offline-build');

const failures = [];
const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `);
  try {
    await fn();
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    failures.push(`${name}: ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(e.message));

// Fast-forward helper: runs the engine directly (same module instance as the page).
const fastForward = (minutes) => page.evaluate(async (mins) => {
  const engine = await import('./src/engine/index.js');
  const host = window.kittleSkies.host;
  const notes = engine.advance(host.state, host.state.now + mins);
  host.handleNotes(notes);
  return host.state.now;
}, minutes);

try {
  await step('page loads and shows the new-game dialog', async () => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Start airline' }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: join(outDir, '01-new-game.png') });
  });

  await step('start a new airline at SFO', async () => {
    await page.getByRole('button', { name: 'Start airline' }).click();
    await page.getByText('Your routes (0)').waitFor();
    const cash = await page.evaluate(() => window.kittleSkies.host.state.airlines.KS.cash);
    assert(cash === 1_000_000, `expected $1M, got ${cash}`);
  });

  await step('plan and open SFO–DFW with the starter E175', async () => {
    await page.getByRole('button', { name: 'Plan your first route' }).click();
    const dialog = page.getByRole('dialog', { name: 'Plan a route' });
    await dialog.locator('label', { hasText: /^To/ }).locator('select').selectOption('DFW');
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: 'Use suggested fare' }).click();
    await page.screenshot({ path: join(outDir, '02-planner.png') });
    await dialog.getByRole('button', { name: 'Open route' }).click();
    await page.getByText('SFO ⇄ DFW').first().waitFor();
    const routes = await page.evaluate(() => Object.values(window.kittleSkies.host.state.routes).filter((r) => r.airlineId === 'KS').length);
    assert(routes === 1, `expected 1 route, got ${routes}`);
  });

  await step('time runs and our plane takes off', async () => {
    await page.keyboard.press('5'); // 120x
    await page.locator('.ks-plane.mine').first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(outDir, '03-flying.png') });
  });

  await step('weekly report appears at the end of the week', async () => {
    // Space toggles pause from the keyboard.
    await page.keyboard.press('Space');
    assert(await page.evaluate(() => window.kittleSkies.host.paused), 'Space pauses the game');
    await fastForward(7 * 24 * 60);
    await page.getByRole('dialog', { name: /Week 1 report/ }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: join(outDir, '04-week-report.png') });
    await page.getByRole('button', { name: 'Back to work' }).click();
    // A random decision (charter offer, fuel hedge...) may follow the report.
    for (let i = 0; i < 3 && await page.locator('.modal').count(); i++) await page.keyboard.press('Escape');
    const lw = await page.evaluate(() => window.kittleSkies.host.state.airlines.KS.lastWeek);
    assert(lw && lw.pax > 0, 'weekly report has passengers');
  });

  await step('every tab renders', async () => {
    // Keep the clock stopped so no new event dialog pops up mid-check.
    await page.evaluate(() => window.kittleSkies.host.pause());
    for (let i = 0; i < 3 && await page.locator('.modal').count(); i++) await page.keyboard.press('Escape');
    for (const [key, text] of [['f', 'Your fleet'], ['m', 'Market explorer'], ['$', 'Finances'], ['u', 'Upgrades'], ['v', 'Standings'], ['n', 'News & events'], ['r', 'Your routes']]) {
      await page.keyboard.press(key);
      await page.getByRole('heading', { name: text }).first().waitFor({ timeout: 5000 });
      if (key === '$') await page.screenshot({ path: join(outDir, '05-finances.png') });
    }
  });

  await step('save, reload and continue', async () => {
    const week = await fastForward(60).then(() => page.evaluate(() => Math.floor(window.kittleSkies.host.state.now / 10080) + 1));
    await page.evaluate(() => window.kittleSkies.host.saveSlot('auto'));
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Continue saved game' }).click();
    await page.getByText('SFO ⇄ DFW').first().waitFor();
    const restoredWeek = await page.evaluate(() => Math.floor(window.kittleSkies.host.state.now / 10080) + 1);
    assert(restoredWeek === week, `restored week ${restoredWeek} vs ${week}`);
  });

  await step('phone layout has no horizontal scroll', async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    phone.on('pageerror', (e) => consoleErrors.push(`phone: ${e.message}`));
    await phone.goto(BASE, { waitUntil: 'load' });
    await phone.getByRole('button', { name: 'Start airline' }).click();
    await phone.getByText('Your routes (0)').waitFor();
    await phone.screenshot({ path: join(outDir, '06-phone.png'), fullPage: false });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `page scrolls sideways by ${overflow}px`);
    await phone.close();
  });

  await step('reloads offline from the service worker cache', async () => {
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.waitForTimeout(1500); // let the worker finish caching
    await context.setOffline(true);
    // Tiles may still come from the HTTP cache; block them to simulate no internet.
    await context.route(/tile\.openstreetmap\.org/, (route) => route.abort('internetdisconnected'));
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Continue saved game' }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Continue saved game' }).click();
    await page.locator('.net-badge:not([hidden])').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: join(outDir, '07-offline.png') });
    await context.unroute(/tile\.openstreetmap\.org/);
    await context.setOffline(false);
  });

  if (checkOfflineBuild) {
    await step('single-file offline build runs from file://', async () => {
      const file = join(root, 'dist/kittle-skies.html');
      assert(existsSync(file), 'run `npm run build:offline` first');
      const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      await p.getByRole('button', { name: 'Start airline' }).click();
      await p.getByText('Your routes (0)').waitFor({ timeout: 10_000 });
      await p.screenshot({ path: join(outDir, '08-offline-build.png') });
      assert(!errs.length, errs.join('; '));
      await p.close();
    });
  }

  // Tile requests can fail in sandboxes without internet; those aren't game bugs.
  const realErrors = consoleErrors.filter((e) => !/tile\.openstreetmap\.org|ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to load resource/.test(e));
  await step('no JavaScript errors in the console', async () => {
    assert(!realErrors.length, realErrors.join(' | '));
  });
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`\nAll smoke checks passed. Screenshots in ${outDir}`);
