import { APP_ORIGIN, OFFICIAL_URL, CHANNEL } from './config.js';

let serial = Promise.resolve();
const run = work => {
  const result = serial.then(work);
  serial = result.catch(() => {});
  return result;
};
const originIsApp = sender => sender.frameId === 0 && sender.tab?.id != null && new URL(sender.url).origin === APP_ORIGIN;
const originIsOfficial = sender => sender.frameId === 0 && sender.tab?.id != null && sender.url === OFFICIAL_URL;
const load = async () => (await chrome.storage.local.get('journal')).journal || { active: null, events: [], usedAttempts: [] };
const save = journal => chrome.storage.local.set({ journal });
const afterIntent = active => ['intent', 'dispatched', 'outcome_unknown'].includes(active.phase);
const sendApp = async (tabId, message) => {
  try { await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, ...message }); } catch { /* Journal stays until the app reconnects and acknowledges. */ }
};
const publish = async journal => {
  if (!journal.active) return;
  const tabId = journal.active.appTabId;
  for (const entry of journal.events) if (entry.appTabId === tabId) await sendApp(tabId, { event: entry.event });
};
const append = async (journal, type, detail) => {
  const event = { id: crypto.randomUUID(), attemptId: journal.active.attemptId, type, at: new Date().toISOString() };
  if (detail) event.detail = detail;
  journal.events.push({ appTabId: journal.active.appTabId, event });
  journal.active.phase = type === 'click_intent' ? 'intent' : type;
  await save(journal);
  await publish(journal);
  return event;
};
const boundOfficial = (sender, active, attemptId) => originIsOfficial(sender) && active && sender.tab.id === active.officialTabId && sender.documentId === active.documentId && attemptId === active.attemptId;
const validSubmission = value => {
  if (!value || typeof value.id !== 'string' || value.id.length > 100 || value.state !== 'queued') return false;
  return [value.profileSnapshot, value.tripSnapshot].every(snapshot => snapshot && Object.values(snapshot).every(item => typeof item === 'string' || item == null) && JSON.stringify(snapshot).length < 12000);
};
async function handle(message, sender) {
  if (!message || message.channel !== CHANNEL || typeof message.command !== 'string') return;
  const journal = await load();
  const active = journal.active;
  if (originIsApp(sender)) {
    if (message.command === 'hello') {
      for (const entry of journal.events) if (entry.appTabId === sender.tab.id) await sendApp(sender.tab.id, { event: entry.event });
      return { connected: true, message: active ? 'Companion memiliki satu proses aktif.' : 'Companion tersambung.', activeAttemptId: active?.attemptId };
    }
    if (message.command === 'start') {
      if (active) throw new Error('Masih ada proses aktif. Periksa tab resmi dan riwayat.');
      if (!validSubmission(message.submission)) throw new Error('Data antrean tidak valid.');
      if (journal.usedAttempts.includes(message.submission.id)) throw new Error('Percobaan ini telah dipakai. Jangan kirim ulang tanpa rekonsiliasi.');
      await chrome.storage.session.set({ payload: message.submission });
      journal.active = { attemptId: message.submission.id, appTabId: sender.tab.id, officialTabId: null, documentId: null, phase: 'opening', clickAcknowledged: false };
      journal.usedAttempts.push(message.submission.id);
      await save(journal);
      try {
        const tab = await chrome.tabs.create({ url: OFFICIAL_URL, active: true });
        journal.active.officialTabId = tab.id;
        await save(journal);
      } catch {
        await append(journal, 'blocked', 'Tab resmi gagal dibuka.');
      }
      return { ok: true };
    }
    if (message.command === 'ack') {
      const entry = journal.events.find(item => item.event.id === message.eventId && item.appTabId === sender.tab.id);
      if (!entry) return { ok: true };
      if (entry.event.type === 'click_intent' && active?.attemptId === entry.event.attemptId) active.clickAcknowledged = true;
      journal.events = journal.events.filter(item => item !== entry);
      if (active?.attemptId === entry.event.attemptId && ['blocked', 'cancelled', 'outcome_unknown'].includes(entry.event.type) && !journal.events.some(item => item.event.attemptId === active.attemptId)) {
        journal.active = null;
        await chrome.storage.session.remove('payload');
      }
      await save(journal);
      return { ok: true };
    }
    if (message.command === 'cancel') {
      if (!active || active.appTabId !== sender.tab.id || active.attemptId !== message.attemptId) throw new Error('Proses tidak cocok dengan tab aplikasi.');
      if (active.officialTabId) {
        try { await chrome.tabs.sendMessage(active.officialTabId, { channel: CHANNEL, command: 'stop', attemptId: active.attemptId }, { documentId: active.documentId }); } catch { /* The bound document may have navigated. */ }
      }
      await append(journal, afterIntent(active) ? 'outcome_unknown' : 'cancelled', afterIntent(active) ? 'Penghentian tidak membatalkan klik. Periksa Check Registration.' : 'Proses dihentikan sebelum klik.');
      return { ok: true };
    }
    throw new Error('Perintah aplikasi tidak dikenal.');
  }
  if (!originIsOfficial(sender) || !active || sender.tab.id !== active.officialTabId) throw new Error('Pengirim tidak terikat pada proses.');
  if (message.command === 'attach') {
    if (active.documentId) {
      if (sender.documentId !== active.documentId) await append(journal, afterIntent(active) ? 'outcome_unknown' : 'blocked', 'Dokumen resmi berubah. Periksa hasil sebelum mencoba lagi.');
      return {};
    }
    const { payload } = await chrome.storage.session.get('payload');
    if (!payload || payload.id !== active.attemptId) {
      await append(journal, 'blocked', 'Sesi browser berakhir. Data aktif tidak tersedia.');
      return {};
    }
    active.documentId = sender.documentId;
    active.phase = 'filling';
    await save(journal);
    return { submission: payload };
  }
  if (!boundOfficial(sender, active, message.attemptId)) throw new Error('Dokumen atau percobaan tidak cocok.');
  if (message.command === 'event') {
    const allowed = { filling: ['filling', 'awaiting_verification', 'blocked'], awaiting_verification: ['blocked'], intent: ['outcome_unknown'], dispatched: ['outcome_unknown'] };
    if (!allowed[active.phase]?.includes(message.type)) throw new Error('Transisi proses tidak diizinkan.');
    await append(journal, message.type, typeof message.detail === 'string' ? message.detail.slice(0, 500) : undefined);
    return { ok: true };
  }
  if (message.command === 'intent') {
    if (active.phase !== 'awaiting_verification') throw new Error('Proses belum siap untuk klik.');
    await append(journal, 'click_intent', 'Niat klik disimpan sebelum tombol Submit ditekan.');
    return { ok: true };
  }
  if (message.command === 'commit') {
    if (active.phase !== 'intent') throw new Error('Izin klik tidak dapat dipakai ulang.');
    if (!active.clickAcknowledged) return { pending: true };
    active.phase = 'dispatched';
    await save(journal);
    return { ok: true };
  }
  throw new Error('Perintah resmi tidak dikenal.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  run(() => handle(message, sender)).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  void run(async () => {
    const journal = await load();
    if (journal.active?.officialTabId === tabId && !['blocked', 'cancelled', 'outcome_unknown'].includes(journal.active.phase)) await append(journal, afterIntent(journal.active) ? 'outcome_unknown' : 'blocked', 'Tab resmi ditutup. Periksa riwayat sebelum mencoba lagi.');
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading') return;
  void run(async () => {
    const journal = await load();
    if (journal.active?.officialTabId === tabId && journal.active.documentId && !['blocked', 'cancelled', 'outcome_unknown'].includes(journal.active.phase)) await append(journal, afterIntent(journal.active) ? 'outcome_unknown' : 'blocked', 'Halaman resmi bernavigasi. Hasil belum terkonfirmasi.');
  });
});
