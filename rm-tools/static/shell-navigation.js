/* Shared navigation only; no requests, stored state or permission changes. */
(function () {
  'use strict';
  var shell = document.querySelector('.client-shell');
  var toggle = shell && shell.querySelector('[data-nav-toggle]');
  var nav = shell && shell.querySelector('#main-navigation');
  if (!toggle || !nav) { return; }
  var root = document.documentElement;

  function close(restoreFocus) {
    shell.removeAttribute('data-nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir navegación');
    if (restoreFocus) { toggle.focus(); }
  }
  function rows() {
    // Distinct visual rows of the grouped navigation; the wide layout allows two.
    var tops = [];
    nav.querySelectorAll('[data-nav-group], :scope > a').forEach(function (group) {
      var top = Math.round(group.getBoundingClientRect().top);
      if (tops.indexOf(top) === -1) { tops.push(top); }
    });
    return tops.length;
  }
  var menus = Array.prototype.slice.call(nav.querySelectorAll('[data-nav-menu]'));
  function menuLabel(group) { return group.querySelector('.nav-group-label'); }
  function closeMenus(except) {
    menus.forEach(function (group) {
      if (group === except || !group.hasAttribute('data-open')) { return; }
      group.removeAttribute('data-open');
      menuLabel(group).setAttribute('aria-expanded', 'false');
    });
  }
  function setMenuOpen(group, open, focusFirst) {
    closeMenus(open ? group : null);
    group.toggleAttribute('data-open', open);
    menuLabel(group).setAttribute('aria-expanded', String(open));
    if (open && focusFirst) {
      var first = group.querySelector('.nav-group-links a');
      if (first) { first.focus(); }
    }
  }
  // Menus only exist in the wide layout: the compact menu lists every group and link.
  function enableMenus(on) {
    root.toggleAttribute('data-nav-menus', on);
    menus.forEach(function (group, index) {
      var label = menuLabel(group), links = group.querySelector('.nav-group-links');
      var count = links ? links.querySelectorAll('a').length : 0;
      group.toggleAttribute('data-nav-solo', on && count === 1);
      group.toggleAttribute('data-has-active', !!group.querySelector('[aria-current="page"]'));
      var interactive = on && count > 1;
      if (links && !links.id) { links.id = 'nav-menu-' + index; }
      if (interactive) {
        label.setAttribute('role', 'button');
        label.setAttribute('tabindex', '0');
        label.setAttribute('aria-haspopup', 'true');
        label.setAttribute('aria-controls', links.id);
        label.setAttribute('aria-expanded', group.hasAttribute('data-open') ? 'true' : 'false');
      } else {
        ['role', 'tabindex', 'aria-haspopup', 'aria-controls', 'aria-expanded'].forEach(function (name) { label.removeAttribute(name); });
        group.removeAttribute('data-open');
      }
    });
  }
  menus.forEach(function (group) {
    var label = menuLabel(group);
    label.addEventListener('click', function () {
      if (!root.hasAttribute('data-nav-menus') || !label.hasAttribute('role')) { return; }
      setMenuOpen(group, !group.hasAttribute('data-open'), false);
    });
    label.addEventListener('keydown', function (event) {
      if (!label.hasAttribute('role')) { return; }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setMenuOpen(group, true, true);
      }
    });
    group.addEventListener('keydown', function (event) {
      if (!group.hasAttribute('data-open')) { return; }
      var links = Array.prototype.slice.call(group.querySelectorAll('.nav-group-links a'));
      var at = links.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(group, false, false);
        label.focus();
      } else if (event.key === 'ArrowDown' && at > -1) {
        event.preventDefault();
        links[(at + 1) % links.length].focus();
      } else if (event.key === 'ArrowUp' && at > -1) {
        event.preventDefault();
        (at === 0 ? label : links[at - 1]).focus();
      }
    });
  });
  // Tab or a click elsewhere closes open menus; a click on a link does not depend on focus (Safari).
  document.addEventListener('focusin', function (event) {
    if (!event.target.closest('[data-nav-menu]')) { closeMenus(null); }
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-nav-menu]') || event.target.closest('.nav-group-links a')) { closeMenus(null); }
  });
  function layout() {
    closeMenus(null);
    var hadMenuFocus = nav.contains(document.activeElement);
    var compact = window.matchMedia('(max-width: 1024px)').matches;
    // Measure the full layout, even when it was previously collapsed.
    if (!compact) {
      root.removeAttribute('data-nav-compact');
      enableMenus(menus.length > 0);
      compact = rows() > 1 || nav.scrollWidth > nav.clientWidth + 1
        || shell.scrollWidth > shell.clientWidth + 1;
    }
    if (compact) { enableMenus(false); }
    root.toggleAttribute('data-nav-compact', compact);
    close(compact && hadMenuFocus);
  }
  toggle.addEventListener('click', function () {
    if (shell.hasAttribute('data-nav-open')) { close(false); return; }
    shell.setAttribute('data-nav-open', '');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Cerrar navegación');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && shell.hasAttribute('data-nav-open')) {
      event.preventDefault();
      close(true);
    }
  });
  document.addEventListener('click', function (event) {
    if (!shell.hasAttribute('data-nav-open')) { return; }
    if (!event.target.closest('.shell-navigation') || event.target.closest('#main-navigation a')) { close(false); }
  });
  window.addEventListener('resize', layout);
  if (typeof ResizeObserver === 'function') {
    var observer = new ResizeObserver(layout);
    observer.observe(shell);
    var logo = shell.querySelector('.client-logo');
    if (logo) { observer.observe(logo); }
  }
  layout();
})();
