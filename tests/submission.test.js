import { it, expect } from 'vitest';
import { createSubmissionDesk } from '../src/lib/submission/desk.js';
import { reduceAttempt } from '../src/lib/domain/state.js';

const path = [[0, 0, 0], [40, 2, 120], [100, -1, 260]];
function fixture({ legacy = false } = {}) {
  let record = { id: 'drag', state: 'queued', events: [], profileSnapshot: {}, tripSnapshot: {}, transport: 'web-v1' };
  const binding = { generation: 'owner', capability: 'test' };
  const events = ['filling', 'awaiting_verification'].map(type => ({ id: type, attemptId: record.id, type, at: new Date().toISOString() }));
  let phase, challenge = 'puzzle-1', outcome = 'failed', replayGate, ackGate, badPuzzle = false;
  const calls = [];
  const repository = {
    listSubmissions: async () => [structuredClone(record)],
    sessionBinding: async () => binding,
    bindSession: async () => binding,
    saveSessionHandle: async (_id, _generation, handle) => { binding.handle = handle; },
    appendEvent: async (_id, event) => { record = reduceAttempt(record, event); },
  };
  const fetcher = async (url, options) => {
    const action = url.split('/').at(-1), body = options.body && JSON.parse(options.body);
    calls.push({ action, body });
    let value;
    if (action === 'challenge') value = { id: challenge, width: badPuzzle ? Infinity : 320, height: 155, pieceWidth: 63, track: 280, ratio: 260 / 280, background: 'AA==', piece: 'AA==' };
    else if (action === 'replay') { if (replayGate) await replayGate.promise; if (outcome instanceof Error) throw outcome; value = { outcome }; }
    else {
      if (action === 'ack' && body.eventId === 'outcome_unknown' && ackGate) { ackGate.reached.resolve(); await ackGate.release.promise; }
      value = { handle: 'drag', generation: binding.generation, events, closed: false, challenge };
      if (legacy) delete value.challenge;
    }
    return { ok: true, json: async () => value };
  };
  const desk = createSubmissionDesk({ repository, fetcher, changed: value => { phase = value; } });
  return {
    desk, calls, phase: () => phase, replace: () => { challenge = 'puzzle-2'; },
    outcome: value => { outcome = value; }, holdReplay: () => (replayGate = Promise.withResolvers()),
    badPuzzle: () => { badPuzzle = true; },
    holdOutcome: () => {
      events.push(...['click_intent', 'outcome_unknown'].map(type => ({ id: type, attemptId: record.id, type, at: new Date().toISOString() })));
      return (ackGate = { reached: Promise.withResolvers(), release: Promise.withResolvers() });
    },
  };
}

it('sends the recorded drag once and keeps checking through concurrent status polls', async () => {
  const f = fixture();
  try {
    await f.desk.start({ id: 'drag' });
    const gate = f.holdReplay();
    const replay = f.desk.replay('puzzle-1', path);
    await f.desk.reconnect();
    expect(f.phase().verification).toBe('checking');
    await f.desk.replay('puzzle-1', path);
    expect(f.calls.filter(call => call.action === 'replay')).toEqual([{ action: 'replay', body: { challenge: 'puzzle-1', path } }]);
    gate.resolve(); await replay;
    expect(f.phase().verification).toBe('failed');
  } finally { f.desk.dispose(); }
});

it('loads a replacement after failure and accepts its completed drag', async () => {
  const f = fixture();
  try {
    await f.desk.start({ id: 'drag' });
    await f.desk.replay('puzzle-1', path); await f.desk.reconnect();
    expect(f.phase().verification).toBe('failed');
    f.replace(); await f.desk.reconnect();
    expect(f.phase()).toMatchObject({ puzzle: { id: 'puzzle-2' }, verification: 'ready' });
    f.outcome('verified'); await f.desk.replay('puzzle-2', path);
    expect(f.phase().verification).toBe('verified');
    await f.desk.replay('puzzle-2', path);
    expect(f.calls.filter(call => call.action === 'replay')).toHaveLength(2);
  } finally { f.desk.dispose(); }
});

it('does not apply a previous puzzle result to a replacement', async () => {
  const f = fixture();
  try {
    await f.desk.start({ id: 'drag' });
    const gate = f.holdReplay();
    const replay = f.desk.replay('puzzle-1', path);
    f.replace(); await f.desk.reconnect();
    gate.resolve(); await replay;
    expect(f.phase()).toMatchObject({ puzzle: { id: 'puzzle-2' }, verification: 'ready' });
  } finally { f.desk.dispose(); }
});

it('shows transport failure and permits a retry without changing the human path', async () => {
  const f = fixture();
  try {
    await f.desk.start({ id: 'drag' });
    f.outcome(Error('Connection lost')); await f.desk.replay('puzzle-1', path);
    expect(f.phase()).toMatchObject({ verification: 'ready', error: 'Connection lost' });
    f.outcome('verified'); await f.desk.replay('puzzle-1', path);
    expect(f.phase().verification).toBe('verified');
    expect(f.calls.filter(call => call.action === 'replay').map(call => call.body.path)).toEqual([path, path]);
  } finally { f.desk.dispose(); }
});

it('caches unchanged puzzle images and completed event acknowledgements', async () => {
  const f = fixture();
  try {
    await f.desk.start({ id: 'drag' }); await f.desk.reconnect();
    expect(f.calls.filter(call => call.action === 'challenge')).toHaveLength(1);
    expect(f.calls.filter(call => call.action === 'ack').map(call => call.body.eventId)).toEqual(['filling', 'awaiting_verification']);
  } finally { f.desk.dispose(); }
});

it('shows the committed outcome before worker teardown acknowledgement finishes', async () => {
  const f = fixture(); let reconnect, gate;
  try {
    await f.desk.start({ id: 'drag' }); gate = f.holdOutcome();
    reconnect = f.desk.reconnect(); await gate.reached.promise;
    expect(f.phase()).toMatchObject({ kind: 'paused', attempt: { state: 'outcome_unknown' } });
  } finally { gate?.release.resolve(); await reconnect; f.desk.dispose(); }
});

it('rejects invalid puzzle dimensions before showing the puzzle', async () => {
  const f = fixture();
  try {
    f.badPuzzle(); await expect(f.desk.start({ id: 'drag' })).rejects.toThrow('Puzzle verifikasi tidak valid.');
  } finally { f.desk.dispose(); }
});

it('explains how to leave an existing screenshot-based session', async () => {
  const f = fixture({ legacy: true });
  try {
    await expect(f.desk.start({ id: 'drag' })).rejects.toThrow('Hentikan pengiriman ini, lalu coba ulang.');
    expect(f.phase().error).toContain('verifikasi lama');
  } finally { f.desk.dispose(); }
});
