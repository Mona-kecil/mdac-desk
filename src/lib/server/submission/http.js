import { json } from '@sveltejs/kit';

export async function boundary(event, action) {
  try {
    const request = event.request;
    if (request.method !== 'GET' && request.headers.get('origin') !== event.url.origin) return json({ error: 'Asal permintaan ditolak.' }, { status: 403 });
    const capability = request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability || '')) return json({ error: 'Izin sesi tidak valid.' }, { status: 401 });
    let body;
    if (request.method !== 'GET') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Gunakan JSON.' }, { status: 415 });
      const reader = request.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16_384) { await reader.cancel(); return json({ error: 'Data melebihi batas.' }, { status: 413 }); }
        chunks.push(part.value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString());
    }
    return json(await action(capability, body), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    return json({ error: error.status ? error.message : 'Sesi belum dapat dijangkau. Sambungkan kembali pengajuan yang sama.' }, { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
