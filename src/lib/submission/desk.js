import { PROFILE_FIELDS, TRIP_FIELDS } from '../domain/schema.js';
import { isInstant } from '../domain/state.js';

const eventTypes = new Set(['filling', 'awaiting_verification', 'click_intent', 'outcome_unknown', 'blocked', 'cancelled']);
const activeStates = new Set(['filling', 'awaiting_verification', 'submitting', 'outcome_unknown']);
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]));
export function createSubmissionDesk({ repository, changed, fetcher = fetch }) {
  let phase = { kind: 'idle' }, binding, attempt, timer, disposed = false, polling;
  const acknowledged = new Set();
  const update = next => { phase = next; changed(next); };
  const records = () => repository.listSubmissions();
  const localEvent = (id, type, detail) => repository.appendEvent(id, { id: crypto.randomUUID(), attemptId: id, type, at: new Date().toISOString(), detail });
  const request = async (action, body) => {
    const path = action === 'create' ? '/api/submission-sessions' : `/api/submission-sessions/${encodeURIComponent(binding.handle)}/${action}`;
    const response = await fetcher(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${binding.capability}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sesi belum dapat dijangkau.');
    return result;
  };
  const png = value => typeof value === 'string' && value.length <= 1_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  const loadPuzzle = async () => {
    const value = await request('challenge');
    if (value.id === null) return null;
    const { id, width, height, pieceWidth, track, ratio } = value;
    if (typeof id !== 'string' || id.length > 200 || !png(value.background) || !png(value.piece) || ![width, height, pieceWidth, track, ratio].every(Number.isFinite) || !(width >= 41 && width <= 1100) || !(height >= 1 && height <= 850) || !(pieceWidth >= 1 && pieceWidth <= width) || !(track >= 1 && track <= width) || !(ratio > 0 && ratio <= 2)) throw Error('Puzzle verifikasi tidak valid.');
    return { id, width, height, pieceWidth, track, ratio, background: `data:image/png;base64,${value.background}`, piece: `data:image/png;base64,${value.piece}` };
  };
  const ingest = async result => {
    if (!Array.isArray(result.events) || result.events.length > 1000 || result.generation !== binding.generation) throw Error('Bukti sesi tidak valid.');
    for (const event of result.events) {
      if (!eventTypes.has(event.type) || event.attemptId !== attempt.id || !isInstant(event.at) || typeof event.id !== 'string') throw Error('Bukti sesi tidak valid.');
      await repository.appendEvent(attempt.id, event);
      if (event.type === 'outcome_unknown') {
        attempt = (await records()).find(item => item.id === attempt.id);
        clearTimeout(timer);
        update({ kind: 'paused', attempt, closed: result.closed });
      }
      if (!acknowledged.has(event.id)) {
        await request('ack', { eventId: event.id });
        acknowledged.add(event.id);
      }
    }
    let current = (await records()).find(item => item.id === attempt.id);
    if (result.closed && !['blocked', 'cancelled', 'confirmed', 'outcome_unknown'].includes(current.state)) {
      if (result.intent && !current.submittedAt) {
        if (current.state === 'queued') await localEvent(current.id, 'filling', 'Memulihkan bukti sesi yang telah berakhir.');
        current = (await records()).find(item => item.id === attempt.id);
        if (current.state === 'filling') await localEvent(current.id, 'awaiting_verification', 'Memulihkan bukti verifikasi sesi.');
        await repository.appendEvent(current.id, { ...result.intent, attemptId: current.id, type: 'click_intent' });
      }
      current = (await records()).find(item => item.id === attempt.id);
      await localEvent(current.id, current.submittedAt ? 'outcome_unknown' : 'blocked', 'Sesi telah berakhir. Periksa riwayat sebelum melanjutkan.');
      current = (await records()).find(item => item.id === attempt.id);
    }
    attempt = current;
    if (current.state === 'awaiting_verification' && !result.closed) {
      if (!Object.hasOwn(result, 'challenge')) throw Error('Sesi ini memakai verifikasi lama. Hentikan pengiriman ini, lalu coba ulang.');
      const known = phase.kind === 'verification' ? phase : {};
      const puzzle = !result.challenge ? null : known.puzzle?.id === result.challenge ? known.puzzle : await loadPuzzle();
      update({ kind: 'verification', attempt: current, puzzle, verification: known.puzzle?.id === puzzle?.id ? known.verification || 'ready' : 'ready', expiresAt: result.expiresAt });
    } else if (['blocked', 'cancelled', 'outcome_unknown', 'confirmed'].includes(current.state)) {
      clearTimeout(timer);
      update({ kind: 'paused', attempt: current, closed: result.closed });
    } else update({ kind: 'connecting', attempt: current, expiresAt: result.expiresAt });
    await changed(phase);
    if (!disposed && !result.closed && !['blocked', 'cancelled', 'outcome_unknown', 'confirmed'].includes(current.state)) timer = setTimeout(poll, 1400);
  };
  const poll = () => {
    if (disposed || !binding?.handle) return Promise.resolve(false);
    polling ??= (async () => {
      try { await ingest(await request('status')); return true; }
      catch (error) { update({ ...phase, error: `${error.message} Sambungkan kembali sesi yang sama.` }); return false; }
    })().finally(() => { polling = null; });
    return polling;
  };
  const start = async record => {
    clearTimeout(timer);
    const all = await records();
    const current = all.find(item => item.id === record.id);
    if (!current || (current.state !== 'queued' && !(await repository.sessionBinding(current.id)))) throw Error('Pengajuan belum siap.');
    if (all.some(item => item.id !== current.id && activeStates.has(item.state))) throw Error('Periksa pengajuan yang aktif atau hasilnya belum diketahui.');
    if (current.submittedAt || current.events.some(event => ['click_intent', 'backup_conflict'].includes(event.type))) throw Error('Jangan kirim ulang. Periksa Check Registration.');
    attempt = current;
    binding = await repository.bindSession(current.id);
    update({ kind: 'connecting', attempt });
    try {
      if (!binding.handle) {
        const result = await request('create', { generation: binding.generation, previous: binding.previous, submission: { id: current.id, profileSnapshot: pick(current.profileSnapshot, PROFILE_FIELDS), tripSnapshot: pick(current.tripSnapshot, TRIP_FIELDS) } });
        if (typeof result.handle !== 'string') throw Error('Izin sesi belum diterima.');
        await repository.saveSessionHandle(current.id, binding.generation, result.handle);
        binding = { ...binding, handle: result.handle };
        await ingest(result);
      } else await poll();
    } catch (error) { update({ kind: 'connecting', attempt, error: error.message }); throw error; }
  };
  return {
    async initialize() {
      const all = await records();
      for (const record of all) {
        if (await repository.sessionBinding(record.id)) continue;
        if (record.state === 'submitting') await localEvent(record.id, 'outcome_unknown', 'Sesi lama tidak dapat dilanjutkan. Periksa Check Registration.');
        else if (['queued', 'filling', 'awaiting_verification'].includes(record.state) && record.transport !== 'web-v1') await localEvent(record.id, 'blocked', 'Catatan lama dihentikan. Pastikan sesi pengiriman lama telah ditutup sebelum membuat pengajuan baru.');
      }
      const resumable = (await records()).find(record => activeStates.has(record.state) || record.state === 'queued');
      if (resumable) {
        binding = await repository.sessionBinding(resumable.id);
        if (binding) {
          attempt = resumable;
          update({ kind: 'connecting', attempt });
          if (binding.handle) await poll();
          else update({ kind: 'connecting', attempt, error: 'Sambungkan kembali sesi yang sama untuk melanjutkan.' });
        }
      }
    },
    start,
    async reconnect() {
      if (!attempt) return;
      if (binding?.handle) await poll();
      else await start(attempt);
    },
    async cancel(record = attempt) {
      if (!record) return;
      attempt = record;
      binding = await repository.sessionBinding(record.id);
      if (!binding?.handle) {
        if (binding) await start(record);
        else if (record.state === 'queued') { await localEvent(record.id, 'cancelled', 'Pengajuan dibatalkan sebelum sesi dimulai.'); return; }
      }
      clearTimeout(timer);
      await ingest(await request('cancel', {}));
    },
    async retry(record) {
      if (record.transport !== 'web-v1' || record.submittedAt || record.events.some(event => ['click_intent', 'backup_conflict'].includes(event.type))) throw Error('Pengajuan ini perlu diperiksa dan tidak dapat dikirim ulang.');
      binding = await repository.sessionBinding(record.id);
      attempt = record;
      if (binding?.handle) await ingest(await request('cancel', {}));
      await localEvent(record.id, 'retry', 'Pengguna mencoba ulang setelah sesi tanpa niat kirim ditutup.');
      await repository.bindSession(record.id, true);
      await start((await records()).find(item => item.id === record.id));
    },
    async replay(id, path) {
      if (phase.kind !== 'verification' || phase.puzzle?.id !== id || phase.verification !== 'ready') return;
      update({ ...phase, verification: 'checking', error: undefined });
      clearTimeout(timer);
      let outcome;
      try {
        ({ outcome } = await request('replay', { challenge: id, path }));
        if (!['verified', 'failed', 'stale'].includes(outcome)) throw Error('Hasil verifikasi tidak valid.');
      } catch (error) {
        outcome = undefined;
        if (phase.kind === 'verification' && phase.puzzle?.id === id) update({ ...phase, verification: 'ready', error: error.message });
      }
      if (phase.kind === 'verification' && phase.puzzle?.id === id && outcome) update({ ...phase, verification: outcome === 'verified' ? 'verified' : 'failed' });
      clearTimeout(timer);
      if (!disposed) timer = setTimeout(poll, outcome === 'verified' ? 0 : 1200);
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
