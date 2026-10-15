export const SOURCE_FILES = ['adapter.js', 'app.js', 'background.js', 'config.js', 'official.js'];

export function companionFiles(origin, sources) {
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Origin aplikasi tidak valid.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Gunakan HTTPS untuk aplikasi yang dihosting.');
  const official = 'https://imigresen-online.imi.gov.my/mdac/main*';
  const manifest = {
    manifest_version: 3,
    name: 'MDAC Desk Companion',
    version: '0.1.0',
    description: 'Isi formulir MDAC dari browser ini. Puzzle tetap diselesaikan pengguna.',
    permissions: ['storage'],
    background: { service_worker: 'background.js', type: 'module' },
    content_scripts: [
      { matches: [`${origin}/*`], js: ['app.js'], run_at: 'document_idle' },
      { matches: [official], js: ['official.js'], run_at: 'document_idle' }
    ],
    web_accessible_resources: [{ resources: ['adapter.js'], matches: ['https://imigresen-online.imi.gov.my/*'] }]
  };
  const files = Object.fromEntries(SOURCE_FILES.map(name => [name, sources[name].replaceAll('__MDAC_APP_ORIGIN__', origin)]));
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  files['INSTALL.txt'] = `MDAC Desk Companion\n\n1. Ekstrak ZIP ke folder tetap.\n2. Buka chrome://extensions.\n3. Aktifkan Developer mode.\n4. Pilih Load unpacked dan folder hasil ekstrak.\n5. Muat ulang ${origin}.\n\nZIP ini hanya terhubung ke origin aplikasi tersebut. Buat ZIP baru bila alamat aplikasi berubah.\n\nBuka satu proses, periksa isian, lalu selesaikan puzzle resmi. Companion mengklik Submit satu kali setelah aplikasi menyimpan niat klik. Klik bukan bukti pendaftaran. Periksa Check Registration dan catat referensi pada aplikasi. Jangan kirim ulang hasil yang belum diketahui.\n\nProfil tetap di IndexedDB aplikasi. Payload aktif ekstensi disimpan dalam sesi browser. Jurnal ekstensi menyimpan ID percobaan dan status sampai aplikasi mengakui penerimaan. Menghapus ekstensi menghapus jurnalnya.\n`;
  return files;
}
