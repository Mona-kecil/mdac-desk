const PROFILE = { name: 'name', passportNo: 'passNo', birthDate: 'dob', nationality: 'nationality', birthPlace: 'pob', sex: 'sex', passportExpiry: 'passExpDte', email: 'email', phoneCountry: 'region', phone: 'mobile' };
const TRIP = { arrival: 'arrDt', departure: 'depDt', transportNo: 'vesselNm', travelMode: 'trvlMode', embarkation: 'embark', accommodationKind: 'accommodationStay', address1: 'accommodationAddress1', address2: 'accommodationAddress2', state: 'accommodationState', city: 'accommodationCity', postcode: 'accommodationPostcode' };
const DATES = new Set(['dob', 'passExpDte', 'arrDt', 'depDt']);

export function assertArrival(arrival, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + 2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || arrival < today || arrival > max.toISOString().slice(0, 10)) throw new Error('Tanggal kedatangan di luar jendela Malaysia hari ini hingga dua hari lagi.');
}

export function formValues(submission) {
  const values = {};
  for (const [fields, snapshot] of [[PROFILE, submission.profileSnapshot], [TRIP, submission.tripSnapshot]]) {
    for (const [key, id] of Object.entries(fields)) {
      const value = snapshot?.[key];
      if (typeof value !== 'string' || (key !== 'address2' && !value)) throw new Error(`Data wajib belum lengkap: ${key}.`);
      if (DATES.has(id)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Tanggal tidak valid: ${key}.`);
        values[id] = value.split('-').reverse().join('/');
      } else values[id] = value;
    }
  }
  values.confirmEmail = values.email;
  const limits = { name: 60, passNo: 12, mobile: 12, email: 100, vesselNm: 30, accommodationAddress1: 100, accommodationAddress2: 100 };
  for (const [id, max] of Object.entries(limits)) if (values[id].length > max) throw new Error(`Nilai ${id} melebihi batas resmi ${max} karakter.`);
  if (values.accommodationAddress1.trim().split(/\s+/).length < 3) throw new Error('Alamat memerlukan setidaknya tiga kata.');
  return values;
}

export function createAdapter({ document, submission, emit, authorizeClick, now = () => new Date(), dependencyTimeout = 15000 }) {
  const win = document.defaultView;
  const values = formValues(submission);
  let phase = 'idle';
  let observer;
  let gesture = null;
  let successful = false;
  let previousSuccess = false;
  let disposed = false;
  const byId = id => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Formulir resmi berubah: ${id} tidak ditemukan.`);
    return element;
  };
  const set = id => {
    const element = byId(id);
    if (element.tagName === 'SELECT' && !Array.from(element.options).some(option => option.value === values[id])) throw new Error(`Pilihan resmi tidak tersedia: ${id}.`);
    if (element.classList.contains('uppercase')) values[id] = values[id].toUpperCase();
    if (element.maxLength >= 0 && values[id].length > element.maxLength) throw new Error(`Nilai ${id} melebihi batas formulir resmi.`);
    element.value = values[id];
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
    element.dispatchEvent(new win.Event('change', { bubbles: true }));
    element.dispatchEvent(new win.Event('blur'));
  };
  const readback = () => {
    assertArrival(submission.tripSnapshot.arrival, now());
    for (const [id, value] of Object.entries(values)) if (byId(id).value !== value) throw new Error(`Nilai formulir berubah: ${id}. Periksa formulir sebelum mencoba lagi.`);
  };
  const changeDependency = (id, dependentId) => new Promise((resolve, reject) => {
    const old = byId(dependentId);
    const timeout = win.setTimeout(() => { watch.disconnect(); reject(new Error(`Pilihan ${dependentId} belum dimuat. Coba lagi setelah memeriksa koneksi.`)); }, dependencyTimeout);
    const watch = new win.MutationObserver(records => {
      const current = document.getElementById(dependentId);
      if (current !== old || records.some(record => record.target === old || old.contains(record.target))) {
        watch.disconnect(); win.clearTimeout(timeout); resolve();
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try { set(id); } catch (error) { watch.disconnect(); win.clearTimeout(timeout); reject(error); }
  });
  const reportFailure = async error => {
    if (disposed) return;
    const type = phase === 'intent' || phase === 'clicked' ? 'outcome_unknown' : 'blocked';
    phase = type;
    cleanup();
    await emit(type, error.message);
  };
  const clickIfReady = async () => {
    if (phase !== 'awaiting_verification' || !successful) return;
    try {
      if (byId('submit').disabled) return;
      readback();
      phase = 'intent';
      await authorizeClick();
      if (disposed) return;
      readback();
      if (!document.querySelector('#captcha .sliderContainer_success') || byId('submit').disabled) throw new Error('Verifikasi puzzle telah berubah. Klik tidak dijalankan.');
      phase = 'clicked';
      cleanup();
      byId('submit').click();
      await emit('outcome_unknown', 'Klik telah dijalankan. Periksa Check Registration dan catat referensi di MDAC Desk.');
    } catch (error) { await reportFailure(error); }
  };
  const pointerDown = event => {
    if (!event.isTrusted || !event.target.closest?.('#captcha .slider')) return;
    gesture = { pointerId: event.pointerId, x: event.clientX, moved: false, ended: false };
  };
  const pointerMove = event => {
    if (event.isTrusted && gesture && event.pointerId === gesture.pointerId && Math.abs(event.clientX - gesture.x) > 5) gesture.moved = true;
  };
  const pointerUp = event => {
    if (event.isTrusted && gesture?.moved && event.pointerId === gesture.pointerId) gesture.ended = true;
  };
  const cleanup = () => {
    observer?.disconnect();
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointermove', pointerMove, true);
    document.removeEventListener('pointerup', pointerUp, true);
  };
  return {
    async start() {
      if (phase !== 'idle') throw new Error('Adapter telah dimulai.');
      phase = 'filling';
      try {
        assertArrival(submission.tripSnapshot.arrival, now());
        await emit('filling');
        await changeDependency('nationality', 'region');
        if (disposed) return;
        await changeDependency('pob', 'region');
        if (disposed) return;
        for (const id of Object.keys(values)) if (!['nationality', 'pob', 'region', 'accommodationState', 'accommodationCity', 'accommodationPostcode'].includes(id)) set(id);
        set('region');
        await changeDependency('accommodationState', 'accommodationCity');
        if (disposed) return;
        await changeDependency('accommodationCity', 'accommodationPostcode');
        if (disposed) return;
        set('accommodationPostcode');
        readback();
        byId('captcha'); byId('submit');
        previousSuccess = !!document.querySelector('#captcha .sliderContainer_success');
        document.addEventListener('pointerdown', pointerDown, true);
        document.addEventListener('pointermove', pointerMove, true);
        document.addEventListener('pointerup', pointerUp, true);
        observer = new win.MutationObserver(() => {
          const current = !!document.querySelector('#captcha .sliderContainer_success');
          if (!current) successful = false;
          if (current && !previousSuccess && gesture?.ended) successful = true;
          previousSuccess = current;
          void clickIfReady();
        });
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
        phase = 'awaiting_verification';
        await emit('awaiting_verification', 'Selesaikan slider puzzle di bagian bawah formulir resmi. Setelah lolos, companion akan mengklik Submit satu kali.');
      } catch (error) { await reportFailure(error); }
    },
    cancel() { disposed = true; cleanup(); },
    readback,
    get phase() { return phase; }
  };
}
