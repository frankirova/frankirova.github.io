/* Native POST forms keep edits same-origin and reload the reviewed content. */
(function () {
  'use strict';
  var resetCandidates = new URLSearchParams(window.location.search).get('limpiar') === '1';
  // Filters and order are remembered per list page, so leaving and coming back keeps them.
  if (document.querySelector('[data-filter-memory]')) {
    var memoryKey = 'rm.operatorFilters:' + window.location.pathname;
    try {
      var search = window.location.search;
      if (search.indexOf('limpiar=1') !== -1) {
        window.localStorage.removeItem(memoryKey);
        window.history.replaceState(null, '', window.location.pathname);
      } else if (search) {
        window.localStorage.setItem(memoryKey, search);
      } else {
        var stored = window.localStorage.getItem(memoryKey);
        // A link to another tab (#history, #csv) does not use the filters: reloading would only flash the page twice.
        if (stored && !window.location.hash && /^\?[\w=&%.\-]*$/.test(stored)) { window.location.replace(window.location.pathname + stored); }
      }
    } catch (error) { /* storage unavailable: filters just are not remembered */ }
  }
  // Suspensiones and Desconexiones share the paginated candidate display. Keep one tab-local
  // draft per module, authenticated identity and candidate set (status + search), so a selection never
  // leaks into another filter; order, page and page size do not change the set.
  // Do not import legacy URL-keyed records: they have no identity namespace.
  document.querySelectorAll('[data-paged-selection-owner]').forEach(function (section) {
    var params = new URLSearchParams(window.location.search);
    var statuses = params.getAll('status').filter(function (s) { return s === 'enabled' || s === 'blocked'; });
    if (!statuses.length) { statuses = ['enabled', 'blocked']; }
    var view = Array.from(new Set(statuses)).sort().join(',') + '|' + (params.get('q') || '');
    var key = 'rm.candidateSelection:v3:' + window.location.pathname + ':' + section.dataset.pagedSelectionOwner + '|' + view;
    function readDraft() {
      var saved = null;
      try { saved = JSON.parse(window.sessionStorage.getItem(key) || 'null'); }
      catch (error) { /* current-page selection still works without storage */ }
      if (!saved || !Array.isArray(saved.selected) || typeof saved.name !== 'string' || saved.name.length > 120 ||
          saved.selected.some(function (id) { return typeof id !== 'string' || !/^[1-9][0-9]{0,17}$/.test(id); }) ||
          new Set(saved.selected).size !== saved.selected.length) { return {selected: [], name: ''}; }
      return saved;
    }
    if (resetCandidates) { try { window.sessionStorage.removeItem(key); } catch (error) { /* ignore */ } }
    var saved = readDraft();
    var form = section.querySelector('[data-draft-selection]');
    if (!form) { return; }
    var chosen = new Set(saved.selected);
    var boxes = Array.from(form.querySelectorAll('input[type="checkbox"][name="selected"]'));
    // The name input lives in the top command bar and joins the form through form="...".
    var name = form.elements.namedItem('name');
    boxes.forEach(function (box) { box.checked = chosen.has(box.value); });
    name.value = saved.name;
    var all = form.querySelector('[data-select-all]');
    function sync() {
      if (all) {
        var count = boxes.filter(function (box) { return box.checked; }).length;
        all.checked = boxes.length > 0 && count === boxes.length;
        all.indeterminate = count > 0 && count < boxes.length;
      }
      boxes.forEach(function (box) { if (box.checked) { chosen.add(box.value); } else { chosen.delete(box.value); } });
      form.querySelectorAll('[data-offpage-selected]').forEach(function (input) { input.remove(); });
      var visible = new Set(boxes.map(function (box) { return box.value; }));
      chosen.forEach(function (id) {
        if (!visible.has(id)) {
          var input = document.createElement('input');
          input.type = 'hidden'; input.name = 'selected'; input.value = id;
          input.setAttribute('data-offpage-selected', ''); form.appendChild(input);
        }
      });
      var summary = section.querySelector('[data-selection-summary]');
      var create = section.querySelector('button[type="submit"][form]');
      if (summary) {
        summary.textContent = chosen.size
          ? chosen.size + (chosen.size === 1 ? ' cliente elegido' : ' clientes elegidos')
          : 'Elegí clientes de la tabla para armar una lista';
        summary.closest('.candidate-command-bar').dataset.active = chosen.size ? 'true' : 'false';
      }
      if (create) { create.disabled = !chosen.size; }
      try { window.sessionStorage.setItem(key, JSON.stringify({selected: Array.from(chosen), name: name.value})); }
      catch (error) { /* current-page POST remains native and usable */ }
    }
    if (all) {
      all.addEventListener('change', function () {
        boxes.forEach(function (box) { box.checked = all.checked; });
        sync();
      });
    }
    sync();
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) { return; }
      var latest = readDraft();
      chosen = new Set(latest.selected);
      boxes.forEach(function (box) { box.checked = chosen.has(box.value); });
      name.value = latest.name;
      sync();
    });
    form.addEventListener('input', function (event) { if (event.target !== all) { sync(); } });
    name.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.addEventListener('submit', function (event) {
      sync();
      if (!chosen.size) {
        event.preventDefault();
        window.alert('Seleccioná al menos un cliente. Crear no ejecuta acciones.');
      } else {
        try { window.sessionStorage.removeItem(key); } catch (error) { /* ignore */ }
      }
    });
  });
  document.querySelectorAll('[data-draft-selection]').forEach(function (form) {
    if (form.closest('[data-paged-selection-owner]')) { return; }
    // Opening a customer sheet leaves this page: keep the ticked clients and the list name for the way back.
    var key = 'rm.draftSelection:' + window.location.pathname + window.location.search;
    function restore() {
      try {
        var saved = JSON.parse(window.sessionStorage.getItem(key) || 'null');
        if (!saved) { return; }
        form.querySelectorAll('input[name="selected"]').forEach(function (box) { box.checked = saved.selected.indexOf(box.value) !== -1; });
        var name = form.querySelector('input[name="name"]');
        if (name && !name.value) { name.value = saved.name || ''; }
      } catch (error) { /* storage unavailable: start clean */ }
    }
    function remember() {
      try {
        var chosen = Array.from(form.querySelectorAll('input[name="selected"]:checked')).map(function (box) { return box.value; });
        window.sessionStorage.setItem(key, JSON.stringify({selected: chosen, name: (form.querySelector('input[name="name"]') || {}).value || ''}));
      } catch (error) { /* storage unavailable: nothing to keep */ }
    }
    restore();
    window.addEventListener('pageshow', function (event) { if (event.persisted) { restore(); } });
    form.querySelectorAll('a.customer-link').forEach(function (link) { link.addEventListener('click', remember); });
    form.addEventListener('submit', function (event) {
      if (form.querySelector('input[name="selected"]:checked')) { try { window.sessionStorage.removeItem(key); } catch (error) { /* ignore */ } }
      if (!form.querySelector('input[name="selected"]:checked')) {
        event.preventDefault();
        window.alert('Seleccioná al menos un cliente. Crear no ejecuta acciones.');
      }
    });
  });
})();
