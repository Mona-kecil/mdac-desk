import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.FIXTURE_URL || 'http://127.0.0.1:4183';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const proof = { simulationOnly: true, errors: [] };
page.on('pageerror', error => proof.errors.push(error.message));
const remote = async () => (await (await fetch(`${base}/__verification/proof`)).json());
const image = page.locator('.verification-frame img');
async function drag(hold = false) {
  const state = (await remote()).state;
  const box = await image.boundingBox();
  const scale = box.width / state.captcha.width;
  const x = box.x + (state.slider.x - state.captcha.x + 20) * scale;
  const y = box.y + (state.slider.y - state.captcha.y + 20) * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 29; step++) {
    await page.waitForTimeout(60);
    await page.mouse.move(x + 288 * scale * step / 29, y);
    if (hold && step === 14) await page.waitForTimeout(4000);
  }
  const released = Date.now();
  await page.mouse.up();
  return released;
}
try {
  await page.goto(`${base}/tests/verification-ui/index.html`);
  await image.waitFor({ timeout: 90_000 });
  await image.evaluate(img => img.decode());
  const initial = await image.getAttribute('src');
  const firstRelease = await drag();
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-status"]').textContent.includes('Generation 2.'), undefined, { timeout: 60_000 });
  await image.evaluate(img => img.decode());
  proof.firstReleaseToNewChallengeDisplayMs = Date.now() - firstRelease;
  assert.notEqual(await image.getAttribute('src'), initial);
  assert.equal((await remote()).state.clicks, 0);
  await page.screenshot({ path: '/tmp/mdac-redesign/verification-retry.png' });
  const secondRelease = await drag(true);
  await page.waitForFunction(() => document.querySelector('[data-testid="fixture-status"]').textContent.includes('outcome_unknown'), undefined, { timeout: 60_000 });
  proof.secondReleaseToOutcomeDisplayMs = Date.now() - secondRelease;
  const details = await remote();
  assert.equal(details.state.clicks, 1);
  assert.equal(details.state.challenge, '2');
  const trustedSecond = details.state.pointerEvents.filter(event => event.challenge === '2');
  assert.equal(trustedSecond.some(event => event.type === 'pointerdown' && event.trusted), true);
  assert.equal(trustedSecond.some(event => event.type === 'pointermove' && event.trusted), true);
  assert.equal(trustedSecond.some(event => event.type === 'pointerup' && event.trusted), true);
  const up = details.calls.filter(call => call.action === 'input' && call.type === 'up' && call.status === 200).at(-1);
  assert.ok(up);
  proof.secondReleaseToAcceptedUpMs = up.ended - secondRelease;
  proof.acceptedInputs = details.calls.filter(call => call.action === 'input' && call.status === 200).length;
  proof.rejectedInputs = details.calls.filter(call => call.action === 'input' && call.status !== 200).length;
  proof.trustedSecondGesture = trustedSecond.map(event => event.type);
  proof.nativeClicks = details.state.clicks;
  proof.calls = details.calls;
  assert.deepEqual(proof.errors, []);
  await page.screenshot({ path: '/tmp/mdac-redesign/verification-success.png' });
  console.log(JSON.stringify({ ...proof, calls: undefined }, null, 2));
} finally {
  await writeFile('/tmp/mdac-redesign/verification-pointer-proof.json', JSON.stringify(proof, null, 2));
  await browser.close();
}
