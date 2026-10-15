import { it, expect } from 'vitest';
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
