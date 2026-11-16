/* Modal ticket results: confirmed writes and read-only recovery. */
(function () {
  'use strict';
  var panel = window.rmPanel = window.rmPanel || {};
  if (panel.ticketActionsReady) { return; }
  panel.ticketActionsReady = true;

  async function refreshTickets(stale) {
    var rail = document.querySelector('aside.customer-ticket-rail');
    if (rail) {
      var customer = document.querySelector('#customer-body[data-customer-code]');
      var url = '/clientes/' + encodeURIComponent(customer.dataset.customerCode);
      url += stale ? '/tickets/actualizar?force=1' : '/tickets-rail';
      var response = await fetch(url, {method: stale ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error'});
      if (!response.ok) { throw new Error('rail unavailable'); }
      var parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      var fresh = parsed.querySelector('aside.customer-ticket-rail');
      if (!fresh || fresh.querySelector('.notice.warn, script, iframe')) { throw new Error('invalid rail'); }
      rail.replaceWith(document.importNode(fresh, true));
      if (window.htmx) { window.htmx.process(document.querySelector('aside.customer-ticket-rail')); }
      document.querySelector('aside.customer-ticket-rail').dispatchEvent(new CustomEvent('htmx:afterSwap', {bubbles: true}));
      return;
    }
    var target = document.querySelector('#tickets-result');
    if (!target) { throw new Error('missing ticket list'); }
    var filters = document.querySelector('form[action="/tickets"]');
    var query = filters ? new URLSearchParams(new FormData(filters)).toString() : '';
    var response = await fetch((stale ? '/tickets/actualizar' : '/tickets/buscar') + '?' + query,
      {method: stale ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error'});
    if (!response.ok) { throw new Error('list unavailable'); }
    var template = document.createElement('template');
    template.innerHTML = await response.text();
    if (!template.content.children.length || template.content.querySelector('script, iframe, .notice.err, .notice.warn')) { throw new Error('invalid list'); }
    target.replaceChildren(template.content);
    if (window.htmx) { window.htmx.process(target); }
    target.dispatchEvent(new CustomEvent('htmx:afterSwap', {bubbles: true}));
  }

  /* ── Ticket edit form: identity, focus and unsaved edits ───────────────
     The detail has one writer form per ticket; its first signature is the
     baseline, and any later difference is an unsaved edit worth confirming. */
  function ticketEditForm(root) {
    return root && root.querySelector ? root.querySelector('form[id^="ticket-edit-"][hx-post]') : null;
  }
  function formSignature(form) {
    return Array.prototype.map.call(form.elements, function (field) {
      return field.name + '=' + (field.value == null ? '' : field.value);
    }).join('&');
  }
  function armUnsavedGuard(root) {
    var form = ticketEditForm(root);
    if (form) { form.dataset.pristine = formSignature(form); }
    var dialog = root.closest('dialog');
    if (!dialog || dialog.dataset.unsavedGuard) { return; }
    dialog.dataset.unsavedGuard = 'true';
    /* The close button bubbles up to the document handler in app.js, so the
       warning has to stop the event here. Escape fires `cancel` and closes
       through the browser default, which preventDefault cancels. */
    dialog.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') { return; }
      if (!target.closest('[data-modal-close]')) { return; }
      if (confirmDiscard(dialog)) { return; }
      event.preventDefault();
      event.stopPropagation();
    });
    dialog.addEventListener('cancel', function (event) {
      if (!confirmDiscard(dialog)) { event.preventDefault(); }
    });
  }
  function hasUnsavedEdits(dialog) {
    if (!dialog || dialog.id !== 'ticket-detail') { return false; }
    var form = ticketEditForm(dialog.querySelector('#ticket-detail-body') || dialog);
    if (!form || form.dataset.pristine === undefined) { return false; }
    return formSignature(form) !== form.dataset.pristine;
  }
  /* One reason decides every close path: the close button and a backdrop click
     bubble up to app.js, while Escape fires `cancel`. */
  function confirmDiscard(dialog) {
    if (!hasUnsavedEdits(dialog)) { return true; }
    return window.confirm('Hay cambios sin guardar en el ticket. ¿Cerrar y descartarlos?');
  }

  /* A refused save keeps the dialog open with the reason in the live region; the
     caret goes to the field that needs attention, so a keyboard user does not
     have to hunt for it. The browser flags the control it already rejected. */
  document.addEventListener('htmx:afterSwap', function (event) {
    var target = event.target;
    if (!target || target.id !== 'ticket-detail-result') { return; }
    if (target.querySelector('[data-ticket-action-success]')) { return; }
    var form = ticketEditForm(target.parentElement);
    if (!form) { return; }
    var field = form.querySelector(':invalid') || form.querySelector('select, textarea, input');
    if (field) { field.focus(); }
  });

  var installationForm;
  document.addEventListener('htmx:beforeRequest', function (event) {
    var dialog = event.target.closest('#installation-booking');
    if (dialog && !dialog.dataset.ticketActionSaved && !installationForm) {
      installationForm = dialog.querySelector('#installation-booking-body').innerHTML;
    }
  });

  // A saved comment must not be submitted again if only its read-back failed.
  document.addEventListener('htmx:beforeRequest', function (event) {
    if (event.target.closest('dialog[data-ticket-action-saved]')) { event.preventDefault(); }
  });
  document.addEventListener('submit', function (event) {
    if (event.target.closest('dialog[data-ticket-action-saved]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('htmx:afterRequest', function (event) {
    var dialog = event.target.closest('dialog[data-ticket-action-saved]');
    if (dialog) { lock(dialog); }
  });
  function lock(dialog) {
    dialog.querySelectorAll('button[type="submit"], input, select, textarea').forEach(function (field) { field.disabled = true; });
  }
  document.addEventListener('htmx:afterSwap', function (event) {
    var target = event.target;
    if (target.id === 'ticket-detail-body') {
      var detail = target.closest('dialog');
      if (detail) { delete detail.dataset.ticketActionSaved; }
      armUnsavedGuard(target);
      return;
    }
    if (!['installation-booking-body', 'ticket-detail-result'].includes(target.id)) { return; }
    var marker = target.querySelector('[data-ticket-action-success]');
    var dialog = target.closest('dialog');
    if (!marker || !dialog || !dialog.open || dialog.dataset.ticketActionSaved) { return; }
    dialog.dataset.ticketActionSaved = 'true';
    lock(dialog);
    var stale = marker.dataset.ticketActionStale === 'true';
    var first = true;
    var recovery = document.createElement('div');
    target.appendChild(recovery);
    panel.actions.finish(dialog, {message: marker.dataset.ticketActionSuccess, result: recovery,
      refresh: function () {
        if (stale && first) { first = false; return false; }
        return refreshTickets(stale || dialog.id === 'installation-booking');
      }, afterSuccess: function () {
        if (dialog.id === 'installation-booking' && installationForm) {
          target.innerHTML = installationForm;
          delete dialog.dataset.ticketActionSaved;
          if (window.htmx) { window.htmx.process(target); }
          target.dispatchEvent(new CustomEvent('htmx:afterSwap', {bubbles: true}));
        }
      }});
  });
})();
