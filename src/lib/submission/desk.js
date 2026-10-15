import { PROFILE_FIELDS, TRIP_FIELDS } from '../domain/schema.js';
import { isInstant } from '../domain/state.js';

const eventTypes = new Set(['filling', 'awaiting_verification', 'click_intent', 'outcome_unknown', 'blocked', 'cancelled']);
const activeStates = new Set(['filling', 'awaiting_verification', 'submitting', 'outcome_unknown']);
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key]]));
export function createSubmissionDesk({ repository, changed, fetcher = fetch }) {
  let phase = { kind: 'idle' }, binding, attempt, timer, disposed = false, polling;
  let inputSequence = 0, inputGeneration;
  let inputCommands = [], inputDrain, inputRecovery = false;
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
  const loadFrame = async () => {
    const frame = await request('frame');
    if (typeof frame.image !== 'string' || frame.image.length > 2_000_000 || !Number.isFinite(frame.width) || frame.width < 1 || frame.width > 1100 || !Number.isFinite(frame.height) || frame.height < 1 || frame.height > 850 || typeof frame.generation !== 'string' || !Number.isInteger(frame.inputSequence)) throw Error('Tampilan verifikasi tidak valid.');
    if (inputGeneration !== frame.generation) {
      inputGeneration = frame.generation;
      inputSequence = frame.inputSequence;
    } else inputSequence = Math.max(inputSequence, frame.inputSequence);
    return { ...frame, image: `data:image/jpeg;base64,${frame.image}` };
  };
  const ingest = async result => {
    if (!Array.isArray(result.events) || result.events.length > 1000 || result.generation !== binding.generation) throw Error('Bukti sesi tidak valid.');
    let frame = phase.frame;
    for (const event of result.events) {
      if (!eventTypes.has(event.type) || event.attemptId !== attempt.id || !isInstant(event.at) || typeof event.id !== 'string') throw Error('Bukti sesi tidak valid.');
      await repository.appendEvent(attempt.id, event);
      if (event.type === 'outcome_unknown') {
        attempt = (await records()).find(item => item.id === attempt.id);
        clearTimeout(timer);
        update({ kind: 'paused', attempt, frame, closed: result.closed });
        try { frame = await loadFrame(); } catch {}
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
      frame = await loadFrame();
      update({ kind: 'verification', attempt: current, frame, expiresAt: result.expiresAt });
    } else if (['blocked', 'cancelled', 'outcome_unknown', 'confirmed'].includes(current.state)) {
      clearTimeout(timer);
      update({ kind: 'paused', attempt: current, frame, closed: result.closed });
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
  const drainInputs = async () => {
    while (inputCommands.length || inputRecovery) {
      if (inputRecovery) {
        await polling;
        if (!await poll()) return;
        inputRecovery = false;
      }
      if (!inputCommands.length) break;
      const { type, x, y, generation } = inputCommands.shift();
      if (phase.kind !== 'verification' || phase.frame.generation !== generation) continue;
      try {
        const sequence = inputSequence + 1;
        await request('input', { type, x, y, generation, sequence });
        inputSequence = sequence;
        if (type === 'up') void poll();
      } catch (error) {
        update({ ...phase, error: error.message });
        inputRecovery = true;
      }
    }
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
    input(type, x, y, generation) {
      const command = { type, x, y, generation };
      const pending = inputCommands.at(-1);
      if (['move', 'up'].includes(type) && pending?.type === 'move' && pending.generation === generation) inputCommands[inputCommands.length - 1] = command;
      else inputCommands.push(command);
      inputDrain ??= drainInputs().finally(() => { inputDrain = null; });
      return inputDrain;
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
