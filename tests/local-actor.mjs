import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);

export function syntheticSubmission() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { id: randomUUID(), profileSnapshot: { name: 'SYNTHETIC TRAVELLER', passportNo: `T${Date.now().toString().slice(-9)}`, birthDate: '1990-01-02', nationality: 'IDN', birthPlace: 'IDN', sex: '1', passportExpiry: '2030-01-01', email: 'test@example.invalid', phoneCountry: '62', phone: '08123456789' }, tripSnapshot: { arrival: today, departure: today, transportNo: 'TEST 123', travelMode: '1', embarkation: 'IDN', accommodationKind: '01', address1: 'TEST HOTEL ROAD', address2: '', state: '14', city: '1401', postcode: '05000' } };
}

export async function startLocalActor({ submission, generation = randomUUID(), fixture = new URL('fixtures/remote-form.html', import.meta.url), readOnly = false }) {
  const dir = new URL(`node_modules/.cache/mdac-actor-${randomUUID()}/`, root);
  await mkdir(dir, { recursive: true });
  await copyFile(new URL('remote/actor.mjs', root), new URL('actor.mjs', dir));
  await copyFile(new URL('remote/adapter.js', root), new URL('adapter.js', dir));
  if (!readOnly) await copyFile(fixture, new URL('fixture.html', dir));
  await writeFile(new URL('package.json', dir), '{"type":"module"}');
  const relay = randomBytes(32).toString('base64url');
  const owner = { generation, digest: 'local-digest', relay, submission, fixture: !readOnly, readOnly, expiresAt: Date.now() + 15 * 60_000 };
  const child = spawn(process.execPath, ['actor.mjs'], { cwd: dir, env: { ...process.env, MDAC_OWNER_JSON: JSON.stringify(owner) }, stdio: 'inherit' });
  const call = async (action, body) => {
    const response = await fetch(`http://127.0.0.1:3000/${action}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${relay}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok) { const error = Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  };
  for (let n = 0; ; n++) {
    try { await call('status'); break; }
    catch (error) { if (n > 100 || child.exitCode !== null) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  const ack = async eventId => {
    const event = (await call('status')).events.find(item => item.id === eventId);
    return event?.type === 'click_intent' ? call('permit', { eventId, permit: randomUUID() }) : call('ack', { eventId });
  };
  return {
    generation, call, ack,
    async stop() { try { await call('cancel', {}); } catch {} child.kill(); await new Promise(resolve => child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve)); await rm(dir, { recursive: true, force: true }); },
  };
}
