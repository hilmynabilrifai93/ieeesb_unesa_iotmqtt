import { icon } from './icons.js';

const storageKey = 'ieee-dashboard-theme';

export function syncThemeButton() {
  const button = document.querySelector('[data-action="theme"]');
  if (!button) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  button.innerHTML = icon(dark ? 'sun' : 'moon');
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Aktifkan light mode' : 'Aktifkan dark mode');
  button.title = button.getAttribute('aria-label');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121c1b' : '#f4f5f1');
  syncThemeButton();
}

let initialTheme = 'light';
try {
  if (localStorage.getItem(storageKey) === 'dark') initialTheme = 'dark';
} catch { /* Tema tetap dapat dipilih saat penyimpanan browser dibatasi. */ }
applyTheme(initialTheme);

document.addEventListener('click', event => {
  if (!event.target.closest('[data-action="theme"]')) return;
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem(storageKey, theme); } catch { /* Pilihan berlaku untuk halaman ini. */ }
  const announcement = document.querySelector('#announcement');
  if (announcement) announcement.textContent = theme === 'dark' ? 'Dark mode aktif.' : 'Light mode aktif.';
});
