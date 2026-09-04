(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const nav = document.querySelector('.nav-links');
  const menu = document.querySelector('.nav-toggle');
  const theme = document.querySelector('.theme-toggle');
  const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
  let explicitTheme;
  try { explicitTheme = localStorage.getItem('theme'); } catch { /* Storage may be unavailable. */ }
  if (!['light', 'dark'].includes(explicitTheme)) explicitTheme = null;
  function applyTheme(value) {
    root.setAttribute('data-theme', value);
    if (theme) {
      theme.setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} mode`);
      theme.setAttribute('aria-pressed', String(value === 'dark'));
    }
  }
  applyTheme(explicitTheme || (darkPreference.matches ? 'dark' : 'light'));
  theme?.addEventListener('click', () => {
    explicitTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(explicitTheme);
    try { localStorage.setItem('theme', explicitTheme); } catch { /* Theme still works in this tab. */ }
  });
  darkPreference.addEventListener('change', event => {
    if (!explicitTheme) applyTheme(event.matches ? 'dark' : 'light');
  });
  if (nav && menu) {
    nav.id = 'primary-navigation';
    menu.setAttribute('aria-controls', nav.id);
    function setMenu(open, restoreFocus = false) {
      nav.classList.toggle('active', open);
      menu.classList.toggle('active', open);
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      if (restoreFocus) menu.focus();
    }
    setMenu(false);
    menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') setMenu(false, true);
    });
    document.addEventListener('click', event => {
      if (!nav.contains(event.target) && !menu.contains(event.target)) setMenu(false);
    });
    const desktop = window.matchMedia('(min-width: 801px)');
    desktop.addEventListener('change', event => { if (event.matches) setMenu(false); });
  }
})();
