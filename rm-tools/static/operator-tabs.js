/* Entry tabs of the list modules. Without JavaScript every panel stays visible. */
(function () {
  'use strict';
  document.querySelectorAll('[data-operator-tabs]').forEach(function (root) {
    var tablist = root.querySelector('[role="tablist"]');
    var tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    if (!tablist || !tabs.length) { return; }
    function panelOf(tab) { return root.querySelector('[data-operator-panel="' + tab.dataset.operatorTab + '"]'); }
    function select(tab, focus) {
      tabs.forEach(function (other) {
        var on = other === tab;
        other.setAttribute('aria-selected', on ? 'true' : 'false');
        other.tabIndex = on ? 0 : -1;
        var panel = panelOf(other);
        if (panel) { panel.hidden = !on; }
      });
      if (focus) { tab.focus(); }
    }
    var wanted = tabs.filter(function (tab) { return '#' + tab.dataset.operatorTab === window.location.hash; })[0];
    var initial = wanted || tabs.filter(function (tab) { return tab.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    tablist.hidden = false;
    root.dataset.ready = '';
    select(initial, false);
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (event) {
        var step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
        if (step) { event.preventDefault(); select(tabs[(index + step + tabs.length) % tabs.length], true); }
        else if (event.key === 'Home') { event.preventDefault(); select(tabs[0], true); }
        else if (event.key === 'End') { event.preventDefault(); select(tabs[tabs.length - 1], true); }
      });
    });
  });
}());
