/* rm-tools — client-side affordances for the panel.
   No dependency, no build step, no eval: delegated copy buttons plus two
   keyboard helpers. Must stay inert on a page with no copy targets. */

(function () {
  "use strict";

  var FLASH_MS = 1200;
  var panel = window.rmPanel;
  var initAntenna = panel.initAntenna;
  var initCustomerTabs = panel.customerTabs.initCustomerTabs;
  var activateCurrentCustomerTab = panel.customerTabs.activateCurrentCustomerTab;
  var carryWifiState = panel.wifi.carryWifiState;
  var carryWifiPanels = panel.wifi.carryWifiPanels;
  var applyWifiView = panel.wifi.applyWifiView;
  var savedWifiView = panel.wifi.savedWifiView;
  var registerOpenClient, renderRail, addOpenClient;

  // Fixed local assets only. Promises coalesce first-use clicks; failed assets
  // are removed so the next explicit click can retry. No customer data cached.
  var toolAssets = Object.create(null);
  function loadToolAsset(name) {
    // A timed-out script can still execute after removal. Reuse its installed
    // listeners on explicit retry, but always finish the tool's CSS separately.
    if ((name === 'customer-edit.js' && window.rmCustomerEditReady) ||
        (name === 'ping-monitor.js' && window.rmPingMonitorReady)) { return Promise.resolve(); }
    if (toolAssets[name]) { return toolAssets[name]; }
    toolAssets[name] = new Promise(function (resolve, reject) {
      var version = document.querySelector('meta[name="customer-tool-version"]');
      var css = /\.css$/.test(name);
      var node = document.createElement(css ? 'link' : 'script');
      var settled = false;
      var timer = setTimeout(failed, 15000);
      function failed() {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        node.remove();
        delete toolAssets[name];
        reject(new Error('asset unavailable'));
      }
      node.onload = function () {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      node.onerror = failed;
      var url = '/static/' + name + '?v=' + encodeURIComponent(version ? version.content : '1');
      if (css) { node.rel = 'stylesheet'; node.href = url; }
      else { node.src = url; }
      document.head.appendChild(node);
    });
    return toolAssets[name];
  }
  var pendingTools = Object.create(null);
  var loadedTools = Object.create(null);
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-customer-edit-open], [data-ping-monitor-open]');
    if (!trigger || !trigger.closest('#customer-body')) { return; }
    var edit = trigger.hasAttribute('data-customer-edit-open');
    var name = edit ? 'customer-edit' : 'ping-monitor';
    // Direct-script fixtures remain supported. In the versioned customer page,
    // script readiness alone is insufficient: ping also needs its stylesheet.
    if (loadedTools[name] || (!document.querySelector('meta[name="customer-tool-version"]') &&
        window[edit ? 'rmCustomerEditReady' : 'rmPingMonitorReady'])) { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pendingTools[name]) {
      pendingTools[name].trigger = trigger;
      return;
    }
    var pending = {trigger: trigger};
    pendingTools[name] = pending;
    var assets = edit ? ['customer-edit.js'] : ['ping-monitor.css', 'ping-monitor.js'];
    Promise.all(assets.map(loadToolAsset)).then(function () {
      loadedTools[name] = true;
      delete pendingTools[name];
      if (pending.trigger.isConnected) { pending.trigger.click(); }
    }).catch(function () {
      delete pendingTools[name];
      showStatusToast('No se pudo cargar la herramienta. Podés reintentar.', false);
    });
  }, true);

  // One .modal at a time: opening a modal dialog closes other open ones so the
  // native top layer never stacks several (ticket compose over search over
  // baja, etc.). Dialogs without the .modal chrome are untouched. Guarded: a
  // DOM without <dialog> support must not take the whole script down.
  if (typeof HTMLDialogElement === "function"
      && typeof HTMLDialogElement.prototype.showModal === "function") {
    var nativeShowModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      var opening = this;
      document.querySelectorAll("dialog.modal[open]").forEach(function (open) {
        if (open !== opening) { open.close(); }
      });
      return nativeShowModal.apply(this, arguments);
    };
  }

  // Argentine money input -> canonical "NNN.NN" or null. Mirrors rm_tools/channels/panel/enable.py normalize_amount;
  // tests/test_amount_format.py drives the same vectors through both.
  var AMOUNT_INPUT = /^ *\$? *(?:([0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+)(?:,([0-9]{1,2}))?|([0-9]+)\.([0-9]{1,2})) *$/;
  function normalizeAmount(value) {
    var match = typeof value === "string" ? AMOUNT_INPUT.exec(value) : null;
    if (!match) { return null; }
    var whole = (match[1] || match[3]).replace(/\./g, "").replace(/^0+/, "");
    if (whole.length > 9) { return null; }
    var cents = (match[2] || match[4] || "0");
    while (cents.length < 2) { cents += "0"; }
    if (Number(whole || "0") === 0 && Number(cents) === 0) { return null; }
    return (whole || "0") + "." + cents;
  }
  window.rmNormalizeAmount = normalizeAmount;

  // N6 begin — relative dates for saved ISO stamps -------------------------
  // Visible text follows the plan wording ("recién", "hace 3 min", "hace 2 h",
  // "hace 2 d"); beyond the 30-day window the caller uses the absolute
  // dd/mm/yy fallback, and a title always carries the machine value
  // ("2026-10-08 14:32"). `nowMs` is injectable so offline tests stay
  // deterministic without a clock mock.
  function relativeDate(iso, nowMs) {
    var ms = typeof iso === "string" ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) { return null; }
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) { nowMs = Date.now(); }
    var seconds = Math.floor((nowMs - ms) / 1000);
    if (seconds < 0) { return null; }
    if (seconds <= 45) { return "recién"; }
    if (seconds < 3600) { return "hace " + Math.max(1, Math.floor(seconds / 60)) + " min"; }
    if (seconds < 86400) { return "hace " + Math.floor(seconds / 3600) + " h"; }
    if (seconds < 30 * 86400) { return "hace " + Math.floor(seconds / 86400) + " d"; }
    return null;
  }
  // "2026-10-08T14:32:00Z" → "2026-10-08 14:32" (title value).
  function dateStampMachine(iso) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || "");
    return m ? m[1] + " " + m[2] : "";
  }
  // "2026-10-08T..." → "08/10/26" (absolute fallback after 30 days).
  function dateStampShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? m[3] + "/" + m[2] + "/" + m[1].slice(2) : "";
  }
  // Re-runnable pass over the server-rendered "Creado AAAA-MM-DD" rows of the
  // customer tickets rail (the one N6 site; the panel ages and the detail
  // modal keep their own conventions). Runs again after every rail swap.
  function relativeTicketDatesIn(root) {
    if (!root || typeof root.querySelectorAll !== "function") { return; }
    var rows = matchingIn(root, '.customer-ticket[data-ticket-created]');
    Array.prototype.forEach.call(rows, function (row) {
      var iso = (row.getAttribute("data-ticket-created") || "").trim();
      if (!iso) { return; }
      var metas = row.getElementsByTagName("p");
      for (var i = 0; i < metas.length; i++) {
        if (metas[i].textContent.indexOf("Creado ") === 0) {
          metas[i].title = dateStampMachine(iso);
          metas[i].textContent = "Creado " + (relativeDate(iso) || dateStampShort(iso));
          return;
        }
      }
    });
  }
  // N6 end -----------------------------------------------------------------

  // Keep attempted operations locked even if an explicit read replaces the ficha.
  var cancellationAttempts = Object.create(null);
  // Same-origin form POST shared by the admin dialogs; the caller decides what a non-ok status means.
  function postAdminForm(code, area, action, values) {
    return fetch('/admin/clientes/' + encodeURIComponent(code) + '/' + area + '/' + action, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(values).toString()
    });
  }
  // The server's message when a write the action needs is switched off in rm-tools
  // (409 + switched_off); null for any other answer. Reads a clone: the body stays usable.
  async function switchedOffDetail(response) {
    if (response.status !== 409) { return null; }
    try {
      var body = await response.clone().json();
      return body && body.switched_off === true && typeof body.detail === 'string' && body.detail ? body.detail : null;
    } catch (_) { return null; }
  }
  // Form POST whose body is the whole answer: any non-ok status is "unconfirmed",
  // but the server's detail (why) travels on the Error for the catch paths to show.
  async function postAdminJson(code, area, action, values) {
    var response = await postAdminForm(code, area, action, values);
    if (!response.ok) {
      var err = new Error('unconfirmed');
      try {
        var body = await response.json();
        if (body && typeof body.detail === 'string' && body.detail) { err.detail = body.detail; }
        err.switchedOff = !!(body && body.switched_off === true);
      } catch (_) { /* body not available: keep only the generic catch message. */ }
      throw err;
    }
    return response.json();
  }
  // A business write was sent: never present the saved data as fresh again.
  function markCustomerStale(root, flag) {
    root.dataset.customerFresh = 'false';
    root.dataset[flag] = 'true';
    var freshness = root.querySelector('[data-customer-status]');
    if (freshness) { freshness.textContent = 'Datos guardados desactualizados: solicitá una lectura con Actualizar.'; }
  }
  // Status → shared flow tone: hecho/ya realizado ok, falló/incierto err, todo lo demás muted.
  function statusTone(status) {
    if (status === 'ok' || status === 'already_done') { return 'ok'; }
    if (status === 'failed' || status === 'uncertain') { return 'err'; }
    return 'muted';
  }
  var FLOW_MARKS = {ok: '✓', err: '✗', muted: '–'};
  function setTone(element, tone) {
    element.classList.remove('is-ok', 'is-err', 'is-warn', 'is-muted');
    if (tone) { element.classList.add('is-' + tone); }
  }
  // One result row of a flow dialog: tone mark (hidden from AT) + text, toned.
  function stepRow(tone, text) {
    var mark = document.createElement('span');
    mark.className = 'flow-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = FLOW_MARKS[tone];
    var item = document.createElement('li');
    item.appendChild(mark);
    item.appendChild(document.createTextNode(text));
    setTone(item, tone);
    return item;
  }
  // Presentational "Datos → Confirmar" indicator; the markup is static, the JS alone moves aria-current.
  function stepIndicator(dialog) {
    var items = Array.prototype.slice.call(dialog.querySelectorAll('.step-indicator li[data-step]'));
    return function setStep(current) {
      items.forEach(function (item) {
        if (item.dataset.step === String(current)) { item.setAttribute('aria-current', 'step'); }
        else { item.removeAttribute('aria-current'); }
      });
    };
  }
  function completionResult(result) {
    var recovery = document.createElement('div');
    result.appendChild(recovery);
    return recovery;
  }
  function cancellationController(dialog, root) {
    if (dialog._cancellation) { return dialog._cancellation; }
    var date = dialog.querySelector('[name=date]');
    var comment = dialog.querySelector('[name=comment]');
    function commentValue() { return comment ? comment.value : ''; }
    var connection = dialog.querySelector('[name=cancellation_connection_id]');
    var assignee = dialog.querySelector('[name=assigned_user_id]');
    var preview = dialog.querySelector('[data-cancellation-preview]');
    var confirm = dialog.querySelector('[data-cancellation-confirm]');
    var message = dialog.querySelector('[data-cancellation-message]');
    var result = dialog.querySelector('[data-cancellation-result]');
    var code = root.dataset.customerCode;
    // Lifetime guard: an in-memory sent baja or one registered server-side both block the flow.
    function alreadySent() { return !!cancellationAttempts[code] || !!dialog.dataset.customerBajaAttempt; }
    var busy = false;
    var generation = 0;
    var token = null;
    var opener;
    var setStep = stepIndicator(dialog);
    var baseName = root.dataset.customerName;
    for (var previous = null; previous !== baseName;) {
      previous = baseName;
      baseName = baseName.replace(/^Baja [0-9]{1,2}-[0-9]{1,2}-[0-9]{4} ?- ?/i, '').replace(/(?: · baja [0-9]{4}-[0-9]{2}-[0-9]{2})+$/, '');
    }
    function bajaName(day) {
      var parts = day.split('-');
      return 'Baja ' + Number(parts[2]) + '-' + Number(parts[1]) + '-' + parts[0] + '- ' + baseName;
    }
    function valid() {
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date.value) || date.value.startsWith('0000')) { return false; }
      var parsed = new Date(date.value + 'T00:00:00Z');
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date.value && /^[1-9][0-9]{0,17}$/.test(connection.value);
    }
    // Locked registered view (S5): hide the whole new-baja flow and keep only the close action.
    function lockView() {
      var locked = alreadySent();
      var flow = dialog.querySelector('[data-cancellation-flow]');
      // Footer close only: the head close is the icon X and must not be relabeled.
      var close = dialog.querySelector('.modal-foot [data-modal-close]');
      if (flow) { flow.hidden = locked; }
      preview.hidden = locked;
      confirm.hidden = locked;
      if (close) { close.textContent = locked ? 'Cerrar' : 'Cancelar'; }
    }
    function controls() {
      lockView();
      date.disabled = busy || alreadySent();
      if (comment) { comment.disabled = busy || alreadySent(); }
      if (assignee) { assignee.disabled = busy || alreadySent(); }
      connection.disabled = busy || alreadySent() || connection.options.length === 0;
      preview.disabled = busy || alreadySent() || !valid();
      confirm.disabled = busy || alreadySent() || !token || !valid();
      dialog.setAttribute('aria-busy', String(busy));
    }
    function changed() {
      generation += 1;
      token = null;
      setStep(1);
      dialog.querySelector('[data-cancellation-name]').textContent = valid() ? bajaName(date.value) : 'Seleccioná una fecha y conexión válidas';
      dialog.querySelector('[data-cancellation-comment]').textContent = valid() ? 'baja a partir ' + date.value + (commentValue() ? '\n' + commentValue() : '') : 'Seleccioná una fecha y conexión válidas';
      message.textContent = alreadySent() ? 'Operación ya enviada: no repetir sin revisión manual.' : '';
      controls();
    }
    date.addEventListener('input', changed);
    if (comment) { comment.addEventListener('input', changed); }
    connection.addEventListener('change', changed);
    function post(action, values) { return postAdminJson(code, 'baja', action, values); }
    preview.addEventListener('click', async function () {
      if (busy || alreadySent() || !dialog.open || !valid()) { return; }
      token = null;
      var values = {date: date.value, connection_id: connection.value, comment: commentValue(), assigned_user_id: assignee ? assignee.value : ''};
      busy = true;
      setTone(message, null);
      controls();
      var current = generation;
      message.textContent = 'Preparando confirmación…';
      try {
        var data = await post('preview', values);
        if (current !== generation || !dialog.open) { return; }
        if (!data || data.date !== values.date || String(data.connection_id) !== values.connection_id || (data.comment || '') !== values.comment || data.immediate_block !== true || typeof data.confirmation !== 'string' || !data.confirmation) { throw new Error('invalid preview'); }
        token = data.confirmation;
        setStep(2);
        message.textContent = 'Confirmación preparada. Confirmá explícitamente para renombrar, bloquear ahora y crear el ticket.';
      } catch (err) {
        if (current === generation && dialog.open) {
          setStep(1);
          message.textContent = 'Baja no disponible: ' + (err && err.detail ? err.detail + ' No se ejecutó la baja.' : 'revisá permisos, datos y configuración. No se ejecutó la baja.');
        }
      } finally { busy = false; controls(); }
    });
    function renderResult(data) {
      result.replaceChildren();
      var heading = document.createElement('p');
      heading.textContent = data.state === 'completed' ? 'Baja completada. Datos guardados desactualizados.' : 'Resultado parcial o incierto: requiere revisión manual; no repetir.';
      if (data.replayed) { heading.textContent = 'Intento previo recuperado, sin nueva ejecución. ' + heading.textContent; }
      result.appendChild(heading);
      var list = document.createElement('ol');
      list.className = 'flow-steps';
      var labels = {rename: 'Renombrar', block: 'Bloquear', ticket: 'Ticket'};
      var statuses = {ok: 'confirmado', already_done: 'ya realizado', pending: 'pendiente / no confirmado', uncertain: 'incierto', failed: 'falló', skipped: 'omitido', not_attempted: 'no se intentó'};
      var reasons = {timeout: 'tiempo de espera agotado', network: 'error de red', unconfirmed_response: 'respuesta del panel no confirmada', csrf_rejected: 'el panel rechazó el token de seguridad', redirect_rejected: 'el panel redirigió la solicitud', login_rejected: 'el panel rechazó el inicio de sesión'};
      function reasonText(code) {
        var http = typeof code === 'string' && /^http_([0-9]{3})$/.exec(code);
        return http ? 'el panel respondió ' + http[1] : reasons[code] || 'causa desconocida';
      }
      ['rename', 'block', 'ticket'].forEach(function (step) {
        var entry = Array.isArray(data.steps) && data.steps.find(function (item) { return item && item.step === step; });
        var status = entry ? statuses[entry.status] : 'no confirmado';
        if (entry && !status) { status = 'no confirmado'; }
        var tone = statusTone(entry && entry.status);
        var row = stepRow(tone, labels[step] + ': ' + (status || 'sin resultado informado'));
        if (entry && entry.status === 'uncertain' && entry.reason) { row.appendChild(document.createTextNode(' (' + reasonText(entry.reason) + ')')); }
        list.appendChild(row);
      });
      result.appendChild(list);
    }
    confirm.addEventListener('click', async function () {
      if (busy || alreadySent() || !dialog.open || !token || !valid()) { return; }
      var values = {date: date.value, connection_id: connection.value, comment: commentValue(), confirmation: token, assigned_user_id: assignee.value};
      token = null;
      cancellationAttempts[code] = true;
      busy = true;
      controls();
      message.textContent = 'Ejecutando: renombrar → bloquear → crear ticket…';
      // Never represent a business write as refreshed read data, even after an error.
      markCustomerStale(root, 'customerCancellationStale');
      var notSent = false;
      try {
        var data = await post('execute', values);
        if (!dialog.isConnected || !dialog.open) { return; }
        if (!data || !['completed', 'uncertain'].includes(data.state)) { throw new Error('invalid result'); }
        renderResult(data);
        if (data.state === 'completed' && dialog.open && dialog.isConnected) {
          await panel.actions.finish(dialog, {message: 'Baja completada', result: completionResult(result),
            refresh: function () { return refreshCompletedCustomer(root, dialog); }});
        }
      } catch (err) {
        // A needed write is switched off in rm-tools (409 + switched_off): nothing was sent.
        notSent = !!(err && err.switchedOff && err.detail);
        result.textContent = notSent ? 'Baja no realizada: ' + err.detail + ' No se envió nada a ISPCube.'
          : 'Baja no confirmada: ' + (err && err.detail ? err.detail + ' Requiere revisión manual; no repetir.' : 'el resultado puede ser parcial o incierto. Requiere revisión manual; no repetir.');
      } finally {
        busy = false;
        message.textContent = notSent ? 'No se envió nada.' : 'Operación enviada. No repetir sin revisión manual.';
        controls();
        if (dialog.open) { result.focus(); }
      }
    });
    dialog.addEventListener('close', function () {
      generation += 1;
      token = null;
      setStep(1);
      controls();
      if (opener && opener.isConnected) { opener.focus(); }
    });
    dialog._cancellation = {open: function (trigger) {
      opener = trigger;
      if (!busy) {
        if (!alreadySent()) { date.value = ''; }
        changed();
      }
      controls();
      dialog.showModal();
      if (alreadySent()) { result.focus(); } else { date.focus(); }
    }};
    return dialog._cancellation;
  }

  var RECONNECT_STEP_LABELS = {DETECT: 'Detección (ISPCube y MikroTik)', TICKET: 'Ticket de orden de desconexión → verificación de pago', UNBLOCK: 'Habilitar en ISPCube', ADDR: 'MikroTik · dirección /30', PROXYOK: 'MikroTik · proxyok', SUSPENDIDOS: 'MikroTik · SUSPENDIDOS', QUEUE: 'MikroTik · queue simple'};
  var FLOW_STATUSES = {ok: 'hecho', already_done: 'ya estaba hecho', failed: 'falló', skipped: 'omitido'};
  var RECONNECT_PLAN = {updated: 'se modificaría', already_done: 'ya estaba hecho', not_found: 'no encontrado, no se toca', not_order: 'sin marca de la orden, no se toca', ambiguous: 'ambiguo, no se escribe', changed: 'cambió, no se escribe', failed: 'falló'};
  var FLOW_REASONS = {
    nothing_to_change: 'Nada para cambiar: el ticket, ISPCube y MikroTik ya están en el estado final.',
    no_disconnection_ticket: 'El cliente no tiene un ticket abierto de ORDEN DE DESCONEXION; no hay nada que mover.',
    ticket_ambiguous: 'Hay más de un ticket de ORDEN DE DESCONEXION y no se puede elegir uno; resolverlo a mano.',
    ticket_identity_mismatch: 'El ticket no corresponde a este cliente; no se ejecuta.',
    detect_failed: 'No se pudo leer el estado del cliente o del MikroTik; no se ejecuta.',
    router_probe_failed: 'No se pudo leer el MikroTik; no se ejecuta.',
    no_connections: 'El cliente no tiene conexiones con IP.',
    customer_not_found: 'El cliente no existe en ISPCube.',
    customer_identity_mismatch: 'ISPCube devolvió otro cliente; no se ejecuta.',
    still_blocked: 'Tras habilitar, ISPCube sigue mostrando al cliente bloqueado.',
    panel_error: 'Falló una llamada a ISPCube.',
    router_changed: 'Un objeto de MikroTik cambió entre la vista previa y la ejecución; no se escribió.',
    router_ambiguous: 'Hay entradas duplicadas en el MikroTik para este cliente; revisá y eliminá los duplicados. No se ejecuta.',
    router_write_failed: 'Falló una escritura en MikroTik.',
    ticket_not_found: 'El ticket ya no existe.', ticket_update_failed: 'Falló la actualización del ticket.',
    unexpected_error: 'Error inesperado.'
  };
  // Fixed router object names the server may report as duplicated; anything else is ignored.
  var RECONNECT_OBJECTS = ['ADDR', 'PROXYOK', 'SUSPENDIDOS', 'QUEUE'];
  // Good = green, bad = red, not evaluated or untouched = muted; the marker keeps it readable without color.
  function reconnectTone(row, executed, halted, ambiguous) {
    if (ambiguous.indexOf(row.step) !== -1) { return 'err'; }
    if (row.status === 'failed') { return 'err'; }
    if (executed) { return row.status === 'skipped' ? 'muted' : 'ok'; }
    if (row.status === 'skipped' && halted) { return 'muted'; }
    if (row.outcome === 'ambiguous' || row.outcome === 'changed' || row.outcome === 'failed') { return 'err'; }
    if (row.outcome === 'not_found' || row.outcome === 'not_order') { return 'muted'; }
    return 'ok';
  }
  // Shared "amount → preview → confirm" admin dialog (reconnect and enable). cfg carries only what differs:
  // data-attribute prefix, URL area, copy, tone policy and result rendering.
  function makeAmountFlowController(dialog, root, cfg) {
    if (dialog[cfg.key]) { return dialog[cfg.key]; }
    var p = 'data-' + cfg.prefix + '-';
    var amount = dialog.querySelector('[name=amount]');
    var preview = dialog.querySelector('[' + p + 'preview]');
    var confirm = dialog.querySelector('[' + p + 'confirm]');
    var message = dialog.querySelector('[' + p + 'message]');
    var result = dialog.querySelector('[' + p + 'result]');
    var steps = dialog.querySelector('[' + p + 'steps]');
    var amountError = dialog.querySelector('[' + p + 'amount-error]');
    var code = root.dataset.customerCode;
    var busy = false;
    var attempted = false;
    var generation = 0;
    var token = null;
    var opener;
    var SESSION_MESSAGE = 'Tu sesión venció. Iniciá sesión de nuevo.';
    // The server cannot be told apart here by status alone: a 403 is a missing permission or a stale form.
    var FORBIDDEN_MESSAGE = 'No tenés permiso para esta acción, o el formulario venció. Recargá la ficha.';
    var setStep = stepIndicator(dialog);
    function valid() { return normalizeAmount(amount.value) !== null; }
    function controls() {
      amountError.textContent = amount.value.trim() !== '' && !valid() ? 'Monto inválido. Ej.: $12.000 o 12000,50' : '';
      amount.disabled = busy || attempted;
      preview.disabled = busy || attempted || !valid();
      confirm.disabled = busy || attempted || !token || !valid();
      dialog.setAttribute('aria-busy', String(busy));
    }
    // cfg.stepRows maps the server rows to [{label, text, tone}]; unknown steps are the flow's call.
    function showSteps(rows, executed, halted, ambiguousNames) {
      steps.replaceChildren();
      cfg.stepRows(Array.isArray(rows) ? rows : [], executed, halted, ambiguousNames).forEach(function (row) {
        steps.appendChild(stepRow(row.tone, row.label + ': ' + row.text));
      });
    }
    function changed() {
      if (attempted) { return; }
      generation += 1;
      token = null;
      setStep(1);
      message.textContent = '';
      setTone(message, null);
      var old = result.querySelector('[' + p + 'summary]');
      if (old) { old.remove(); }
      showSteps([]);
      controls();
    }
    function summary(text, tone) {
      var line = result.querySelector('[' + p + 'summary]');
      if (!line) {
        line = document.createElement('p');
        line.setAttribute(p + 'summary', '');
        result.insertBefore(line, steps);
      }
      line.textContent = text;
      setTone(line, tone);
    }
    function denied(response) { return response.status === 401 || response.status === 403; }
    var ui = {showSteps: showSteps, summary: summary, message: message};
    amount.addEventListener('input', changed);
    preview.addEventListener('click', async function () {
      if (busy || attempted || !dialog.open || !valid()) { return; }
      token = null;
      busy = true;
      controls();
      var current = generation;
      message.textContent = 'Preparando vista previa…';
      if (cfg.clearToneOnPreview) { setTone(message, null); }
      try {
        var response = await postAdminForm(code, cfg.area, 'preview', {amount: amount.value});
        if (current !== generation || !dialog.open) { return; }
        if (denied(response)) { message.textContent = response.status === 401 ? SESSION_MESSAGE : FORBIDDEN_MESSAGE; if (cfg.errTone) { setTone(message, 'err'); } return; }
        var off = await switchedOffDetail(response);
        if (off) { showSteps([]); setStep(1); message.textContent = off + ' No se cambió nada.'; setTone(message, 'err'); return; }
        if (!response.ok) { throw new Error('unavailable'); }
        var data = await response.json();
        if (current !== generation || !dialog.open) { return; }
        if (!data || typeof data.can_execute !== 'boolean' || !Array.isArray(data.steps)) { throw new Error('invalid preview'); }
        showSteps(data.steps, false, !data.can_execute && data.reason !== 'nothing_to_change', data.ambiguous);
        if (data.can_execute) {
          if (typeof data.confirmation !== 'string' || !data.confirmation) { throw new Error('invalid preview'); }
          token = data.confirmation;
          setStep(2);
          message.textContent = (cfg.previewReadyLabel || 'Vista previa lista') + ' (monto ' + (data.amount_display || data.amount) + '). ' + cfg.confirmHint;
          setTone(message, null);
        } else {
          var blocked = cfg.blocked(data);
          message.textContent = blocked.text;
          setTone(message, blocked.tone);
        }
      } catch (_) {
        if (current === generation && dialog.open) {
          showSteps([]);
          setStep(1);
          message.textContent = 'Vista previa no disponible: revisá permisos y configuración. No se cambió nada.';
          if (cfg.errTone) { setTone(message, 'err'); }
        }
      } finally { busy = false; controls(); }
    });
    confirm.addEventListener('click', async function () {
      if (busy || attempted || !dialog.open || !token || !valid()) { return; }
      var values = {amount: amount.value, confirmation: token};
      attempted = true;
      token = null;
      busy = true;
      controls();
      message.textContent = cfg.runningText;
      // Never represent a business write as refreshed read data, even after an error.
      markCustomerStale(root, cfg.staleFlag);
      try {
        var response = await postAdminForm(code, cfg.area, 'execute', values);
        if (denied(response)) { message.textContent = response.status === 401 ? SESSION_MESSAGE : FORBIDDEN_MESSAGE; if (cfg.errTone) { setTone(message, 'err'); } return; }
        var switched = await switchedOffDetail(response);
        if (switched) {
          message.textContent = switched + ' No se envió nada a ISPCube.';
          setTone(message, 'err');
          return;
        }
        if (response.status === 409) {
          message.textContent = 'Esta confirmación ya fue usada: no se repitió. Verificá el estado real.';
          if (cfg.errTone) { setTone(message, 'err'); }
          return;
        }
        if (!response.ok) { throw new Error('unconfirmed'); }
        var data = await response.json();
        if (!dialog.isConnected || !dialog.open) { return; }
        if (!data || cfg.states.indexOf(data.state) === -1) { throw new Error('invalid result'); }
        cfg.executed(data, ui);
        if (data.state === 'completed' && dialog.open && dialog.isConnected) {
          await panel.actions.finish(dialog, {message: cfg.completedMessage, result: completionResult(result),
            refresh: function () { return refreshCompletedCustomer(root, dialog); }});
        }
      } catch (_) {
        cfg.unconfirmed(ui);
      } finally {
        busy = false;
        controls();
        if (dialog.open) { result.focus(); }
      }
    });
    dialog.addEventListener('close', function () {
      generation += 1;
      token = null;
      setStep(1);
      controls();
      if (opener && opener.isConnected) { opener.focus(); }
    });
    dialog[cfg.key] = {open: function (trigger) {
      opener = trigger;
      if (!busy && !attempted) { amount.value = ''; changed(); }
      controls();
      dialog.showModal();
      if (attempted) { result.focus(); } else { amount.focus(); }
    }};
    return dialog[cfg.key];
  }
  var reconnectCfg = {
    key: '_reconnect', prefix: 'reconnect', area: 'reconexion', staleFlag: 'customerReconnectStale', completedMessage: 'Reconexión completada',
    clearToneOnPreview: true, errTone: false,
    states: ['completed', 'failed', 'uncertain'],
    confirmHint: 'Confirmá para mover el ticket, habilitar al cliente y restaurar MikroTik.',
    runningText: 'Ejecutando la reconexión…',
    stepRows: function (rows, executed, halted, ambiguousNames) {
      var ambiguous = (Array.isArray(ambiguousNames) ? ambiguousNames : []).filter(function (name) { return RECONNECT_OBJECTS.indexOf(name) !== -1; });
      var out = [];
      rows.forEach(function (row) {
        if (!row || !RECONNECT_STEP_LABELS[row.step]) { return; }
        var text = executed ? FLOW_STATUSES[row.status] : RECONNECT_PLAN[row.outcome];
        // A stopped preview never evaluated its skipped steps; do not claim they would be applied.
        if (!executed && halted && row.status === 'skipped') { text = 'no se evaluó'; }
        else if (!executed && halted && row.status === 'failed') { text = FLOW_STATUSES.failed; }
        if (ambiguous.indexOf(row.step) !== -1) { text = 'entradas duplicadas, no se escribe'; }
        out.push({label: RECONNECT_STEP_LABELS[row.step], text: text || (executed ? 'sin resultado informado' : 'se aplicaría'),
          tone: reconnectTone(row, executed, halted, ambiguous)});
      });
      return out;
    },
    blocked: function (data) {
      var text = FLOW_REASONS[data.reason] || 'No se puede ejecutar la reconexión.';
      var names = (Array.isArray(data.ambiguous) ? data.ambiguous : []).filter(function (name) { return RECONNECT_OBJECTS.indexOf(name) !== -1; });
      if (names.length) { text += ' Entradas duplicadas en: ' + names.join(', ') + '.'; }
      return {text: text, tone: data.reason === 'nothing_to_change' ? null : 'err'};
    },
    executed: function (data, ui) {
      ui.showSteps(data.steps, true, false, data.ambiguous);
      ui.summary(data.state === 'completed' ? 'Reconexión completada.' : data.state === 'uncertain' ? 'Resultado incierto: no repetir a ciegas. Revisá el estado real.' : 'Un paso falló: ' + (FLOW_REASONS[data.reason] || 'revisá el estado real') + ' No repetir sin revisar.',
        data.state === 'completed' ? 'ok' : 'err');
      ui.message.textContent = '';

    },
    unconfirmed: function (ui) {
      ui.summary('Resultado incierto: no repetir a ciegas. Revisá el estado real en ISPCube y MikroTik.', 'err');
      ui.message.textContent = '';

    }
  };
  var ENABLE_STEP_LABELS = {DETECT: 'Detección (ISPCube y MikroTik)', TICKET: 'Ticket de habilitación', UNBLOCK: 'Habilitar en ISPCube', RESTORE: 'Restaurar objetos de MikroTik', CLEANUP: 'Limpieza'};
  var enableCfg = {
    key: '_enable', prefix: 'enable', area: 'habilitar', staleFlag: 'customerEnableStale', completedMessage: 'Habilitación completada',
    clearToneOnPreview: false, errTone: true,
    states: ['completed', 'uncertain'],
    previewReadyLabel: 'Comprobaciones previas correctas',
    confirmHint: 'No se aplicó ningún cambio. Confirmá para ejecutar las acciones pendientes.',
    runningText: 'Ejecutando la habilitación…',
    stepRows: function (rows, executed) {
      var outcomes = {
        checked: 'Comprobación correcta', pending: 'Pendiente de confirmación',
        failed: 'Comprobación fallida', not_needed: 'No requiere cambios',
        attachment_pending: 'No se modificará: tiene adjuntos pendientes de revisión',
        already_done: 'Ya está en la categoría de verificación',
        not_checked: 'Sin comprobación completada'
      };
      var out = [];
      rows.forEach(function (row) {
        if (!row || !ENABLE_STEP_LABELS[row.step]) { return; }
        var text = FLOW_STATUSES[row.status] || 'sin resultado informado';
        var tone = statusTone(row.status);
        if (!executed) {
          text = outcomes[row.outcome] || outcomes.not_checked;
          tone = row.status === 'failed' ? 'err' : row.outcome === 'checked' ? 'ok' : 'muted';
          if (row.step === 'RESTORE' && row.outcome === 'checked') {
            text += '; restauración pendiente de confirmación';
          }
        }
        out.push({label: ENABLE_STEP_LABELS[row.step], text: text, tone: tone});
      });
      return out;
    },
    blocked: function (data) {
      var reasons = {
        ticket_check_failed: 'No se pudo comprobar el ticket; no se ejecuta.',
        preview_check_failed: 'Falló una comprobación previa; no se ejecuta.'
      };
      return {text: reasons[data.reason] || (data.reason && FLOW_REASONS[data.reason]) || 'Operación detenida. No se puede confirmar.', tone: 'err'};
    },
    executed: function (data, ui) {
      if (data.state === 'uncertain') {
        ui.showSteps(data.steps, true);
        ui.summary('Resultado incierto: no reintentar. Revisar manualmente la acción.', 'err');
        ui.message.textContent = '';
        return;
      }
      ui.showSteps(data.steps, true);
      ui.summary('Habilitación completada. Los datos guardados quedaron desactualizados.', 'ok');
      ui.message.textContent = '';

    },
    unconfirmed: function (ui) {
      ui.summary('Resultado no confirmado: el resultado puede ser parcial o incierto. Requiere revisión manual; no repetir.', 'err');
      ui.message.textContent = '';
    }
  };
  function reconnectController(dialog, root) { return makeAmountFlowController(dialog, root, reconnectCfg); }
  function enableController(dialog, root) { return makeAmountFlowController(dialog, root, enableCfg); }
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-cancellation-open], [data-reconnect-open], [data-enable-open], [data-history-open]');
    if (!trigger) { return; }
    var root = trigger.closest('#customer-body');
    if (!root) { return; }
    var dialog = root.querySelector(trigger.hasAttribute('data-history-open') ? '#ticket-history'
      : trigger.hasAttribute('data-reconnect-open') ? '#customer-reconnect'
      : trigger.hasAttribute('data-enable-open') ? '#customer-enable' : '#customer-cancellation');
    if (!dialog || dialog.open || typeof dialog.showModal !== 'function') { return; }
    event.preventDefault();
    if (trigger.hasAttribute('data-cancellation-open')) { cancellationController(dialog, root).open(trigger); }
    else if (trigger.hasAttribute('data-reconnect-open')) { reconnectController(dialog, root).open(trigger); }
    else if (trigger.hasAttribute('data-enable-open')) { enableController(dialog, root).open(trigger); }
    else {
      dialog.showModal();
      var search = dialog.querySelector('[data-history-search]');
      if (search) { search.click(); }
      dialog.querySelector('[data-modal-close]').focus();
      dialog.addEventListener('close', function () { if (trigger.isConnected) { trigger.focus(); } }, {once: true});
    }
  });

  // Overflow menu: outside click and Escape close it. While a dialog is open the
  // menu stays open, so closing the dialog can hand focus back to its item.
  function closeActionMenus(except) {
    document.querySelectorAll('[data-action-menu][open]').forEach(function (menu) {
      if (menu !== except) { menu.removeAttribute('open'); }
    });
  }
  document.addEventListener('click', function (event) {
    if (document.querySelector('dialog[open]') || event.target.closest('dialog')) { return; }
    closeActionMenus(event.target.closest('[data-action-menu]'));
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) { return; }
    var open = document.querySelector('[data-action-menu][open]');
    if (!open) { return; }
    open.removeAttribute('open');
    open.querySelector('summary').focus();
  });

  // Delegate from the document so a refreshed customer body needs no rebinding.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-ticket-filter]');
    var tickets = button && button.closest('#customer-tickets');
    if (!tickets) { return; }
    var mode = button.dataset.ticketFilter;
    if (mode !== 'open' && mode !== 'recent') { return; }
    var visible = 0;
    tickets.querySelectorAll('[data-ticket-state]').forEach(function (ticket) {
      // Recientes uses cache membership, never the open ticket's creation age.
      // Unknown rows remain in Abiertos unless closure is confirmed.
      var shown = mode === 'recent' || ticket.dataset.ticketState !== 'closed';
      ticket.hidden = !shown;
      if (shown) { visible += 1; }
    });
    tickets.querySelectorAll('[data-ticket-filter]').forEach(function (filter) {
      filter.setAttribute('aria-pressed', String(filter === button));
    });
    var empty = tickets.querySelector('[data-ticket-filter-empty]');
    if (empty) {
      // «Todos» with nothing visible means no tickets at all; the list's own
      // empty state owns that message.
      empty.hidden = visible > 0 || mode === 'all';
      empty.querySelectorAll('[data-ticket-empty]').forEach(function (copy) {
        copy.hidden = copy.dataset.ticketEmpty !== mode;
      });
    }
  });

  var ticketAgeTimer = null;
  function bindTicketAge(root) {
    if (ticketAgeTimer !== null) { clearInterval(ticketAgeTimer); ticketAgeTimer = null; }
    var status = root.querySelector('[data-ticket-age]');
    if (!status) { return; }
    function timestamp(raw) {
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw || '') ? Date.parse(raw) : NaN;
    }
    var opened = timestamp(status.dataset.ticketsOpenFetchedAt);
    var closed = timestamp(status.dataset.ticketsClosedFetchedAt);
    function updateAge() {
      if (!root.isConnected) {
        clearInterval(ticketAgeTimer);
        ticketAgeTimer = null;
        return;
      }
      var now = Date.now();
      var known = Number.isFinite(opened) && Number.isFinite(closed) && opened <= now && closed <= now;
      var seconds = Math.floor((now - Math.min(opened, closed)) / 1000);
      status.textContent = known ? 'Actualizado hace ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') : 'Sin actualización confirmada';
    }
    updateAge();
    ticketAgeTimer = setInterval(updateAge, 1000);
  }

  var customerAgeTimer = null;
  function bindCustomerAge(root) {
    if (customerAgeTimer !== null) { clearInterval(customerAgeTimer); }
    var status = root.querySelector('[data-customer-status]');
    // A fragment without the status notice must not abort the rest of the
    // script (the rail registry init runs later in this IIFE).
    if (!status) { return; }
    var raw = root.dataset.customerFetchedAt || '';
    // Require a timezone-bearing machine timestamp, never localized display text.
    var stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : NaN;
    var dot = status.parentElement ? status.parentElement.querySelector('.info-dot') : null;
    var visibleDetail = root.querySelector('[data-customer-freshness-detail]');
    function parts(ms) {
      var values = {};
      new Intl.DateTimeFormat('es-AR', {timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
        .formatToParts(new Date(ms)).forEach(function (part) { values[part.type] = part.value; });
      function p(value) { return value.padStart(2, '0'); }
      var clock = p(values.hour) + ':' + p(values.minute);
      return {clock: clock, local: p(values.day) + '/' + p(values.month) + ' ' + clock};
    }
    function updateAge() {
      if (!root.isConnected) {
        clearInterval(customerAgeTimer);
        customerAgeTimer = null;
        return;
      }
      if (root.dataset.customerBusy === 'true' || root.dataset.customerRefreshFailed === 'true') { return; }
      var time = Number.isFinite(stamp) ? parts(stamp) : null;
      var detail = time ? 'Última lectura confirmada el ' + time.local :
        'Última lectura confirmada no disponible.';
      if (root.dataset.customerCancellationStale === 'true' || root.dataset.customerReconnectStale === 'true' ||
          root.dataset.customerEnableStale === 'true') {
        status.textContent = 'Datos sin confirmar';
        status.classList.add('warn');
        detail = 'Datos guardados desactualizados: solicitá una lectura con Actualizar.';
      } else {
        var seconds = Math.floor((Date.now() - stamp) / 1000);
        var known = Number.isFinite(seconds) && seconds >= 0;
        var stale = !known || root.dataset.customerFresh !== 'true' || seconds >= 600;
        status.textContent = known && !stale ? 'Actualizado ' + time.clock : 'Datos sin confirmar';
        status.classList.toggle('warn', stale);
        if (known && stale) { detail += ' · Datos desactualizados: renová con Actualizar.'; }
        status.setAttribute('aria-label', status.textContent + (stale ? ' · Datos desactualizados' : ''));
      }
      status.setAttribute('title', detail);
      if (dot) { dot.setAttribute('title', detail); }
      if (visibleDetail) { visibleDetail.textContent = detail; }
    }
    updateAge();
    customerAgeTimer = setInterval(updateAge, 1000);
  }

  function customerProbeStatus(root, failed) {
    var technical = root.querySelector('[data-antenna-auto="true"]');
    var indicator = root.querySelector('[data-ping-indicator]');
    if (!technical || !indicator) { return; }
    indicator.dataset.pingState = failed ? 'error' : 'waiting';
    indicator.classList.remove('ok', 'err', 'warn');
    indicator.classList.add(failed ? 'err' : 'warn');
    indicator.textContent = failed ? 'error de consulta' :
      'esperando actualización del cliente…';
  }

  async function refreshCustomer(root, force, completedDialog) {
    if (!root || !root.isConnected || root.dataset.customerBusy === 'true' || (!force && root.dataset.customerRequested === 'true')) { return false; }
    if (completedDialog && (!completedDialog.isConnected || !completedDialog.open || !root.contains(completedDialog))) { return false; }
    root.dataset.customerBusy = 'true';
    root.dataset.customerRefreshFailed = 'false';
    root.dataset.customerRequested = 'true';
    var previousTechnical = root.querySelector('[data-antenna-auto]');
    if (previousTechnical && previousTechnical.pauseQueries) { previousTechnical.pauseQueries(); }
    customerProbeStatus(root, false);
    var status = root.querySelector('[data-customer-status]');
    var saved = status.textContent;
    status.textContent = 'Actualizando cliente desde ISPCube… · ' + saved;
    status.setAttribute('aria-label', status.textContent);
    try {
      var response = await fetch('/clientes/' + encodeURIComponent(root.dataset.customerCode) + '/actualizar' + (force ? '?force=1' : ''), {
        method: 'POST', credentials: 'same-origin', redirect: 'error', headers: {'HX-Request': 'true'}
      });
      if (!response.ok) { throw new Error('failed'); }
      var html = await response.text();
      if (/<!doctype|<\/?(?:html|head|body)\b/i.test(html)) { throw new Error('document'); }
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var nodes = Array.from(parsed.body.childNodes).filter(function (node) {
        return node.nodeType !== 3 || node.textContent.trim();
      });
      var body = nodes[0];
      if (nodes.length !== 1 || body.nodeType !== 1 || body.tagName !== 'DIV' ||
          body.id !== 'customer-body' || body.dataset.customerCode !== root.dataset.customerCode ||
          !['true', 'false'].includes(body.dataset.customerFresh) || parsed.head.childNodes.length ||
          body.querySelector('script, style, iframe, object, embed, base, link, meta, [data-customer-code]')) {
        throw new Error('invalid customer');
      }
      ['[data-customer-status]', '#client-info', '#new-ticket'].forEach(function (selector) {
        if (body.querySelectorAll(selector).length !== 1) { throw new Error('missing structure'); }
      });
      // Match the permission-shaped workspace already rendered for this session.
      // Missing permitted panels must not be mistaken for permission omissions.
      ['[data-customer-tabs]', '[data-antenna-auto]', '#cuenta'].concat(
        ['technical', 'wifi', 'account', 'contact'].reduce(function (selectors, name) {
          return selectors.concat('#customer-tab-' + name, '#customer-panel-' + name);
        }, [])
      ).forEach(function (selector) {
        var expected = root.querySelectorAll(selector).length;
        if (expected > 1 || body.querySelectorAll(selector).length !== expected) { throw new Error('missing structure'); }
      });
      var technical = body.querySelector('[data-antenna-auto]');
      var selector = technical && technical.querySelector('select');
      var cards = technical ? technical.querySelectorAll('.antenna-metrics') : [];
      var wifiOnly = !root.querySelector('#customer-panel-technical') && !!root.querySelector('#customer-panel-wifi');
      if (cards.length && !selector) { throw new Error('missing selection'); }
      var targets = Object.create(null);
      if (selector) {
        Array.from(selector.options).forEach(function (option) {
          if (!option.value) { return; }
          if (!/^\d+$/.test(option.value) || targets[option.value]) { throw new Error('invalid target'); }
          targets[option.value] = true;
        });
      }
      if (wifiOnly ? cards.length !== 0 : Object.keys(targets).length !== cards.length) { throw new Error('missing targets'); }
      cards.forEach(function (card) {
        var id = card.id.replace(/^antena-/, '');
        // A user without the refresh permission gets a card with no action buttons.
        var actionButtons = card.querySelectorAll('button[hx-post]').length;
        if (!targets[id] || card.id !== 'antena-' + id || (actionButtons !== 2 && actionButtons !== 0)) {
          throw new Error('invalid target card');
        }
        (actionButtons ? ['actualizar', 'ping'] : []).forEach(function (action) {
          var button = card.querySelector('button[hx-post="/antenas/' + id + '/' + action + '"]');
          if (!button || button.getAttribute('hx-target') !== '#antena-' + id ||
              button.getAttribute('hx-swap') !== 'outerHTML' || button.type !== 'button') { throw new Error('invalid action'); }
        });
      });
      var ids = Object.create(null);
      body.querySelectorAll('[id]').forEach(function (element) {
        if (ids[element.id] || element.id === body.id) { throw new Error('duplicate id'); }
        ids[element.id] = true;
      });
      body.querySelectorAll('*').forEach(function (element) {
        Array.from(element.attributes).forEach(function (attr) {
          if (/^on/i.test(attr.name) || /^(?:href|src|action)$/i.test(attr.name) && /^\s*(?:javascript|data):/i.test(attr.value)) {
            throw new Error('active content');
          }
        });
      });
      if (!root.isConnected || (completedDialog && (!completedDialog.isConnected || !completedDialog.open))) { return false; }
      if (completedDialog && body.dataset.customerFresh !== 'true') { throw new Error('unconfirmed customer'); }
      // Never replace another open or busy dialog, including dialogs outside the ficha.
      if (Array.from((completedDialog ? document : root).querySelectorAll('dialog[open], dialog[aria-busy="true"]')).some(function (dialog) { return dialog !== completedDialog; })) {
        status.textContent = saved;
        status.setAttribute('aria-label', saved);
        initAntenna(root.querySelector('[data-antenna-auto]'), true);
        return false;
      }
      var replacement = document.importNode(body, true);
      if (completedDialog) {
        var freshDialog = replacement.querySelector('#' + CSS.escape(completedDialog.id));
        if (!freshDialog || freshDialog.tagName !== 'DIALOG') { throw new Error('missing completed dialog'); }
        freshDialog.replaceWith(completedDialog);
      }
      replacement.dataset.customerRequested = 'true';
      // Read the current choice now, including changes made while refresh awaited.
      var previousSelection = root.querySelector('[data-antenna-auto] select');
      var newSelection = replacement.querySelector('[data-antenna-auto] select');
      if (newSelection) {
        var choice = previousSelection && previousSelection.value;
        var options = Array.from(newSelection.options).filter(function (option) { return option.value; });
        newSelection.value = targets[choice] ? choice : (options.length ? options[0].value : '');
      }
      // Capture at completion: the user may have changed tabs during the fetch.
      var selectedTab = root.querySelector('[data-customer-tabs] [role="tab"][aria-selected="true"]');
      var focusedTab = root.querySelector('[data-customer-tabs] [role="tab"]:focus');
      carryWifiState(root, replacement);
      carryWifiPanels(root.querySelector('[data-router-wifi]'), replacement.querySelector('[data-router-wifi]'));
      root.replaceWith(replacement);
      initCustomerTabs(replacement, selectedTab && selectedTab.id, !!focusedTab);
      bindCustomerAge(replacement);
      bindTicketAge(replacement);
      syncTicketPairingIn(replacement);
      if (window.htmx) { window.htmx.process(replacement); }
      initAntenna(replacement.querySelector('[data-antenna-auto]'), true);
      // The rail dot and debt come from the fresh body's data attributes.
      registerOpenClient();
      renderRail();
      return true;
    } catch (error) {
      if (!root.isConnected) { return false; }
      root.dataset.customerRefreshFailed = 'true';
      status.textContent = 'Datos guardados / no se pudo actualizar; pueden estar desactualizados. ' +
        (root.querySelector('[data-antenna-auto="true"]') ? 'Consulta automática de antena detenida. ' : '') +
        'Usá Actualizar para reintentar. · ' + saved;
      status.classList.toggle('warn', true);
      status.setAttribute('aria-label', status.textContent);
      initAntenna(root.querySelector('[data-antenna-auto]'), true);
      customerProbeStatus(root, true);
      return false;
    } finally {
      root.dataset.customerBusy = 'false';
    }
  }
  /* ── Cuenta statement skeleton (N3) ───────────────────────────────────
     The fixed-height placeholder replaces the stale statement while the
     POST runs — fewer layout jumps than a spinner; every swap or failure
     path restores the content area and its aria-busy state. */
  function setCuentaSkeleton(pending) {
    var area = document.getElementById('cuenta');
    var skeleton = document.getElementById('cuenta-skeleton');
    if (!area || !skeleton) { return; }
    skeleton.hidden = !pending;
    area.hidden = pending;
    area.setAttribute('aria-busy', String(pending));
  }
  function isAccountAction(elt) {
    return Boolean(elt && elt.matches && elt.matches('[data-customer-account-action]'));
  }
  function accountFeedback(action) {
    var account = action && action.closest('#customer-account');
    return account && account.querySelector('[data-account-feedback]');
  }
  // Tab activation invokes action.click(); after an error only the operator's
  // direct activation of the account button may retry the request.
  document.addEventListener('click', function (event) {
    var action = event.target.closest('[data-customer-account-action]');
    var feedback = accountFeedback(action);
    if (action && feedback && feedback.dataset.failed === 'true' && !event.isTrusted) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('htmx:beforeRequest', function (event) {
    var action = event.detail && event.detail.elt;
    if (isAccountAction(action)) {
      var feedback = accountFeedback(action);
      if (feedback) { feedback.textContent = 'Consultando cuenta corriente…'; feedback.dataset.failed = 'false'; }
      setCuentaSkeleton(true);
    }
  });
  document.addEventListener('htmx:afterSwap', function (event) {
    if (event.target && event.target.id === 'cuenta') {
      setCuentaSkeleton(false);
      var action = event.detail && event.detail.requestConfig && event.detail.requestConfig.elt;
      var feedback = isAccountAction(action) && accountFeedback(action);
      if (feedback) { feedback.textContent = ''; feedback.dataset.failed = 'false'; }
    }
  });
  function accountRequestFailed(event) {
    var action = event.detail && event.detail.elt;
    if (!isAccountAction(action)) { return; }
    setCuentaSkeleton(false);
    var feedback = accountFeedback(action);
    if (feedback) {
      feedback.dataset.failed = 'true';
      feedback.textContent = 'No se pudo consultar la cuenta corriente. Se conservan los datos anteriores; pueden estar desactualizados. Para reintentar, elegí Ver cuenta corriente.';
    }
  }
  document.addEventListener('htmx:responseError', accountRequestFailed);
  document.addEventListener('htmx:sendError', accountRequestFailed);
  document.addEventListener('htmx:timeout', accountRequestFailed);
  /* ── Ticket subcategory ⇄ area pairing ────────────────────────────────
     The pairing is owned by ISPCube (its category catalog), so the form never
     offers a combination the server would rewrite anyway: every subcategory
     option carries the area it belongs to as `data-ticket-area`. Picking a
     subcategory moves the area; picking an area leaves only its own
     subcategories (plus the ones the catalog leaves without an area, which
     stay free). The server re-applies the same rule on every write. */

  panel.wifi.initWifiViews();

  function restrictTicketCategories(area, category) {
    if (!area || !category) { return; }
    var first = null;
    Array.prototype.forEach.call(category.options, function (option) {
      var own = option.dataset.ticketArea || '';
      var allowed = own === '' || own === area.value;
      option.hidden = !allowed;
      option.disabled = !allowed;
      if (allowed && !first) { first = option; }
    });
    var current = category.options[category.selectedIndex];
    if ((!current || current.hidden) && first) { category.value = first.value; }
  }

  function pairTicketArea(category) {
    var area = category.form && category.form.querySelector('select[name="ticket_area_id"]');
    if (!area) { return; }
    var selected = category.options[category.selectedIndex];
    var mapped = selected && selected.dataset.ticketArea;
    if (mapped) {
      Array.prototype.forEach.call(area.options, function (option) {
        if (option.value === mapped) { area.value = mapped; }
      });
    }
    restrictTicketCategories(area, category);
  }

  function bindTicketPairing(category) {
    if (!category || category.tagName !== 'SELECT' || category.dataset.ticketPairBound === 'true') { return; }
    var area = category.form && category.form.querySelector('select[name="ticket_area_id"]');
    if (!area) { return; }
    category.dataset.ticketPairBound = 'true';
    category.addEventListener('change', function () { pairTicketArea(category); });
    if (area.dataset.ticketPairBound !== 'true') {
      area.dataset.ticketPairBound = 'true';
      area.addEventListener('change', function () { restrictTicketCategories(area, category); });
    }
    pairTicketArea(category);
  }

  function matchingIn(root, selector) {
    if (!root || !root.querySelectorAll) { return []; }
    var nodes = root.matches && root.matches(selector) ? [root] : [];
    return nodes.concat(Array.from(root.querySelectorAll(selector)));
  }
  function syncTicketPairingIn(root) {
    if (!root || !root.querySelectorAll) { return; }
    // Leaf swaps cannot contain forms, and an already-bound select is inert.
    if (root !== document && !root.children.length &&
        !(root.matches && root.matches('select[name="ticket_category_id"]'))) { return; }
    matchingIn(root, 'select[name="ticket_category_id"]:not([data-ticket-pair-bound="true"])').forEach(bindTicketPairing);
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href="#customer-contact"], a[href="#customer-account"], a[href="#cuenta"]');
    if (link) {
      event.preventDefault();
      history.pushState(null, '', link.getAttribute('href'));
      activateCurrentCustomerTab(link.getAttribute('href'));
    }
  });
  window.addEventListener('hashchange', function () { activateCurrentCustomerTab(window.location.hash); });
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-customer-refresh]');
    if (!button) { return; }
    var root = button.closest('#customer-body[data-customer-code]');
    if (root) { refreshCustomer(root, true); }
  });
  // Only customer airOS timestamps are localized; replacement cards are also
  // formatted after the antenna controller swaps them into the customer body.
  if (document.body && document.body.classList.contains('client-detail')) {
    function formatCustomerAntennaTimes(root) {
      var nodes = root.matches && root.matches('[data-customer-antenna-time]') ? [root] : [];
      if (root.querySelectorAll) { nodes = nodes.concat(Array.from(root.querySelectorAll('[data-customer-antenna-time]'))); }
      nodes.forEach(function (node) {
        var raw = node.getAttribute('datetime') || '';
        var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(raw);
        var validDate = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 &&
          Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() &&
          Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59;
        var stamp = validDate ? Date.parse(raw) : NaN;
        if (!Number.isFinite(stamp)) { node.textContent = 'sin datos'; return; }
        var parts = {};
        new Intl.DateTimeFormat('es-AR', {timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'})
          .formatToParts(new Date(stamp)).forEach(function (part) { parts[part.type] = part.value; });
        function pad(value) { return value.padStart(2, '0'); }
        node.textContent = parts.year + '-' + pad(parts.month) + '-' + pad(parts.day) + ' ' + pad(parts.hour) + ':' + pad(parts.minute);
      });
    }
    formatCustomerAntennaTimes(document.getElementById('customer-body') || document.body);
    new MutationObserver(function (changes) {
      changes.forEach(function (change) { change.addedNodes.forEach(function (node) {
        if (node.nodeType === 1 && node.closest('#customer-body')) { formatCustomerAntennaTimes(node); }
      }); });
    }).observe(document.body, {childList:true, subtree:true});
  }
  var customerRoot = document.querySelector('#customer-body[data-customer-code]');
  if (customerRoot) { initCustomerTabs(customerRoot); bindCustomerAge(customerRoot); bindTicketAge(customerRoot); relativeTicketDatesIn(customerRoot);
    // A fresh stored detail makes the page-load POST a no-op re-render: skip it and start the antenna lane directly.
    if (customerRoot.dataset.customerAutoRefresh === '0') {
      customerRoot.dataset.customerRequested = 'true';
      initAntenna(customerRoot.querySelector('[data-antenna-auto]'), true);
    } else { refreshCustomer(customerRoot); } }
  else { initAntenna(document.querySelector('[data-antenna-auto]'), true); }

  /* clipboard.writeText needs a secure context; plain-HTTP origins fall back to
     a hidden textarea + execCommand('copy'). */
  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.left = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      area.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function writeText(text) {
    if (navigator.clipboard && (window.isSecureContext || window.location.protocol === "https:")) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* The value lives on the row (`[data-copy]`); a `.btn-copy` is a bare
     trigger. A trigger that carries its own `data-copy` still works, and
     `data-copy-block="#selector"` copies every `[data-copy]` inside it as
     "Label: value" lines, in document order. */
  function blockText(selector) {
    var root = document.querySelector(selector);
    if (!root) { return ""; }
    var nodes = root.querySelectorAll('[data-copy]');
    if (selector === '#client-info' && root.closest('#customer-body')) {
      nodes = root.closest('#customer-body').querySelectorAll('[data-copy]');
    }
    var lines = [];
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].getAttribute("data-copy");
      if (!value) { continue; }
      var label = nodes[i].getAttribute("data-copy-label");
      lines.push(label ? label + ": " + value : value);
    }
    return lines.join("\n");
  }

  /* Resolve the text for one click: the trigger's own value first, then the
     nearest `[data-copy]` ancestor (the value usually lives on the row). */
  function triggerText(trigger) {
    if (trigger.hasAttribute("data-copy-block")) {
      return blockText(trigger.getAttribute("data-copy-block"));
    }
    if (trigger.hasAttribute("data-copy")) {
      return trigger.getAttribute("data-copy");
    }
    var source = trigger.closest("[data-copy]");
    return source ? source.getAttribute("data-copy") : "";
  }

  /* Flip the button label (never color alone) and always restore it. */
  function flash(button, ok) {
    if (!button) { return; }
    if (button.hasAttribute('data-copy-icon')) {
      // Keep the SVG nodes intact; only the accessible feedback changes.
      if (!button.copyFeedback) {
        button.copyFeedback = {
          label: button.getAttribute('aria-label'),
          title: button.getAttribute('title') || button.getAttribute('data-tip') || button.getAttribute('aria-label')
        };
      }
      window.clearTimeout(button.copyFeedback.timer);
      var saved = button.copyFeedback;
      var message = saved.label + ': ' + (ok ? 'copiado' : 'no se pudo');
      button.setAttribute('aria-label', message);
      button.setAttribute('title', message);
      button.classList.toggle('copied', ok);
      button.classList.toggle('copy-failed', !ok);
      var root = button.closest('#customer-body');
      if (root) {
        var status = root.querySelector('[data-copy-status]');
        if (!status) {
          status = document.createElement('span');
          status.setAttribute('data-copy-status', '');
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
          status.className = 'customer-copy-status';
          root.appendChild(status);
        }
        status.textContent = message;
      }
      saved.timer = window.setTimeout(function () {
        button.classList.remove('copied', 'copy-failed');
        button.setAttribute('aria-label', saved.label);
        button.setAttribute('title', saved.title);
        if (status && status.textContent === message) { status.textContent = ''; }
      }, FLASH_MS);
      return;
    }
    if (button.getAttribute("data-copy-original") === null) {
      button.setAttribute("data-copy-original", button.textContent);
    }
    var original = button.getAttribute("data-copy-original");
    button.classList.toggle("copied", ok);
    button.classList.toggle("copy-failed", !ok);
    button.textContent = ok ? "copiado" : "no se pudo";
    window.setTimeout(function () {
      button.classList.remove("copied", "copy-failed");
      button.textContent = original;
    }, FLASH_MS);
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") { return; }
    var composeLink = target.closest('a[href="#new-ticket"], a[data-installation-booking]');
    if (composeLink) {
      var compose = document.getElementById(composeLink.hasAttribute('data-installation-booking') ? 'installation-booking' : 'new-ticket');
      if (compose) {
        event.preventDefault();
        if (typeof compose.showModal === "function") {
          if (!compose.open) { compose.showModal(); }
        } else {
          compose.open = true;
        }
        composeLink.setAttribute("aria-expanded", "true");
        // Focus follows the fields, never the header close button.
        var firstControl = compose.querySelector(".modal-body input, .modal-body select, .modal-body textarea, .modal-body button");
        if (firstControl) { firstControl.focus(); }
      }
    }
    var rowLink = target.closest("tr.row-link[data-ticket-open]");
    var anchorHit = target.closest("a[href]");
    if (rowLink && anchorHit && rowLink.contains(anchorHit)) {
      // The first-cell anchor keeps its default navigation (keyboard/no-JS fallback):
      // do not open the modal and do not let the row marker below fire for it.
      rowLink = null;
    } else if (rowLink) {
      event.preventDefault();
      var rowAnchor = rowLink.querySelector("a[href]");
      if (rowAnchor) {
        var detailUrl = rowAnchor.getAttribute("href").replace(/^(\/tickets\/\d+)\/?$/, "$1/detalle");
        if (window.htmx && detailUrl !== rowAnchor.getAttribute("href")) {
          window.htmx.ajax("GET", detailUrl, "#ticket-detail-body");
        }
      }
      var detailRow = document.getElementById("ticket-detail");
      if (detailRow && typeof detailRow.showModal === "function" && !detailRow.open) { detailRow.showModal(); }
      return;
    }
    var detailLink = rowLink || target.closest("[data-ticket-open]");
    if (detailLink) {
      var detail = document.getElementById("ticket-detail");
      if (detail && typeof detail.showModal === "function" && !detail.open) { detail.showModal(); }
    }
    var closeLink = target.closest("[data-modal-close]");
    if (closeLink) {
      var owner = closeLink.closest("dialog");
      if (owner) { owner.close(); }
    }
    // Backdrop clicks land on the dialog element itself, never on its children.
    // Only read-only modals opt in: a form modal must not lose typed input.
    if (target.tagName === "DIALOG" && target.classList.contains("modal") && target.hasAttribute("data-backdrop-close")) {
      target.close();
    }
    var searchTrigger = target.closest("[data-client-search]");
    if (searchTrigger) {
      event.preventDefault();
      var searchDialog = document.getElementById("client-search");
      if (searchDialog) {
        if (typeof searchDialog.showModal === "function") {
          if (!searchDialog.open) { searchDialog.showModal(); }
        } else {
          searchDialog.open = true;
        }
        document.querySelectorAll('[aria-controls="client-search"]').forEach(function (el) {
          el.setAttribute("aria-expanded", "true");
        });
        var searchInput = searchDialog.querySelector("input[type='search']");
        if (searchInput) { searchInput.focus(); }
      }
    }
    var filterChip = target.closest("[data-search-filter]");
    if (filterChip && filterChip.parentElement) {
      filterChip.parentElement.querySelectorAll("[data-search-filter]").forEach(function (chip) {
        chip.classList.toggle("active", chip === filterChip);
        chip.setAttribute("aria-pressed", String(chip === filterChip));
      });
      applySearchFilter();
    }
    var railToggle = target.closest("[data-rail-toggle]");
    if (railToggle) {
      var railRoot = document.documentElement;
      var railWillClose = railRoot.getAttribute("data-rail") !== "closed";
      railRoot.setAttribute("data-rail", railWillClose ? "closed" : "open");
      try { localStorage.setItem("rm.rail", railWillClose ? "closed" : "open"); } catch (e) { /* storage unavailable */ }
      railToggle.setAttribute("aria-expanded", String(!railWillClose));
      railToggle.setAttribute("aria-label", railWillClose ? "Desplegar panel lateral" : "Plegar panel lateral");
      railToggle.textContent = railWillClose ? "›" : "‹";
    }
    // Pin button on the search-modal rows: an explicit add to the open
    // clients rail without navigating anywhere.
    var pin = target.closest("[data-add-open-client]");
    if (pin) {
      var pinRow = pin.closest(".search-row");
      var extras = null;
      if (pinRow) {
        extras = {
          status: pinRow.getAttribute("data-status") || "",
          debt: pinRow.getAttribute("data-debt") || ""
        };
      }
      addOpenClient(pin.getAttribute("data-customer-code"), pin.getAttribute("data-customer-name"), extras);
      renderRail();
      showStatusToast("Agregado a clientes abiertos", true);
    }
    var trigger = target.closest("[data-copy-block], .btn-copy");
    if (!trigger) {
      // Click-to-copy: any value carrying `data-copy` copies itself, unless the
      // click was on an interactive control or ended a text selection.
      var source = target.closest("[data-copy]");
      if (!source || target.closest("a, button, input, select, textarea, label")) { return; }
      var selection = window.getSelection && window.getSelection();
      if (selection && String(selection).length) { return; }
      var value = source.getAttribute("data-copy");
      if (!value) { return; }
      writeText(value).then(showCopyToast);
      return;
    }
    var text = triggerText(trigger);
    if (!text) { return; }
    writeText(text).then(function (ok) {
      flash(trigger, ok);
      showCopyToast(ok);
    });
  });

  /* Icon-only buttons get an instant CSS tooltip: swap the slow native `title`
     for `data-tip` on first hover/focus (aria-label keeps the accessible name). */
  function swapTitleForTip(event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") { return; }
    var button = target.closest(".quick-actions > .btn[title]");
    if (!button) { return; }
    button.setAttribute("data-tip", button.getAttribute("title"));
    button.removeAttribute("title");
  }
  document.addEventListener("mouseover", swapTitleForTip);
  document.addEventListener("focusin", swapTitleForTip);

  /* Transient confirmation for copies and admin results; role=status keeps it announced. */
  var statusToastTimer = null;
  function showStatusToast(text, ok, duration) {
    var toast = document.querySelector(".status-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "status-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.toggle("is-error", !ok);
    toast.classList.add("is-visible");
    window.clearTimeout(statusToastTimer);
    statusToastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, duration || 1600);
  }

  // The caller has already confirmed the write. A failed read must never retry it.
  panel.actions = {
    refreshCustomer: function (root, completedDialog) { return refreshCustomer(root, true, completedDialog); },
    toast: function (text, ok) { showStatusToast(text, ok !== false, 4500); },
    finish: async function (dialog, options) {
      try {
        if (options.refresh && await options.refresh() === false) { throw new Error('refresh failed'); }
      } catch (_) {
        var result = options.result;
        if (!result) {
          result = document.createElement('div');
          (dialog.querySelector('.modal-body') || dialog).appendChild(result);
          options.result = result;
        }
        result.setAttribute('role', 'status');
        result.textContent = options.message + '. No se pudo actualizar la información mostrada. No repitas la acción; actualizá los datos.';
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn';
        retry.textContent = 'Actualizar datos';
        retry.addEventListener('click', function () {
          retry.disabled = true;
          panel.actions.finish(dialog, options);
        });
        result.appendChild(retry);
        return false;
      }
      if (dialog.open) { dialog.close(); }
      panel.actions.toast(options.message, true);
      if (options.afterSuccess) { options.afterSuccess(); }
      return true;
    }
  };

  function showCopyToast(ok) {
    showStatusToast(ok ? "Copiado al portapapeles" : "No se pudo copiar", ok);
  }

  /* ── New-ticket compose result (M10) ─────────────────────────────────
     Success: the server fragment confirms with “Ticket #N creado.” — close
     the dialog, announce it and refresh the rail fragment in place.
     The warn path renders a warning notice on purpose: the dialog stays open
     so the user reads what did not refresh. A failure banner changes nothing. */
  function refreshCustomerTicketRail(forceRead) {
    var root = document.querySelector("aside.customer-ticket-rail");
    var form = document.querySelector('#new-ticket form[hx-post]');
    var match = form && /^\/clientes\/([^/]+)\/ticket$/.exec(form.getAttribute('hx-post') || '');
    if (!root) { return Promise.resolve(true); }
    if (!match) { return Promise.reject(new Error('missing ticket form')); }
    var refreshButton = root.querySelector('[data-tickets-refresh]');
    if (forceRead && !refreshButton) { return Promise.reject(new Error('ticket refresh unavailable')); }
    var url = forceRead ? refreshButton.dataset.ticketsRefreshUrl + '?force=1' : '/clientes/' + match[1] + '/tickets-rail';
    return fetch(url, {method: forceRead ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error'})
      .then(function (response) { if (!response.ok) { throw new Error('rail ' + response.status); } return response.text(); })
      .then(function (html) { if (!root.isConnected) { throw new Error('detached rail'); } swapCustomerTicketRail(root, html, true); return true; });
  }

  function swapCustomerTicketRail(root, html, rejectStale) {
    if (!root.isConnected) { return; }
    var template = document.createElement('template');
    template.innerHTML = html;
    var fresh = template.content.firstElementChild;
    if (!fresh || !fresh.classList.contains('customer-ticket-rail') || (rejectStale && fresh.querySelector('.notice.warn'))) { throw new Error('invalid rail fragment'); }
    var replacement = document.importNode(fresh, true);
    root.replaceWith(replacement);
    bindTicketAge(replacement);
    if (window.htmx) { window.htmx.process(replacement); }
    relativeTicketDatesIn(replacement);
  }

  /* On-demand "Actualizar tickets": the server refreshes both full lists (or
     skips it when they are < 30 s old) and answers with the rail fragment. */
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-tickets-refresh]');
    if (!button || button.getAttribute('aria-busy') === 'true') { return; }
    var root = button.closest('aside.customer-ticket-rail');
    if (!root) { return; }
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    fetch(button.dataset.ticketsRefreshUrl, {method: 'POST', credentials: 'same-origin', redirect: 'error', headers: {'HX-Request': 'true'}})
      .then(function (response) { if (!response.ok) { throw new Error('rail ' + response.status); } return response.text(); })
      .then(function (html) { swapCustomerTicketRail(root, html); })
      .catch(function () {
        button.removeAttribute('aria-busy');
        button.disabled = false;
        showStatusToast('No se pudo actualizar los tickets', false);
      });
  });

  async function refreshCompletedCustomer(root, dialog) {
    if (!dialog.isConnected || !dialog.open || !root.isConnected) { return false; }
    await refreshCustomerTicketRail(true);
    return panel.actions.refreshCustomer(root, dialog);
  }

  function ticketRequestFailed(event) {
    var dialog = event.target.closest && event.target.closest('#new-ticket');
    if (!dialog) { return; }
    var status = event.detail && event.detail.xhr ? event.detail.xhr.status : 0;
    var uncertain = !status || status >= 500;
    var result = dialog.querySelector('#ticket-result');
    if (result) {
      result.setAttribute('role', 'status');
      result.textContent = uncertain ? 'Creación de ticket no confirmada: el resultado puede ser incierto. No repitas el envío sin revisar los tickets actuales.'
        : status === 401 ? 'Tu sesión venció. Iniciá sesión de nuevo antes de crear el ticket.'
        : 'No se pudo crear el ticket. Revisá los datos y los permisos.';
    }
    if (uncertain) {
      dialog.dataset.ticketCompleted = 'true';
      var submit = dialog.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; }
    }
  }
  ['htmx:sendError', 'htmx:timeout', 'htmx:sendAbort', 'htmx:responseError'].forEach(function (name) {
    document.addEventListener(name, ticketRequestFailed);
  });
  document.addEventListener('submit', function (event) {
    if (event.target.closest('#new-ticket[data-ticket-completed="true"]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('htmx:beforeRequest', function (event) {
    if (event.target.closest && event.target.closest('#new-ticket[data-ticket-completed="true"]')) { event.preventDefault(); }
  });
  document.addEventListener('htmx:afterRequest', function (event) {
    var dialog = event.target.closest && event.target.closest('#new-ticket[data-ticket-completed="true"]');
    var submit = dialog && dialog.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; }
  });
  document.addEventListener('htmx:afterSwap', function (event) {
    if (!event.target || event.target.id !== 'ticket-result') { return; }
    var okNotice = event.target.querySelector('.notice.ok');
    if (!okNotice) { return; }
    var dialog = event.target.closest('#new-ticket');
    if (!dialog || !dialog.open || dialog.dataset.ticketCompleted === 'true') { return; }
    dialog.dataset.ticketCompleted = 'true';
    var submit = dialog.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; }
    var message = okNotice.textContent.trim();
    var stale = !!event.target.querySelector('.notice.warn');
    var firstRead = true;
    panel.actions.finish(dialog, {message: message, result: completionResult(event.target), refresh: function () {
      if (stale && firstRead) { firstRead = false; return false; }
      return refreshCustomerTicketRail(stale);
    }, afterSuccess: function () {
      var form = dialog.querySelector('form');
      form.reset();
      delete dialog.dataset.ticketCompleted;
      event.target.replaceChildren();
      if (submit) { submit.disabled = false; }
    }});
  });


  // `close` does not bubble; capture keeps every trigger's aria state honest
  // for Esc, the close button and backdrop clicks alike.
  document.addEventListener("close", function (event) {
    var dialog = event.target;
    if (!dialog || dialog.tagName !== "DIALOG") { return; }
    document.querySelectorAll('[aria-controls="' + dialog.id + '"]').forEach(function (el) {
      el.setAttribute("aria-expanded", "false");
    });
  }, true);

  var applySearchFilter = panel.initSearch();

  document.addEventListener("htmx:afterSwap", function (event) {
    if (event.target && event.target.id === "client-search-results") {
      applySearchFilter();
    }
    if (event.target && event.target.querySelectorAll && event.target.children.length) {
      syncTicketPairingIn(event.target);
      relativeTicketDatesIn(event.target);
      matchingIn(event.target, '[data-router-wifi]:not([data-wifi-band-view])').forEach(function (card) {
        applyWifiView(card, savedWifiView());
      });
    }
  });

  /* ── In-card admin feedback (B-001/B-002) ─────────────────────────────
     A 401 (session expired) or 403 (missing permission, or a stale form token)
     would otherwise die silently inside the card; surface it as a status notice. */
  document.addEventListener("htmx:responseError", function (event) {
    var status = event.detail && event.detail.xhr ? event.detail.xhr.status : 0;
    if (status !== 401 && status !== 403) return;
    var elt = event.target;
    var card = elt && elt.closest ? elt.closest(".antenna-metrics") : null;
    if (!card) return;
    var notice = card.querySelector("[data-admin-error]");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "notice";
      notice.setAttribute("data-admin-error", "");
      notice.setAttribute("role", "status");
      card.appendChild(notice);
    }
    var body = event.detail.xhr.responseText || "";
    var message = status === 401
      ? "Tu sesión venció. Iniciá sesión de nuevo para guardar este cambio."
      : body.indexOf("Permiso requerido") !== -1
        ? "No tenés permiso para esta acción."
        : "No se pudo guardar: token de formulario vencido o inválido. Recargá la ficha e intentá de nuevo.";
    notice.textContent = message;
    /* N5: same feedback on the unified toast channel; details stay in place. */
    showStatusToast(message, false);
  });

  var rail = panel.initOpenClients();
  registerOpenClient = rail.registerOpenClient;
  renderRail = rail.renderRail;
  addOpenClient = rail.addOpenClient;
  syncTicketPairingIn(document);
  var railToggleInit = document.querySelector("[data-rail-toggle]");
  if (railToggleInit) {
    var railOpen = document.documentElement.getAttribute("data-rail") !== "closed";
    railToggleInit.setAttribute("aria-expanded", String(railOpen));
    railToggleInit.setAttribute("aria-label", railOpen ? "Plegar panel lateral" : "Desplegar panel lateral");
    railToggleInit.textContent = railOpen ? "‹" : "›";
  }

  // The native file control is localised by the browser, not the page: replace its
  // visible part with a Spanish button and keep the real input for forms and validation.
  function enhanceFilePickers(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') { return; }
    scope.querySelectorAll('input[type="file"]:not([data-file-picker])').forEach(function (input) {
      input.setAttribute('data-file-picker', '');
      input.classList.add('file-native');
      var wrap = document.createElement('span');
      wrap.className = 'file-picker';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost';
      button.textContent = 'Elegir archivo';
      var name = document.createElement('span');
      name.className = 'file-picker-name muted';
      name.textContent = 'Ningún archivo seleccionado';
      button.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        name.textContent = input.files && input.files.length ? input.files[0].name : 'Ningún archivo seleccionado';
      });
      wrap.appendChild(button);
      wrap.appendChild(name);
      input.insertAdjacentElement('afterend', wrap);
    });
  }
  enhanceFilePickers(document);
  if (document.body) { document.body.addEventListener('htmx:afterSettle', function (event) { enhanceFilePickers(event.target || document); }); }
})();
