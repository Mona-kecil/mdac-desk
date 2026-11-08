import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { Sandbox } from '@vercel/sandbox';
import { get, del } from '@vercel/blob';
import { startLocalActor, syntheticSubmission } from './local-actor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.FIXTURE_PORT || 4183);
const latency = Number(process.env.FIXTURE_LATENCY || 240);
const remote = process.env.FIXTURE_REMOTE === '1';
const fixture = await readFile(new URL('./fixtures/remote-form.html', import.meta.url), 'utf8');
const raw = { generation: randomUUID(), submission: syntheticSubmission() };
const capability = randomBytes(32).toString('base64url');
const calls = [];
let gateway, actor, handle, binding, starting, lastState;
async function fixtureState() {
  try {
    if (!remote) lastState = await actor.call('fixture-state');
    else {
      const sandbox = await Sandbox.get({ name: binding.vmName, resume: false });
      const relay = createHmac('sha256', process.env.MDAC_SESSION_SECRET).update(`relay-v1:${binding.owner}`).digest('base64url');
      const response = await fetch(`${sandbox.domain(3000)}/fixture-state`, { headers: { Authorization: `Bearer ${relay}` } });
      if (!response.ok) throw Error('Fixture state unavailable');
      lastState = await response.json();
    }
  } catch { if (!lastState) throw Error('Fixture not ready'); }
  return lastState;
}
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
        let result;
        if (action === 'bootstrap') result = { ...raw, capability, latency };
        else if (action === 'proof') result = { calls, state: await fixtureState() };
        else if (action === 'create') {
          starting ??= (async () => {
            if (remote) {
              const session = await gateway.createSession(raw, capability, fixture);
              handle = session.handle;
              binding = JSON.parse(Buffer.from(handle.split('.')[0], 'base64url'));
              return session;
            }
            actor = await startLocalActor({ submission: raw.submission, generation: raw.generation });
            return { handle: 'local', ...await actor.call('status') };
          })();
          result = await starting;
        } else {
          const call = { action, ...(action === 'replay' ? data : {}), started: Date.now() };
          calls.push(call);
          if (action === 'replay') await new Promise(resolve => setTimeout(resolve, latency));
          try {
            result = remote ? await gateway.sessionAction(handle, capability, action, data) : action === 'ack' ? await actor.ack(data.eventId) : await actor.call(action, data);
            call.status = 200;
            if (action === 'status' && result.events?.some(event => event.type === 'outcome_unknown')) await fixtureState();
          } catch (error) { call.status = error.status || 500; throw error; }
          finally { call.ended = Date.now(); }
        }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message }));
      }
    });
  },
}], server: { host: '127.0.0.1', port, strictPort: true } });
if (remote) gateway = await vite.ssrLoadModule('/src/lib/server/submission/gateway.js');
await vite.listen();
console.log(`Synthetic verification fixture at http://127.0.0.1:${port}/tests/verification-ui/index.html. ${remote ? 'Cloud' : 'Local'} headed actor. No government requests.`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await actor?.stop();
  if (binding) {
    try { const sandbox = await Sandbox.get({ name: binding.vmName, resume: false }); if (sandbox.status === 'running') await sandbox.stop(); await sandbox.delete(); } catch {}
    const current = await get(binding.key, { access: 'private', useCache: false });
    if (current) await del(binding.key, { ifMatch: current.blob.etag });
  }
  await vite.close();
  process.exit();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
