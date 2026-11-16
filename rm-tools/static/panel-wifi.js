/* Router Wi-Fi: reads, edits and explicit confirmation. No automatic writes. */
(function () {
  "use strict";
  var panel = window.rmPanel = window.rmPanel || {};

  function bindWifiEvents() {
  /* Router Wi-Fi tab: the server resolves the router host from the connection
     selected in Técnica; the client only sends its id and the action fields. */
  document.addEventListener('click', function (event) {
    var toggle = event.target.closest && event.target.closest('[data-wifi-toggle]');
    if (toggle) {
      var input = toggle.previousElementSibling;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Ocultar' : 'Mostrar';
      return;
    }
    var pick = event.target.closest && event.target.closest('[data-wifi-band-filter]');
    if (pick) {
      var pickCard = pick.closest('[data-router-wifi]');
      if (pickCard) {
        applyWifiView(pickCard, pick.dataset.wifiBandFilter);
        try { window.localStorage.setItem('wifiBandView', pickCard.dataset.wifiBandView); } catch (error) { /* storage is optional */ }
      }
      return;
    }
    var accept = event.target.closest && event.target.closest('[data-wifi-confirm-accept]');
    if (accept) {
      var confirmDialog = accept.closest('#wifi-confirm');
      var pending = confirmDialog && confirmDialog._wifiPending;
      if (!pending) { return; }
      confirmDialog._wifiPending = null;
      accept.disabled = true;
      confirmDialog.setAttribute('aria-busy', 'true');
      confirmDialog.querySelector('[data-wifi-confirm-message]').textContent = 'Aplicando y verificando los cambios…';
      wifiSave(pending.card, pending.changes, confirmDialog).finally(function () {
        confirmDialog.setAttribute('aria-busy', 'false');
      });
      return;
    }
    var discard = event.target.closest && event.target.closest('[data-wifi-discard]');
    if (discard) {
      var discardCard = discard.closest('[data-router-wifi]');
      if (discardCard) {
        discardCard.querySelectorAll('[data-wifi-kind]').forEach(function (field) {
          if (field.dataset.wifiOrig !== undefined) { field.value = field.dataset.wifiOrig; }
        });
        updateWifiHint(discardCard);
      }
      return;
    }
    var save = event.target.closest && event.target.closest('[data-wifi-save]');
    if (save) {
      var saveCard = save.closest('[data-router-wifi]');
      if (!saveCard || saveCard.dataset.wifiBusy === 'true' || saveCard.dataset.wifiNeedsReview) { return; }
      var changes = wifiChanges(saveCard);
      var saveDialog = saveCard.querySelector('#wifi-confirm');
      if (!changes.length || wifiHasErrors(saveCard) || !saveDialog || saveDialog.open || typeof saveDialog.showModal !== 'function') { return; }
      saveDialog.querySelector('[data-wifi-confirm-message]').textContent = 'Se aplicarán estos cambios. Los dispositivos conectados se desconectarán.';
      var list = saveDialog.querySelector('[data-wifi-confirm-list]');
      list.replaceChildren.apply(list, changes.map(function (change) {
        var item = document.createElement('li');
        item.textContent = change.label;
        return item;
      }));
      saveDialog.querySelector('[data-wifi-confirm-accept]').disabled = false;
      saveDialog._wifiPending = {card: saveCard, changes: changes};
      saveDialog.showModal();
      var cancel = saveDialog.querySelector('.modal-foot [data-modal-close]');
      if (cancel) { cancel.focus(); }
      saveDialog.addEventListener('close', function () {
        if (saveDialog._wifiPending) { saveDialog._wifiPending = null; }
        if (save.isConnected) { save.focus(); }
      }, {once: true});
      return;
    }
    var button = event.target.closest && event.target.closest('[data-wifi-action]');
    var card = button && button.closest('[data-router-wifi]');
    if (!card || card.dataset.wifiBusy === 'true') { return; }
    var action = button.dataset.wifiAction;
    if (action === 'devices') {
      var dialog = card.querySelector('#wifi-devices');
      if (!dialog || dialog.open || typeof dialog.showModal !== 'function') { return; }
      dialog.showModal();
      dialog.addEventListener('close', function () { if (button.isConnected) { button.focus(); } }, {once: true});
    }
    wifiRequest(card, action).then(function (ok) {
      if (action === 'current' && ok) {
        var live = wifiLive(card);
        if (live) { delete live.dataset.wifiNeedsReview; updateWifiHint(live); }
      }
    });
  });

  /* The router answers with a server-rendered fragment, so the same request
     serves the manual actions and the automatic read of the current settings.
     A refreshed customer body replaces the card mid-request: the answer then
     lands in whichever card is live. */
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-device-page]');
    var area = button && button.closest('[data-wifi-devices]');
    if (!area || button.disabled) { return; }
    var list = area.querySelector('.wifi-devices');
    var items = Array.from(list.children);
    var pages = Math.ceil(items.length / 8);
    var page = Math.max(0, Math.min(pages - 1, Number(list.dataset.page || 0) + Number(button.dataset.devicePage)));
    list.dataset.page = page;
    items.forEach(function (item, index) { item.hidden = Math.floor(index / 8) !== page; });
    area.querySelector('[data-device-page-label]').textContent = 'Página ' + (page + 1) + ' de ' + pages;
    area.querySelector('[data-device-page="-1"]').disabled = page === 0;
    area.querySelector('[data-device-page="1"]').disabled = page === pages - 1;
    area.scrollTop = 0;
  });

  }

  function wifiRequest(card, action, extra) {
    var select = document.querySelector('#customer-connection select');
    var body = new URLSearchParams({csrf_token: card.dataset.wifiCsrf, connection_id: select ? select.value : ''});
    // Band fields are never posted wholesale: a write sends exactly the values its step names.
    card.querySelectorAll('[data-wifi-field]:not([data-wifi-kind])').forEach(function (field) {
      if (field.type === 'checkbox') { if (field.checked) { body.set(field.dataset.wifiField, 'on'); } }
      else { body.set(field.dataset.wifiField, field.value); }
    });
    Object.keys(extra || {}).forEach(function (name) { body.set(name, extra[name]); });
    var slot = {current: '[data-wifi-current]', devices: '[data-wifi-devices]'}[action] || '[data-wifi-result]';
    var okNotice = false;
    // The card exists without its slots while the panel is not configured: nothing to read or show.
    var area = card.querySelector(slot);
    if (!area) { return Promise.resolve(false); }
    card.dataset.wifiBusy = 'true';
    area.textContent = 'Consultando el router…';
    return fetch('/admin/clientes/' + encodeURIComponent(card.dataset.wifiCode) + '/router-wifi/' + action, {
      method: 'POST', credentials: 'same-origin', redirect: 'error', body: body
    }).then(function (response) {
      if (!response.ok) { throw new Error('failed'); }
      return response.text();
    }).then(function (html) {
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      if (parsed.body.querySelector('script, style, iframe, object, embed, base, link, meta')) { throw new Error('document'); }
      var liveCard = wifiLive(card);
      var target = liveCard && liveCard.querySelector(slot);
      if (!target) { return; }
      var filled = action === 'current' && fillWifiBands(liveCard, parsed.body);
      if (filled) { target.textContent = ''; }
      else { target.replaceChildren.apply(target, Array.from(document.importNode(parsed.body, true).childNodes)); }
      if (action === 'current') { liveCard.dataset.wifiLoaded = filled ? 'true' : 'false'; }
      okNotice = action === 'current' ? !!filled : !!target.querySelector('.notice.ok');
    }).catch(function () {
      var live = wifiLive(card);
      var shown = live && live.querySelector(slot);
      if (shown) { shown.textContent = 'No se pudo completar la acción. Recargá la página e intentá de nuevo.'; }
    }).then(function () {
      var live = wifiLive(card);
      if (live) { live.dataset.wifiBusy = 'false'; }
      return okNotice;
    });
  }
  /* One save = up to two router writes, names first, then passwords; the first failure stops the rest.
     A 5 GHz value is always resent from the read (the router rejects a half-specified pair), but only
     when that band exists: a single-band router must never receive 5 GHz fields.
     Passwords: new_password_5g travels when the 5 GHz band was read and its value is not empty, so
     modern firmware keeps (or changes) each band separately; legacy firmware never reports 5 GHz and
     therefore never receives it. */
  function wifiSave(card, changes, dialog) {
    var value = function (name) {
      var field = card.querySelector('[data-wifi-field="' + name + '"]');
      return field && !field.disabled ? field.value : '';
    };
    var steps = [];
    if (changes.some(function (change) { return change.kind === 'ssid'; })) {
      steps.push({action: 'ssids', done: 'nombres', extra: {ssid_2g: value('ssid_2g'), ssid_5g: value('ssid_5g')}});
    }
    if (changes.some(function (change) { return change.kind === 'pass'; })) {
      var extra = {new_password: value('new_password')};
      if (value('new_password_5g')) { extra.new_password_5g = value('new_password_5g'); }
      steps.push({action: 'password', done: 'contraseñas', extra: extra});
    }
    var completed = [];
    var next = function (index) {
      if (index >= steps.length) {
        var live = wifiLive(card);
        var result = live && live.querySelector('[data-wifi-result]');
        if (result) {
          var notice = document.createElement('div');
          notice.className = 'notice ok';
          notice.setAttribute('role', 'status');
          notice.textContent = 'Cambios aplicados: ' + completed.join(' y ') + '.';
          result.replaceChildren(notice);
        }
        return panel.actions.finish(dialog, {message: 'Cambios de Wi-Fi aplicados',
          result: dialog.querySelector('[data-wifi-confirm-message]'),
          refresh: function () {
            var current = wifiLive(card);
            return current ? wifiRequest(current, 'current') : Promise.resolve(false);
          }});
      }
      return wifiRequest(card, steps[index].action, steps[index].extra).then(function (ok) {
        if (ok) { completed.push(steps[index].done); return next(index + 1); }
        var live = wifiLive(card);
        var result = live && live.querySelector('[data-wifi-result]');
        if (result) {
          var note = document.createElement('p');
          note.className = 'muted';
          var unconfirmed = !!result.querySelector('[data-wifi-unconfirmed="true"]');
          note.textContent = (unconfirmed ? 'Sin confirmar: ' : 'No se pudo cambiar ') + steps[index].done + '.' + (completed.length ? ' Ya se aplicó: ' + completed.join(' y ') + '.' : '');
          result.appendChild(note);
          dialog.querySelector('[data-wifi-confirm-message]').textContent = result.textContent + ' Revisá el estado antes de volver a guardar.';
        }
        if (live) { live.dataset.wifiNeedsReview = 'true'; updateWifiHint(live); }
        // Names already applied: refresh the originals but keep the unsaved password edits.
        if (live && completed.length) {
          live._wifiKeep = {};
          live.querySelectorAll('[data-wifi-kind="pass"]').forEach(function (field) { live._wifiKeep[field.dataset.wifiField] = field.value; });
          return wifiRequest(live, 'current');
        }
      });
    };
    return next(0);
  }
  // Changed fields in reading order, as {field, kind, label}; passwords are never printed.
  function wifiChanges(card) {
    var changes = [];
    card.querySelectorAll('[data-wifi-panel]').forEach(function (panel) {
      var band = panel.dataset.wifiPanel.replace('GHz', ' GHz');
      panel.querySelectorAll('[data-wifi-kind]').forEach(function (field) {
        if (field.disabled || field.dataset.wifiOrig === undefined || field.value === field.dataset.wifiOrig) { return; }
        var isName = field.dataset.wifiKind === 'ssid';
        changes.push({field: field.dataset.wifiField, kind: field.dataset.wifiKind,
          label: band + ' · ' + (isName ? 'nombre: ' + field.dataset.wifiOrig + ' → ' + field.value : 'clave: nueva')});
      });
    });
    return changes;
  }
  // Mirrors the server rules: names 1-32, passwords 8-63, printable ASCII only.
  function wifiFieldError(field) {
    var isName = field.dataset.wifiKind === 'ssid';
    var value = field.value;
    if (!/^[\x20-\x7e]*$/.test(value)) { return 'Usá solo caracteres ASCII imprimibles'; }
    if (isName && (value.length < 1 || value.length > 32)) { return 'El nombre debe tener de 1 a 32 caracteres'; }
    if (!isName && (value.length < 8 || value.length > 63)) { return 'La clave debe tener de 8 a 63 caracteres'; }
    return '';
  }
  function wifiHasErrors(card) {
    return Array.prototype.some.call(card.querySelectorAll('[data-wifi-kind]'), function (field) {
      return !field.disabled && field.dataset.wifiOrig !== undefined && field.value !== field.dataset.wifiOrig && !!wifiFieldError(field);
    });
  }
  // The read answers one [data-wifi-band] entry per band; each fills (and unlocks) its panel's fields.
  function fillWifiBands(card, body) {
    if (!body.querySelector('[data-wifi-band]')) { return 0; }
    var keep = card._wifiKeep || {};
    card._wifiKeep = null;
    var count = 0;
    card.querySelectorAll('[data-wifi-panel]').forEach(function (panel) {
      var key = panel.dataset.wifiPanel;
      var source = body.querySelector('[data-wifi-band="' + key + '"]');
      var note = panel.querySelector('[data-wifi-unavailable]');
      var hint = panel.querySelector('[data-wifi-hint]');
      var toggle = panel.querySelector('[data-wifi-toggle]');
      if (toggle) { toggle.textContent = 'Mostrar'; }
      var sourceSsid = source && source.querySelector('[data-wifi-ssid]');
      var sourcePass = source && source.querySelector('[data-wifi-pass]');
      panel.querySelectorAll('[data-wifi-kind]').forEach(function (field) {
        var isName = field.dataset.wifiKind === 'ssid';
        if (!isName) { field.type = 'password'; }
        if (source) {
          var original = isName ? (sourceSsid ? sourceSsid.textContent : '') : (sourcePass ? sourcePass.value : '');
          field.dataset.wifiOrig = original;
          field.value = !isName && keep[field.dataset.wifiField] !== undefined ? keep[field.dataset.wifiField] : original;
          field.disabled = false;
        } else {
          delete field.dataset.wifiOrig;
          field.value = '';
          field.disabled = true;
        }
      });
      if (source) { panel.dataset.wifiRead = 'true'; count += 1; } else { delete panel.dataset.wifiRead; }
      if (note) { note.hidden = !!source; }
      if (hint) { hint.hidden = !!source || !!(note && !note.hidden); }
    });
    updateWifiHint(card);
    return count;
  }
  // Pure view filter: hidden panels keep their inputs and their unsaved edits.
  function applyWifiView(card, view) {
    if (!card || typeof card.querySelectorAll !== 'function') { return; }
    if (['all', '2.4GHz', '5GHz'].indexOf(view) < 0) { view = 'all'; }
    card.dataset.wifiBandView = view;
    var bands = card.querySelector('[data-wifi-bands]');
    if (bands) { bands.dataset.wifiBandView = view; }
    card.querySelectorAll('[data-wifi-band-filter]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.wifiBandFilter === view ? 'true' : 'false');
    });
    card.querySelectorAll('[data-wifi-panel]').forEach(function (panel) {
      panel.hidden = view !== 'all' && panel.dataset.wifiPanel !== view;
    });
    updateWifiHint(card);
  }
  // Single place that derives everything dirty-dependent: counter, buttons, inline errors, hidden-band hint.
  function updateWifiHint(card) {
    var hidden = [];
    var dirty = 0;
    card.querySelectorAll('[data-wifi-panel]').forEach(function (panel) {
      var panelDirty = 0;
      panel.querySelectorAll('[data-wifi-kind]').forEach(function (field) {
        var changed = !field.disabled && field.dataset.wifiOrig !== undefined && field.value !== field.dataset.wifiOrig;
        var message = changed ? wifiFieldError(field) : '';
        var error = field.parentNode.querySelector('[data-wifi-error]') || field.parentNode.parentNode.querySelector('[data-wifi-error]');
        if (error) { error.textContent = message; error.hidden = !message; }
        field.setAttribute('aria-invalid', message ? 'true' : 'false');
        if (changed) { panelDirty += 1; }
      });
      dirty += panelDirty;
      if (panel.hidden && panelDirty) { hidden.push(panel.dataset.wifiPanel.replace('GHz', ' GHz')); }
    });
    var hint = card.querySelector('[data-wifi-band-hint]');
    if (hint) {
      hint.textContent = hidden.length ? 'También hay cambios en ' + hidden.join(' y ') : '';
      hint.hidden = !hidden.length;
    }
    var counter = card.querySelector('[data-wifi-dirty]');
    if (counter) {
      counter.textContent = dirty + (dirty === 1 ? ' cambio sin guardar' : ' cambios sin guardar');
      counter.hidden = !dirty;
    }
    var saveButton = card.querySelector('[data-wifi-save]');
    if (saveButton) { saveButton.disabled = !dirty || wifiHasErrors(card) || !!card.dataset.wifiNeedsReview; }
    var discardButton = card.querySelector('[data-wifi-discard]');
    if (discardButton) { discardButton.disabled = !dirty; }
  }
  function bindWifiInput() {
    document.addEventListener('input', function (event) {
      var field = event.target;
      var card = field && field.closest && field.closest('[data-router-wifi]');
      if (!card) { return; }
      if (field.dataset.wifiField === 'port') {
        var label = card.querySelector('[data-wifi-port-summary]');
        if (label) { label.textContent = field.value; }
      }
      updateWifiHint(card);
    });
  }
  function savedWifiView() {
    try { return window.localStorage.getItem('wifiBandView') || 'all'; } catch (error) { return 'all'; }
  }
  // Boot remains owned by app.js so feature registration does not reorder initialization.
  function initWifiViews() {
    bindWifiEvents();
    bindWifiInput();
    if (typeof document.querySelectorAll === 'function') {
      document.querySelectorAll('[data-router-wifi]').forEach(function (card) { applyWifiView(card, savedWifiView()); });
    }
  }
  function wifiLive(card) { return card.isConnected ? card : document.querySelector('[data-router-wifi]'); }
  // Entering the tab reads the router once; a failed read is retried on re-entry.
  function loadWifiCurrent(panel) {
    var card = panel && panel.querySelector('[data-router-wifi]');
    if (card && !card.dataset.wifiBandView) { applyWifiView(card, savedWifiView()); }
    if (card && card.dataset.wifiLoaded !== 'true' && card.dataset.wifiBusy !== 'true') { wifiRequest(card, 'current'); }
  }
  // A replacement body starts empty: carry over what was read, or is being read.
  function carryWifiPanels(from, to) {
    if (!from || !to || !from.querySelector('[data-wifi-current]') || !to.querySelector('[data-wifi-current]')) { return; }
    from.querySelectorAll('[data-wifi-panel]').forEach(function (panel) {
      var next = to.querySelector('[data-wifi-panel="' + panel.dataset.wifiPanel + '"]');
      if (!next) { return; }
      ['[data-wifi-unavailable]', '[data-wifi-hint]'].forEach(function (selector) {
        var a = panel.querySelector(selector); var b = next.querySelector(selector);
        if (a && b) { b.hidden = a.hidden; }
      });
      panel.querySelectorAll('[data-wifi-kind]').forEach(function (field) {
        var other = next.querySelector('[data-wifi-field="' + field.dataset.wifiField + '"]');
        if (!other) { return; }
        other.value = field.value;
        other.disabled = field.disabled;
        if (field.dataset.wifiOrig !== undefined) { other.dataset.wifiOrig = field.dataset.wifiOrig; }
      });
      if (panel.dataset.wifiRead) { next.dataset.wifiRead = panel.dataset.wifiRead; }
    });
    updateWifiHint(to);
    applyWifiView(to, from.dataset.wifiBandView || savedWifiView());
  }
  function carryWifiState(previous, replacement) {
    var from = previous.querySelector('[data-router-wifi]');
    var to = replacement.querySelector('[data-router-wifi]');
    var fromCurrent = from && from.querySelector('[data-wifi-current]');
    var toCurrent = to && to.querySelector('[data-wifi-current]');
    // The card exists without the settings area while the panel is not configured.
    if (!fromCurrent || !toCurrent) { return; }
    to.dataset.wifiBusy = from.dataset.wifiBusy || 'false';
    if (from.dataset.wifiNeedsReview) {
      to.dataset.wifiNeedsReview = from.dataset.wifiNeedsReview;
      var fromResult = from.querySelector('[data-wifi-result]');
      var toResult = to.querySelector('[data-wifi-result]');
      if (fromResult && toResult) { toResult.replaceChildren.apply(toResult, Array.from(fromResult.childNodes)); }
    }
    if (from.dataset.wifiLoaded) { to.dataset.wifiLoaded = from.dataset.wifiLoaded; }
    toCurrent.replaceChildren.apply(toCurrent, Array.from(fromCurrent.childNodes));
  }

  panel.wifi = {initWifiViews: initWifiViews, loadWifiCurrent: loadWifiCurrent,
    carryWifiPanels: carryWifiPanels, carryWifiState: carryWifiState,
    applyWifiView: applyWifiView, savedWifiView: savedWifiView};
})();
