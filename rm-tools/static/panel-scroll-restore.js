/* Lists scroll inside .table-scroll, which the browser does not restore on Back. Remember it per URL, and
   give it back on Back and on the «Volver a la lista» link of a customer card. */
(function () {
  "use strict";
  var TARGETS = '[data-draft-selection] > .table-scroll, .bajas-list-page .table-scroll';

  function storageKey() { return 'rm-scroll:' + window.location.pathname + window.location.search; }
  function regions() { return Array.from(document.querySelectorAll(TARGETS)); }
  function save() {
    try { window.sessionStorage.setItem(storageKey(), JSON.stringify(regions().map(function (region) { return region.scrollTop; }))); }
    catch (error) { /* Back simply lands at the top. */ }
  }
  function cameBack() {
    var entry = window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    return !!entry && entry.type === 'back_forward';
  }
  function fromCustomerCard() {
    try {
      var from = new URL(document.referrer);
      return from.origin === window.location.origin && from.pathname.indexOf('/clientes/') === 0;
    } catch (error) { return false; }
  }
  function restore() {
    var saved;
    try { saved = JSON.parse(window.sessionStorage.getItem(storageKey()) || 'null'); }
    catch (error) { return; }
    if (!Array.isArray(saved)) { return; }
    regions().forEach(function (region, index) {
      if (typeof saved[index] === 'number') { region.scrollTop = saved[index]; }
    });
  }

  window.addEventListener('pagehide', save);
  if (cameBack() || fromCustomerCard()) {
    restore();
    window.addEventListener('load', restore);
  }
})();
