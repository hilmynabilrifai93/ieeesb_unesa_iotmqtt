import { apiPost } from './auth.js?v=20261002-idle';

export function installPasswordChange() {
  const dialog = document.createElement('dialog');
  dialog.id = 'password-dialog';
  dialog.setAttribute('aria-labelledby', 'password-dialog-title');
  dialog.innerHTML = `<form id="password-form">
    <div class="dialog-heading"><h2 id="password-dialog-title">Ganti password kelompok</h2></div>
    <p>Password berlaku untuk perangkat kelompok yang sedang login. Setelah diganti, semua anggota perlu login kembali dengan password baru.</p>
    <label for="password-old">Password lama</label>
    <input id="password-old" name="oldPassword" type="password" autocomplete="current-password" required maxlength="128" />
    <label for="password-new">Password baru</label>
    <input id="password-new" name="newPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128" />
    <label for="password-confirm">Konfirmasi password baru</label>
    <input id="password-confirm" name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128" />
    <p id="password-error" role="alert"></p>
    <div class="dialog-actions"><button type="button" class="button secondary" data-password-cancel>Batal</button><button type="submit" class="button primary">Simpan password</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('#password-error');
  const submit = form.querySelector('[type="submit"]');
  let busy = false;
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'change-password') {
      event.target.closest('details')?.removeAttribute('open');
      form.reset(); error.textContent = ''; dialog.showModal();
    } else if (!event.target.closest('.account-menu')) {
      document.querySelector('.account-menu')?.removeAttribute('open');
    }
  });
  dialog.querySelector('[data-password-cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { form.reset(); error.textContent = ''; document.querySelector('.sidebar-account summary')?.focus(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(form));
    error.textContent = '';
    if (data.newPassword !== data.confirmPassword) { error.textContent = 'Konfirmasi password baru tidak cocok.'; return; }
    if (data.newPassword === data.oldPassword) { error.textContent = 'Password baru harus berbeda dari password lama.'; return; }
    busy = true;
    submit.disabled = true;
    dialog.querySelector('[data-password-cancel]').disabled = true;
    try {
      await apiPost('change-password', data);
      form.reset();
      location.replace(location.pathname + '?password-changed=1');
    } catch (cause) { error.textContent = cause.message; }
    finally { busy = false; submit.disabled = false; dialog.querySelector('[data-password-cancel]').disabled = false; }
  });
}
