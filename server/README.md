# Dashboard login gateway

Login memilih satu device dari 15 perangkat. Password disimpan sebagai hash scrypt dengan salt unik di `accounts.json`. Cookie sesi HttpOnly/Secure/SameSite Strict berlaku 8 jam. API memeriksa device dan payload setiap command; browser tidak mempunyai credential MQTT. Data MQTT diambil browser setiap 750 ms, hanya topic device yang login.

## Development di Windows

Terminal pertama:

```powershell
$env:DASHBOARD_ORIGIN='http://127.0.0.1:5173'
$env:COOKIE_SECURE='false'
node server/start.mjs
```

Terminal kedua:

```powershell
npm.cmd run dev
```

`config.local.js` diperlukan oleh server dan harus tetap privat. `npm.cmd run build` tidak menyalin credential ke build publik. Preview/dev menolak URL file config tersebut. Daftar password lokal: `Dashboard - Topic dan Password.md`. Jangan menaruh file password di `dist/` atau source publik.

## Deployment

Build dari laptop. Gateway membutuhkan `server/`, `src/device-store.js`, `node_modules/`, `package.json`, dan config privat. Server memakai `/home/hint1/apps/ieee-dashboard/gateway`, dimount read-only oleh container `ieee-dashboard-auth`. Jalankan compose khusus `compose.auth.yaml` dengan project `ieee-dashboard-login`; container ini tidak membuka port host. Nginx dashboard meneruskan `/api/` lewat network `ieee-dashboard_default`.

Backup `dist`, Nginx, dan konfigurasi sebelum deploy. Konfigurasi Nginx adalah bind mount file: ubah isi file di tempat sebelum reload. Mengganti inode dengan rename atau editor atomic membutuhkan restart/recreate container dashboard agar mount membaca inode baru. Setelah recreate auth yang mengubah IP container, reload Nginx dashboard untuk resolve ulang alamat upstream. Restart gateway membatalkan sesi login; pengguna perlu login lagi.

`scripts/create-dashboard-accounts.mjs` membuat hash dan password acak untuk setiap perangkat pada instalasi baru. Jangan jalankan pada instalasi aktif: file akun awal dan daftar password akan ditimpa. Akun aktif yang tersimpan di `data/` tetap dikelola gateway. `npm.cmd test` menguji API dengan broker mock. Script diagnosis browser dan login produksi milik instalasi lokal tidak dipublikasikan ke repository.

## Batas pengamanan

Password sederhana dibuat sesuai permintaan pengguna dan mudah ditebak. Login mengamankan API dashboard. Credential shared MQTT lama dan ACL broker belum dirotasi/diperketat karena perlu koordinasi dengan firmware dan client lain. Pemilik credential broker lama masih dapat mencoba koneksi MQTT langsung. File config publik sekarang 404, tetapi salinan credential yang sudah terunduh tidak otomatis dicabut.

## Auto logout karena tidak aktif

Server membatalkan sesi setelah 30 menit tanpa aktivitas pengguna, dengan batas absolut 8 jam tetap berlaku. Endpoint session/messages dan data MQTT tidak memperpanjang idle deadline. Aktivitas mouse, keyboard, wheel/scroll dan touch yang trusted memanggil endpoint activity berproteksi CSRF, maksimal sekali per 15 detik. Command perangkat valid juga memperpanjang idle deadline. Frontend memeriksa kedaluwarsa meskipun berada dalam mode simulasi; visibility/pageshow memeriksa tanpa memperpanjang sesi. Aktivitas tab lain memakai sesi cookie yang sama sehingga deadline diperiksa ke server sebelum mengarahkan kembali ke login.

Test server menggunakan clock simulasi untuk 30 menit; fixture browser lokal memakai broker mock dan timeout singkat untuk membuktikan input keyboard memperpanjang sesi, auto logout dan cookie lama ditolak. Jangan menjalankan fixture tersebut di server produksi.


## Ganti password kelompok

Menu Akun > Ganti password memerlukan sesi aktif, Origin/CSRF, password lama dan konfirmasi password baru (6-128 karakter). Target selalu device dari sesi; request tidak boleh menentukan perangkat lain. Lima percobaan password lama per akun dalam lima menit. Setelah berhasil, semua sesi akun target dicabut dan anggota kelompok login kembali.

Hash aktif disimpan privat di `data/accounts.json` melalui file sementara dan rename, sebelum hash runtime diperbarui. Compose hanya memberi write access ke mount data ini; kode gateway tetap read-only. Saat pertama kali berjalan, store diinisialisasi dari `server/accounts.json` jika belum ada. Deployment berikutnya tidak boleh menimpa data/accounts.json dengan seed lama atau daftar password dari laptop.

Daftar password Markdown hanya mencatat password awal; setelah kelompok mengubahnya, daftar tersebut tidak lagi menunjukkan password aktif. Tidak tersedia reset tanpa password lama. Pemulihan lewat operator belum dibuat.

Saat menambahkan nested mount pertama kali, buat direktori kosong `gateway/data` sebelum compose up. File statis publik harus dapat dibaca Nginx (mode 644); direktori dan file akun privat memakai 700/600.
