<script>
  import { onMount } from 'svelte';
  import VerificationPane from '../../src/lib/components/VerificationPane.svelte';
  import { createSubmissionDesk } from '../../src/lib/submission/desk.js';
  import { reduceAttempt } from '../../src/lib/domain/state.js';
  import '../../src/app.css';
  let phase = { kind: 'idle' }, desk, error, latency, sent = 0;
  onMount(() => {
    void (async () => {
      const bootstrap = await (await fetch('/__verification/bootstrap')).json();
      latency = bootstrap.latency;
      let record = { ...bootstrap.submission, state: 'queued', events: [], transport: 'web-v1' };
      const binding = { generation: bootstrap.generation, capability: bootstrap.capability };
      const repository = {
        listSubmissions: async () => [structuredClone(record)],
        sessionBinding: async () => binding,
        bindSession: async () => binding,
        saveSessionHandle: async (_id, _generation, handle) => { binding.handle = handle; },
        appendEvent: async (_id, event) => { record = reduceAttempt(record, event); },
      };
      const fetcher = (url, options) => {
        const action = url.endsWith('submission-sessions') ? 'create' : url.split('/').at(-1);
        if (action === 'replay') sent++;
        return fetch(`/__verification/${action}`, options);
      };
      desk = createSubmissionDesk({ repository, fetcher, changed: value => { phase = value; } });
      await desk.start(record);
    })().catch(value => { error = value.message; });
    return () => desk?.dispose();
  });
</script>

<main class="wizard-wrap">
  <div class="notice warning">Synthetic form. No government requests. Replay delay {latency ?? '…'} ms.</div>
  <p data-testid="fixture-status">Puzzle {phase.puzzle?.id ?? '…'}. Sent {sent} replays. State {phase.attempt?.state ?? 'starting'}.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <section class="wizard-panel">
    <VerificationPane {phase} replay={(...args) => desk.replay(...args)} cancel={() => desk.cancel()} reconnect={() => desk.reconnect()} reconcile={() => {}} checkUrl="#simulation" />
  </section>
</main>
