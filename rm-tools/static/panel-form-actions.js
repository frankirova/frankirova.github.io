/* Progressive enhancement for local action forms; normal POST remains the fallback. */
(function () {
  'use strict';
  var panel = window.rmPanel = window.rmPanel || {};
  if (panel.formActionsReady) { return; }
  panel.formActionsReady = true;

  document.addEventListener('submit', async function (event) {
    var form = event.target.closest('form[data-action-form]');
    if (!form || !panel.actions) { return; }
    event.preventDefault();
    if (form.dataset.actionBusy || form.dataset.actionSaved) { return; }
    var dialog = form.closest('dialog');
    var kind = form.dataset.actionForm;
    var body = new URLSearchParams(new FormData(form));
    form.dataset.actionBusy = 'true';
    dialog.setAttribute('aria-busy', 'true');
    var submit = form.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; }
    var result = form.querySelector('[data-action-result]');
    if (!result) {
      result = document.createElement('p');
      result.setAttribute('data-action-result', '');
      form.appendChild(result);
    }
    result.setAttribute('role', 'status');
    result.textContent = 'Guardando…';
    try {
      var response = await fetch(form.action, {method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: {'Accept': 'application/json'}, body: body});
      var data = await response.json();
      if (!response.ok) {
        if (response.status >= 500) { form.dataset.actionSaved = 'uncertain'; }
        result.textContent = typeof data.detail === 'string' ? data.detail : 'No se pudo guardar. Revisá los datos y los permisos.';
        return;
      }
      if (!data || data.saved !== true) { throw new Error('unconfirmed'); }
      form.dataset.actionSaved = 'true';
      form.querySelectorAll('input, select, textarea').forEach(function (field) { field.disabled = true; });
      var freshDialog;
      await panel.actions.finish(dialog, {message: data.message, result: result,
        refresh: kind === 'prospect' ? async function () {
          var response = await fetch('/prospectos' + window.location.search, {credentials: 'same-origin', redirect: 'error'});
          if (!response.ok) { throw new Error('list unavailable'); }
          var parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
          var card = parsed.querySelector('.prospects-page');
          var current = document.querySelector('.prospects-page');
          if (!card || !current || card.querySelector('script, iframe')) { throw new Error('invalid list'); }
          // Preserve the unrelated prospect-entry draft when updating decisions.
          var draft = current.querySelector('.prospect-form');
          if (draft && card.querySelector('.prospect-form')) { card.querySelector('.prospect-form').replaceWith(draft); }
          current.replaceWith(document.importNode(card, true));
          freshDialog = parsed.getElementById(dialog.id);
          return true;
        } : function () {
          return true;
        }, afterSuccess: function () {
          if (kind === 'prospect') {
            if (freshDialog) { dialog.replaceWith(document.importNode(freshDialog, true)); }
            else { dialog.remove(); }
          } else {
            delete form.dataset.actionSaved;
            form.querySelectorAll('input, select, textarea').forEach(function (field) { field.disabled = false; });
          }
        }});
    } catch (_) {
      form.dataset.actionSaved = 'uncertain';
      result.textContent = 'Resultado no confirmado. No repitas la acción sin revisar el estado actual.';
    } finally {
      delete form.dataset.actionBusy;
      dialog.setAttribute('aria-busy', 'false');
      if (submit) { submit.disabled = !!form.dataset.actionSaved; }
    }
  }, true);
})();
