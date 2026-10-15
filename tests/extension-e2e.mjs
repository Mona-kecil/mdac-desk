import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync, strFromU8, strToU8 } from 'fflate';

const appOrigin = process.env.MDAC_TEST_ORIGIN || 'http://localhost:5173';
const fixtureOrigin = new URL(appOrigin);
fixtureOrigin.hostname = fixtureOrigin.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
const fixtureUrl = `${fixtureOrigin.origin}/fixture.html?official=1`;
const temp = await mkdtemp(join(tmpdir(), 'mdac-companion-test-'));
let context;
let worker;
let page;
const blockGovernment = context => context.route('**/*', route => new URL(route.request().url()).hostname === 'imigresen-online.imi.gov.my' ? route.abort('blockedbyclient') : route.continue());
try {
  const browser = await chromium.launch({ headless: true });
  const downloadContext = await browser.newContext();
  await blockGovernment(downloadContext);
  const downloadPage = await downloadContext.newPage();
  await downloadPage.goto(`${appOrigin}/fixture.html`);
  const downloaded = downloadPage.waitForEvent('download');
  await downloadPage.evaluate(async () => { const { downloadCompanion } = await import('/src/lib/bridge/client.js'); await downloadCompanion(); });
  const zip = await downloaded;
  const zipPath = join(temp, 'download.zip'); await zip.saveAs(zipPath);
  const files = unzipSync(await readFile(zipPath));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.deepEqual(manifest.content_scripts[0].matches, [`${appOrigin}/*`]);
  assert.deepEqual(manifest.content_scripts[1].matches, ['https://imigresen-online.imi.gov.my/mdac/main*']);
  assert(!JSON.stringify(manifest).includes('*.vercel.app'));
  await browser.close();

  // Only this extracted test copy gains the fixture origin. The downloaded production ZIP stays intact.
  manifest.name = 'MDAC Desk Fixture Companion';
  manifest.content_scripts[1].matches = [`${fixtureOrigin.origin}/fixture.html*`];
  manifest.web_accessible_resources[0].matches = [`${fixtureOrigin.origin}/*`];
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  files['config.js'] = strToU8(strFromU8(files['config.js']).replace('https://imigresen-online.imi.gov.my/mdac/main?registerMain', fixtureUrl));
  const extension = join(temp, 'extension'); await mkdir(extension);
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(extension, name), bytes);
  context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await blockGovernment(context);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage();
  await page.goto(`${appOrigin}/fixture.html`);
  const installBridge = async (holdAwaiting = false) => page.evaluate(async hold => {
    const { createBridge } = await import('/src/lib/bridge/client.js');
    window.testBridge = createBridge({ onStatus: status => {window.bridgeStatus=status;}, onEvent: async event => {
      if (hold && event.type === 'awaiting_verification') await new Promise(() => {});
      if (window.holdIntent && event.type === 'click_intent') await new Promise(resolve => {window.releaseIntent=resolve;});
      const events=JSON.parse(localStorage.getItem('test-journal') || '[]');
      if(!events.some(item=>item.id===event.id))events.push(event);
      localStorage.setItem('test-journal',JSON.stringify(events));
    }});
    window.testBridge.connect();
  }, holdAwaiting);
  await installBridge(true);
  await page.waitForFunction(() => window.bridgeStatus?.connected);
  const firstSubmission = await page.evaluate(() => window.fixtureSubmission);
  const officialOpened = context.waitForEvent('page');
  await page.evaluate(submission => window.testBridge.start(submission), firstSubmission);
  const official = await officialOpened;
  await official.waitForURL(fixtureUrl);
  await official.waitForFunction(() => document.getElementById('accommodationPostcode').value === '05000');
  assert.equal(await official.locator('#submit').isEnabled(), true);
  assert.equal(await official.getAttribute('body','data-native-clicks'), null);
  const journalBefore = await worker.evaluate(async () => (await chrome.storage.local.get('journal')).journal);
  assert(journalBefore.events.some(entry => entry.event.type === 'awaiting_verification'));
  assert(!JSON.stringify(journalBefore).includes('TEST TRAVELLER'));
  await page.reload();
  await installBridge();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-journal') || '[]').some(event => event.type === 'awaiting_verification'));
  await assert.rejects(() => page.evaluate(() => window.testBridge.start(window.fixtureSubmission)), /proses aktif/);
  const previousPage = page;
  page = await context.newPage();
  await page.goto(`${appOrigin}/fixture.html`);
  await installBridge();
  await page.waitForFunction(() => window.bridgeStatus?.connected);
  await assert.rejects(() => page.evaluate(id => window.testBridge.cancel(id), firstSubmission.id), /tab aplikasi/);
  await previousPage.close();
  const reboundDeadline = Date.now() + 10000;
  while (true) {
    const owner = await worker.evaluate(async () => (await chrome.storage.local.get('journal')).journal.active.appTabId);
    if (owner !== journalBefore.active.appTabId) break;
    assert(Date.now() < reboundDeadline, 'Journal must rebind after its owner tab closes');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.evaluate(() => {window.holdIntent=true;});
  await official.bringToFront();
  await official.locator('.slider').scrollIntoViewIfNeeded();
  const box = await official.locator('.slider').boundingBox();
  await official.mouse.move(box.x + 20, box.y + 20);
  await official.mouse.down();
  await official.mouse.move(box.x + 308, box.y + 22, { steps: 20 });
  await official.mouse.up();
  await page.waitForFunction(() => typeof window.releaseIntent === 'function');
  assert.equal(await official.getAttribute('body','data-native-clicks'), null);
  const waitingForAck = await worker.evaluate(async () => (await chrome.storage.local.get('journal')).journal);
  assert.equal(waitingForAck.active.phase, 'intent');
  assert.equal(waitingForAck.active.clickAcknowledged, false);
  await page.evaluate(() => {window.holdIntent=false;window.releaseIntent();});
  await official.waitForFunction(() => document.body.dataset.nativeClicks === '1');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-journal') || '[]').some(event => event.type === 'outcome_unknown'));
  const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem('test-journal')));
  assert.deepEqual(recorded.map(event => event.type), ['filling','awaiting_verification','click_intent','outcome_unknown']);
  assert.equal(await official.getAttribute('body','data-native-clicks'), '1');
  await page.reload(); await installBridge();
  await page.waitForFunction(() => window.bridgeStatus?.connected);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('test-journal')));
  assert.equal(persisted.at(-1).type, 'outcome_unknown');
  await assert.rejects(() => page.evaluate(submission => window.testBridge.start(submission), firstSubmission), /dipakai/);
  const retrySubmission = {...firstSubmission,id:'before-click-retry'};
  for (let run = 0; run < 2; run++) {
    await page.evaluate(submission => window.testBridge.start(submission), retrySubmission);
    await page.waitForFunction(count => JSON.parse(localStorage.getItem('test-journal')).filter(event => event.attemptId === 'before-click-retry' && event.type === 'awaiting_verification').length === count, run + 1);
    await page.evaluate(id => window.testBridge.cancel(id), retrySubmission.id);
    const deadline=Date.now()+10000;
    while(await worker.evaluate(async () => !!(await chrome.storage.local.get('journal')).journal.active)) {
      assert(Date.now()<deadline,'Cancellation journal must be acknowledged');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  console.log('PASS: downloaded ZIP loads; exact origins; session-only payload; journal replay after app reload; trusted drag; persisted intent before one native click; unknown outcome retained; closed owner tab rebound; live owner protected; pre-click retry allowed and post-click retry denied. Government requests blocked.');
} catch (error) {
  if (worker) console.error('Extension journal at failure', await worker.evaluate(async () => (await chrome.storage.local.get('journal')).journal));
  if (page) console.error('App journal at failure', await page.evaluate(() => localStorage.getItem('test-journal')));
  throw error;
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
