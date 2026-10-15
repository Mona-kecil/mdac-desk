(() => {
  const origin = '__MDAC_APP_ORIGIN__';
  const channel = 'mdac-desk-v1';
  if (location.origin !== origin || window.top !== window) return;
  const post = payload => window.postMessage({ channel, from: 'companion', ...payload }, origin);
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== origin || data?.channel !== channel || data.from !== 'app' || typeof data.requestId !== 'string') return;
    if (!['hello', 'start', 'cancel', 'ack'].includes(data.command)) return;
    const message = { channel, command: data.command };
    if (data.command === 'start') message.submission = data.submission;
    if (data.command === 'cancel') message.attemptId = data.attemptId;
    if (data.command === 'ack') message.eventId = data.eventId;
    try {
      const result = await chrome.runtime.sendMessage(message);
      post({ requestId: data.requestId, result });
    } catch {
      post({ requestId: data.requestId, result: { error: 'Companion tidak tersedia. Muat ulang halaman setelah memasang ekstensi.' } });
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.channel === channel && message.event) post({ event: message.event });
  });
  post({ ready: true });
})();
