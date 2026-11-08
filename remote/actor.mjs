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
let browser, page, grant, lastReplay, lastTouch = Date.now();
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
const puzzle = async () => {
  const state = await page.evaluate(() => {
    const root = document.getElementById('captcha');
    const canvas = root?.querySelector('canvas:not(.block)'), block = root?.querySelector('canvas.block');
    if (!canvas || !block || block.width >= canvas.width) return null;
    const width = root.offsetWidth;
    return { width, height: canvas.height, pieceWidth: block.width, track: width - 40, ratio: (width - 60) / (width - 40), background: canvas.toDataURL('image/png'), piece: block.toDataURL('image/png') };
  });
  if (!state) return null;
  const id = `${owner.generation}.${createHash('sha256').update(state.background).update(state.piece).digest('base64url').slice(0, 22)}`;
  return { ...state, id, background: state.background.replace(/^data:image\/png;base64,/, ''), piece: state.piece.replace(/^data:image\/png;base64,/, '') };
};
const solving = () => ['awaiting_verification', 'readonly'].includes(journal.phase) && page && !journal.closed;
const validPath = (path, current) => Array.isArray(path) && path.length >= 2 && path.length <= 400 && path.every((point, index) => Array.isArray(point) && point.length === 3 && point.every(Number.isInteger) && point[0] >= 0 && point[0] <= current.track && Math.abs(point[1]) <= current.height && point[2] >= (index ? path[index - 1][2] : 0) && point[2] <= 8000) && path[0].every(value => value === 0);
const replay = async path => {
  const knob = page.locator('#captcha .slider');
  await knob.scrollIntoViewIfNeeded();
  const box = await knob.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    const started = Date.now();
    for (const [dx, dy, at] of path.slice(1)) {
      const wait = started + at - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      await page.mouse.move(x + dx, y + dy);
    }
  } finally { await page.mouse.up(); }
  const verified = await page.waitForFunction(() => {
    const result = document.querySelector('#captcha .sliderContainer_success, #captcha .sliderContainer_fail');
    return result && { verified: result.classList.contains('sliderContainer_success') };
  }, undefined, { timeout: 3000 }).then(async handle => { const value = await handle.jsonValue(); await handle.dispose(); return value.verified; }, () => false);
  return verified ? 'verified' : 'failed';
};
const terminal = () => ['blocked', 'cancelled', 'outcome_unknown'].includes(journal.phase);
const closeBrowser = async () => {
  grant?.(false);
  grant = null;
  await browser?.close().catch(() => {});
  browser = page = null;
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
const view = () => ({ phase: journal.phase, events: journal.events, generation: journal.generation, digest: journal.digest, closed: journal.closed, settled: terminal() && journal.events.every(event => journal.acknowledged.includes(event.id)), dispatched: journal.dispatched, expiresAt: owner.expiresAt });
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
      if (type === 'awaiting_verification') await page.locator('#captcha').scrollIntoViewIfNeeded();
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
      if (Buffer.byteLength(raw) > 16_384) return send(413, { error: 'Body too large' });
    }
    const data = raw ? JSON.parse(raw) : {};
    const result = await serial(async () => {
      if (Date.now() >= owner.expiresAt) await stop('expiry');
      lastTouch = Date.now();
      if (request.method === 'GET' && request.url === '/status') return { status: 200, data: { ...view(), challenge: solving() ? (await puzzle())?.id ?? null : null } };
      if (owner.fixture && request.method === 'GET' && request.url === '/fixture-state') return { status: 200, data: await page.evaluate(() => ({ clicks: Number(document.body.dataset.nativeClicks || 0), passport: document.getElementById('passNo').value, region: document.getElementById('region').value, city: document.getElementById('accommodationCity').value, postcode: document.getElementById('accommodationPostcode').value, puzzle: window.fixturePuzzle?.() })) };
      if (request.method === 'GET' && request.url === '/challenge') {
        const current = solving() ? await puzzle() : null;
        return { status: 200, data: { ...current, id: current?.id ?? null, ownerGeneration: owner.generation, digest: owner.digest } };
      }
      if (request.method === 'POST' && request.url === '/replay') {
        const result = outcome => ({ status: 200, data: { outcome, generation: owner.generation, digest: owner.digest } });
        if (lastReplay && lastReplay.challenge === data.challenge) return result(lastReplay.outcome);
        const current = solving() ? await puzzle() : null;
        if (!current || data.challenge !== current.id || await page.locator('#captcha .sliderContainer_success, #captcha .sliderContainer_fail').count()) return result('stale');
        if (!validPath(data.path, current)) return { status: 400, data: { error: 'Gerakan puzzle tidak valid.' } };
        lastReplay = { challenge: current.id, outcome: await replay(data.path) };
        return result(lastReplay.outcome);
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
