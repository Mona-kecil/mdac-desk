import { it, expect, vi } from 'vitest';
import { createSubmissionDesk } from '../src/lib/submission/desk.js';
import { reduceAttempt } from '../src/lib/domain/state.js';

it('starts each traveller pointer at one and retains the sequence on reconnect', async () => {
  const records = ['a', 'b'].map(id => ({ id, state: 'queued', events: [], profileSnapshot: {}, tripSnapshot: {}, transport: 'web-v1' }));
  const bindings = new Map(), sessions = new Map(), inputs = [];
  let phase;
  const repository = {
    listSubmissions: async () => structuredClone(records),
    sessionBinding: async id => bindings.get(id),
    bindSession: async id => {
      if (!bindings.has(id)) bindings.set(id, { generation: `gen-${id}`, capability: 'test' });
      return bindings.get(id);
    },
    saveSessionHandle: async (id, generation, handle) => { bindings.get(id).handle = handle; },
    appendEvent: async (id, event) => {
      const index = records.findIndex(record => record.id === id);
      records[index] = reduceAttempt(records[index], event);
      return structuredClone(records[index]);
    },
  };
  const response = value => ({ ok: true, json: async () => value });
  const fetcher = async (url, options) => {
    const action = url.split('/').at(-1), body = options.body && JSON.parse(options.body);
    if (action === 'submission-sessions') {
      const id = body.submission.id;
      const events = ['filling', 'awaiting_verification'].map((type, index) => ({ id: `${id}-${type}`, attemptId: id, type, at: new Date(Date.now() + index).toISOString() }));
      const state = { generation: body.generation, events, closed: false };
      sessions.set(id, state);
      return response({ handle: id, ...state });
    }
    const id = url.split('/').at(-2);
    if (action === 'frame') return response({ image: 'AA==', width: 400, height: 200, generation: `gen-${id}.1`, inputSequence: 0 });
    if (action === 'input') { inputs.push({ id, sequence: body.sequence }); return response({ sequence: body.sequence }); }
    return response(sessions.get(id));
  };
  const desk = createSubmissionDesk({ repository, fetcher, changed: next => { phase = next; } });
  try {
    await desk.start(records[0]);
    await desk.input('down', 10, 10, phase.frame.generation);
    await desk.input('move', 20, 10, phase.frame.generation);
    await desk.reconnect();
    await desk.input('up', 20, 10, phase.frame.generation);
    records[0].state = 'confirmed';
    await desk.start(records[1]);
    await desk.input('down', 10, 10, phase.frame.generation);
    expect(inputs).toEqual([{ id: 'a', sequence: 1 }, { id: 'a', sequence: 2 }, { id: 'a', sequence: 3 }, { id: 'b', sequence: 1 }]);
  } finally { desk.dispose(); }
});

function verificationFixture({ delay = 0, delayOutcomeAck = false } = {}) {
  let record = { id: 'drag', state: 'queued', events: [], profileSnapshot: {}, tripSnapshot: {}, transport: 'web-v1' };
  const binding = { generation: 'owner', capability: 'test' };
  const events = ['filling', 'awaiting_verification'].map(type => ({ id: type, attemptId: record.id, type, at: new Date().toISOString() }));
  const inputs = [], accepted = [], acknowledgements = [];
  const outcomeAck = Promise.withResolvers(), ackReached = Promise.withResolvers();
  let phase, generation = 'owner.1', sequence = 0;
  const repository = {
    listSubmissions: async () => [structuredClone(record)],
    sessionBinding: async () => binding,
    bindSession: async () => binding,
    saveSessionHandle: async (_id, _generation, handle) => { binding.handle = handle; },
    appendEvent: async (_id, event) => { record = reduceAttempt(record, event); },
  };
  const response = (value, ok = true) => ({ ok, json: async () => value });
  const fetcher = async (url, options) => {
    const action = url.split('/').at(-1), body = options.body && JSON.parse(options.body);
    if (action === 'frame') return response({ image: 'AA==', width: 400, height: 200, generation, inputSequence: sequence });
    if (action === 'input') {
      inputs.push(body);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (body.generation !== generation || body.sequence !== sequence + 1) return response({ error: 'Input stale or outside frame' }, false);
      sequence = body.sequence;
      accepted.push(body);
      return response({ sequence });
    }
    if (action === 'ack') {
      acknowledgements.push(body.eventId);
      if (delayOutcomeAck && body.eventId === 'outcome_unknown') { ackReached.resolve(); await outcomeAck.promise; }
    }
    return response({ handle: 'drag', generation: binding.generation, events, closed: false });
  };
  const desk = createSubmissionDesk({ repository, fetcher, changed: value => { phase = value; } });
  return {
    desk, inputs, accepted, acknowledgements, phase: () => phase, replace: () => { generation = 'owner.2'; },
    outcome: () => events.push(...['click_intent', 'outcome_unknown'].map(type => ({ id: type, attemptId: record.id, type, at: new Date().toISOString() }))),
    ackReached: ackReached.promise, releaseAck: outcomeAck.resolve,
  };
}

it('releases a drag within three input round trips after a 60 ms pointer stream', async () => {
  vi.useFakeTimers();
  const fixture = verificationFixture({ delay: 240 });
  try {
    await fixture.desk.start({ id: 'drag' });
    const generation = fixture.phase().frame.generation;
    void fixture.desk.input('down', 10, 10, generation);
    for (let x = 20; x <= 300; x += 10) {
      await vi.advanceTimersByTimeAsync(60);
      void fixture.desk.input('move', x, 10, generation);
    }
    void fixture.desk.input('up', 300, 10, generation);
    await vi.advanceTimersByTimeAsync(720);
    expect(fixture.accepted.at(-1)).toMatchObject({ type: 'up', x: 300, sequence: fixture.accepted.length });
    expect(fixture.accepted.length).toBeLessThanOrEqual(11);
  } finally { fixture.desk.dispose(); vi.useRealTimers(); }
});

it('shows the recorded outcome while the remote close acknowledgement is pending', async () => {
  const fixture = verificationFixture({ delayOutcomeAck: true });
  let reconnect;
  try {
    await fixture.desk.start({ id: 'drag' });
    fixture.outcome();
    reconnect = fixture.desk.reconnect();
    await fixture.ackReached;
    expect(fixture.phase()).toMatchObject({ kind: 'paused', attempt: { state: 'outcome_unknown' } });
  } finally { fixture.releaseAck(); await reconnect; fixture.desk.dispose(); }
});

it('loads subsequent verification frames without repeating completed event acknowledgements', async () => {
  const fixture = verificationFixture();
  try {
    await fixture.desk.start({ id: 'drag' });
    await fixture.desk.reconnect();
    expect(fixture.acknowledgements).toEqual(['filling', 'awaiting_verification']);
    expect(fixture.phase().frame.generation).toBe('owner.1');
  } finally { fixture.desk.dispose(); }
});

it('starts the replacement puzzle at the last accepted sequence after stale input', async () => {
  const fixture = verificationFixture();
  try {
    await fixture.desk.start({ id: 'drag' });
    await fixture.desk.input('down', 10, 10, fixture.phase().frame.generation);
    fixture.replace();
    await fixture.desk.input('move', 100, 10, fixture.phase().frame.generation);
    await fixture.desk.reconnect();
    await fixture.desk.input('down', 10, 10, fixture.phase().frame.generation);
    expect(fixture.accepted.map(({ type, generation, sequence }) => ({ type, generation, sequence }))).toEqual([
      { type: 'down', generation: 'owner.1', sequence: 1 },
      { type: 'down', generation: 'owner.2', sequence: 2 },
    ]);
    expect(fixture.phase().error).toBeUndefined();
  } finally { fixture.desk.dispose(); }
});
