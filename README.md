# MDAC Desk

MDAC Desk menyiapkan Malaysia Digital Arrival Card untuk satu atau banyak penumpang. Aplikasi SvelteKit menyimpan profil dan riwayat pengiriman di browser. Chrome companion mengisi tab MDAC resmi. Setiap penumpang menyelesaikan puzzle resmi sebelum companion mencatat niat klik dan menekan tombol kirim sekali.

[Source di GitHub](https://github.com/Mona-kecil/mdac-desk). Proyek ini bukan situs pemerintah dan tidak terafiliasi dengan Jabatan Imigresen Malaysia.

## Jalankan aplikasi

Gunakan Node.js 22.17 atau lebih baru.

```sh
npm ci
npm run dev
```

Buka alamat localhost yang dicetak Vite. `npm run build` membuat situs statis di `build`. `vercel.json` menetapkan direktori itu untuk Vercel. Aplikasi tidak membutuhkan API key atau variabel lingkungan.

## Siapkan dan kirim MDAC

1. Tambahkan profil melalui formulir, CSV, XLSX, atau foto paspor. OCR berjalan di browser dengan worker, WASM, dan data bahasa dari origin aplikasi.
2. Tinjau semua kolom dengan paspor asli. MRZ tidak memuat negara kelahiran, email, atau telepon. Isi kolom tersebut sendiri.
3. Untuk spreadsheet, unduh template CSV. Simpan nomor paspor dan telepon sebagai teks. Gunakan tanggal `YYYY-MM-DD`. Import menampilkan kesalahan sebelum menyimpan baris yang Anda tinjau.
4. Pilih penumpang dan isi perjalanan bersama. Tanggal tiba harus hari ini sampai dua hari berikutnya dalam waktu Malaysia.
5. Unduh ZIP companion melalui **Panduan & data**. Ekstrak ZIP. Buka `chrome://extensions`, aktifkan **Developer mode**, pilih **Load unpacked**, lalu pilih folder hasil ekstrak.
6. Muat ulang MDAC Desk pada origin tempat ZIP diunduh. Companion dari origin lain tidak dapat mengendalikan antrean ini.
7. Tinjau snapshot pengiriman lalu mulai antrean. Companion membuka tab pemerintah. Selesaikan puzzle pada tab itu untuk setiap penumpang.
8. Setelah klik, periksa hasil di situs resmi. Buka [Check Registration](https://imigresen-online.imi.gov.my/mdac/register?viewRegistration). Masukkan paspor, kewarganegaraan, PIN, dan puzzle sesuai permintaan situs.
9. Masukkan referensi pengakuan atau PIN setelah Anda memeriksa registrasi. Riwayat memberi label **Dikonfirmasi pengguna**. Aplikasi tidak memverifikasi referensi itu ke pemerintah.

Companion adalah artefak instalasi ZIP, bukan publikasi Chrome Web Store. ZIP mengizinkan origin aplikasi saat unduh dan halaman MDAC resmi. Host lain tidak memperoleh izin.

## Simpan dan pulihkan data

Profil dapat berupa draf. Profil harus lengkap dan ditinjau sebelum masuk antrean. Setiap pengiriman menyimpan snapshot profil dan perjalanan. Edit profil tidak mengubah riwayat.

Gunakan **Ekspor cadangan** pada **Panduan & data** untuk menyimpan JSON. File itu memuat data paspor, kontak, perjalanan, dan riwayat. Simpan di tempat yang Anda lindungi. **Pulihkan cadangan** menggabungkan data tanpa menggandakan identitas profil atau paspor dan tanggal tiba yang sama.

Klik **Minta penyimpanan tetap** untuk meminta browser mempertahankan IndexedDB. Browser menentukan hasil permintaan. Menghapus data situs, menggunakan profil browser lain, atau memakai mode privat dapat menghapus atau memisahkan data. IndexedDB bukan cadangan. Aplikasi menyediakan hapus per catatan dan hapus semua dengan konfirmasi.

## Batas pengiriman

Klik tombol kirim bukan bukti penerimaan. `submittedAt` mencatat niat klik. `confirmedAt` berarti pengguna memasukkan referensi setelah memeriksa situs resmi. Tidak ada parser bukti penerimaan pemerintah dalam versi ini.

Status `outcome_unknown` menghentikan antrean. Aplikasi tidak mengulang klik yang hasilnya belum diketahui. Gangguan setelah niat klik juga masuk status itu. Selesaikan pemeriksaan melalui Check Registration. Kegagalan sebelum niat klik dapat dicoba ulang melalui tindakan pengguna. Tombol hentikan tidak dapat membatalkan klik yang sudah terjadi.

Formulir resmi dapat berubah. Companion berhenti jika pilihan, kolom, nilai setelah pengisian, tanggal tiba, atau bukti puzzle tidak cocok. Tombol kirim yang sudah aktif saat halaman dibuka bukan bukti puzzle. Companion memerlukan interaksi pointer pengguna pada puzzle dan perubahan DOM menuju status sukses dalam dokumen yang sama.

## Periksa perubahan

```sh
npm run verify
```

Perintah itu menjalankan pemeriksaan Svelte, tes domain/import/IndexedDB/adapter, build produksi, dan OCR model dengan dokumen sintetis. Tes memakai data sintetis. Jangan gunakan paspor asli dalam tes atau commit.

[Pengujian companion](docs/extension-testing.md) menjelaskan pengujian Chromium persisten dengan ZIP hasil unduh dan fixture lokal. [Batas data dan keamanan](docs/security.md) menjelaskan penyimpanan, izin, dan jurnal pengiriman.

Untuk mengulang pemeriksaan model OCR tanpa build aplikasi, jalankan `npm run test:ocr`. Perintah itu menjalankan WASM lokal pada PNG dokumen uji dan membandingkan dua baris MRZ dengan teks sumber. Pemeriksaan itu tidak menggantikan pengujian unggah dan crop di browser.

Untuk memeriksa preprocessing transparansi pada canvas Chromium, jalankan `npx playwright install chromium` lalu `npm run test:ocr:canvas`. Regresi ini membuat gambar sintetis dengan margin transparan, memeriksa piksel putih yang opak, dan memastikan dua baris teks tetap terpisah. Tes tidak memakai gambar spesimen eksternal atau permintaan jaringan.

Validasi OCR pada 15 Oktober 2026 memakai MRZ sintetis dengan WASM lokal dan [sampel fiktif UTOPIA/ERIKSSON dari PassportEye](https://github.com/konstantint/PassportEye/blob/master/tests/data/passport-td3.jpg) melalui browser. Sampel fiktif yang jelas menghasilkan nama, nomor paspor, tanggal lahir, jenis kelamin, dan masa berlaku sesuai MRZ, dengan checksum yang lolos. Kode UTO bersifat fiktif dan tidak tersedia dalam pilihan negara MDAC. Spesimen GOV.UK 2020 dan 2015 beresolusi rendah tetap gagal diekstrak setelah dikompositkan ke putih. Gunakan isian manual jika OCR tidak terbaca. Pengujian ini tidak mengukur akurasi foto paspor nyata. Gambar eksternal tidak disertakan dalam repository.
