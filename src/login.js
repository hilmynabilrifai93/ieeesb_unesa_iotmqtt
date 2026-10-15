import './theme.js?v=20261013-theme';
import { loadSession, apiPost } from './auth.js?v=20261002-idle';
import { installPasswordChange } from './password-change.js?v=20261013-type-refine';
import { startIdleLogout } from './idle-session.js?v=20261005-password-v1';
async function boot() {
  try {
    if (await loadSession()) {
      await import('./main.js?v=20261015-relay4-r2');
      installPasswordChange();
      startIdleLogout();
      document.addEventListener('click', async event => {
        if (!event.target.closest('[data-action="logout"]')) return;
        try { await apiPost('logout', {}); location.reload(); }
        catch (error) { alert(error.message); }
      });
      return;
    }
    document.querySelector('#app').innerHTML = `<main class="login-page" id="main"><div class="login-layout"><section class="login-brand" aria-label="IEEE Student Branch Universitas Negeri Surabaya"><img src="./assets/ieee-sb-unesa-logo.png" alt="Logo IEEE Student Branch UNESA"/><p>IEEE Student Branch<span>Universitas Negeri Surabaya</span></p></section><form id="login-form" class="login-card"><h1>Login Dashboard</h1><p>Pilih perangkat dan masukkan password untuk mengakses dashboard.</p><label for="login-device">Perangkat</label><select id="login-device" name="deviceId" required></select><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="128"/><p id="login-error" role="alert"></p><button class="button primary" type="submit">Masuk</button></form></div></main>`;
    if (new URLSearchParams(location.search).has('password-changed')) {
      document.querySelector('#login-error').textContent = 'Password berhasil diganti. Semua anggota kelompok perlu login dengan password baru.';
      history.replaceState(null, '', location.pathname + location.hash);
    }
    const response = await fetch('/api/devices', { cache: 'no-store' });
    if (!response.ok) throw new Error('Daftar perangkat belum tersedia.');
    const { devices } = await response.json();
    for (const device of devices) document.querySelector('#login-device').add(new Option(device.name, device.id));
    document.querySelector('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('button'); button.disabled = true;
      document.querySelector('#login-error').textContent = '';
      try {
        await apiPost('login', { deviceId: document.querySelector('#login-device').value, password: document.querySelector('#login-password').value });
        location.reload();
      } catch (error) { document.querySelector('#login-error').textContent = error.message; }
      finally { button.disabled = false; }
    });
  } catch {
    document.querySelector('#app').innerHTML = '<main class="login-page"><div class="login-card"><h1>Dashboard belum tersedia</h1><p>Koneksi login gagal. Muat ulang halaman untuk mencoba lagi.</p><button class="button primary" onclick="location.reload()">Muat ulang</button></div></main>';
  }
}
boot();
