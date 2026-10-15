# Periksa ZIP dan pemulihan companion

Gunakan fixture lokal untuk menguji extension API dan pesan lintas tab. Fixture memuat ID kolom dan perubahan dropdown yang dipakai adapter produksi. Fixture tidak mengirim data ke pemerintah.

1. Pasang dependency dan Chromium.

```sh
npm ci
npx playwright install chromium
```

2. Jalankan server pengembangan.

```sh
npm run dev -- --port 5173
```

3. Dalam terminal lain, jalankan pengujian extension.

```sh
npm run test:extension
```

Untuk port lain, tetapkan origin yang dicetak Vite.

```sh
MDAC_TEST_ORIGIN=http://localhost:5174 npm run test:extension
```

Pengujian mengunduh ZIP melalui fungsi aplikasi, mengekstraknya ke direktori sementara, dan membuka Chromium dengan profil persisten. Pengujian memeriksa origin produksi sebelum menambahkan origin fixture ke salinan sementara. ZIP unduhan dan kode manifest produksi tetap membatasi origin aplikasi serta halaman MDAC resmi. Semua permintaan ke host pemerintah diblokir oleh pengujian.

Fixture mulai dengan tombol submit yang aktif. Pengujian memeriksa bahwa companion tidak menekan tombol sebelum puzzle. Drag pointer memicu perubahan sukses pada fixture. Pengujian menahan ACK niat klik, memuat ulang tab aplikasi, memeriksa pemutaran ulang jurnal, dan mengizinkan satu klik native setelah aplikasi menyimpan niat klik. Hasil tetap `outcome_unknown`. Profil aktif berada dalam session storage extension, bukan jurnal lokal.

Buka `/fixture.html` untuk inspeksi manual melalui preview. Tombol fixture hanya mencatat klik dalam DOM lokal. Mode fixture tidak mengubah adapter menjadi pengirim jaringan.

Gunakan preview aplikasi untuk memeriksa impor dan penyimpanan profil. Pengujian extension ini membutuhkan profil Chromium persisten agar Chrome memuat extension MV3. Jangan menjalankan pengujian submit pada origin pemerintah. Pemeriksaan live berhenti sebelum klik.
