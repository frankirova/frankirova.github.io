/* Shared engine of the operational list pages (bajas, suspensions, disconnections).

   ListRun.inlineEdits(root): rows marked [data-list-row] with data-note-url / data-remove-url get notes that
   save themselves and an inline "remove" confirmation; the row folds away and the totals follow.
   ListRun.runDialog(dialog, module): the stepped run dialog (setup → checking → confirm → queued → running → done)
   that reviews without writing, confirms inside the dialog and follows the worker live through data-status-url.
   Each page supplies only what differs: how to review, which fields to send and how to word the outcome. */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function wait(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, reduceMotion ? 0 : ms); }); }
  function money(value) {
    return new Intl.NumberFormat('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value).replace(/,00$/, '');
  }
  // Same-origin form POST; JSON errors carry `detail`, and a followed redirect counts as success.
  async function post(url, fields) {
    var data = new FormData();
    Object.entries(fields || {}).forEach(function (entry) {
      [].concat(entry[1]).forEach(function (value) { data.append(entry[0], value); });
    });
    var response = await fetch(url, {method: 'POST', body: data});
    if (response.redirected && response.ok) { return {location: response.url}; }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { throw new Error(body.detail || 'No se pudo completar'); }
    return body;
  }

  function inlineEdits(root) {
    var error = root.querySelector('[data-draft-error]');
    function report(message) { if (error) { error.textContent = message || ''; } }

    // Notes save themselves: shortly after typing stops, on leaving the field, or with Ctrl+Enter.
    var saving = new Set();
    function grow(area) { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; }
    function noteState(row, text, kind) {
      var state = row.querySelector('[data-note-state]');
      state.textContent = text; state.dataset.kind = kind || '';
    }
    function saveNote(area) {
      if (area.dataset.saved === area.value) { return Promise.resolve(); }
      var row = area.closest('[data-list-row]'), value = area.value;
      window.clearTimeout(area.saveTimer);
      noteState(row, 'Guardando…', 'busy');
      var request = post(row.dataset.noteUrl, {notes: value}).then(function () {
        area.dataset.saved = value;
        if (area.value === value) {
          noteState(row, 'Guardado', 'ok');
          window.setTimeout(function () { if (area.dataset.saved === area.value) { noteState(row, '', ''); } }, 1800);
        }
      }, function (failure) {
        noteState(row, 'No se guardó', 'err');
        report(failure.message);
        throw failure;
      });
      saving.add(request);
      request.catch(function () {}).then(function () { saving.delete(request); });
      return request;
    }
    root.querySelectorAll('[data-draft-notes]').forEach(function (area) {
      area.dataset.saved = area.value; grow(area);
      area.addEventListener('input', function () {
        grow(area);
        noteState(area.closest('[data-list-row]'), area.value === area.dataset.saved ? '' : 'Sin guardar', 'dirty');
        window.clearTimeout(area.saveTimer);
        area.saveTimer = window.setTimeout(function () { saveNote(area).catch(function () {}); }, 1200);
      });
      area.addEventListener('blur', function () { saveNote(area).catch(function () {}); });
      area.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveNote(area).catch(function () {}); }
      });
    });

    // Removing a row asks inline, then the row folds away and the count, balance and positions follow.
    function rows() { return Array.from(root.querySelectorAll('[data-list-row]')); }
    function sumBalances() {
      return rows().reduce(function (total, row) { return total + (row.dataset.balance === '' ? NaN : Number(row.dataset.balance)); }, 0);
    }
    function removed(row) {
      var count = root.querySelector('[data-stat-count]'), balance = root.querySelector('[data-stat-balance]');
      var left = Number(count.textContent) - 1, amount = Number(row.dataset.balance);
      count.textContent = String(left);
      if (balance) {
        if (balance.dataset.total === undefined) { balance.dataset.total = String(sumBalances()); }
        if (row.dataset.balance !== '' && !isNaN(amount) && balance.dataset.total !== 'NaN') {
          balance.dataset.total = String(Number(balance.dataset.total) - amount);
          balance.textContent = money(Number(balance.dataset.total));
        }
      }
      var body = row.parentNode, columns = row.children.length;
      row.remove();
      var rest = rows(), first = rest.length ? Number(rest[0].querySelector('.list-pos').textContent) : 1;
      rest.forEach(function (other, index) { other.querySelector('.list-pos').textContent = String(first + index); });
      document.querySelectorAll('[data-count]').forEach(function (node) { node.dataset.count = String(left); });
      if (!left) {
        body.innerHTML = '<tr><td class="empty"></td></tr>';
        body.querySelector('td').colSpan = columns;
        body.querySelector('td').textContent = root.dataset.emptyText || 'La lista está vacía.';
        var open = root.querySelector('[data-run-open]');
        if (open) { open.remove(); }
      }
    }
    root.addEventListener('click', async function (event) {
      var row = event.target.closest('[data-list-row]');
      if (!row || !row.querySelector('[data-remove-confirm]')) { return; }
      var ask = row.querySelector('[data-remove-confirm]'), trash = row.querySelector('[data-draft-remove]');
      if (event.target.closest('[data-draft-remove]')) {
        trash.hidden = true; ask.hidden = false; row.classList.add('is-asking'); ask.querySelector('[data-remove-yes]').focus();
      } else if (event.target.closest('[data-remove-no]')) {
        ask.hidden = true; trash.hidden = false; row.classList.remove('is-asking'); trash.focus();
      } else if (event.target.closest('[data-remove-yes]')) {
        var yes = event.target.closest('[data-remove-yes]');
        yes.disabled = true; report('');
        try {
          await post(row.dataset.removeUrl);
          row.classList.add('is-leaving');
          await wait(280);
          removed(row);
        } catch (failure) {
          yes.disabled = false;
          report(failure.message);
        }
      }
    });
    return {
      flush: function () {
        var pending = Array.from(root.querySelectorAll('[data-draft-notes]')).map(saveNote);
        return Promise.all(pending.concat(Array.from(saving)));
      }
    };
  }

  var HEALTH = {
    stalled: 'El worker no informa avance desde hace más de 10 minutos. No vuelvas a ejecutar la lista: reiniciá el contenedor rm-tools-worker; la lista quedará interrumpida para revisión.',
    offline: 'El worker no está activo: la lista sigue en espera. Revisá el contenedor rm-tools-worker.'};
  var ICON = {completed: '✓', failed: '!', not_attempted: '–', running: '', pending: ''};
  var STEP = {setup: 'review', checking: 'review', confirm: 'confirm', queued: 'run', running: 'run', done: 'done'};
  var ORDER = ['review', 'confirm', 'run', 'done'];

  /* module: {
       review(at) → Promise<{confirmation, plan}>: reads without writing and fills the confirm pane;
       fields() → extra form fields sent with the confirmation (optional);
       validate() → message that blocks the review, or '' (optional);
       flush() → Promise settled before reviewing, e.g. pending notes (optional);
       confirmLabel(body) → text of the confirm button (optional);
       scheduled(body) → text shown once the run is scheduled;
       outcome(run) → [kind, title, text] once the worker finished. } */
  function runDialog(dialog, module) {
    var form = dialog.querySelector('form'), base = dialog.dataset.base;
    var preview = dialog.querySelector('#run-preview'), timing = dialog.querySelector('#run-at');
    var back = dialog.querySelector('#run-back'), dismiss = dialog.querySelector('[data-run-dismiss]');
    var plan = dialog.querySelector('#run-plan'), error = dialog.querySelector('#run-error');
    var health = dialog.querySelector('[data-run-health]');
    var confirm = dialog.querySelector('#run-confirm'), later = dialog.querySelector('#run-schedule');
    var resultLink = dialog.querySelector('[data-run-result]');
    var token = null, revision = 0, submitting = false, pane = 'setup', polling = null, finished = false;

    function whenLater() {
      var choice = form.querySelector('input[name=run-when]:checked');
      return !!choice && choice.value === 'later';
    }
    async function show(name) {
      var current = dialog.querySelector('.run-pane:not([hidden])'), next = dialog.querySelector('[data-pane="' + name + '"]');
      pane = name; dialog.dataset.currentPane = name;
      var reached = ORDER.indexOf(STEP[name]);
      dialog.querySelectorAll('[data-step-dot]').forEach(function (dot) {
        var index = ORDER.indexOf(dot.dataset.stepDot);
        dot.classList.toggle('is-done', index < reached || (name === 'done' && index === reached));
        dot.classList.toggle('is-current', index === reached && name !== 'done');
      });
      var foot = {
        setup: ['dismiss', 'preview'], checking: ['dismiss'], confirm: ['back', whenLater() ? 'later' : 'confirm'],
        queued: ['dismiss'], running: ['dismiss'], done: ['dismiss', 'result']};
      var buttons = {dismiss: dismiss, preview: preview, back: back, confirm: confirm, later: later, result: resultLink};
      Object.keys(buttons).forEach(function (key) { if (buttons[key]) { buttons[key].hidden = foot[name].indexOf(key) < 0; } });
      dismiss.textContent = ['setup', 'confirm'].indexOf(name) >= 0 ? 'Cancelar' : 'Cerrar';
      if (current && current !== next) {
        current.classList.add('is-leaving');
        await wait(160);
        current.hidden = true; current.classList.remove('is-leaving');
      }
      next.hidden = false;
      next.classList.remove('is-entering'); void next.offsetWidth; next.classList.add('is-entering');
    }
    function resetReview() {
      if (!preview) { return; }
      revision += 1; token = null; confirm.disabled = true; later.disabled = true;
      plan.textContent = ''; error.textContent = '';
      if (module.reset) { module.reset(); }
    }
    function open(name) {
      if (!dialog.open) { dialog.showModal(); }
      dialog.querySelectorAll('.run-pane').forEach(function (section) { section.hidden = true; });
      return show(name);
    }
    function close() { if (!submitting) { dialog.close(); } }
    dialog.addEventListener('close', function () {
      if (finished || pane === 'queued' || pane === 'running') { stopPolling(); window.location.reload(); return; }
      resetReview(); pane = 'setup';
    });
    dialog.addEventListener('cancel', function (event) { if (submitting || pane === 'checking') { event.preventDefault(); } });
    dismiss.addEventListener('click', close);
    dialog.querySelector('[data-run-close]').addEventListener('click', close);
    var opener = document.querySelector('[data-run-open]');
    if (opener) { opener.addEventListener('click', function () { resetReview(); open('setup'); }); }
    var follower = document.querySelector('[data-run-follow]');
    if (follower) { follower.addEventListener('click', function () { open('queued').then(startPolling); }); }

    if (preview) {
      form.addEventListener('change', function (event) {
        if (event.target.name === 'run-when') {
          form.querySelector('[data-run-at-field]').hidden = !whenLater();
          if (whenLater()) { timing.focus(); }
        }
      });
      back.addEventListener('click', function () { resetReview(); show('setup'); });
      preview.addEventListener('click', async function () {
        if (submitting) { return; }
        error.textContent = '';
        var invalid = module.validate ? module.validate() : '';
        if (invalid) { error.textContent = invalid; return; }
        if (whenLater() && !timing.value) { error.textContent = 'Elegí el día y la hora, o ejecutá ahora.'; timing.focus(); return; }
        resetReview();
        var mine = revision, at = whenLater() ? timing.value : '';
        preview.disabled = true;
        await show('checking');
        try {
          if (module.flush) { await module.flush(); }
          var body = await module.review(at);
          if (mine !== revision) { return; }
          dialog.querySelector('.run-summary').classList.toggle('is-blocked', !body.confirmation);
          plan.textContent = body.plan;
          if (body.confirmation) {
            token = body.confirmation;
            if (module.confirmLabel) { confirm.textContent = module.confirmLabel(body); }
            confirm.disabled = false; later.disabled = false;
          }
          await show('confirm');
          if (body.confirmation) { (at ? later : confirm).hidden = false; (at ? confirm : later).hidden = true; }
          else { confirm.hidden = true; later.hidden = true; }
        } catch (failure) {
          if (mine === revision) { error.textContent = failure.message || 'No se pudo revisar; intentá de nuevo.'; await show('setup'); }
        } finally { preview.disabled = false; }
      });

      var submit = async function (scheduled) {
        if (!token || submitting) { return; }
        submitting = true; revision += 1;
        confirm.disabled = true; later.disabled = true; back.disabled = true; error.textContent = '';
        var fields = Object.assign({}, module.fields ? module.fields() : {}, {confirmation: token});
        if (scheduled) { fields.run_at = timing.value; }
        token = null;
        try {
          var body = await post(base + (scheduled ? '/programar' : '/ejecutar'), fields);
          submitting = false; back.disabled = false;
          if (scheduled) {
            finished = true;
            outcome('scheduled', 'Programada', module.scheduled(body));
            await show('done');
            resultLink.hidden = true;
          } else {
            await show('queued');
            startPolling();
          }
        } catch (failure) {
          submitting = false; back.disabled = false;
          error.textContent = (failure.message || 'No se pudo confirmar') + '. Verificá el estado antes de reintentar; no repitas a ciegas.';
          resetReview(); await show('setup');
        }
      };
      confirm.addEventListener('click', function () { submit(false); });
      later.addEventListener('click', function () { submit(true); });
      // Changing the choices invalidates a review already shown.
      form.addEventListener('change', function (event) { if (event.target.name !== 'run-when' && pane === 'setup') { resetReview(); } });
    }

    // Live progress from the status endpoint while the worker has the list.
    function renderItems(list, items) {
      items.forEach(function (item) {
        var li = list.querySelector('[data-item="' + CSS.escape(String(item.id)) + '"]');
        if (!li) {
          li = document.createElement('li');
          li.dataset.item = item.id;
          li.innerHTML = '<span class="run-ticket-icon" aria-hidden="true"></span><span class="run-ticket-id mono"></span>' +
            '<span class="run-ticket-name"></span><span class="run-ticket-label"></span>';
          li.querySelector('.run-ticket-id').textContent = item.id;
          li.querySelector('.run-ticket-name').textContent = item.name;
          list.appendChild(li);
        }
        if (li.dataset.state !== item.state) {
          li.dataset.state = item.state;
          li.querySelector('.run-ticket-icon').textContent = ICON[item.state] || '';
          li.querySelector('.run-ticket-label').textContent = item.state === 'pending' ? '' :
            item.label + (item.detail && item.state !== 'completed' ? ' · ' + item.detail : '');
          if (item.state === 'running') { li.scrollIntoView({block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth'}); }
        }
      });
    }
    function outcome(kind, title, text) {
      var box = dialog.querySelector('[data-outcome]');
      box.dataset.kind = kind;
      box.querySelector('[data-outcome-title]').textContent = title;
      box.querySelector('[data-outcome-text]').textContent = text;
    }
    async function tick() {
      var response = await fetch(dialog.dataset.statusUrl, {headers: {Accept: 'application/json'}});
      if (!response.ok) { throw new Error('estado ' + response.status); }
      var body = await response.json();
      health.hidden = !body.health; health.textContent = HEALTH[body.health] || '';
      if (body.state === 'waiting' || (!body.run && body.state === 'pending')) {
        if (pane !== 'queued') { await show('queued'); }
        return true;
      }
      if (!body.run) { return false; }
      var run = body.run;
      if (run.state === 'running') {
        if (pane !== 'running') { await show('running'); }
        dialog.querySelector('[data-run-done]').textContent = String(run.done);
        dialog.querySelector('[data-run-total]').textContent = String(run.total);
        var bar = dialog.querySelector('[role=progressbar]');
        bar.setAttribute('aria-valuemax', String(run.total)); bar.setAttribute('aria-valuenow', String(run.done));
        dialog.querySelector('[data-run-bar]').style.width = (run.total ? run.done / run.total * 100 : 0) + '%';
        renderItems(dialog.querySelector('[data-run-tickets]'), run.items);
        return true;
      }
      finished = true;
      outcome.apply(null, module.outcome(run));
      var doneList = dialog.querySelector('[data-done-tickets]');
      doneList.textContent = '';
      renderItems(doneList, run.items.filter(function (item) { return item.state !== 'completed'; }));
      await show('done');
      return false;
    }
    function stopPolling() { window.clearTimeout(polling); polling = null; }
    function startPolling() {
      stopPolling();
      var loop = async function () {
        var again = true;
        try { again = await tick(); error.textContent = ''; }
        catch (failure) { error.textContent = 'No se pudo leer el avance; reintentando…'; }
        if (again) { polling = window.setTimeout(loop, 1500); }
      };
      loop();
    }
    window.addEventListener('pageshow', function (event) { if (event.persisted) { window.location.reload(); } });
  }

  window.ListRun = {post: post, wait: wait, inlineEdits: inlineEdits, runDialog: runDialog};
})();
