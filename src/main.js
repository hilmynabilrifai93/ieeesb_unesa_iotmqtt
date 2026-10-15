import { syncThemeButton } from './theme.js?v=20261013-theme';
import { installGlassDrag } from './glass-drag.js?v=20261005-drag-v1';
import { createServoTargets } from './servo-targets.js?v=20261002-servo-hold';
import { createServoStream } from './servo-stream.js?v=20261003-live';
import { createServoSlider } from './servo-slider.js?v=20261002-smooth2';
import { icon } from './icons.js?v=20261013-profile';
import { inventory } from './inventory.js?v=20261015-relay4';
import {
  getDeviceConfiguration, publishDeviceCommand, startMqtt, stopMqtt,
} from './mqtt-client.js?v=20261003-live';
import {
  applyDeviceMessage, buildCommandTopic, canControlDevice, createCommandPayload, createDeviceStore,
  getDevicePresence, getSelectedDevice, selectDevice,
} from './device-store.js?v=20261015-relay4';
import { dashboardConfig } from './dashboard-config.js';
import {
  createModeController, getBrokerDisplayStatus, getInitialDashboardMode,
} from './mode-controller.js';
import {
  createLabState, tick, setOutput, addLed, renameLed, removeLed, setLed,
  setServo, setLcd, recordMqttMessage, resetControls, toggleSimulation,
} from './model.js?v=20261015-relay4';

const state = createLabState();
const servoSlider = createServoSlider();
const servoStream = createServoStream(({ angle, deviceId, final }) => {
  if (!isMqttMode() || currentPage !== 'dashboard'
    || deviceId !== deviceStore.selectedDeviceId) return false;
  return sendSelectedCommand('servo', angle, { quiet: !final, waitForCompletion: true });
});
const servoTargets = createServoTargets(globalThis.localStorage);
const deviceConfiguration = getDeviceConfiguration();
const deviceStore = createDeviceStore(
  deviceConfiguration.devices,
  deviceConfiguration.defaultDeviceId,
);
const pages = { dashboard: 'Dashboard', komponen: 'Komponen praktik', aktivitas: 'Catatan aktivitas', panduan: 'Panduan singkat' };
let currentPage = 'dashboard';
let dataMode = getInitialDashboardMode(
  globalThis.localStorage,
  dashboardConfig.defaultMode,
  dashboardConfig.modeStorageKey,
);
let brokerStatus = 'MQTT terputus';
let modeController;
let audioContext;
let oscillator;
let audioGain;
let soundEnabled = false;
let toastTimer;
let editingLedId = null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
const direction = (angle = state.servoAngle) => angle < 90 ? 'Ke kiri' : angle > 90 ? 'Ke kanan' : 'Tengah';
const isMqttMode = () => dataMode === 'mqtt';
const lastDeviceData = (device) => device.lastMessageAt
  ? `Data terakhir: ${new Date(device.lastMessageAt).toLocaleTimeString('id-ID', { hour12: false })}`
  : 'Data terakhir: belum diterima';
const visibleLogs = () => state.logs.filter((entry) => (isMqttMode()
  ? entry.type === 'MQTT'
  : entry.type !== 'MQTT'));

function navItem(id, symbol) {
  return `<a href="#${id}" class="nav-item" data-page="${id}" aria-label="${pages[id]}" title="${pages[id]}">${icon(symbol)}<span>${pages[id]}</span>${id === 'komponen' ? '<span class="nav-count">17</span>' : ''}</a>`;
}

function mobileNavItem(id, symbol, label) {
  return `<a href="#${id}" class="nav-item mobile-tab" data-page="${id}" aria-label="${pages[id]}" title="${pages[id]}">${icon(symbol)}<span>${label}</span></a>`;
}

const desktopSidebar = window.matchMedia('(min-width: 761px)');
function syncSidebarToggle() {
  const button = $('.menu-button');
  if (!button) return;
  const expanded = desktopSidebar.matches
    ? !document.body.classList.contains('sidebar-collapsed')
    : document.body.classList.contains('menu-open');
  const label = desktopSidebar.matches
    ? (expanded ? 'Kecilkan sidebar' : 'Buka sidebar')
    : (expanded ? 'Tutup navigasi' : 'Buka navigasi');
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon(expanded ? 'sidebarCollapse' : 'sidebarExpand');
  const mobileOpen = !desktopSidebar.matches && expanded;
  const logo = $('.mobile-header-brand');
  logo?.setAttribute('aria-expanded', String(mobileOpen));
  logo?.setAttribute('aria-label', mobileOpen ? 'Tutup panel perangkat dan akun' : 'Buka panel perangkat dan akun');
  $('#sidebar').inert = !desktopSidebar.matches && !mobileOpen;
  $('.workspace').inert = mobileOpen;
  $('.mobile-bottom-nav').inert = mobileOpen;
  if (mobileOpen) {
    $('#sidebar').setAttribute('role', 'dialog');
    $('#sidebar').setAttribute('aria-modal', 'true');
  } else {
    $('#sidebar').removeAttribute('role');
    $('#sidebar').removeAttribute('aria-modal');
  }
}

function closeMobileSidebar() {
  const wasOpen = document.body.classList.contains('menu-open');
  document.body.classList.remove('menu-open');
  syncSidebarToggle();
  if (wasOpen && !desktopSidebar.matches) $('.mobile-header-brand')?.focus();
}
desktopSidebar.addEventListener('change', () => {
  document.body.classList.remove('menu-open');
  syncSidebarToggle();
});

function shell() {
  $('#app').innerHTML = `
    <button type="button" class="mobile-scrim" data-action="close-menu" aria-label="Tutup panel perangkat dan akun" tabindex="-1"></button>
    <aside class="sidebar" id="sidebar" aria-label="Navigasi utama">
      <div class="mobile-sidebar-heading"><h2>Perangkat dan akun</h2><button type="button" class="icon-button" data-action="close-menu" aria-label="Tutup panel perangkat dan akun">${icon('close')}</button></div>
      <a class="brand" href="#dashboard" aria-label="Lab IoT IEEE SB UNESA"><img class="brand-logo" src="./assets/ieee-sb-unesa-logo.png" alt="" /><span class="brand-name">IEEE SB<span>UNESA</span></span></a>
      <div class="sidebar-label">RUANG PRAKTIK</div>
      <nav>${navItem('dashboard', 'grid')}${navItem('komponen', 'box')}${navItem('aktivitas', 'history')}</nav>
      <div class="sidebar-bottom">
        <div class="device-summary" aria-label="Status perangkat"><div class="device-heading">${icon('chip')}<span>Status perangkat</span></div><div class="connection-label" id="mqtt-status" data-state="disconnected" title="Status koneksi dashboard ke broker"><span class="status-dot neutral"></span><span id="mqtt-status-label">Mode simulasi</span></div><div class="connection-label device-connection" id="device-status" data-state="inactive" title="Status ESP32 yang dipilih"><span class="status-dot neutral"></span><span id="device-status-label">ESP32: Belum terhubung</span></div><p id="device-summary-note">ESP32 tidak digunakan dalam mode simulasi.</p></div>
        <details class="account-menu sidebar-account"><summary data-action="account" aria-label="Menu akun perangkat" title="Menu akun perangkat"><span class="account-avatar" aria-hidden="true">${icon('user')}</span><span class="account-identity"><span class="account-caption">Akun perangkat</span><span id="selected-device-name">ESP32 Praktik 1</span></span>${icon('chevron')}</summary><div class="account-menu-items"><button type="button" data-action="change-password">Ganti password</button><button type="button" data-action="logout">Keluar</button></div></details>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb"><button type="button" class="icon-button menu-button" data-action="menu" aria-label="Buka navigasi" aria-controls="sidebar" aria-expanded="false">${icon('sidebarExpand')}</button><button type="button" class="brand mobile-header-brand" data-action="menu" aria-controls="sidebar" aria-expanded="false" aria-label="IEEE SB UNESA — Dashboard"><img class="brand-logo" src="./assets/ieee-sb-unesa-logo.png" alt="" /><span class="brand-name">IEEE SB<span>UNESA</span></span></button><span id="page-label">Dashboard</span></div><div class="topbar-right"><div class="mode-control" role="group" aria-label="Mode operasi dashboard"><button type="button" data-mode-option="simulation" aria-pressed="false">Simulasi</button><button type="button" data-mode-option="mqtt" aria-pressed="false">MQTT</button></div></div></header>
      <main id="main" tabindex="-1"></main>
      <footer class="page-footer"><span>IEEE SB UNESA</span></footer>
    </div>
    <nav class="mobile-bottom-nav" aria-label="Navigasi utama ponsel">${mobileNavItem('dashboard', 'grid', 'Dashboard')}${mobileNavItem('komponen', 'box', 'Komponen')}${mobileNavItem('aktivitas', 'history', 'Aktivitas')}${mobileNavItem('panduan', 'book', 'Panduan')}</nav>
    <div class="toast" role="status" id="toast" hidden></div>
    <dialog id="lcd-dialog" aria-labelledby="lcd-dialog-title"><form id="lcd-form"><div class="dialog-heading"><h2 id="lcd-dialog-title">Ubah teks LCD</h2><button type="button" class="icon-button" data-action="close-lcd" aria-label="Tutup editor LCD">${icon('close')}</button></div><p>Dua baris, masing-masing maksimal 16 karakter.</p><label for="lcd-line1">Baris pertama</label><input id="lcd-line1" name="line1" maxlength="16" pattern="[ -~]*" title="Gunakan huruf, angka, atau tanda baca ASCII" autocomplete="off" required /><label for="lcd-line2">Baris kedua</label><input id="lcd-line2" name="line2" maxlength="16" pattern="[ -~]*" title="Gunakan huruf, angka, atau tanda baca ASCII" autocomplete="off" /><div class="dialog-actions"><button type="button" class="button secondary" data-action="close-lcd">Batal</button><button class="button primary" id="lcd-submit" type="submit">Tampilkan di LCD</button></div></form></dialog>
    <dialog id="led-dialog" aria-labelledby="led-dialog-title"><form id="led-form"><div class="dialog-heading"><h2 id="led-dialog-title">Tambah LED</h2><button type="button" class="icon-button" data-action="close-led" aria-label="Tutup pengaturan LED">${icon('close')}</button></div><p>Gunakan nama yang menjelaskan fungsi LED pada rangkaian.</p><label for="led-name">Nama LED</label><input id="led-name" name="name" maxlength="24" placeholder="Contoh: Lampu meja" autocomplete="off" required /><div class="dialog-actions"><button type="button" class="button secondary" data-action="close-led">Batal</button><button class="button primary" id="led-submit" type="submit">Tambah LED</button></div></form></dialog>`;
}

const sensorConfig = [
  { key: 'temperature', name: 'Suhu', unit: '°C', source: 'DHT11', icon: 'thermometer', caption: 'Suhu ruang', color: 'orange' },
  { key: 'humidity', name: 'Kelembapan', unit: '%', source: 'DHT11', icon: 'droplet', caption: 'Kelembapan udara', color: 'blue' },
  { key: 'distance', name: 'Jarak', unit: 'cm', source: 'ULTRASONIK', icon: 'ruler', caption: 'Jarak ke objek', color: 'green' },
  { key: 'water', name: 'Level air', unit: '%', source: 'WATER SENSOR', icon: 'water', caption: 'Level relatif', color: 'teal' },
];

function sensorCard(sensor) {
  return `<article class="sensor-card ${sensor.color}" aria-label="${sensor.name}"><div class="sensor-heading"><span class="sensor-name">${icon(sensor.icon)}${sensor.name}</span><span class="sensor-source">${sensor.source}</span></div><div class="sensor-reading"><span data-value="${sensor.key}"></span><span class="sensor-unit">${sensor.unit}</span></div><div class="sensor-footer"><span>${sensor.caption}</span><svg class="sparkline" data-chart="${sensor.key}" viewBox="0 0 100 30" aria-hidden="true"></svg></div>${sensor.key === 'water' ? '<div class="water-track" aria-hidden="true"><span id="water-fill"></span></div>' : ''}</article>`;
}

function switchButton(name, label) {
  return `<button type="button" class="switch" role="switch" data-output="${name}" aria-checked="false" aria-label="${label}"><span></span></button>`;
}

function ledSwitch(led) {
  return `<button type="button" class="switch" role="switch" data-led-toggle="${led.id}" aria-checked="${led.on}" aria-label="${escape(led.name)}"><span></span></button>`;
}

function ledDrawing() {
  return `<svg class="led-drawing" viewBox="38 0 104 126" aria-hidden="true"><path class="led-ray" d="M90 4v10M48 23l8 8m76-8-8 8M40 66h10m80 0h10"/><path class="led-wire" d="M81 87v31m18-31v24"/><path class="led-glass" d="M66 78V48a24 24 0 0 1 48 0v30Z"/><path class="led-shine" d="M76 48a14 14 0 0 1 8-13"/><rect class="led-base" x="61" y="78" width="58" height="10" rx="3"/><path class="led-inner" d="M81 76V60h10v16m8 0V51"/></svg>`;
}

function ledListMarkup() {
  const selectedDevice = getSelectedDevice(deviceStore);
  return state.leds.map((led) => {
    const on = isMqttMode()
      ? Boolean(selectedDevice?.actuators.leds[`led${led.channel}`])
      : led.on;
    const displayedLed = { ...led, on };
    return `<div class="led-row" data-led-row="${led.id}"><span class="led-visual ${on ? 'is-on' : ''}" data-led-visual="${led.id}" aria-hidden="true">${ledDrawing()}</span><div class="led-row-copy"><strong>${escape(led.name)}</strong><span><span data-led-status="${led.id}">${on ? 'Menyala' : 'Mati'}</span> · LED ${led.channel}</span></div><div class="led-row-actions"><button type="button" class="led-row-action" data-action="edit-led" data-led-id="${led.id}" aria-label="Ubah nama ${escape(led.name)}">Ubah nama</button>${state.leds.length > 1 ? `<button type="button" class="led-row-action remove" data-action="remove-led" data-led-id="${led.id}" aria-label="Hapus ${escape(led.name)}">Hapus</button>` : ''}</div>${ledSwitch(displayedLed)}</div>`;
  }).join('');
}

function renderLedList() {
  const list = $('#led-list');
  if (list) list.innerHTML = ledListMarkup();
}

function servoDrawing() {
  let marks = '';
  for (let i = 0; i <= 12; i++) {
    const angle = Math.PI + (i / 12) * Math.PI;
    const inner = i % 3 === 0 ? 86 : 92;
    marks += `<line x1="${140 + Math.cos(angle) * inner}" y1="${115 + Math.sin(angle) * inner}" x2="${140 + Math.cos(angle) * 100}" y2="${115 + Math.sin(angle) * 100}" />`;
  }
  return `<svg class="servo-gauge" viewBox="0 0 280 142" role="img" aria-label="Indikator target sudut servo"><path class="gauge-arc" d="M40 115a100 100 0 0 1 200 0"/><path class="gauge-guide" d="M57 115a83 83 0 0 1 166 0"/><g class="gauge-ticks">${marks}</g><text x="26" y="134">1°</text><text x="131" y="10">90°</text><text x="241" y="134">180°</text><path class="gauge-baseline" d="M50 115h180"/><g id="servo-needle" class="servo-needle"><path d="m135 115 3-71a2 2 0 0 1 4 0l3 71Z"/><circle cx="140" cy="115" r="13"/><circle class="needle-cap" cx="140" cy="115" r="5"/></g></svg>`;
}

function deviceOptions() {
  return deviceStore.devices.map((device) => `<option value="${escape(device.id)}" ${device.id === deviceStore.selectedDeviceId ? 'selected' : ''}>${escape(device.name)}</option>`).join('');
}

function dashboard() {
  return `<section class="page-intro"><div><h1 id="dashboard-title">Internet of Things</h1></div><div class="intro-actions"><button class="button secondary" data-action="reset" id="reset-button">${icon('reset')}Reset kontrol</button><button class="button primary" data-action="simulation" id="simulation-button"></button></div></section>
    <div class="device-toolbar" aria-label="Perangkat aktif"><label for="device-selector">Perangkat<select id="device-selector">${deviceOptions()}</select></label><span class="device-presence" id="device-presence"><span class="status-dot neutral"></span><span id="device-presence-label">Tidak aktif</span></span><details class="mobile-connection-details"><summary>Status koneksi</summary><div><p id="mobile-broker-status"></p><p id="mobile-device-status"></p><p id="mobile-last-data"></p><p id="mobile-device-note"></p></div></details></div>
    <div class="section-heading"><h2>Pembacaan sensor <span class="section-count">04</span></h2><div class="update-status"><span class="status-dot" id="update-dot"></span><span id="update-label">Diperbarui setiap 2 detik</span></div></div>
    <section class="sensor-grid" aria-label="Data sensor simulasi">${sensorConfig.map(sensorCard).join('')}</section>
    <div class="section-heading control-section-heading"><h2>Kontrol perangkat</h2><span class="section-note" id="control-count-note"><span id="active-count">0</span> dari <span id="switch-count">4</span> sakelar aktif</span><span class="section-note control-lock-note" id="control-lock-note" hidden>Kontrol nonaktif sampai ESP32 Online</span></div>
    <section class="control-grid" aria-label="Kontrol output simulasi">
      <article class="panel led-panel"><div class="panel-heading"><div><h3>Kontrol LED</h3><p>Nama dan sakelar untuk setiap LED</p></div><button type="button" class="text-button" data-action="add-led">${icon('led')}Tambah LED</button></div><div class="led-summary"><span><strong id="led-active-count">0</strong> menyala</span><span><strong id="led-total-count">1</strong> LED terdaftar</span></div><div class="led-list" id="led-list"></div><div class="panel-footnote" id="led-footnote">${icon('info')}Maksimal 8 LED dalam simulasi.</div></article>
      <article class="panel relay-panel"><div class="panel-heading"><div><h3>Relay 4 channel</h3><p>Empat sakelar, kontrol terpisah</p></div>${icon('relay', 'muted-icon')}</div><div class="relay-channels">${[1, 2, 3, 4].map((n) => `<div class="relay-channel"><div class="relay-top"><span class="relay-number">R${n}</span><div class="relay-name"><h4>Channel ${n}</h4><span data-state="relay${n}">Mati</span></div>${switchButton(`relay${n}`, `Relay channel ${n}`)}</div><div class="relay-circuit" data-circuit="relay${n}"><span class="circuit-node"></span><span class="circuit-line"></span><svg viewBox="0 0 60 22" aria-hidden="true"><circle cx="8" cy="15" r="2"/><path class="contact" d="M10 15 48 3"/><circle cx="51" cy="15" r="2"/></svg><span class="circuit-line"></span><span class="circuit-node"></span><span class="relay-code" data-onoff="relay${n}">OFF</span></div></div>`).join('')}</div><div class="panel-footnote" id="relay-footnote" hidden></div></article>
      <article class="panel servo-panel"><div class="panel-heading"><div><h3>Posisi servo</h3><p>Geser ke sudut 1–180°, langkah 1°</p></div><span class="component-tag">SG90</span></div><div class="servo-stage">${servoDrawing()}<div class="servo-readout"><span id="servo-value">90</span><span>°</span><small id="servo-direction">Tengah</small></div></div><label class="sr-only" for="servo-range">Target sudut servo, derajat</label><input class="range" id="servo-range" type="range" min="1" max="180" step="1" value="90" /><div class="servo-presets"><button data-angle="1">${icon('arrow', 'arrow-left')}Kiri <span>1°</span></button><button data-angle="90" class="selected">Tengah <span>90°</span></button><button data-angle="180">Kanan <span>180°</span>${icon('arrow')}</button></div></article>
    </section>
    <div class="section-heading additional-heading"><h2>Perangkat lainnya</h2></div>
    <section class="additional-grid" aria-label="Perangkat tambahan"><article class="panel lcd-panel"><div class="panel-heading"><div><h3>${icon('display')}LCD 16 × 2</h3><p id="lcd-panel-description">Pratinjau layar I²C</p></div><button type="button" class="text-button" id="lcd-edit-button" data-action="edit-lcd">Ubah teks ${icon('arrow')}</button></div><div class="lcd-housing"><span class="lcd-screw screw-one"></span><span class="lcd-screw screw-two"></span><div class="lcd-screen" role="img" aria-label="Pratinjau dua baris LCD"><div id="lcd-preview1"></div><div id="lcd-preview2"></div></div><span class="lcd-screw screw-three"></span><span class="lcd-screw screw-four"></span></div></article>
    <article class="panel input-panel"><div class="compact-control"><span class="mini-icon">${icon('volume')}</span><div class="compact-label"><h3>Buzzer</h3><p data-state="buzzer">Mati</p></div>${switchButton('buzzer', 'Buzzer')}</div></article></section>
    <div class="simulation-note">${icon('info')}<span id="data-mode-note">Semua data dan kontrol di halaman ini adalah simulasi. ESP32 belum terhubung.</span><a href="#panduan">Tentang praktik ini ${icon('arrow')}</a></div>`;
}

function componentsPage() {
  return `<section class="page-intro"><div><div class="eyebrow"><span></span>PERSIAPAN PRAKTIK</div><h1>Kenali komponennya<span class="heading-period">.</span></h1><p>17 bahan untuk merakit dan mencoba rangkaian ESP32.</p></div><span class="large-count">17<span>BAHAN PRAKTIK</span></span></section><div class="inventory-toolbar"><div class="filter-group" aria-label="Filter komponen">${['Semua', 'Kontrol', 'Sensor', 'Output', 'Pendukung'].map((label) => `<button class="filter-button ${label === 'Semua' ? 'selected' : ''}" data-filter="${label}" aria-pressed="${label === 'Semua'}">${label}</button>`).join('')}</div><span class="section-note" id="inventory-count">17 komponen</span></div><section class="inventory-list" aria-label="Daftar bahan praktik">${inventory.map((item, i) => `<article class="inventory-row" data-category="${item.category}"><span class="inventory-number">${String(i + 1).padStart(2, '0')}</span><span class="inventory-icon">${icon(item.icon)}</span><div class="inventory-description"><h2>${escape(item.name)}</h2><p>${escape(item.description)}</p></div><span class="category-tag">${item.category}</span></article>`).join('')}</section><div class="simulation-note">${icon('box')}<span>Kabel, breadboard, dan alat bantu tercantum sebagai bahan praktik. Komponen tersebut tidak memiliki kontrol di dashboard.</span></div>`;
}

function activityPage() {
  const source = isMqttMode() ? 'MQTT' : 'simulasi lokal';
  return `<section class="page-intro"><div><div class="eyebrow"><span></span>SESI PRAKTIK</div><h1>Catatan aktivitas<span class="heading-period">.</span></h1><p>Lihat kembali perubahan kontrol selama mencoba rangkaian.</p></div><button class="button secondary" data-action="export">${icon('download')}Unduh catatan</button></section><div class="activity-info">${icon('history')}<span>Menampilkan aktivitas ${source}. Catatan dimulai ulang ketika halaman dimuat ulang.</span></div><section class="activity-panel" aria-label="Riwayat kontrol"><div class="activity-table-heading"><span>WAKTU</span><span>AKTIVITAS</span></div><div id="activity-list"></div></section>`;
}

function guidePage() {
  return `<section class="page-intro"><div><div class="eyebrow"><span></span>MULAI DARI SINI</div><h1>Langkah praktik</h1><p>Pilih Simulasi atau MQTT, lalu amati respons perangkat.</p></div><span class="guide-illustration">${icon('chip')}</span></section><div class="guide-grid"><section class="guide-main"><h2>Coba dalam 3 langkah</h2>${[
    ['Pilih mode operasi', 'Gunakan pemilih di bagian atas. Simulasi memakai data browser; MQTT menunggu data dari ESP32 yang dipilih.'],
    ['Ubah satu kontrol', 'Nyalakan LED atau salah satu relay. Geser sudut servo dan amati jarumnya. Tombol kiri, tengah, dan kanan membantu mencoba tiga posisi.'],
    ['Periksa hasilnya', 'Buka catatan aktivitas untuk melihat perubahan. Coba teks LCD dan buzzer di bagian bawah dashboard.'],
  ].map(([title, text], i) => `<article class="guide-step"><span>${String(i + 1).padStart(2, '0')}</span><div><h3>${title}</h3><p>${text}</p></div></article>`).join('')}<a class="button primary" href="#dashboard">Mulai mencoba ${icon('arrow')}</a></section><aside class="guide-aside"><h2>Tentang dua mode</h2><p>Mode Simulasi dan MQTT berjalan terpisah. MQTT hanya aktif saat mode tersebut dipilih.</p><dl><dt>Level air</dt><dd>Persentase relatif untuk contoh tampilan. Pembacaan sensor fisik perlu dikalibrasi sebelum dikonversi menjadi level air.</dd><dt>Arah servo</dt><dd>1° di kiri, 90° di tengah, dan 180° di kanan pada ilustrasi. Arah fisik mengikuti pemasangan lengan servo.</dd><dt>LCD & buzzer</dt><dd>LCD memakai dua baris berisi maksimal 16 karakter ASCII. Suara buzzer dapat dicoba dengan mengaktifkan pilihan suara browser.</dd><dt>Status</dt><dd>Status broker menunjukkan koneksi dashboard. Status perangkat menunjukkan ESP32 online, offline, belum terhubung, atau tidak aktif.</dd></dl></aside></div>`;
}

function renderPage() {
  servoStream.cancel();
  servoSlider.clear();
  const route = location.hash.slice(1);
  currentPage = Object.hasOwn(pages, route) ? route : 'dashboard';
  document.body.classList.remove('menu-open');
  syncSidebarToggle();
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.page === currentPage;
    item.classList.toggle('active', active);
    active ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current');
  });
  $('#page-label').textContent = pages[currentPage];
  $('.mobile-bottom-nav').style.setProperty('--active-index', Object.keys(pages).indexOf(currentPage));
  document.title = 'IEEE SB UNESA';
  $('#main').innerHTML = ({ dashboard, komponen: componentsPage, aktivitas: activityPage, panduan: guidePage })[currentPage]();
  if (currentPage === 'dashboard') renderLedList();
  syncUI();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function sparkline(values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const min = Math.min(...values) - 0.5;
  const span = Math.max(2, Math.max(...values) - min + 0.5);
  const points = values.map((value, i) => `${(i * 100 / (values.length - 1)).toFixed(1)},${(27 - (value - min) / span * 23).toFixed(1)}`);
  return `<path class="spark-area" d="M0 30L${points.join('L')}L100 30Z"/><polyline points="${points.join(' ')}"/>`;
}

function renderLcdLine(row, text) {
  const characters = text.slice(0, 16).padEnd(16, ' ');
  row.replaceChildren(...Array.from(characters, (character) => {
    const cell = document.createElement('span');
    cell.className = 'lcd-cell';
    cell.textContent = character;
    return cell;
  }));
}

function renderServoAngle(servoAngle, updateRange = true) {
    $('#servo-value').textContent = servoAngle;
    $('#servo-direction').textContent = direction(servoAngle);
    $('#servo-needle').setAttribute('transform', `rotate(${servoAngle - 90}, 140, 115)`);
    if (updateRange) $('#servo-range').value = servoAngle;
    $('#servo-range').style.setProperty('--range-progress', `${Math.max(0, (servoAngle - 1) / 179) * 100}%`);
    $('#servo-range').setAttribute('aria-valuetext', `${servoAngle} derajat, ${direction(servoAngle).toLowerCase()}`);
    $$('[data-angle]').forEach((button) => {
      const selected = Number(button.dataset.angle) === servoAngle;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected);
    });
}

let servoRenderFrame = null;
function scheduleServoRender() {
  if (servoRenderFrame !== null) return;
  servoRenderFrame = requestAnimationFrame(() => {
    servoRenderFrame = null;
    if (currentPage !== 'dashboard') return;
    const device = getSelectedDevice(deviceStore);
    renderServoAngle(servoSlider.angle(device.actuators.servo, device.id), false);
  });
}

function syncUI() {
  const selectedDevice = getSelectedDevice(deviceStore);
  $('#selected-device-name').firstChild.textContent = selectedDevice.name;
  $('.sidebar-account summary').setAttribute('aria-label', `Menu akun ${selectedDevice.name}`);
  $('.sidebar-account summary').title = `Menu akun ${selectedDevice.name}`;
  $$('[data-mode-option]').forEach((button) => {
    const active = button.dataset.modeOption === dataMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  renderConnectionStatus();
  renderDeviceConnectionSummary(selectedDevice);
  if (!$('.mode-control').classList.contains('is-dragging')) {
    $('.mode-control').style.setProperty('--mode-index', isMqttMode() ? 1 : 0);
  }

  if (currentPage === 'dashboard') {
    const mqttMode = isMqttMode();
    $('#mobile-broker-status').textContent = $('#mqtt-status-label').textContent;
    $('#mobile-device-status').textContent = $('#device-status-label').textContent;
    $('#mobile-device-note').textContent = $('#device-summary-note').textContent;
    $('#mobile-last-data').textContent = lastDeviceData(selectedDevice);
    $('#mobile-last-data').hidden = !mqttMode;
    const telemetry = selectedDevice.telemetry;
    const displayedSensors = mqttMode
      ? {
        temperature: telemetry.temperature,
        humidity: telemetry.humidity,
        distance: telemetry.distance,
        water: telemetry.waterLevel,
      }
      : state.sensors;
    const displayedHistories = mqttMode
      ? {
        temperature: selectedDevice.histories.temperature,
        humidity: selectedDevice.histories.humidity,
        distance: selectedDevice.histories.distance,
        water: selectedDevice.histories.waterLevel,
      }
      : state.histories;
    const displayedOutputs = mqttMode
      ? {
        relay1: selectedDevice.actuators.relay1,
        relay2: selectedDevice.actuators.relay2,
        relay3: selectedDevice.actuators.relay3,
        relay4: selectedDevice.actuators.relay4,
        buzzer: selectedDevice.actuators.buzzer,
      }
      : state.outputs;
    const displayedLeds = state.leds.map((led) => ({
      ...led,
      on: mqttMode
        ? Boolean(selectedDevice.actuators.leds[`led${led.channel}`])
        : led.on,
    }));
    const servoAngle = servoSlider.angle(
      mqttMode ? servoTargets.get(selectedDevice.id, selectedDevice.actuators.servo) : state.servoAngle,
      selectedDevice.id,
    );
    const lcdLines = mqttMode
      ? [selectedDevice.actuators.lcd.line1, selectedDevice.actuators.lcd.line2]
      : state.lcdLines;

    $('#device-selector').value = deviceStore.selectedDeviceId;
    const presence = mqttMode
      ? getDevicePresence(selectedDevice, Date.now(), dashboardConfig.deviceStaleAfterMs)
      : 'simulation';
    const mqttControlsLocked = mqttMode && !canControlDevice(selectedDevice, {
      brokerConnected: brokerStatus === 'MQTT terhubung',
      staleAfterMs: dashboardConfig.deviceStaleAfterMs,
    });
    const presenceLabels = {
      online: 'ESP32 online', offline: 'ESP32 offline', stale: 'ESP32 tidak merespons', inactive: 'ESP32 belum terhubung', simulation: 'Data simulasi',
    };
    const presenceUnverified = mqttMode && brokerStatus !== 'MQTT terhubung';
    $('#device-presence-label').textContent = presenceUnverified
      ? 'Status ESP32 belum dapat diperiksa' : presenceLabels[presence];
    $('#device-presence').dataset.state = presenceUnverified ? 'inactive' : presence;
    $('#device-presence').querySelector('.status-dot').classList.toggle('neutral', presenceUnverified || presence !== 'online');
    $('.sensor-grid').setAttribute('aria-label', mqttMode ? 'Data sensor ESP32 melalui MQTT' : 'Data sensor simulasi');
    $('.control-grid').setAttribute('aria-label', mqttMode ? 'Kontrol output ESP32 melalui MQTT' : 'Kontrol output simulasi');
    let sourceLabel = $('#sensor-data-source');
    if (!sourceLabel) {
      sourceLabel = document.createElement('span');
      sourceLabel.id = 'sensor-data-source';
      sourceLabel.className = 'data-source-label';
      $('.sensor-grid').previousElementSibling.querySelector('h2').append(sourceLabel);
    }
    sourceLabel.textContent = mqttMode ? 'MQTT' : 'Data simulasi';
    sourceLabel.dataset.mode = dataMode;
    const lockReason = brokerStatus !== 'MQTT terhubung'
      ? 'Kontrol nonaktif. Hubungkan dashboard ke broker MQTT.'
      : presence === 'offline'
        ? 'Kontrol nonaktif. ESP32 offline; periksa daya dan Wi-Fi.'
        : presence === 'stale'
          ? 'Kontrol nonaktif. Menunggu ESP32 kembali mengirim data.'
          : 'Kontrol nonaktif. Menunggu ESP32 online.';
    $$('.control-grid .panel, .additional-grid .panel').forEach((panel, index) => {
      let status = panel.querySelector('.control-status');
      if (!status) {
        status = document.createElement('p');
        status.id = `control-status-${index}`;
        status.className = 'control-status';
        panel.append(status);
      }
      panel.classList.toggle('controls-locked', mqttControlsLocked);
      status.textContent = lockReason;
      status.hidden = !mqttControlsLocked;
      panel.querySelectorAll('.switch, .range, [data-angle], #lcd-edit-button').forEach((control) => {
        if (mqttControlsLocked) control.setAttribute('aria-describedby', status.id);
        else control.removeAttribute('aria-describedby');
      });
    });
    $('#data-mode-note').textContent = mqttMode
      ? `Sensor dan state semua aktuator berasal dari ${selectedDevice.name}. Perintah dikirim melalui MQTT dan tampilan menunggu state dari ESP32.`
      : 'Semua data dan kontrol di halaman ini adalah simulasi. ESP32 belum terhubung.';
    $('#lcd-panel-description').textContent = mqttMode ? 'Teks aktual dari ESP32' : 'Pratinjau layar I²C';
    $('#led-footnote').innerHTML = mqttMode
      ? mqttControlsLocked
        ? `${icon('info')}Kontrol nonaktif. ESP32 harus Online untuk menerima perintah.`
        : `${icon('info')}Perintah dikirim ke ${escape(selectedDevice.id)}; state diperbarui oleh ESP32.`
      : `${icon('info')}Maksimal 8 LED dalam simulasi.`;
    $('#relay-footnote').innerHTML = mqttMode
      ? mqttControlsLocked
        ? `${icon('info')}Kontrol nonaktif. ESP32 harus Online untuk menerima perintah.`
        : `${icon('info')}Perintah hanya dikirim ke ${escape(selectedDevice.id)}.`
      : '';
    $('#led-footnote').hidden = mqttControlsLocked;
    $('#relay-footnote').hidden = mqttControlsLocked || !mqttMode;

    for (const sensor of sensorConfig) {
      const value = displayedSensors[sensor.key];
      $(`[data-value="${sensor.key}"]`).textContent = value === null
        ? '—'
        : ['temperature', 'distance'].includes(sensor.key) ? value.toFixed(1) : Math.round(value);
      $(`[data-chart="${sensor.key}"]`).innerHTML = sparkline(displayedHistories[sensor.key]);
    }
    $('#water-fill').style.width = `${displayedSensors.water ?? 0}%`;
    $('#update-label').textContent = mqttMode
      ? selectedDevice.lastTelemetryAt
        ? `Telemetri terakhir: ${new Date(selectedDevice.lastTelemetryAt).toLocaleTimeString('id-ID', { hour12: false })}`
        : 'Menunggu telemetri'
      : state.simulationRunning ? 'Simulasi · setiap 2 detik' : `Simulasi dijeda · ${state.lastSample}`;
    $('#update-dot').classList.toggle('neutral', mqttMode
      ? selectedDevice.status !== 'online' || !selectedDevice.lastTelemetryAt
      : !state.simulationRunning);
    $('#simulation-button').innerHTML = `${icon(state.simulationRunning ? 'pause' : 'play')}${state.simulationRunning ? 'Jeda simulasi' : 'Lanjutkan simulasi'}`;
    $('#simulation-button').setAttribute('aria-label', state.simulationRunning ? 'Jeda simulasi sensor' : 'Lanjutkan simulasi sensor');
    $('#simulation-button').hidden = mqttMode;
    $('#simulation-button').disabled = mqttMode;
    $('#simulation-button').title = '';
    $('#reset-button').disabled = mqttMode;
    $('#reset-button').title = mqttMode ? 'Reset hanya tersedia pada mode simulasi' : '';
    for (const [name, on] of Object.entries(displayedOutputs)) {
      const outputButton = $(`[data-output="${name}"]`);
      outputButton.setAttribute('aria-checked', on);
      outputButton.disabled = mqttControlsLocked && ['relay1', 'relay2', 'relay3', 'relay4', 'buzzer'].includes(name);
      outputButton.title = outputButton.disabled ? 'ESP32 harus Online untuk menerima perintah' : '';
      $$(`[data-state="${name}"]`).forEach((item) => { item.textContent = on ? 'Menyala' : 'Mati'; });
      $$(`[data-onoff="${name}"]`).forEach((item) => { item.textContent = on ? 'ON' : 'OFF'; });
      $(`[data-dot="${name}"]`)?.classList.toggle('neutral', !on);
      $(`[data-circuit="${name}"]`)?.classList.toggle('connected', on);
    }
    for (const led of displayedLeds) {
      const ledButton = $(`[data-led-toggle="${led.id}"]`);
      ledButton?.setAttribute('aria-checked', led.on);
      if (ledButton) {
        ledButton.disabled = mqttControlsLocked;
        ledButton.title = mqttControlsLocked ? 'ESP32 harus Online untuk menerima perintah' : '';
      }
      const status = $(`[data-led-status="${led.id}"]`);
      if (status) status.textContent = led.on ? 'Menyala' : 'Mati';
      $(`[data-led-visual="${led.id}"]`)?.classList.toggle('is-on', led.on);
    }
    const activeLeds = displayedLeds.filter((led) => led.on).length;
    const countedOutputs = Object.values(displayedOutputs);
    $('#active-count').textContent = countedOutputs.filter(Boolean).length + activeLeds;
    $('#switch-count').textContent = countedOutputs.length + state.leds.length;
    $('#control-count-note').hidden = mqttControlsLocked;
    $('#control-lock-note').hidden = !mqttControlsLocked;
    $('#control-lock-note').textContent = 'Kontrol nonaktif';
    $('#led-active-count').textContent = activeLeds;
    $('#led-total-count').textContent = state.leds.length;
    const addButton = $('[data-action="add-led"]');
    addButton.disabled = state.leds.length >= state.maxLeds;
    addButton.title = addButton.disabled ? `Batas ${state.maxLeds} LED tercapai` : '';
    renderServoAngle(servoAngle);
    $('#servo-range').disabled = mqttControlsLocked;
    $('#servo-range').title = mqttControlsLocked ? 'ESP32 harus Online untuk menerima perintah'
      : mqttMode && servoAngle !== selectedDevice.actuators.servo
        ? `Target ${servoAngle} derajat; feedback ESP32 ${selectedDevice.actuators.servo} derajat` : '';
    $$('[data-angle]').forEach((button) => {
      const selected = Number(button.dataset.angle) === servoAngle;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected);
      button.disabled = mqttControlsLocked;
      button.title = mqttControlsLocked ? 'ESP32 harus Online untuk menerima perintah' : '';
    });
    const lcdEditButton = $('#lcd-edit-button');
    lcdEditButton.disabled = mqttControlsLocked;
    lcdEditButton.title = mqttControlsLocked ? 'ESP32 harus Online untuk menerima perintah' : '';
    const lcdSubmitButton = $('#lcd-submit');
    lcdSubmitButton.disabled = mqttControlsLocked;
    lcdSubmitButton.title = mqttControlsLocked ? 'ESP32 harus Online untuk menerima perintah' : '';
    lcdLines.forEach((line, i) => renderLcdLine($(`#lcd-preview${i + 1}`), line));
    $('.lcd-screen').setAttribute('aria-label', `LCD: ${lcdLines.join('. ')}`);
  }
  if (currentPage === 'aktivitas') {
    $('#activity-list').innerHTML = visibleLogs().map((entry) => `<div class="activity-row"><time>${escape(entry.time)}</time><span class="log-dot"></span><p>${escape(entry.message)}</p><span class="log-type">${escape(entry.type || 'Simulasi')}</span></div>`).join('');
  }
}

function setMqttStatus(status) {
  brokerStatus = status;
  if (status !== 'MQTT terhubung') servoStream.cancel();
  renderConnectionStatus();
  renderDeviceConnectionSummary(getSelectedDevice(deviceStore));
  if (currentPage === 'dashboard') syncUI();
}

function renderConnectionStatus() {
  const container = $('#mqtt-status');
  const label = $('#mqtt-status-label');
  if (!container || !label) return;
  const baseStatus = getBrokerDisplayStatus(dataMode, brokerStatus);
  const brokerLabels = {
    'MQTT terhubung': 'Broker MQTT: Terhubung',
    'MQTT terputus': 'Broker MQTT: Terputus',
    Menghubungkan: 'Broker MQTT: Menghubungkan',
    'Menghubungkan ulang': 'Broker MQTT: Menghubungkan ulang',
    'Autentikasi gagal': 'Broker MQTT: Autentikasi gagal',
    'Gagal terhubung': 'Broker MQTT: Gagal terhubung',
  };
  const visibleStatus = isMqttMode() ? (brokerLabels[baseStatus] || baseStatus) : baseStatus;
  const connected = isMqttMode() && brokerStatus === 'MQTT terhubung';
  const failed = isMqttMode() && ['Autentikasi gagal', 'Gagal terhubung'].includes(brokerStatus);
  container.dataset.state = connected ? 'connected' : failed ? 'error' : 'disconnected';
  container.title = isMqttMode() ? `Status broker: ${brokerStatus}` : 'MQTT tidak digunakan pada Mode Simulasi';
  label.textContent = visibleStatus;
  container.querySelector('.status-dot')?.classList.toggle('neutral', !connected);
}

function renderDeviceConnectionSummary(device) {
  const container = $('#device-status');
  const label = $('#device-status-label');
  const note = $('#device-summary-note');
  if (!container || !label || !note) return;

  let presence = 'inactive';
  let visibleLabel = 'ESP32: Belum terhubung';
  let explanation = 'Belum ada status atau data yang diterima dari ESP32 ini.';

  if (!isMqttMode()) {
    visibleLabel = 'ESP32: Tidak digunakan';
    explanation = 'Mode simulasi berjalan tanpa koneksi ke ESP32.';
  } else if (brokerStatus !== 'MQTT terhubung') {
    visibleLabel = 'ESP32: Belum dapat diperiksa';
    explanation = 'Dashboard harus terhubung ke broker sebelum status ESP32 dapat diperiksa.';
  } else {
    presence = getDevicePresence(device, Date.now(), dashboardConfig.deviceStaleAfterMs);
    const summaries = {
      online: ['ESP32: Online', `Terhubung sebagai ${device.id} dan siap bertukar data.`],
      offline: ['ESP32: Offline', 'ESP32 melaporkan status offline ke broker MQTT.'],
      stale: ['ESP32: Tidak merespons', `Tidak ada telemetri atau status baru selama lebih dari ${dashboardConfig.deviceStaleAfterMs / 1000} detik. Periksa daya, Wi-Fi, dan koneksi MQTT perangkat.`],
      inactive: ['ESP32: Belum terhubung', `Broker aktif, tetapi belum ada data dari ${device.id}.`],
    };
    [visibleLabel, explanation] = summaries[presence];
  }

  container.dataset.state = presence;
  container.title = visibleLabel;
  label.textContent = visibleLabel;
  note.textContent = explanation;
  let lastData = $('#device-last-data');
  if (!lastData) {
    lastData = document.createElement('p');
    lastData.id = 'device-last-data';
    note.after(lastData);
  }
  lastData.textContent = lastDeviceData(device);
  lastData.hidden = !isMqttMode();
  container.querySelector('.status-dot')?.classList.toggle('neutral', presence !== 'online');
}

function sendSelectedCommand(target, value, { quiet = false, waitForCompletion = false } = {}) {
  const device = getSelectedDevice(deviceStore);
  if (!canControlDevice(device, {
    brokerConnected: brokerStatus === 'MQTT terhubung',
    staleAfterMs: dashboardConfig.deviceStaleAfterMs,
  })) {
    toast('Kontrol nonaktif. ESP32 harus Online untuk menerima perintah.');
    return false;
  }
  const topic = buildCommandTopic(device.id);
  let command = createCommandPayload(target, value);
  if (command && /^led([1-8])?$/.test(target)) command = servoTargets.ledCommand(device.id, command);
  const delivery = topic && command && publishDeviceCommand(device.id, command, { waitForCompletion });
  if (!delivery) {
    toast('Perintah belum dikirim. Pastikan MQTT terhubung.');
    return false;
  }
  if (target === 'servo') servoTargets.remember(device.id, value);
  recordMqttMessage(state, topic, JSON.stringify(command));
  if (!quiet) toast(`Perintah dikirim ke ${device.name}.`);
  return delivery;
}

function announce(message) {
  $('#announcement').textContent = message;
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}

async function syncSound() {
  if (oscillator) {
    const oldOscillator = oscillator;
    const oldGain = audioGain;
    oscillator = null;
    audioGain = null;
    oldGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
    oldOscillator.stop(audioContext.currentTime + 0.05);
    oldOscillator.onended = () => { oldOscillator.disconnect(); oldGain.disconnect(); };
  }
  const buzzerOn = isMqttMode()
    ? Boolean(getSelectedDevice(deviceStore)?.actuators.buzzer)
    : state.outputs.buzzer;
  if (!soundEnabled || !buzzerOn) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio unavailable');
    audioContext ||= new Audio();
    await audioContext.resume();
    const latestBuzzerState = isMqttMode()
      ? Boolean(getSelectedDevice(deviceStore)?.actuators.buzzer)
      : state.outputs.buzzer;
    if (!soundEnabled || !latestBuzzerState || oscillator) return;
    oscillator = audioContext.createOscillator();
    audioGain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    audioGain.gain.value = 0.025;
    oscillator.connect(audioGain).connect(audioContext.destination);
    oscillator.start();
  } catch {
    soundEnabled = false;
    if ($('#sound-enabled')) $('#sound-enabled').checked = false;
    toast('Suara browser tidak tersedia. Indikator buzzer tetap dapat dicoba.');
  }
}

function openLedDialog(id = null) {
  editingLedId = id;
  const led = id ? state.leds.find((item) => item.id === id) : null;
  $('#led-dialog-title').textContent = led ? 'Ubah nama LED' : 'Tambah LED';
  $('#led-submit').textContent = led ? 'Simpan nama' : 'Tambah LED';
  $('#led-name').value = led?.name || `LED ${state.nextLedId}`;
  $('#led-name').setCustomValidity('');
  $('#led-dialog').showModal();
  $('#led-name').focus();
  if (!led) $('#led-name').select();
}

document.addEventListener('click', (event) => {
  const modeOption = event.target.closest('[data-mode-option]');
  if (modeOption) {
    modeController?.setMode(modeOption.dataset.modeOption);
  }
  const ledToggle = event.target.closest('[data-led-toggle]');
  if (ledToggle) {
    const led = state.leds.find((item) => item.id === ledToggle.dataset.ledToggle);
    if (isMqttMode() && led) {
      const target = `led${led.channel}`;
      const current = Boolean(getSelectedDevice(deviceStore).actuators.leds[target]);
      sendSelectedCommand(target, !current);
    } else if (led && setLed(state, led.id, !led.on)) {
      syncUI();
      announce(`${led.name} ${led.on ? 'menyala' : 'mati'}.`);
    }
  }
  const output = event.target.closest('[data-output]');
  if (output) {
    const name = output.dataset.output;
    if (isMqttMode() && ['relay1', 'relay2', 'relay3', 'relay4', 'buzzer'].includes(name)) {
      const current = getSelectedDevice(deviceStore).actuators[name];
      sendSelectedCommand(name, !current);
    } else {
      setOutput(state, name, !state.outputs[name]);
      if (name === 'buzzer') syncSound();
      syncUI();
      announce(`${output.getAttribute('aria-label')} ${state.outputs[name] ? 'menyala' : 'mati'}.`);
    }
  }
  const preset = event.target.closest('[data-angle]');
  if (preset) {
    const angle = Number(preset.dataset.angle);
    if (isMqttMode()) {
      servoSlider.input(angle, deviceStore.selectedDeviceId);
      servoSlider.commit();
      servoStream.commit(angle, deviceStore.selectedDeviceId);
      syncUI();
    }
    else { setServo(state, angle); syncUI(); announce(`Target servo ${state.servoAngle} derajat, ${direction()}.`); }
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    const category = filter.dataset.filter;
    $$('[data-filter]').forEach((item) => { const active = item === filter; item.classList.toggle('selected', active); item.setAttribute('aria-pressed', active); });
    let count = 0;
    $$('.inventory-row').forEach((row) => { row.hidden = category !== 'Semua' && row.dataset.category !== category; if (!row.hidden) count++; });
    $('#inventory-count').textContent = `${count} komponen`;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'account' && desktopSidebar.matches && document.body.classList.contains('sidebar-collapsed')) {
    document.body.classList.remove('sidebar-collapsed');
    try { localStorage.setItem('ieee-sidebar-collapsed', 'false'); } catch { /* Optional preference. */ }
    syncSidebarToggle();
  }
  if (action === 'simulation' && !isMqttMode()) { toggleSimulation(state); syncUI(); announce(state.simulationRunning ? 'Simulasi sensor dilanjutkan.' : 'Simulasi sensor dijeda.'); }
  if (action === 'reset' && !isMqttMode()) { resetControls(state); syncSound(); syncUI(); toast('Kontrol direset. Semua sakelar mati dan servo kembali ke 90°.'); }
  if (action === 'menu' || action === 'close-menu') {
    if (desktopSidebar.matches && action === 'menu') {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('ieee-sidebar-collapsed', String(collapsed)); } catch { /* Optional preference. */ }
    } else {
      const open = action === 'menu' && !document.body.classList.contains('menu-open');
      document.body.classList.toggle('menu-open', open);
    }
    syncSidebarToggle();
    if (!desktopSidebar.matches) {
      if (document.body.classList.contains('menu-open')) $('.mobile-sidebar-heading button').focus();
      else $('.mobile-header-brand').focus();
    }
  }
  if (action === 'edit-lcd') {
    const deviceLcd = getSelectedDevice(deviceStore).actuators.lcd;
    const lcdLines = isMqttMode() ? [deviceLcd.line1, deviceLcd.line2] : state.lcdLines;
    $('#lcd-line1').value = lcdLines[0];
    $('#lcd-line2').value = lcdLines[1];
    $('#lcd-dialog').showModal();
  }
  if (action === 'close-lcd') $('#lcd-dialog').close();
  if (action === 'add-led') {
    if (state.leds.length >= state.maxLeds) toast(`Maksimal ${state.maxLeds} LED dalam simulasi.`);
    else openLedDialog();
  }
  if (action === 'edit-led') openLedDialog(event.target.closest('[data-led-id]').dataset.ledId);
  if (action === 'remove-led') {
    const id = event.target.closest('[data-led-id]').dataset.ledId;
    const led = state.leds.find((item) => item.id === id);
    if (led && removeLed(state, id)) {
      renderLedList(); syncUI();
      toast(`${led.name} dihapus dari simulasi.`);
    }
  }
  if (action === 'close-led') { editingLedId = null; $('#led-dialog').close(); }
  if (action === 'export') {
    const rows = [`Catatan ${isMqttMode() ? 'MQTT' : 'simulasi'} Lab IoT - IEEE SB UNESA`, ...visibleLogs().map((entry) => `${entry.time}\t${entry.message}`)].join('\n');
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'catatan-praktik-iot.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Catatan sesi diunduh.');
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'servo-range') {
    const angle = Number(event.target.value);
    servoSlider.input(angle, deviceStore.selectedDeviceId);
    $('#servo-needle').classList.add('is-dragging');
    if (isMqttMode()) servoStream.input(angle, deviceStore.selectedDeviceId);
    else setServo(state, angle);
    scheduleServoRender();
  }
  if (event.target.id === 'led-name') event.target.setCustomValidity('');
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'sound-enabled') { soundEnabled = event.target.checked; syncSound(); }
  if (event.target.id === 'device-selector' && selectDevice(deviceStore, event.target.value)) {
    servoStream.cancel();
    servoSlider.clear();
    renderLedList();
    syncUI();
    syncSound();
    announce(`${getSelectedDevice(deviceStore).name} dipilih.`);
  }
  if (event.target.id === 'servo-range') {
    const angle = Number(event.target.value);
    if (servoRenderFrame !== null) cancelAnimationFrame(servoRenderFrame);
    servoRenderFrame = null;
    $('#servo-needle').classList.remove('is-dragging');
    if (isMqttMode()) {
      servoSlider.input(angle, deviceStore.selectedDeviceId);
      servoSlider.commit();
      servoStream.commit(angle, deviceStore.selectedDeviceId);
    } else {
      servoSlider.clear();
      setServo(state, angle);
    }
    syncUI();
  }
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'lcd-form') {
    event.preventDefault();
    const line1 = $('#lcd-line1').value;
    const line2 = $('#lcd-line2').value;
    if (isMqttMode()) {
      if (sendSelectedCommand('lcd', { line1, line2 })) $('#lcd-dialog').close();
    } else {
      setLcd(state, line1, line2);
      $('#lcd-dialog').close(); syncUI(); toast('Teks LCD diperbarui.');
    }
  }
  if (event.target.id === 'led-form') {
    event.preventDefault();
    const input = $('#led-name');
    const name = input.value.trim();
    if (!name) {
      input.setCustomValidity('Masukkan nama LED.');
      input.reportValidity();
      return;
    }
    const saved = editingLedId ? renameLed(state, editingLedId, name) : addLed(state, name);
    if (!saved && !editingLedId) {
      toast(`Maksimal ${state.maxLeds} LED dalam simulasi.`);
      return;
    }
    const savedLed = editingLedId
      ? state.leds.find((led) => led.id === editingLedId)
      : state.leds.find((led) => led.id === saved);
    const message = editingLedId ? 'Nama LED diperbarui.' : `${savedLed.name} ditambahkan.`;
    editingLedId = null;
    $('#led-dialog').close();
    renderLedList(); syncUI(); toast(message);
  }
});
document.addEventListener('keydown', (event) => {
  if (!document.querySelector('dialog[open]') && !desktopSidebar.matches && document.body.classList.contains('menu-open') && event.key === 'Tab') {
    const controls = [...$('#sidebar').querySelectorAll('a[href], button, summary')].filter((item) => item.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const dialog = $('#lcd-dialog');
  const activeInput = document.activeElement;
  if (dialog?.open && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const down = ['PageDown', 'ArrowDown', 'Next'].includes(event.key)
      || event.code === 'PageDown' || event.keyCode === 34;
    const up = ['PageUp', 'ArrowUp', 'Prior'].includes(event.key)
      || event.code === 'PageUp' || event.keyCode === 33;
    const destination = down && activeInput?.id === 'lcd-line1' ? $('#lcd-line2')
      : up && activeInput?.id === 'lcd-line2' ? $('#lcd-line1') : null;
    if (destination) {
      event.preventDefault();
      destination.focus({ preventScroll: true });
      destination.setSelectionRange(destination.value.length, destination.value.length);
    }
  }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    const account = $('.sidebar-account');
    if (account.open) { account.open = false; account.querySelector('summary').focus(); }
    else closeMobileSidebar();
  }
}, true);

document.addEventListener('visibilitychange', () => { if (document.hidden) { soundEnabled = false; if ($('#sound-enabled')) $('#sound-enabled').checked = false; syncSound(); } });
window.addEventListener('hashchange', () => { renderPage(); $('#main').focus({ preventScroll: true }); });

shell();
const themeButton = document.createElement('button');
themeButton.type = 'button';
themeButton.className = 'icon-button theme-toggle';
themeButton.dataset.action = 'theme';
$('.mode-control').before(themeButton);
syncThemeButton();
installGlassDrag($('.mode-control'), '[data-mode-option]', '--mode-index');
installGlassDrag($('.mobile-bottom-nav'), '[data-page]', '--active-index');
try { document.body.classList.toggle('sidebar-collapsed', localStorage.getItem('ieee-sidebar-collapsed') === 'true'); } catch { /* Optional preference. */ }
renderPage();

function handleMqttMessage({ topic, payload }) {
  const result = applyDeviceMessage(deviceStore, topic, payload);
  if (!result.accepted) {
    console.warn(`[MQTT] Pesan diabaikan (${result.reason}): ${topic}`);
    return;
  }
  if (result.channel === 'state') {
    const data = JSON.parse(payload);
    const angle = data.target === 'servo' ? data.value : data.servo;
    servoTargets.observe(result.deviceId, angle);
  }
  recordMqttMessage(state, topic, payload);
  if (result.deviceId === deviceStore.selectedDeviceId) {
    renderDeviceConnectionSummary(getSelectedDevice(deviceStore));
  }
  if (currentPage === 'dashboard' && result.deviceId === deviceStore.selectedDeviceId) {
    syncUI();
    if (result.channel === 'state') syncSound();
  }
  if (currentPage === 'aktivitas') syncUI();
}

modeController = createModeController({
  initialMode: dataMode,
  storage: globalThis.localStorage,
  storageKey: dashboardConfig.modeStorageKey,
  simulationIntervalMs: dashboardConfig.simulationIntervalMs,
  onSimulationTick: () => {
    if (tick(state) && currentPage === 'dashboard') syncUI();
  },
  connectMqtt: () => startMqtt({ onStatus: setMqttStatus, onMessage: handleMqttMessage }),
  disconnectMqtt: stopMqtt,
  onModeChange: (mode) => {
    dataMode = mode;
    servoStream.cancel();
    servoSlider.clear();
    if (mode === 'simulation' && !state.simulationRunning) toggleSimulation(state);
    if (currentPage === 'dashboard') renderLedList();
    syncUI();
    syncSound();
    announce(mode === 'mqtt' ? 'Mode MQTT aktif.' : 'Mode simulasi aktif.');
  },
});

const freshnessTimer = setInterval(() => {
  if (!isMqttMode()) return;
  renderDeviceConnectionSummary(getSelectedDevice(deviceStore));
  if (currentPage === 'dashboard') syncUI();
}, 1000);

window.addEventListener('beforeunload', () => {
  servoStream.cancel();
  clearInterval(freshnessTimer);
  modeController.destroy();
});

document.addEventListener("command-error", event => toast(event.detail));
