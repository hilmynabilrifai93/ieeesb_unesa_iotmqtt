# Design — IEEE SB UNESA IoT Lab

Sistem visual ini berlaku untuk seluruh halaman dashboard. Fungsi dan data tetap menjadi pusat perhatian; dekorasi tidak boleh mengganggu pembacaan sensor atau kontrol.

## Genre

Technical editorial: tenang, langsung, dan mudah dibaca oleh peserta praktik.

## Struktur

- App pages: Workbench dengan sidebar tipis, area kerja lebar, data sensor sebagai satu papan ukur, dan panel kontrol yang mengikuti bentuk perangkatnya.
- Content pages: daftar dan panduan memakai garis pemisah serta ruang kosong, bukan tumpukan kartu dekoratif.

## Warna

- `--color-paper`: `#f4f5f1`
- `--color-paper-raised`: `#fbfcf9`
- `--color-paper-soft`: `#edf3f1`
- `--color-ink`: `#172522`
- `--color-ink-muted`: `#566963`
- `--color-rule`: `#d9e1de`
- `--color-accent`: `#087d77`
- `--color-accent-soft`: `#d9eeeb`
- `--color-focus`: `#b46a18`

Teal adalah penanda tindakan dan status aktif. Area besar tetap memakai warna kertas agar nyaman dibaca lama.

## Tipografi

- Display: Bahnschrift dengan fallback Arial Narrow, gaya normal.
- Body: Segoe UI dengan fallback Arial, gaya normal.
- Angka sensor: Consolas atau monospace sistem agar digit tidak bergeser.
- Judul memakai bobot 650; isi memakai 400–550.

## Spacing dan bentuk

- Skala 4 px: 4, 8, 12, 16, 24, 32, 48.
- Radius kecil 4–8 px; tidak memakai bentuk kapsul besar.
- Bayangan hanya untuk dialog atau toast. Panel utama memakai garis tipis.

## Gerak

- Transisi status 180–220 ms.
- Tidak ada animasi masuk, pantulan, atau efek cahaya.
- `prefers-reduced-motion` menonaktifkan transisi.

## Kontrol

- Tombol utama: teal solid, teks putih.
- Tombol sekunder: putih, garis abu-hijau.
- Fokus keyboard: outline jingga 3 px.
- Keadaan aktif selalu memakai teks selain warna.

## Batas

- Hindari gradient, glassmorphism, glow, dan bayangan pada kartu.
- Hindari kartu di dalam kartu bila garis atau jarak sudah cukup.
- Jangan menampilkan angka, klaim koneksi, atau status perangkat yang tidak berasal dari data nyata.


## Dark mode - revisi 2026-10-13

Permukaan menggunakan charcoal netral agar aksen teal menunjukkan tindakan dan status, tanpa membuat seluruh dashboard berwarna hijau. Canvas #151719, header/sidebar #1a1d20, panel #202427, permukaan kontrol #292e32. Teks utama #eef0f2, teks sekunder #adb5bb, garis #343b40. Teal #7abbb4 digunakan untuk state aktif, kontrol dan status MQTT; metadata sensor/tag memakai teks sekunder. Sensor tetap mempunyai warna semantik yang tenang. Pemilih mode dan navigasi HP pada dark mode memakai permukaan solid tanpa blur atau bayangan dekoratif; bentuk dan gesture yang diminta sebelumnya dipertahankan. Light mode mengikuti palet sebelumnya. Judul dashboard: Internet of Things, tanpa eyebrow yang mengulang konteks.

## Typography refinement - 2026-10-13

Design Read: existing technical editorial workbench for classroom sensor reading and device control. ENERGY 1 / RHYTHM 1 / MOTION 1; existing navigation gestures retained. Structure, grids, order and functionality stay as established. Green Bahnschrift title remains the identity; section/control headings use the system body face at 16px/600, labels 13px/500, supporting copy 12px/400 with 1.5 line-height, metadata 10px. Title scales 30?38px at 600 with -.025em tracking. Monospaced tabular sensor values keep changing digits stable. Secondary hardware labels and counts use neutral text without decorative badge fills. No font download, dependency, new asset or animation.
