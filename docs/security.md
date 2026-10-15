# Batas data dan keamanan

MDAC Desk menyimpan profil dan riwayat di IndexedDB milik origin aplikasi. Tidak ada akun, basis data server, analitik, atau server unggah dokumen. Situs statis dan aset OCR dimuat dari host aplikasi. Browser pengguna mengirim data ke pemerintah melalui formulir resmi saat companion menekan tombol kirim setelah puzzle.

Foto paspor tidak masuk IndexedDB. Tesseract.js memproses gambar di worker browser. Aset worker, WASM, dan bahasa disalin dari dependency yang terkunci saat build. Kegagalan OCR menghasilkan draf yang dapat dikoreksi. Checksum MRZ mendeteksi sebagian kesalahan baca dan tidak membuktikan identitas.

Profile menyimpan data pribadi yang dapat dipakai ulang. Submission menyimpan profileSnapshot, tripSnapshot, fingerprint kewarganegaraan/paspor/tanggal tiba, dan peristiwa append-only. Satu repository memiliki semua penulisan IndexedDB. Index unik dan transaksi mencegah duplikasi lintas tab. Restore tidak menimpa snapshot riwayat yang sudah ada.

Companion menerima protokol dengan versi dan perintah terbatas dari tab aplikasi pada origin yang tercantum dalam ZIP. Aplikasi tidak mengirim JavaScript, selector, atau URL tujuan. Adapter memiliki seluruh selector MDAC. Companion mengikat perintah pada tab aplikasi, tab resmi, dokumen, dan ID percobaan. Satu pekerjaan aktif memiliki satu pemilik jurnal.

Extension storage lokal menyimpan jurnal ID dan peristiwa sampai aplikasi menyimpan lalu mengakui penerimaan. Payload profil aktif berada dalam extension session storage. Pemulihan tidak mengulang niat klik. Setelah klik, perubahan halaman tanpa bukti penerimaan menjadi hasil tidak diketahui.

Permintaan penyimpanan tetap tidak menjamin retensi browser. Ekspor JSON diperlukan untuk cadangan. Data lokal dan JSON tidak dienkripsi oleh aplikasi. Orang yang mengakses profil browser atau file cadangan dapat membaca data tersebut.

Sumber referensi pilihan berasal dari formulir MDAC dan endpoint kota publik yang diperiksa 15 Oktober 2026. Adapter memeriksa pilihan halaman saat mengisi. Dataset lokal membantu pengguna memilih label dan tidak menggantikan pemeriksaan formulir langsung.

Restore memvalidasi jurnal sumber sebelum menggabungkannya. Peristiwa pemulihan lokal tetap tersimpan. Cadangan lebih baru dapat melanjutkan bukti sumber melewati pemulihan itu tanpa menjalankan ulang tindakan browser. Jika dua cabang berbeda dan salah satunya memuat niat klik, aplikasi menambahkan bukti konflik dan menghentikan antrean dengan `outcome_unknown`. Restore menandai proses pengisian yang terputus sebagai `blocked` dan niat klik yang terputus sebagai `outcome_unknown`.
