import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, acceptDownloads: true });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Riwayat', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { createRepository } = await import('/src/lib/storage/repository.js');
    const { malaysiaToday } = await import('/src/lib/domain/validate.js');
    const repository = createRepository();
    const trip = { arrival: malaysiaToday(), departure: malaysiaToday(), transportNo: 'TEST123', travelMode: '1', embarkation: 'IDN', accommodationKind: '01', address1: 'ONE TEST ROAD', address2: '', state: '14', city: '1400', postcode: '00100' };
    for (let index = 0; index < 5; index++) {
      const profile = await repository.saveProfile({ name: `SYNTHETIC TRAVELLER ${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][index]}`, passportNo: `TEST${index + 1}`, birthDate: '1990-01-02', passportExpiry: '2035-01-01', nationality: 'IDN', birthPlace: 'IDN', sex: '1', email: 'test@example.invalid', phoneCountry: '62', phone: '08123456789', reviewedAt: new Date().toISOString() });
      const [record] = await repository.queue([profile], { ...trip, transportNo: index === 4 ? 'OTHER123' : 'TEST123' });
      for (const type of ['filling', 'awaiting_verification', 'click_intent', 'outcome_unknown', 'reconcile']) await repository.appendEvent(record.id, { id: crypto.randomUUID(), attemptId: record.id, type, at: new Date().toISOString(), ...(type === 'reconcile' ? { reference: `pInAbC${index + 1}` } : {}) });
    }
  });
  await page.reload();
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  assert.equal(await page.locator('.trip-history').count(), 2);
  const trip = page.locator('.trip-history').filter({ has: page.getByRole('heading', { name: /TEST123/ }) });
  assert.equal(await trip.locator('.history-card').count(), 4);
  const [download] = await Promise.all([page.waitForEvent('download'), trip.getByRole('button', { name: 'Ekspor nama & PIN' }).click()]);
  assert.match(download.suggestedFilename(), /^mdac-nama-pin-\d{4}-\d{2}-\d{2}-TEST123\.png$/);
  await mkdir('.audit', { recursive: true });
  await download.saveAs('.audit/trip-pins-test.png');
  const png = await readFile('.audit/trip-pins-test.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1080);
  assert.ok(png.readUInt32BE(20) > 400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS: two journeys stay separate; one mobile history button downloads a PNG for its four passengers.');
} finally { await browser.close(); }
