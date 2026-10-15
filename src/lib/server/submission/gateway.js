import { Sandbox } from '@vercel/sandbox';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import * as env from '$app/env/private';
import actorSource from '../../../../remote/actor.mjs?raw';
import adapterSource from '../../../../remote/adapter.js?raw';
import { PROFILE_FIELDS, TRIP_FIELDS } from '../../domain/schema.js';
import { validateProfile, validateTrip, fingerprint } from '../../domain/validate.js';
import { createClaimLedger } from './claims.js';

const ledger = createClaimLedger();
const ttl = 15 * 60 * 1000;
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const equal = (left, right) => { const a = Buffer.from(left || ''), b = Buffer.from(right || ''); return a.length === b.length && timingSafeEqual(a, b); };
const secret = () => env.MDAC_SESSION_SECRET?.length >= 32 ? env.MDAC_SESSION_SECRET : fail(503, 'Layanan pengiriman belum tersedia. Data tetap tersimpan di perangkat ini.');
const hmac = (purpose, value) => createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('base64url');
const namespace = value => {
  if (!env.MDAC_CLAIM_NAMESPACE_SECRET || env.MDAC_CLAIM_NAMESPACE_SECRET.length < 32) fail(503, 'Layanan pengiriman belum tersedia.');
  return createHmac('sha256', env.MDAC_CLAIM_NAMESPACE_SECRET).update(`mdac-fingerprint-v1:${value}`).digest('base64url');
};
const pick = (value, fields) => Object.fromEntries(fields.map(key => { if (typeof value?.[key] !== 'string' || value[key].length > 1000) fail(400, 'Data pengajuan tidak valid.'); return [key, value[key]]; }));
export function reviewedPayload(raw) {
  if (!raw || !/^[\w-]{1,100}$/.test(raw.id)) fail(400, 'Pengajuan tidak valid.');
  const submission = { id: raw.id, profileSnapshot: pick(raw.profileSnapshot, PROFILE_FIELDS), tripSnapshot: pick(raw.tripSnapshot, TRIP_FIELDS) };
  const issues = [...validateProfile(submission.profileSnapshot), ...validateTrip(submission.tripSnapshot)];
  if (issues.length) fail(400, issues.join(' '));
  return submission;
}
const signHandle = value => { const encoded = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${encoded}.${hmac('handle-v1', encoded)}`; };
function readHandle(handle, capability) {
  if (typeof handle !== 'string' || handle.length > 1800) fail(401, 'Sesi tidak dikenali.');
  const [encoded, signature, extra] = handle.split('.');
  if (extra || !equal(signature, hmac('handle-v1', encoded))) fail(401, 'Sesi tidak dikenali.');
  let value;
  try { value = JSON.parse(Buffer.from(encoded, 'base64url')); } catch { fail(401, 'Sesi tidak dikenali.'); }
  if (!equal(value.owner, hmac('owner-v1', `${value.attemptId}:${value.generation}:${capability}`))) fail(401, 'Sesi tidak dikenali.');
  return value;
}
async function readClaim(value) {
  const current = await ledger.read(value.key);
  if (!ledger.matches(current?.claim, value)) fail(409, 'Pengajuan ini telah memiliki sesi lain. Periksa riwayat.');
  return current.claim;
}
const deadView = claim => ({ phase: 'closed', closed: true, events: [], intent: claim.intent || null, generation: claim.generation, digest: claim.digest, expiresAt: claim.expiresAt });
async function getWorker(claim) {
  let sandbox;
  try { sandbox = await Sandbox.get({ name: claim.vmName, resume: false }); }
  catch (error) { if (error.response?.status === 404) return null; throw error; }
  if (claim.sessionId && sandbox.currentSession()?.sessionId !== claim.sessionId) fail(409, 'Pemilik sesi berubah.');
  return sandbox;
}
async function relay(sandbox, claim, action, body) {
  if (!sandbox || sandbox.status !== 'running') return deadView(claim);
  const response = await fetch(`${sandbox.domain(3000)}/${action}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${hmac('relay-v1', claim.owner)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!response.ok) fail(response.status === 401 ? 401 : 409, 'Sesi berubah atau belum siap. Sambungkan kembali sesi yang sama.');
  const text = await response.text();
  if (text.length > 2_100_000) fail(502, 'Tampilan sesi melebihi batas.');
  const state = JSON.parse(text);
  const ownerGeneration = action === 'frame' ? state.ownerGeneration : state.generation;
  if (ownerGeneration && (ownerGeneration !== claim.generation || state.digest !== claim.digest)) fail(409, 'Bukti pemilik sesi berubah.');
  return state;
}
async function publish(sandbox, claim, state) {
  const event = state.events?.find(event => event.type === 'click_intent');
  if (event) {
    const result = await ledger.transition(claim.key, claim, ['open'], { phase: 'intent', intent: { id: event.id, at: event.at }, intentAt: event.at });
    claim = result.current.claim;
    if (!['intent','spent'].includes(claim.phase) || claim.intent?.id !== event.id) {
      await relay(sandbox, claim, 'cancel', {});
      return relay(sandbox, claim, 'status');
    }
  }
  return state;
}
async function stopWorker(sandbox, claim, state, explicit = false) {
  if (!state.closed || (!state.settled && !explicit)) return state;
  if (['allocating','open'].includes(claim.phase)) {
    const transition = await ledger.transition(claim.key, claim, ['allocating','open'], { phase: 'closing' });
    claim = transition.current.claim;
  }
  if (sandbox?.status === 'running') await sandbox.stop();
  const stopped = await getWorker(claim);
  if (stopped && (stopped.status !== 'stopped' || (stopped.currentSnapshotId && stopped.currentSnapshotId !== env.MDAC_BROWSER_SNAPSHOT_ID))) fail(409, 'Sesi belum dapat ditutup.');
  if (claim.phase === 'closing' && (stopped || Date.now() > claim.expiresAt + 60_000)) await ledger.transition(claim.key, claim, ['closing'], { phase: 'closed', closedAt: Date.now() });
  if (stopped) await stopped.delete();
  return state;
}
export async function createSession(raw, capability, fixture = null) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability || '') || !/^[\w-]{1,80}$/.test(raw?.generation || '')) fail(401, 'Izin sesi tidak valid.');
  if (!env.MDAC_BROWSER_SNAPSHOT_ID) fail(503, 'Layanan pengiriman belum tersedia. Data tetap tersimpan di perangkat ini.');
  const submission = reviewedPayload(raw.submission);
  const generation = raw.generation;
  const digest = hmac('payload-v1', JSON.stringify(submission));
  const owner = hmac('owner-v1', `${submission.id}:${generation}:${capability}`);
  const key = `mdac-claims/v1/${namespace(fingerprint(submission.profileSnapshot, submission.tripSnapshot))}.json`;
  const expiry = new Date(`${submission.tripSnapshot.arrival}T00:00:00Z`); expiry.setUTCDate(expiry.getUTCDate() + 8);
  const binding = { key, attemptId: submission.id, generation, digest, owner, vmName: `mdac-${hmac('vm-v1', `${key}:${generation}`).slice(0,40)}`, sessionId: null, epoch: 1, expiresAt: Date.now() + ttl, retainUntil: expiry.toISOString() };
  let previous;
  if (raw.previous) previous = readHandle(raw.previous.handle, raw.previous.capability);
  let claim;
  try { claim = (await ledger.allocate(key, binding, previous)).claim; }
  catch (error) {
    if (/^Claim (owned|changed)$/.test(error.message)) fail(409, 'Pengajuan ini telah memiliki sesi lain. Periksa riwayat sebelum mengirim ulang.');
    throw error;
  }
  const handle = signHandle(claim);
  let sandbox = await getWorker(claim);
  if (['intent','spent','closing','closed'].includes(claim.phase) || Date.now() > claim.expiresAt) return { handle, ...(sandbox?.status === 'running' ? await publish(sandbox, claim, await relay(sandbox, claim, 'status')) : deadView(claim)) };
  if (!sandbox) {
    try { sandbox = await Sandbox.create({ name: claim.vmName, region: 'sin1', persistent: false, timeout: Math.max(1000, claim.expiresAt - Date.now()), source: { type: 'snapshot', snapshotId: env.MDAC_BROWSER_SNAPSHOT_ID }, resources: { vcpus: 1 }, ports: [3000], tags: { purpose: 'mdac-submission-v1', expiry: claim.retainUntil.slice(0,10) } }); }
    catch (error) {
      if (!(error.response?.status === 400 && error.json?.error?.code === 'bad_request' && /already exists/.test(error.message))) throw error;
      sandbox = await getWorker(claim);
    }
  }
  if (!sandbox || sandbox.status !== 'running') return { handle, ...deadView(claim) };
  const sessionId = sandbox.currentSession()?.sessionId;
  if (!claim.sessionId) {
    const result = await ledger.transition(key, claim, ['allocating'], { phase: 'open', sessionId });
    claim = result.current.claim;
  }
  if (claim.sessionId !== sessionId || claim.phase !== 'open') fail(409, 'Pemilik sesi berubah.');
  let state;
  try { state = await relay(sandbox, claim, 'status'); } catch {}
  if (!state) {
    await readClaim(claim);
    const files = [{ path: 'browser/actor.mjs', content: Buffer.from(actorSource) }, { path: 'browser/adapter.js', content: Buffer.from(adapterSource) }];
    if (fixture) files.push({ path: 'browser/fixture.html', content: Buffer.from(fixture) });
    await sandbox.writeFiles(files);
    await sandbox.runCommand({ cmd: 'flock', args: ['-n', '/vercel/browser/actor.lock', 'xvfb-run', '-a', 'node', 'actor.mjs'], cwd: '/vercel/browser', env: { MDAC_OWNER_JSON: JSON.stringify({ ...claim, id: claim.attemptId, relay: hmac('relay-v1', claim.owner), submission, fixture: Boolean(fixture) }) }, detached: true });
  }
  for (let attempt = 0; attempt < 16 && !state; attempt++) {
    try { state = await relay(sandbox, claim, 'status'); } catch { await new Promise(resolve => setTimeout(resolve,500)); }
  }
  if (!state) fail(503, 'Sesi sedang disiapkan. Sambungkan kembali pengajuan yang sama.');
  return { handle, ...await publish(sandbox, claim, state) };
}
export async function sessionAction(handle, capability, action, body) {
  if (!['status','frame','input','ack','cancel'].includes(action)) fail(404, 'Tindakan tidak ditemukan.');
  const value = readHandle(handle, capability);
  let claim = await readClaim(value);
  const sandbox = await getWorker(claim);
  if (!sandbox || sandbox.status !== 'running') {
    const state = deadView(claim);
    if (action === 'cancel' && !['intent','spent'].includes(claim.phase)) return stopWorker(sandbox, claim, state, true);
    return state;
  }
  if (action === 'cancel') {
    const result = await ledger.transition(claim.key, claim, ['allocating','open'], { phase: 'closing' });
    claim = result.current.claim;
    const state = await relay(sandbox, claim, 'cancel', {});
    return state;
  }
  if (action === 'status') return publish(sandbox, claim, await relay(sandbox, claim, 'status'));
  if (Date.now() >= claim.expiresAt) fail(410, 'Sesi telah berakhir.');
  if (action === 'ack') {
    if (typeof body?.eventId !== 'string' || body.eventId.length > 100) fail(400, 'Bukti tidak valid.');
    const state = await publish(sandbox, claim, await relay(sandbox, claim, 'status'));
    claim = await readClaim(value);
    const event = state.events.find(entry => entry.id === body.eventId);
    if (!event) fail(409, 'Bukti tidak ditemukan.');
    if (event.type === 'click_intent') {
      if (claim.intent?.id !== event.id || claim.intent.at !== event.at) return relay(sandbox, claim, 'cancel', {});
      const permit = crypto.randomUUID();
      let spent;
      try { spent = await ledger.transition(claim.key, claim, ['intent'], { phase: 'spent', permit, spentAt: Date.now() }); }
      catch { return relay(sandbox, claim, 'cancel', {}); }
      if (!spent.won) return relay(sandbox, claim, 'status');
      claim = spent.current.claim;
      return relay(sandbox, claim, 'permit', { eventId: event.id, permit });
    }
    return stopWorker(sandbox, claim, await relay(sandbox, claim, 'ack', body));
  }
  if (claim.phase !== 'open' && action === 'input') fail(409, 'Verifikasi sesi telah berakhir.');
  return relay(sandbox, claim, action, body);
}
