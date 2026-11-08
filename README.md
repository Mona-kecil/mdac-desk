# MDAC Desk

Siapkan Malaysia Digital Arrival Card untuk satu atau banyak penumpang. Buka [MDAC Desk](https://mdac-desk.vercel.app), tambah penumpang, isi satu perjalanan bersama, tinjau, lalu pilih Kirim. Selesaikan puzzle resmi dalam aplikasi. Tidak ada ekstensi yang perlu dipasang.

Proyek SvelteKit ini bersifat independen dan tidak terafiliasi dengan Jabatan Imigresen Malaysia. Lisensi MIT.

## Pemakaian

1. Pilih foto paspor, CSV/XLSX, atau isian manual. OCR berjalan di perangkat. Cocokkan hasil dengan paspor, lalu lengkapi negara kelahiran dan kontak.
2. Pilih penumpang dan isi perjalanan bersama. Tanggal tiba mengikuti waktu Malaysia, hari ini hingga dua hari berikutnya.
3. Tinjau semua data, centang izin pengiriman, lalu pilih Kirim.
4. Selesaikan puzzle resmi untuk penumpang aktif. Verifikasi yang lolos memicu satu pengiriman. Tidak perlu menekan Kirim lagi.
5. Periksa [Check Registration](https://imigresen-online.imi.gov.my/mdac/register?viewRegistration), lalu catat referensi di riwayat. Lanjutkan penumpang berikutnya setelah hasil diperiksa.

Klik bukan bukti penerimaan. Hasil yang belum diketahui menahan rombongan dan tidak dikirim ulang otomatis. Riwayat membedakan bukti niat klik dari konfirmasi pengguna.

Profil dan riwayat tersimpan di browser. Gunakan **Data & bantuan** untuk ekspor atau pemulihan cadangan. Cadangan JSON memuat data pribadi dalam teks terbuka. Menghapus data situs atau memakai browser lain memisahkan data lokal.

Di **Riwayat**, pilih **Ekspor nama & PIN** pada perjalanan untuk mengunduh kartu PNG. Gambar dibuat di browser dan hanya memuat nama serta PIN yang Anda catat. PIN kosong ditandai **Belum dicatat**. Untuk memulihkan seluruh profil dan riwayat, gunakan cadangan JSON.

Foto paspor tidak dikirim ke server. Hanya data teks yang ditinjau diproses dalam browser server sementara. Sesi memiliki batas 15 menit. Penanda pengajuan berupa hash tersimpan terpisah untuk mencegah retry yang belum jelas hasilnya. Lihat [batas data](docs/security.md).

## Pengembangan lokal

Gunakan Node.js 24.

```sh
npm ci
npm run dev
```

Input, OCR, profil, dan cadangan bekerja lokal. Untuk pengiriman, operator menghubungkan proyek Vercel dengan Sandbox dan Blob privat, lalu mengisi variabel server di `.env.local` melalui `vercel env pull`. Pengguna aplikasi tidak memerlukan akun atau kunci API.

- `MDAC_SESSION_SECRET`. Kunci acak minimal 32 karakter untuk izin sesi.
- `MDAC_CLAIM_NAMESPACE_SECRET`. Kunci acak terpisah dan tetap untuk penanda pengajuan. Jangan rotasi tanpa migrasi penanda lama.
- `MDAC_BROWSER_SNAPSHOT_ID`. Image browser bersih dari `npm run browser:image`. Perbarui sebelum kedaluwarsa.
- Autentikasi Vercel OIDC serta Blob privat yang terhubung, atau `BLOB_READ_WRITE_TOKEN` untuk pengembangan.

`npm run browser:image` menyiapkan Chromium dan Xvfb sebelum ada data pengguna. Sesi pengguna memakai `persistent:false`; jangan membuat snapshot sesi pengguna. `npm run build` menghasilkan deployment SvelteKit dengan adapter Vercel. Batasi POST `/api/submission-sessions` melalui Vercel Firewall; deployment ini memakai 6 permintaan/menit/IP.

## Pemeriksaan

```sh
npm run verify
npm run test:remote
```

`verify` menjalankan pemeriksaan Svelte, tes domain/import/IndexedDB/adapter, build, dan pembacaan MRZ sintetis dengan WASM lokal. `test:remote` memerlukan konfigurasi Vercel dan menjalankan browser sementara pada fixture sintetis. Fixture memblokir permintaan pemerintah dan memeriksa pengisian, rekaman drag, retry, ACK yang ditahan, serta satu klik setelah ACK.

Untuk menguji UI tanpa akun Vercel, jalankan `node tests/verification-ui.mjs`, lalu `node tests/verification-pointer.mjs` di terminal kedua. Tes memakai komponen produksi dan actor Chromium lokal. Tes memeriksa gerakan tanpa permintaan jaringan, puzzle gagal lalu retry pada layar 360 px, dan satu submit sintetis. Gunakan `FIXTURE_REMOTE=1 node --env-file=.env.local tests/verification-ui.mjs` untuk memakai gateway dan Sandbox Vercel.

`node tests/official-puzzle.mjs` memeriksa ekspor gambar dari halaman resmi dengan semua permintaan selain GET/HEAD diblokir. Tes ini tidak menggeser puzzle atau mengirim formulir.

Dengan `npm run dev -- --port 4173` berjalan, `node tests/trip-export.mjs` memeriksa pengelompokan perjalanan dan unduhan PNG di layar 360 px memakai data sintetis.

Jangan kirim data uji ke pemerintah. Pemeriksaan halaman resmi hanya membuka formulir dan melihat puzzle. OCR dapat gagal pada gambar buram atau kecil; isian manual tetap tersedia. Fixture OCR tidak mengukur akurasi paspor nyata.
