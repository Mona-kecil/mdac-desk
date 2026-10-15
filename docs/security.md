# Batas data

Profil, hasil OCR, snapshot pengiriman, dan riwayat tersimpan dalam IndexedDB pada origin aplikasi. Foto diproses dalam worker browser dan tidak disimpan sebagai bagian profil. Aset OCR dimuat dari host aplikasi. Cadangan JSON dan data lokal tidak dienkripsi oleh aplikasi.

Saat pengguna memilih Kirim, data teks yang ditinjau melewati server untuk mengisi formulir MDAC dalam browser sementara. Foto tidak ikut dikirim. Browser ditutup saat sesi selesai atau setelah 3 menit tanpa aktivitas. VM memiliki batas keras 15 menit. Jika koneksi gateway hilang, proses penutupan VM dapat menunggu batas tersebut. Sesi pengguna tidak dibuat persisten dan tidak di-snapshot.

Blob privat menyimpan penanda hash identitas/perjalanan, hash payload dan pemilik, generasi sesi, ID peristiwa, fase pengiriman, serta waktu kedaluwarsa. Penanda tidak memuat nama, nomor paspor mentah, kontak, foto, atau salinan formulir. Penanda dipertahankan melewati tanggal tiba agar kehilangan sesi tidak membuka pengiriman ulang. Penghapusan operasional dilakukan setelah tanggal tiba ditambah 7 hari dan seluruh izin sesi kedaluwarsa.

Kunci namespace penanda harus tetap sama antar deployment. Rotasi membutuhkan pencarian dengan kunci lama atau penghentian create selama migrasi. Mengganti kunci tanpa migrasi dapat menghilangkan perlindungan retry.

Server menerima tujuan dan operasi tetap. Pengguna menyelesaikan puzzle resmi melalui gambar browser dan pointer. Niat klik ditulis ke riwayat lokal sebelum ACK. Penanda server dibelanjakan sebelum satu izin klik diberikan ke browser aktif. Gangguan pada tahap ini dapat menghasilkan hasil tidak diketahui walaupun klik belum terjadi. Aplikasi tidak menjanjikan pendaftaran pemerintah tepat satu kali.

Klik, navigasi, dan HTTP200 bukan bukti penerimaan. Konfirmasi riwayat berasal dari pengguna setelah memeriksa Check Registration. Hasil yang belum diketahui menahan antrean. Cadangan mempertahankan bukti klik dan konflik; pemulihan tidak menjalankan ulang pengiriman.

Jangan memasukkan paspor nyata, foto, token, `.env.local`, atau log sesi ke repository dan laporan pengujian. Gunakan data sintetis dan jangan mengirim formulir uji ke pemerintah.
