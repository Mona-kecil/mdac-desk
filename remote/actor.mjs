import { createServer } from 'node:http';
import { readFile, writeFile, open } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import { chromium } from 'playwright';

const owner = JSON.parse(process.env.MDAC_OWNER_JSON);
delete process.env.MDAC_OWNER_JSON;
const initialized = await open(new URL('./initialized', import.meta.url), 'wx');
await initialized.writeFile(JSON.stringify({ generation: owner.generation, digest: owner.digest }));
await initialized.sync();
await initialized.close();
const adapter = (await readFile(new URL('./adapter.js', import.meta.url), 'utf8')).replaceAll('export ', '');
const journalPath = new URL('./journal.json', import.meta.url);
const official = 'https://imigresen-online.imi.gov.my/mdac/main?registerMain';
let journal = { phase: 'opening', events: [], acknowledged: [], generation: owner.generation, digest: owner.digest, closed: false, dispatched: false };
let browser, page, clip, grant, lastInput = 0, pointerDown = false, lastTouch = Date.now();
let challengeHash = '', challengeNumber = 0;
let commands = Promise.resolve();
const serial = operation => {
  const result = commands.then(operation);
  commands = result.catch(() => {});
  return result;
};
const persist = async () => {
  await writeFile(journalPath, JSON.stringify(journal), { mode: 0o600 });
  const file = await open(journalPath, 'r');
  await file.sync();
  await file.close();
};
const emit = async (type, detail) => {
  if (journal.closed) return;
  const event = { id: crypto.randomUUID(), attemptId: owner.submission.id, type, at: new Date().toISOString() };
  if (detail) event.detail = detail.slice(0, 1000);
  journal.events.push(event);
  journal.phase = type;
  await persist();
  return event;
};
const intent = () => journal.events.find(event => event.type === 'click_intent');
const challenge = async () => {
  const value = await page.evaluate(() => {
    const canvas = document.querySelector('#captcha canvas');
    return canvas ? canvas.toDataURL() : document.getElementById('captcha')?.dataset.challenge || 'fixture';
  });
  const hash = createHash('sha256').update(value).digest('hex');
  if (hash !== challengeHash) {
    if (pointerDown) { await page.mouse.up(); pointerDown = false; }
    challengeHash = hash;
    challengeNumber++;
  }
  return `${owner.generation}.${challengeNumber}`;
};
const terminal = () => ['blocked', 'cancelled', 'outcome_unknown'].includes(journal.phase);
const closeBrowser = async () => {
  grant?.(false);
  grant = null;
  await browser?.close().catch(() => {});
  browser = page = clip = null;
  owner.submission = null;
  journal.closed = true;
  await persist();
};
const stop = async reason => {
  if (journal.closed) return;
  await page?.evaluate(() => window.mdacAdapter?.cancel()).catch(() => {});
  if (!terminal()) await emit(intent() ? 'outcome_unknown' : reason === 'cancel' ? 'cancelled' : 'blocked', reason === 'cancel' ? 'Sesi dihentikan. Periksa hasil bila niat kirim sudah tercatat.' : 'Sesi berakhir. Periksa riwayat sebelum melanjutkan.');
  await closeBrowser();
};
const view = () => ({ phase: journal.phase, events: journal.events, generation: journal.generation, digest: journal.digest, closed: journal.closed, settled: terminal() && journal.events.every(event => journal.acknowledged.includes(event.id)), dispatched: journal.dispatched, expiresAt: owner.expiresAt, inputSequence: lastInput });
await persist();

const initialize = async () => {
  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
    if (owner.fixture || owner.readOnly) await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) && (!owner.fixture || new URL(route.request().url()).hostname === '127.0.0.1') ? route.continue() : route.abort());
    await page.exposeBinding('mdacEmit', (_source, type, detail) => serial(async () => {
      if (!['filling', 'awaiting_verification', 'blocked', 'outcome_unknown'].includes(type)) throw Error('Event refused');
      if (journal.closed || terminal()) return;
      await emit(type, detail);
      if (type === 'awaiting_verification') {
        await page.locator('#captcha').scrollIntoViewIfNeeded();
        clip = await page.locator('#captcha').boundingBox();
      }
    }));
    await page.exposeBinding('mdacAuthorize', async () => {
      const waiting = await serial(async () => {
        if (journal.closed || journal.phase !== 'awaiting_verification' || intent()) throw Error('Authorization refused');
        await emit('click_intent');
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        grant = resolve;
        return { promise };
      });
      if (!await waiting.promise) throw Error('Authorization stopped');
    });
    page.on('framenavigated', frame => {
      if (frame === page?.mainFrame() && journal.phase === 'awaiting_verification') void serial(() => stop('document'));
    });
    await page.goto(owner.fixture ? 'http://127.0.0.1:3000/fixture' : official, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('#passNo').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(3000);
    if (owner.readOnly) {
      await page.locator('#captcha').scrollIntoViewIfNeeded();
      clip = await page.locator('#captcha').boundingBox();
      journal.phase = 'readonly';
      await persist();
      return;
    }
    await page.addScriptTag({ content: `${adapter}\nwindow.mdacAdapter = createAdapter({document,submission:${JSON.stringify(owner.submission)},emit:(type,detail)=>window.mdacEmit(type,detail),authorizeClick:()=>window.mdacAuthorize()}); window.mdacAdapter.start();` });
  } catch {
    await serial(async () => {
      if (!terminal() && !journal.closed) await emit(intent() ? 'outcome_unknown' : 'blocked', 'Formulir resmi belum dapat disiapkan. Periksa data atau coba lagi sebelum ada niat kirim.');
    });
  }
};

createServer(async (request, response) => {
  const send = (status, data, type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  if (request.url === '/fixture' && owner.fixture && request.method === 'GET') return send(200, await readFile(new URL('./fixture.html', import.meta.url)), 'text/html');
  const supplied = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${owner.relay}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Unauthorized' });
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4096) return send(413, { error: 'Body too large' });
    }
    const data = raw ? JSON.parse(raw) : {};
    const result = await serial(async () => {
      if (Date.now() >= owner.expiresAt) await stop('expiry');
      lastTouch = Date.now();
      if (request.method === 'GET' && request.url === '/status') return { status: 200, data: view() };
      if (owner.fixture && request.method === 'GET' && request.url === '/fixture-state') return { status: 200, data: await page.evaluate(() => ({ clicks: Number(document.body.dataset.nativeClicks || 0), challenge: document.getElementById('captcha').dataset.challenge, pointerEvents: JSON.parse(document.body.dataset.pointerEvents || '[]'), passport: document.getElementById('passNo').value, region: document.getElementById('region').value, city: document.getElementById('accommodationCity').value, postcode: document.getElementById('accommodationPostcode').value, slider: document.querySelector('.slider').getBoundingClientRect().toJSON(), track: document.querySelector('.sliderContainer').getBoundingClientRect().toJSON(), captcha: document.getElementById('captcha').getBoundingClientRect().toJSON() })) };
      if (request.method === 'GET' && request.url === '/frame') {
        if (!page || !clip || journal.closed) return { status: 410, data: { error: 'Frame closed' } };
        const image = await page.screenshot({ type: 'jpeg', quality: 80, clip });
        if (image.length > 1_500_000) throw Error('Frame too large');
        return { status: 200, data: { image: image.toString('base64'), width: clip.width, height: clip.height, generation: await challenge(), ownerGeneration: owner.generation, digest: owner.digest, inputSequence: lastInput } };
      }
      if (request.method === 'POST' && request.url === '/input') {
        if (journal.phase !== 'awaiting_verification' || data.generation !== await challenge() || !clip || !Number.isInteger(data.sequence) || data.sequence !== lastInput + 1 || !['down', 'move', 'up'].includes(data.type) || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.x > clip.width || data.y < 0 || data.y > clip.height) return { status: 409, data: { error: 'Input stale or outside frame' } };
        if ((data.type === 'down' && pointerDown) || (data.type !== 'down' && !pointerDown)) return { status: 409, data: { error: 'Pointer order refused' } };
        await page.mouse.move(clip.x + data.x, clip.y + data.y);
        if (data.type === 'down') { await page.mouse.down(); pointerDown = true; }
        if (data.type === 'up') { await page.mouse.up(); pointerDown = false; }
        lastInput = data.sequence;
        return { status: 200, data: { sequence: lastInput } };
      }
      if (request.method === 'POST' && ['/ack', '/permit'].includes(request.url)) {
        const event = journal.events.find(item => item.id === data.eventId);
        if (!event) return { status: 409, data: { error: 'Unknown event' } };
        if (!journal.acknowledged.includes(event.id)) { journal.acknowledged.push(event.id); await persist(); }
        if (request.url === '/permit' && event.type === 'click_intent' && typeof data.permit === 'string' && /^[\w-]{36}$/.test(data.permit) && !journal.dispatched && !journal.closed && journal.phase === 'click_intent') {
          journal.dispatched = true;
          journal.permit = data.permit;
          await persist();
          grant?.(true);
          grant = null;
        }
        if (terminal() && journal.events.every(item => journal.acknowledged.includes(item.id))) await closeBrowser();
        return { status: 200, data: view() };
      }
      if (request.method === 'POST' && request.url === '/cancel') { await stop('cancel'); return { status: 200, data: view() }; }
      return { status: 404, data: { error: 'Not found' } };
    });
    send(result.status, result.data);
  } catch { send(400, { error: 'Command refused' }); }
}).listen(3000, '0.0.0.0', () => { void initialize(); });
setInterval(() => { if (!journal.closed && (Date.now() >= owner.expiresAt || Date.now() - lastTouch > 180_000)) void serial(() => stop('expiry')); }, 5000).unref();
