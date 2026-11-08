import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.FIXTURE_URL || 'http://127.0.0.1:4183';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const proof = { simulationOnly: true, errors: [], checks: [] };
page.on('pageerror', error => proof.errors.push(error.message));
const remote = async () => (await (await fetch(`${base}/__verification/proof`)).json());
const knob = page.getByRole('button', { name: 'Geser potongan puzzle' });
const check = (name, value) => { assert.ok(value, name); proof.checks.push(name); };
async function drag(dx, hold = false) {
  const box = await knob.boundingBox();
  const width = await page.locator('.slider-puzzle').evaluate(node => node.getBoundingClientRect().width);
  const scale = width / 320, x = box.x + box.width / 2, y = box.y + box.height / 2;
  const before = (await remote()).calls.filter(call => call.action === 'replay').length;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(x + dx * scale * step / 20, y + Math.sin(step) * 3 * scale);
    await page.waitForTimeout(20);
    if (hold && step === 12) {
      await page.waitForTimeout(1800);
      const moved = await page.locator('.slider-puzzle-piece').evaluate(node => parseFloat(node.style.left));
      check('piece moves locally while button is held', moved > 0);
      check('no drag requests before release', (await remote()).calls.filter(call => call.action === 'replay').length === before);
    }
  }
  await page.mouse.up();
}
try {
  await page.goto(`${base}/tests/verification-ui/index.html`);
  await knob.waitFor({ timeout: 90_000 });
  await page.locator('.slider-puzzle-image img').first().evaluate(img => img.decode());
  const first = await page.locator('.slider-puzzle-image img').first().getAttribute('src');
  await drag(10);
  await page.waitForFunction(initial => document.querySelector('.slider-puzzle-image img')?.src !== initial, first, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('.slider-puzzle-knob')?.getAttribute('aria-disabled') === 'false');
  check('failed puzzle resets and becomes usable', (await remote()).state.puzzle.challenge > 1);
  await page.setViewportSize({ width: 360, height: 800 });
  const state = (await remote()).state;
  await drag(state.puzzle.answer / state.puzzle.ratio, true);
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-status"]').textContent.includes('outcome_unknown'), undefined, { timeout: 60_000 });
  const details = await remote();
  check('mobile retry passes official-style offset and trail checks', details.state.puzzle.verdicts.at(-1).verified);
  check('one native submit after local commit and permit', details.state.clicks === 1);
  check('one batch for each completed drag', details.calls.filter(call => call.action === 'replay').length === 2);
  check('no legacy move or screenshot calls', !details.calls.some(call => ['input', 'frame'].includes(call.action)));
  assert.deepEqual(proof.errors, []);
  await mkdir('.audit', { recursive: true });
  await page.screenshot({ path: '.audit/local-puzzle-success.png' });
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await writeFile('.audit/local-puzzle-ui-proof.json', JSON.stringify(proof, null, 2));
  await browser.close();
}
