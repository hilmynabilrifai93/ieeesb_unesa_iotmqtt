# Laboratorium IoT · IEEE SB UNESA

Frontend statis untuk mencoba tampilan dan kontrol praktikum ESP32. Dibuat dengan HTML, CSS, JavaScript, dan MQTT.js.

## Tampilan

Tampilan hijau sebelum revisi IMITECH dipulihkan pada 16 Oktober 2026 sesuai permintaan pengguna. Seluruh tampilan kembali memakai `src/styles.css`, termasuk login, sidebar, dan dashboard. Light/dark mode serta gesture geser pada pemilih Simulasi/MQTT dan navigasi bawah ponsel tetap mengikuti implementasi semula. Isi, autentikasi, dan logika perangkat tidak berubah.

Pada desktop, ruang menu akun dipertahankan ketika viewport pendek; isi status perangkat dapat di-scroll agar akun tidak terdorong keluar layar.

## Menjalankan

Gunakan Node.js 18 atau lebih baru. Buka terminal di folder proyek.

Pasang dependency terlebih dahulu:

```sh
npm install
```

Salin `config.example.js` menjadi `config.local.js`, lalu isi username dan password MQTT. File ini hanya dibaca gateway dan diabaikan Git. Build publik berisi placeholder tanpa credential.

Untuk instalasi baru, jalankan `node scripts/create-dashboard-accounts.mjs` sekali untuk membuat akun dengan password acak per perangkat. Hash tersimpan di `server/accounts.json`; daftar password ada di `Dashboard - Topic dan Password.md`. Keduanya privat dan diabaikan Git. Jangan menjalankan generator pada instalasi yang sudah memiliki akun karena file awal akan ditimpa.

Jalankan gateway pada terminal terpisah sesuai [panduan server](server/README.md), lalu jalankan frontend:

Windows PowerShell:

```powershell
npm.cmd run dev
```

Linux:

```sh
npm run dev
```

Buka [http://localhost:5173](http://localhost:5173).

## MQTT

- WebSocket: `wss://ieee.hint-lab.id/mqtt`
- Subscribe: `ieee/lab/+/telemetry`, `ieee/lab/+/state`, dan `ieee/lab/+/status`
- Command perangkat: `ieee/lab/{deviceId}/command`
- Perangkat awal: `esp32-01` (`ESP32 Praktik 1`) dan `esp32-02` (`ESP32 Praktik 2`)
- Status koneksi tampil pada kartu ESP32 di sidebar.
- Status online/offline, telemetry, dan state disimpan terpisah untuk setiap device ID.
- Pesan valid yang masuk tampil di browser console dan halaman **Catatan aktivitas**.

Perangkat untuk instalasi baru dapat ditambahkan melalui array `devices` di `config.local.js` dengan bentuk `{ id, name }` sebelum membuat akun. Login membatasi akses ke satu perangkat. Mode awal MQTT; pilih **Simulasi** untuk mencoba kontrol tanpa perangkat.

Contoh payload telemetry:

```json
{"temperature":28.7,"humidity":65,"distance":26.5,"waterLevel":43}
```

Contoh payload command:

```json
{"relay3":true}
```

Koneksi broker dapat diperiksa manual dengan `npm run verify:mqtt` (`npm.cmd run verify:mqtt` di PowerShell).

Empat relay memakai key `relay1` sampai `relay4`, masing-masing bernilai `true` atau `false`. Kirim satu relay per command. Firmware ESP32 perlu menangani keempat key tersebut dan mengirim state aktual melalui topic `state`.

Gateway memegang credential MQTT; frontend mengakses API dengan cookie sesi. `config.local.js`, hash akun, dan daftar password tidak dimasukkan ke repository atau build publik. Gunakan akun broker dengan izin topic yang terbatas untuk pemakaian nyata.

## Pemeriksaan dan build

```sh
npm test
npm run build
```

Di PowerShell, gunakan `npm.cmd` apabila eksekusi `npm.ps1` dibatasi. Hasil build tersedia di folder `dist` untuk hosting statis.

## Cakupan simulasi

- Mode simulasi memakai data browser. Mode MQTT membaca telemetry dan state ESP32, lalu mengirim kontrol LED, relay, servo, LCD, dan buzzer ke perangkat yang dipilih.
- LED dapat ditambah hingga delapan kanal, diberi nama sendiri, dan dikontrol secara terpisah. Empat relay, buzzer, servo, serta LCD dapat dicoba melalui antarmuka. Push button dan potensiometer digunakan langsung sebagai input fisik.
- Suhu, kelembapan, jarak ultrasonik, dan sensor air memakai data contoh.
- Persentase sensor air adalah demonstrasi nilai relatif, bukan pengukuran kedalaman atau volume. Pembacaan fisik memerlukan kalibrasi.
- Sudut servo adalah target perintah. Slider memilih setiap sudut 1–180° dengan langkah 1°. Pada mode MQTT, sudut pilihan tampil selama digeser dan dikirim saat slider dilepas; preview menunggu feedback maksimal 5 detik. Konvensi tampilan: 1° ke kiri, 90° ke tengah, 180° ke kanan. Arah perangkat fisik mengikuti pemasangan lengan servo.
- LCD memiliki dua baris dengan maksimal 16 karakter ASCII per baris. Pada mode MQTT, preview mengikuti state aktual yang dikirim ESP32.
- Keadaan sesi kembali ke nilai awal saat halaman dimuat ulang.

Daftar bahan mencakup 17 item praktikum. Prinsip penulisan antarmuka mengikuti [No AI Slop](https://github.com/petergyang/no-ai-slop): label langsung, nama komponen konsisten, dan keterangan yang spesifik.

Slider servo memperbarui hanya visual servo melalui requestAnimationFrame saat drag. Input native tetap mengendalikan thumb; log/perintah dicatat saat slider dilepas. Main.js dan CSS memakai query versi untuk menghindari cache aset lama.

Setiap LED memiliki kanal MQTT tetap 1-8 terpisah dari ID dan urutan tampilan. Penghapusan atau penggantian nama tidak mengubah kanal LED lain; LED baru memakai kanal kosong pertama. Menghapus baris LED tidak mengirim perintah mematikan perangkat.
