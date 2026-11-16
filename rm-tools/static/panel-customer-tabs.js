/* Customer tabs: keyboard navigation and hash activation. Loaded before app.js. */
(function () {
  "use strict";
  var panel = window.rmPanel = window.rmPanel || {};

  function customerTabHashIndex(tabs, hash) {
    var id = hash === '#customer-contact' ? 'customer-tab-contact' :
      hash === '#customer-wifi' ? 'customer-tab-wifi' :
      (hash === '#customer-account' || hash === '#cuenta') ? 'customer-tab-account' : '';
    return tabs.findIndex(function (tab) { return tab.id === id; });
  }
  function activateCurrentCustomerTab(hash) {
    var workspace = document.querySelector('#customer-body [data-customer-tabs]');
    var index = customerTabHashIndex(Array.from(workspace ? workspace.querySelectorAll('[role="tab"]') : []), hash);
    if (workspace && workspace.activateCustomerTab && index >= 0) {
      workspace.activateCustomerTab(index, false);
    }
  }
  function initCustomerTabs(root, selectedTab, restoreFocus) {
    var workspace = root && root.querySelector('[data-customer-tabs]');
    if (!workspace || workspace.dataset.tabsInitialized === 'true') { return; }
    var tabs = Array.from(workspace.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (tab) { return document.getElementById(tab.getAttribute('aria-controls')); });
    if (!tabs.length || panels.some(function (panel) { return !panel || !workspace.contains(panel); })) { return; }
    workspace.dataset.tabsInitialized = 'true';
    function activate(index, focus, initialSelection) {
      tabs.forEach(function (tab, position) {
        var selected = position === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panels[position].hidden = !selected;
      });
      if (focus) { tabs[index].focus(); }
      if (tabs[index].id === 'customer-tab-account' && !initialSelection) {
        var action = panels[index].querySelector('[data-customer-account-action]');
        if (action) { action.click(); }
      }
      if (tabs[index].id === 'customer-tab-wifi') { panel.wifi.loadWifiCurrent(panels[index]); }
    }
    workspace.activateCustomerTab = activate;
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { activate(index, false); });
      tab.addEventListener('keydown', function (event) {
        var next;
        if (event.key === 'ArrowRight') { next = (index + 1) % tabs.length; }
        else if (event.key === 'ArrowLeft') { next = (index + tabs.length - 1) % tabs.length; }
        else if (event.key === 'Home') { next = 0; }
        else if (event.key === 'End') { next = tabs.length - 1; }
        if (next !== undefined) { event.preventDefault(); activate(next, true); }
      });
    });
    var initial = tabs.findIndex(function (tab) { return tab.id === selectedTab; });
    if (initial < 0) { initial = customerTabHashIndex(tabs, window.location.hash); }
    if (initial < 0) { initial = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; }); }
    activate(initial >= 0 ? initial : 0, !!restoreFocus, true);
  }

  panel.customerTabs = {initCustomerTabs: initCustomerTabs, activateCurrentCustomerTab: activateCurrentCustomerTab};
})();
