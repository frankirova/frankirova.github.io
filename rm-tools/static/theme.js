/* Shared by the authenticated shell and login; no app controllers required. */
(function () {
  "use strict";

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var color = document.querySelector('meta[name="theme-color"]');
    if (color) { color.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0d0f14'); }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-toggle') === theme));
    });
  }

  document.addEventListener('rm:preferences', function () { applyTheme(window.rmPreferences.theme); });
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-theme-toggle]');
    if (!button) { return; }
    var theme = button.getAttribute('data-theme-toggle');
    if (theme !== 'light' && theme !== 'dark') { return; }
    applyTheme(theme);
    if (window.rmPreferenceChange) { window.rmPreferenceChange({theme: theme}); }
    else { try { localStorage.setItem('rm.theme', theme); } catch (_) { /* Still usable without storage. */ } }
  });
})();
