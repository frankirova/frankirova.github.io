/* Serialized antenna reads and strict server-fragment validation. */
(function () {
  "use strict";
  var panel = window.rmPanel = window.rmPanel || {};

  /* One serialized lane for automatic and manual antenna requests. Selection
     changes supersede queued work, not active network writes to the cache. */
  function initAntenna(antennaRoot, automatic) {
    if (!antennaRoot || antennaRoot.dataset.antennaBound === 'true') { return; }
    antennaRoot.dataset.antennaBound = 'true';
    var selection = antennaRoot.querySelector('select');
    var antennaStatus = antennaRoot.querySelector('[data-antenna-status]');
    var customerBody = antennaRoot.id === 'customer-connection' ? antennaRoot.closest('#customer-body') : null;
    var pingIndicator = (customerBody || antennaRoot).querySelector('[data-ping-indicator]');
    var pingStates = Object.create(null);
    var activePing = null;
    var selected = selection ? selection.value : '';
    var revision = 0;
    var busy = false;
    var queued = null;
    var enabled = antennaRoot.dataset.antennaAuto === 'true';
    var bodyRoot = antennaRoot.closest('#customer-body');
    // Only the customer refresh controller owns context-wide pending/errors.
    // A standalone antenna lane retains its last completed PING during metrics reads.
    var customerContext = bodyRoot && bodyRoot.dataset.customerCode !== undefined;
    function autoAllowed() {
      return automatic && (!bodyRoot || (bodyRoot.dataset.customerBusy !== 'true' &&
        bodyRoot.dataset.customerRefreshFailed !== 'true'));
    }
    antennaRoot.pauseQueries = function () {
      revision++;
      queued = null;
      activePing = null;
    };

    function showSelection() {
      if (antennaRoot.isConnected === false) { return; }
      if (antennaRoot.id === 'customer-connection') {
        var option = selection && selection.selectedOptions[0];
        var ip = option ? option.dataset.connectionIp || '' : '';
        (customerBody || antennaRoot).querySelectorAll('[data-selected-connection-ip]').forEach(function (ipRow) {
          ipRow.dataset.copy = ip;
          ipRow.querySelector('span').textContent = ip || '—';
        });
      }
      if (pingIndicator) {
        var state = activePing && activePing.id === selected && activePing.revision === revision ?
          'pending' : (enabled && selected ? (pingStates[selected] || 'unknown') :
            (customerContext || !enabled ? 'unavailable' : 'unknown'));
        var labels = {up: 'respondió', down: 'sin respuesta', timeout: 'tiempo agotado',
          pending: 'consultando…', unknown: 'sin consultar', unavailable: 'no disponible',
          error: 'error de consulta', waiting: 'esperando actualización del cliente…'};
        if (bodyRoot && enabled) {
          if (bodyRoot.dataset.customerBusy === 'true') { state = 'waiting'; }
          else if (bodyRoot.dataset.customerRefreshFailed === 'true') { state = 'error'; }
        }
        pingIndicator.dataset.pingState = state;
        pingIndicator.className = (customerBody ? 'verdict' : 'chip') + (state === 'up' ? ' ok' : state === 'down' || state === 'error' ? ' err' :
          state === 'pending' || state === 'timeout' ? ' warn' : '');
        pingIndicator.textContent = labels[state];
      }
      antennaRoot.querySelectorAll('.antenna-metrics').forEach(function (card) {
        card.hidden = card.id !== 'antena-' + selected;
        card.setAttribute('aria-busy', String(busy && !card.hidden));
        // N3: soft shimmer overlay over the measurement values while pending.
        if (card.classList) { card.classList.toggle('antenna-query-busy', Boolean(busy && !card.hidden)); }
        card.querySelectorAll('button[hx-post]').forEach(function (button) {
          button.disabled = busy;
        });
      });
    }

    /* Parse in an inert document and verify the fragment contract before
       touching last-good DOM. HTTP 200 also carries equipment failures. */
    function parseAntennaCard(html, id) {
      if (!html.trim() || /<!doctype|<\/?(?:html|head|body)\b/i.test(html)) {
        throw new Error('invalid document');
      }
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      var nodes = Array.from(parsed.body.childNodes).filter(function (node) {
        return node.nodeType !== 3 || node.textContent.trim();
      });
      var card = nodes[0];
      if (nodes.length !== 1 || card.nodeType !== 1 || card.tagName !== 'DIV' ||
          card.id !== 'antena-' + id || !card.classList.contains('antenna-metrics') ||
          !card.classList.contains('kv') || !card.querySelector('.antenna-header') ||
          (!card.querySelector('.antenna-updated') && !card.classList.contains('antenna-retry')) ||
          parsed.head.childNodes.length || card.querySelector('script, style, iframe, object, embed, link, base, meta')) {
        throw new Error('invalid card');
      }
      var adminControls = new Set();
       var portInput = null;
       var seenForms = Object.create(null);
       card.querySelectorAll('form').forEach(function (form) {
         var path = form.getAttribute('hx-post');
         var kind = path === '/admin/antenas/' + id + '/puerto' ? 'port' :
           path === '/admin/antenas/' + id + '/familia' ? 'family' : null;
         if (!kind || form.getAttribute('action') !== path || form.getAttribute('method') !== 'post' ||
             form.getAttribute('hx-target') !== '#antena-' + id || form.getAttribute('hx-swap') !== 'outerHTML' ||
             form.getAttribute('hx-disabled-elt') !== 'input, button' ||
             !form.matches('.antenna-management > .' + (kind === 'port' ? 'port-editor' : 'family-switch') + ' > form')) {
           throw new Error('invalid admin form');
         }
         var inputs = Array.from(form.querySelectorAll('input'));
         var submits = Array.from(form.querySelectorAll('button'));
         var csrf = inputs.shift();
         if (!csrf || csrf.type !== 'hidden' || csrf.name !== 'csrf_token' || !csrf.value) {
           throw new Error('missing admin authorization');
         }
         var key = kind;
         if (kind === 'port') {
           var input = inputs[0];
           if (inputs.length !== 1 || input.name !== 'port' || submits.length !== 1 ||
               (input.type !== 'number' && (input.type !== 'hidden' || input.value !== ''))) {
             throw new Error('invalid port controls');
           }
           key = input.type === 'number' ? 'port' : 'reset';
           if (key === 'port') {
             var labels = form.querySelectorAll('label');
             if (input.id !== 'port-' + id || input.getAttribute('min') !== '1' ||
                 input.getAttribute('max') !== '65535' || labels.length !== 1 ||
                 labels[0].getAttribute('for') !== input.id) { throw new Error('invalid port input'); }
             portInput = input;
           }
         } else if (inputs.length || submits.length !== 2 ||
             submits[0].name !== 'family' || submits[0].value !== 'airMAX' ||
             submits[1].name !== 'family' || submits[1].value !== 'AC') {
           throw new Error('invalid family controls');
         }
         if (seenForms[key]) { throw new Error('duplicate admin form'); }
         seenForms[key] = true;
         adminControls.add(csrf);
         inputs.forEach(function (input) { adminControls.add(input); });
         submits.forEach(function (button) {
           if (button.getAttribute('type') !== 'submit') { throw new Error('invalid admin button'); }
           adminControls.add(button);
         });
       });
       if (seenForms.reset && !seenForms.port) { throw new Error('missing port editor'); }
       card.querySelectorAll('[id]').forEach(function (node) {
         if (node !== portInput) { throw new Error('unexpected id'); }
       });
       card.querySelectorAll('*').forEach(function (node) {
         Array.from(node.attributes).forEach(function (attr) {
           if (/^on/i.test(attr.name) || /^(?:srcdoc|formaction|formtarget)$/i.test(attr.name) ||
               (/^hx-/i.test(attr.name) && ['hx-post', 'hx-target', 'hx-swap', 'hx-disabled-elt'].indexOf(attr.name) === -1)) {
             throw new Error('active content');
           }
         });
       });
       var buttons = card.querySelectorAll('button[hx-post]');
      if (buttons.length !== 2) { throw new Error('missing controls'); }
      ['actualizar', 'ping'].forEach(function (action) {
        var button = card.querySelector('button[hx-post="/antenas/' + id + '/' + action + '"]');
        if (!button || button.getAttribute('hx-target') !== '#antena-' + id ||
            button.getAttribute('hx-swap') !== 'outerHTML' || button.getAttribute('type') !== 'button') {
          throw new Error('invalid control');
        }
      });
      card.querySelectorAll('input, button, select, textarea, [hx-post]').forEach(function (node) {
         if (node.tagName !== 'FORM' && !adminControls.has(node) && !Array.from(buttons).includes(node)) {
           throw new Error('unexpected control');
         }
         if (adminControls.has(node) && node.hasAttribute('hx-post')) { throw new Error('unexpected admin action'); }
       });
       var outcomes = card.querySelectorAll('[data-antenna-outcome]');
      if (outcomes.length !== 1 || !outcomes[0].textContent.trim()) {
        throw new Error('missing outcome');
      }
      var ping = outcomes[0].getAttribute('data-ping-outcome');
      if (ping !== null && ['up', 'down', 'timeout', 'unavailable'].indexOf(ping) === -1) {
        throw new Error('invalid ping outcome');
      }
      return {card: document.importNode(card, true), outcome: outcomes[0].textContent.trim(), ping: ping};
    }

    async function runAntenna(job) {
      var results = [];
      function report(message) {
        if (antennaRoot.isConnected === false) { return; }
        antennaStatus.textContent = results.concat(message ? [message] : []).join(' · ');
      }
      busy = true;
      showSelection();
      try {
        for (var i = 0; i < job.actions.length; i++) {
          if (job.revision !== revision || antennaRoot.isConnected === false) { break; }
          var action = job.actions[i];
          if (action === 'ping') { activePing = job; showSelection(); }
          report(action === 'ping' ? 'Ejecutando PING…' : 'Leyendo datos de antena…');
          var response = await fetch('/antenas/' + job.id + '/' + action + (job.force ? '' : '?force=0'), {
            method: 'POST', credentials: 'same-origin',
            headers: {'HX-Request': 'true'}, redirect: 'error'
          });
          if (!response.ok) { throw new Error('request failed'); }
          var html = await response.text();
          if (job.revision !== revision || antennaRoot.isConnected === false) { break; }
          var fragment = parseAntennaCard(html, job.id);
          if (action === 'ping' && !fragment.ping) { throw new Error('missing ping outcome'); }
          var card = document.getElementById('antena-' + job.id);
          if (!card || !antennaRoot.contains(card)) { throw new Error('missing target'); }
          // The stable live region owns announcements here; fallback HTMX cards
          // keep their status role outside this selection controller.
          var notice = fragment.card.querySelector('[data-antenna-outcome]');
          notice.removeAttribute('role');
          notice.hidden = true;
          card.replaceWith(fragment.card);
          if (action === 'ping') { pingStates[job.id] = fragment.ping; activePing = null; }
          results.push((action === 'ping' ? 'PING: ' : 'Actualizar antena: ') + fragment.outcome);
          report('');
          showSelection();
        }
        if (job.revision === revision) { report('Podés usar los controles manuales.'); }
      } catch (error) {
        if (job.revision === revision) {
          if (customerContext) { pingStates[job.id] = 'error'; }
          else if (action === 'ping') { pingStates[job.id] = 'unavailable'; }
          report('No se pudo completar ' + (action === 'ping' ? 'PING' : 'la lectura de antena') +
            ': error de comunicación o respuesta no válida. Se conservan los últimos datos; podés reintentar manualmente.');
        }
      } finally {
        activePing = null;
        busy = false;
        showSelection();
        var next = queued;
        queued = null;
        if (next && antennaRoot.isConnected !== false) { runAntenna(next); }
      }
    }

    function requestAntenna(actions, force) {
      if (!enabled || !selected || antennaRoot.isConnected === false) { return; }
      if (bodyRoot && bodyRoot.dataset.customerBusy === 'true') { return; }
      if (customerContext) { pingStates[selected] = 'pending'; }
      var job = {id: selected, revision: revision, actions: actions, force: !!force};
      if (busy) {
        queued = job;
        antennaStatus.textContent = 'Esperando que termine la consulta anterior…';
        showSelection();
      } else { runAntenna(job); }
    }

    if (selection) {
      selection.addEventListener('change', function () {
        if (selected === selection.value) { return; }
        selected = selection.value;
        revision++;
        queued = null;
        showSelection();
        antennaStatus.textContent = 'Elegí una conexión para consultar sus datos.';
        if (autoAllowed()) { requestAntenna(['actualizar', 'ping']); }
      });
    }
    /* Capture before HTMX's click handler. Swapped buttons need no rebinding.
       Outside this customer section the original HTMX behavior is untouched. */
    antennaRoot.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('button[hx-post]');
      if (!button || !antennaRoot.contains(button)) { return; }
      var path = button.getAttribute('hx-post');
      var match = /^\/antenas\/(\d+)\/(actualizar|ping)$/.exec(path);
      if (!match) { return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || match[1] !== selected) { return; }
      requestAntenna([match[2]], true);
    }, true);
    showSelection();
    if (autoAllowed()) { requestAntenna(['actualizar', 'ping']); }
  }

  panel.initAntenna = initAntenna;
})();
