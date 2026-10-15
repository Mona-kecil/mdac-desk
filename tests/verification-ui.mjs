import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { Sandbox } from '@vercel/sandbox';
import { get, del } from '@vercel/blob';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.FIXTURE_PORT || 4183);
const latency = Number(process.env.FIXTURE_LATENCY || 240);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = (await readFile(new URL('./fixtures/remote-form.html', import.meta.url), 'utf8')).replace('</script>', `
document.getElementById('captcha').dataset.challenge = '1';
slider.style.userSelect = 'none';
document.querySelector('#captcha strong').textContent = 'Synthetic drag 1. This puzzle changes during the first drag.';
slider.addEventListener('pointermove', event => {
  if (drag == null || !event.isTrusted || document.getElementById('captcha').dataset.challenge !== '1' || event.clientX - drag < 80) return;
  drag = null;
  slider.style.left = '2px';
  document.getElementById('captcha').dataset.challenge = '2';
  document.querySelector('#captcha strong').textContent = 'Synthetic drag 2. Drag the green box to the dashed target.';
});
const pointerEvents = [];
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'gotpointercapture', 'lostpointercapture']) document.addEventListener(type, event => {
  if (!event.isTrusted || (type === 'pointermove' && !event.buttons)) return;
  pointerEvents.push({ type, challenge: document.getElementById('captcha').dataset.challenge, trusted: event.isTrusted, x: event.clientX, y: event.clientY, buttons: event.buttons, target: event.target.className, captured: slider.hasPointerCapture(event.pointerId), drag });
  document.body.dataset.pointerEvents = JSON.stringify(pointerEvents);
}, true);
</script>`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const raw = { generation: randomUUID(), submission: { id: randomUUID(), profileSnapshot: { name: 'SYNTHETIC TRAVELLER', passportNo: `T${Date.now().toString().slice(-9)}`, birthDate: '1990-01-02', nationality: 'IDN', birthPlace: 'IDN', sex: '1', passportExpiry: '2030-01-01', email: 'test@example.invalid', phoneCountry: '62', phone: '08123456789' }, tripSnapshot: { arrival: today, departure: today, transportNo: 'TEST 123', travelMode: '1', embarkation: 'IDN', accommodationKind: '01', address1: 'TEST HOTEL ROAD', address2: '', state: '14', city: '1401', postcode: '05000' } } };
const capability = randomBytes(32).toString('base64url');
const calls = [];
let gateway, handle, binding, starting, lastState;
async function fixtureState() {
  if (!binding) return lastState;
  const sandbox = await Sandbox.get({ name: binding.vmName, resume: false });
  const relay = createHmac('sha256', process.env.MDAC_SESSION_SECRET).update(`relay-v1:${binding.owner}`).digest('base64url');
  const response = await fetch(`${sandbox.domain(3000)}/fixture-state`, { headers: { Authorization: `Bearer ${relay}` } });
  assert.equal(response.status, 200);
  lastState = await response.json();
  return lastState;
}
const result = value => ({ status: 200, body: value });
const vite = await createServer({ root, configFile: false, plugins: [svelte(), {
  name: 'verification-fixture',
  resolveId(id) { if (id === '$app/env/private') return '\0fixture-private-env'; },
  load(id) { if (id === '\0fixture-private-env') return ['MDAC_SESSION_SECRET', 'MDAC_CLAIM_NAMESPACE_SECRET', 'MDAC_BROWSER_SNAPSHOT_ID'].map(key => `export const ${key} = process.env.${key};`).join('\n'); },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url.startsWith('/__verification/')) return next();
      try {
        const action = request.url.split('/').at(-1);
        let body = '';
        for await (const chunk of request) body += chunk;
        const data = body ? JSON.parse(body) : undefined;
        let reply;
        if (action === 'bootstrap') reply = result({ ...raw, capability, latency });
        else if (action === 'proof') {
          let state;
          try { state = await fixtureState(); } catch { state = lastState; }
          reply = result({ calls, state });
        } else {
          if (action === 'create') {
            starting ??= gateway.createSession(raw, capability, fixture);
            const session = await starting;
            handle = session.handle;
            binding = JSON.parse(Buffer.from(handle.split('.')[0], 'base64url'));
            reply = result(session);
          } else {
            const call = { action, ...(action === 'input' ? data : {}), started: Date.now() };
            calls.push(call);
            if (action === 'input') await wait(latency);
            try {
              reply = result(await gateway.sessionAction(handle, capability, action, data));
              call.status = 200;
              if (action === 'status' && reply.body.events?.some(event => event.type === 'outcome_unknown')) await fixtureState();
            } catch (error) { call.status = error.status || 500; throw error; }
            finally { call.ended = Date.now(); }
          }
        }
        response.writeHead(reply.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(reply.body));
      } catch (error) {
        response.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message }));
      }
    });
  },
}], server: { host: '127.0.0.1', port, strictPort: true } });
gateway = await vite.ssrLoadModule('/src/lib/server/submission/gateway.js');
await vite.listen();
console.log(`Synthetic verification fixture at http://127.0.0.1:${port}/tests/verification-ui/index.html`);
console.log(`Production VerificationPane, desk, gateway, adapter and headed remote actor. Input delay ${latency} ms. No government requests.`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (binding) {
    await writeFile('/tmp/mdac-redesign/verification-ui-proof.json', JSON.stringify({ calls }, null, 2));
    try { const sandbox = await Sandbox.get({ name: binding.vmName, resume: false }); if (sandbox.status === 'running') await sandbox.stop(); await sandbox.delete(); } catch {}
    const current = await get(binding.key, { access: 'private', useCache: false });
    if (current) await del(binding.key, { ifMatch: current.blob.etag });
  }
  await vite.close();
  process.exit();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
