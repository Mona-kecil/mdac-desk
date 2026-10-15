(async () => {
  const { createAdapter } = await import(chrome.runtime.getURL('adapter.js'));
  const request = message => chrome.runtime.sendMessage({ channel: 'mdac-desk-v1', ...message });
  const job = await request({ command: 'attach' });
  if (!job?.submission) return;
  const attemptId = job.submission.id;
  const send = message => request({ ...message, attemptId });
  let adapter;
  try {
    adapter = createAdapter({
      document,
      submission: job.submission,
      emit: (type, detail) => send({ command: 'event', type, detail }),
      authorizeClick: async () => {
        const intent = await send({ command: 'intent' });
        if (!intent?.ok) throw new Error(intent?.error || 'Klik tidak diizinkan.');
        for (let tries = 0; tries < 120; tries++) {
          const permission = await send({ command: 'commit' });
          if (permission?.ok) return;
          if (permission?.error) throw new Error(permission.error);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('Aplikasi belum menyimpan niat klik. Buka kembali MDAC Desk.');
      }
    });
  } catch (error) {
    await send({ command: 'event', type: 'blocked', detail: error.message });
    return;
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.channel === 'mdac-desk-v1' && message.command === 'stop' && message.attemptId === attemptId) adapter.cancel();
  });
  await adapter.start();
})();
