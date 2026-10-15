import { zipSync, strToU8 } from 'fflate';
import { companionFiles } from '../../../extension/package.js';
import adapter from '../../../extension/adapter.js?raw';
import app from '../../../extension/app.js?raw';
import background from '../../../extension/background.js?raw';
import config from '../../../extension/config.js?raw';
import official from '../../../extension/official.js?raw';

const CHANNEL = 'mdac-desk-v1';
const TYPES = new Set(['filling', 'awaiting_verification', 'click_intent', 'outcome_unknown', 'blocked', 'cancelled']);
const PROFILE_FIELDS = ['name', 'passportNo', 'birthDate', 'nationality', 'birthPlace', 'sex', 'passportExpiry', 'email', 'phoneCountry', 'phone'];
const TRIP_FIELDS = ['arrival', 'departure', 'transportNo', 'travelMode', 'embarkation', 'accommodationKind', 'address1', 'address2', 'state', 'city', 'postcode'];

export function createBridge({ onStatus = () => {}, onEvent }) {
  const pending = new Map();
  let listening = false;
  let heartbeat;
  let events = Promise.resolve();
  const request = (command, payload = {}) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Companion belum tersambung. Pasang ZIP lalu muat ulang halaman.'));
    }, 5000);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ channel: CHANNEL, from: 'app', requestId, command, ...payload }, location.origin);
  });
  const ack = eventId => request('ack', { eventId });
  const hello = async () => {
    try { onStatus(await request('hello')); }
    catch (error) { onStatus({ connected: false, message: error.message }); }
  };
  const receive = message => {
    const data = message.data;
    if (message.source !== window || message.origin !== location.origin || data?.channel !== CHANNEL || data.from !== 'companion') return;
    if (data.ready) { void hello(); return; }
    if (data.requestId && pending.has(data.requestId)) {
      const operation = pending.get(data.requestId);
      clearTimeout(operation.timer); pending.delete(data.requestId);
      if (data.result?.error) operation.reject(new Error(data.result.error));
      else operation.resolve(data.result);
      return;
    }
    const event = data.event;
    if (!event || !TYPES.has(event.type) || typeof event.id !== 'string' || typeof event.attemptId !== 'string' || !Number.isFinite(Date.parse(event.at))) return;
    events = events.then(async () => { await onEvent(event); await ack(event.id); }).catch(error => onStatus({ connected: true, message: `Peristiwa belum tersimpan: ${error.message}` }));
  };
  return {
    connect() {
      if (listening) return;
      listening = true;
      window.addEventListener('message', receive);
      void hello();
      heartbeat = setInterval(hello, 4000);
    },
    async start(submission) {
      const pick = (object, fields) => Object.fromEntries(fields.map(key => [key, object[key]]));
      await request('start', { submission: { id: submission.id, state: submission.state, profileSnapshot: pick(submission.profileSnapshot, PROFILE_FIELDS), tripSnapshot: pick(submission.tripSnapshot, TRIP_FIELDS) } });
      await hello();
    },
    cancel: attemptId => request('cancel', { attemptId }),
    ack,
    disconnect() {
      listening = false;
      clearInterval(heartbeat);
      window.removeEventListener('message', receive);
      for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Koneksi dihentikan.')); }
      pending.clear();
    }
  };
}

export async function downloadCompanion() {
  const files = companionFiles(location.origin, { 'adapter.js': adapter, 'app.js': app, 'background.js': background, 'config.js': config, 'official.js': official });
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'mdac-desk-companion.zip'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
