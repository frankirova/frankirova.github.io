/* Bajas lists: select tickets and create a list; inside a list, the shared ListRun engine edits it and runs it,
   with the bajas review (one chip per router object) and wording. Needs list-run.js first. */
(function () {
  'use strict';
  var post = window.ListRun.post;
  var all = document.getElementById('bajas-all');
  if (all) {
    all.addEventListener('change', function () {
      document.querySelectorAll('input[name=tickets]:not(:disabled)').forEach(function (box) { box.checked = all.checked; });
    });
  }
  // Single bajas scheduled before lists existed stay cancelable until they run.
  document.querySelectorAll('[data-baja-cancel]').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (!window.confirm('¿Cancelar la baja programada?')) { return; }
      button.disabled = true;
      try {
        await post('/bajas/programadas/' + button.dataset.bajaCancel + '/cancelar');
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        document.getElementById('bajas-error').textContent = error.message;
      }
    });
  });
  var create = document.getElementById('draft-create');
  if (create) {
    var name = document.getElementById('draft-name');
    var group = create.closest('[data-draft-create]');
    var summary = group.querySelector('[data-selection-summary]');
    var idle = summary.textContent;
    var money = new Intl.NumberFormat('es-AR', {maximumFractionDigits: 2});
    function boxes() { return Array.from(document.querySelectorAll('input[name=tickets]:checked:not(:disabled)')); }
    function selected() { return boxes().map(function (box) { return box.value; }); }
    // The group wakes up once something is chosen: how many tickets and how much they owe.
    function syncSummary(chosen) {
      group.dataset.active = chosen.length ? 'true' : 'false';
      if (!chosen.length) { summary.textContent = idle; return; }
      var owed = chosen.reduce(function (sum, box) { var value = parseFloat(box.dataset.balance); return isNaN(value) ? sum : sum + value; }, 0);
      summary.textContent = chosen.length + (chosen.length === 1 ? ' seleccionado' : ' seleccionados') + ' · saldo ' + (owed < 0 ? '-' : '') + '$ ' + money.format(Math.abs(owed));
    }
    function syncCreate() {
      var chosen = boxes();
      syncSummary(chosen);
      create.disabled = !name.value.trim() || chosen.length === 0;
    }
    document.addEventListener('change', syncCreate);
    name.addEventListener('input', syncCreate);
    create.addEventListener('click', async function () {
      create.disabled = true;
      try {
        var result = await post('/bajas/listas', {name: name.value, tickets: JSON.stringify(selected())});
        window.location.assign(result.location);
      } catch (error) {
        document.getElementById('draft-create-error').textContent = error.message;
        syncCreate();
      }
    });
    syncCreate();
  }
  var draft = document.querySelector('[data-baja-draft]');
  if (!draft) { return; }
  var edits = window.ListRun.inlineEdits(draft);
  var dialog = document.getElementById('list-run');
  if (!dialog) { return; }
  var errors = JSON.parse(document.getElementById('baja-errors').textContent);
  var objects = {ADDR: 'IP', PROXYOK: 'Proxy OK', SUSPENDIDOS: 'Suspendidos', QUEUE: 'Queue'};
  var planned = {UPDATED: 'se desactiva', ALREADY_DONE: 'ya estaba', NOT_FOUND: 'no está'};
  var items = document.getElementById('run-items');

  // One chip per router object, coloured by what the baja will do to it.
  function describe(router) {
    var ips = Object.keys(router || {}), cell = document.createDocumentFragment();
    ips.forEach(function (ip) {
      var group = document.createElement('span');
      group.className = 'run-chips';
      if (ips.length > 1) {
        var where = document.createElement('span');
        where.className = 'run-chip-router mono'; where.textContent = ip;
        group.appendChild(where);
      }
      Object.keys(router[ip]).forEach(function (key) {
        var state = router[ip][key], chip = document.createElement('span'), name = document.createElement('strong'), what = document.createElement('span');
        chip.className = 'run-chip'; chip.dataset.plan = state;
        name.textContent = objects[key] || key; what.textContent = planned[state] || state;
        chip.title = name.textContent + ': ' + what.textContent;
        chip.append(name, ' ', what);
        group.appendChild(chip);
      });
      cell.appendChild(group);
    });
    return cell;
  }

  var reviewRows = [], reviewColumn = null, reviewDirection = '';
  var sortButtons = Array.from(dialog.querySelectorAll('[data-review-sort]'));
  sortButtons.forEach(function (button) {
    button.dataset.label = button.textContent;
    button.addEventListener('click', function () {
      var column = Number(button.dataset.reviewSort);
      reviewDirection = reviewColumn === column ? ({desc: 'asc', asc: '', '': 'desc'})[reviewDirection] : 'desc';
      reviewColumn = reviewDirection ? column : null;
      var ordered = reviewRows.slice();
      if (reviewDirection) {
        ordered.sort(function (a, b) {
          var left = a.cells[column].textContent.trim(), right = b.cells[column].textContent.trim();
          if (!left || !right) { return !left - !right; }
          var compared = column === 1 ? Number(left) - Number(right) : left.localeCompare(right, 'es', {sensitivity: 'base'});
          return reviewDirection === 'desc' ? -compared : compared;
        });
      }
      ordered.forEach(function (row) { items.appendChild(row); });
      sortButtons.forEach(function (other) {
        var active = Number(other.dataset.reviewSort) === reviewColumn;
        other.textContent = other.dataset.label + (active ? (reviewDirection === 'desc' ? ' ↓' : ' ↑') : '');
        if (active) { other.closest('th').setAttribute('aria-sort', reviewDirection === 'desc' ? 'descending' : 'ascending'); }
        else { other.closest('th').removeAttribute('aria-sort'); }
      });
    });
  });

  window.ListRun.runDialog(dialog, {
    flush: edits.flush,
    reset: function () { items.textContent = ''; },
    review: async function (at) {
      var body = await post(dialog.dataset.base + '/preview');
      body.items.forEach(function (item, index) {
        var tr = document.createElement('tr'), cells = [String(index + 1), item.id,
          item.state === 'ready' ? describe(item.router) : (errors[item.error] || 'No se puede ejecutar')];
        tr.dataset.reviewTicket = item.id;
        tr.className = item.state === 'ready' ? 'is-ready' : 'is-blocked';
        tr.style.setProperty('--row-delay', Math.min(index, 12) * 30 + 'ms');
        cells.forEach(function (text, column) {
          var td = document.createElement('td');
          if (column === 2 && item.state !== 'ready') { td.className = 'is-err'; }
          if (text instanceof Node) { td.appendChild(text); } else { td.textContent = text; }
          tr.appendChild(td);
        });
        items.appendChild(tr);
      });
      reviewRows = Array.from(items.children);
      dialog.querySelector('[data-review-ready]').textContent = String(body.ready);
      dialog.querySelector('[data-review-total]').textContent = String(body.total);
      body.plan = !body.confirmation ? 'No se puede confirmar: quitá de la lista los tickets marcados y volvé a revisar.' :
        at ? 'Se va a programar la baja de ' + body.total + ' ticket(s) para el ' + at.replace('T', ' a las ') + ' (hora de Argentina).' :
        'Se van a dar de baja ' + body.total + ' ticket(s) ahora. No se puede deshacer desde el panel.';
      return body;
    },
    confirmLabel: function (body) { return 'Dar de baja ' + body.total + ' ticket' + (body.total === 1 ? '' : 's'); },
    scheduled: function (body) { return 'La baja corre el ' + body.run_at.replace('T', ' a las ') + ' (hora de Argentina).'; },
    outcome: function (run) {
      var failed = run.items.filter(function (item) { return item.state !== 'completed'; }).length;
      if (run.state === 'completed') { return ['ok', 'Bajas completadas', run.total + ' de ' + run.total + ' bajas aplicadas en el router. Los tickets no se tocan.']; }
      if (run.state === 'interrupted') {
        return ['err', 'Ejecución interrumpida', 'Revisá en el router y en el ticket cada baja incierta antes de intervenir. No se reintenta nada.'];
      }
      return ['warn', 'Terminó con ' + failed + ' para revisar', (run.total - failed) + ' de ' + run.total +
        ' completadas. Revisá en el router y en el ticket las marcadas; no se reintenta nada.'];
    }
  });
})();
