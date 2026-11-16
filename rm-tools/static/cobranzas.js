/* Keep the native POST and redirect; enhance only the export's waiting state. */
(function () {
  'use strict';
  var form = document.querySelector('[data-cobranzas-export]');
  if (!form) { return; }
  var button = form.querySelector('button[type="submit"]');
  var message = form.querySelector('[data-cobranzas-message]');
  form.addEventListener('submit', function (event) {
    if (form.getAttribute('aria-busy') === 'true') {
      event.preventDefault();
      return;
    }
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    message.textContent = 'Generando CSV…';
  });
  // Back/forward cache can restore a previously disabled form.
  window.addEventListener('pageshow', function () {
    form.removeAttribute('aria-busy');
    button.disabled = false;
    message.textContent = '';
  });
})();
