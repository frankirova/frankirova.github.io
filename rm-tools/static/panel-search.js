/* Search modal keyboard navigation and local result filters. */
(function () {
  "use strict";
  var panel = window.rmPanel = window.rmPanel || {};

  panel.initSearch = function () {
  function isTyping(target) {
    if (!target) { return false; }
    var tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }

  /* Open the client search modal: shared by the "/" key and the
     buscar=1 deep link (P12). */
  function openClientSearch() {
    var dialog = document.getElementById("client-search");
    if (!dialog) { return false; }
    var field = dialog.querySelector("input[type='search']");
    if (!field) { return false; }
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) { dialog.showModal(); }
    } else {
      dialog.open = true;
    }
    document.querySelectorAll('[aria-controls="client-search"]').forEach(function (el) {
      el.setAttribute("aria-expanded", "true");
    });
    field.focus();
    if (typeof field.select === "function") { field.select(); }
    return true;
  }

  /* "/" and Ctrl/⌘+K open the client search modal, unless already typing. */
  function isSearchShortcutKey(event) {
    var isPlainSlash = event.key === "/"
      && !event.metaKey && !event.ctrlKey && !event.altKey;
    var isCtrlK = (event.ctrlKey || event.metaKey)
      && (event.key === "k" || event.key === "K");
    return isPlainSlash || isCtrlK;
  }
  document.addEventListener("keydown", function (event) {
    if (!isSearchShortcutKey(event)) { return; }
    if (isTyping(event.target)) { return; }
    event.preventDefault();
    openClientSearch();
  });

  /* N1: the header hint reflects the platform; the server-rendered text
     ("Ctrl+K") stays as the no-JS fallback. Guarded so offline Node
     harnesses without navigator don't crash. */
  try {
    var searchHint = document.querySelector(".client-search .client-search-hint");
    if (searchHint) {
      var hintPlatform = String(navigator.platform || "").toLowerCase();
      searchHint.textContent = /mac|iphone|ipad/.test(hintPlatform) ? "\u2318K" : "Ctrl+K";
    }
  } catch (e) { /* harness without navigator */ }

  /* P12: /?buscar=1 (GET /clientes redirects here) auto-opens the modal.
     Guarded so the offline Node harnesses (window stub, no location) and
     every real browser (window exists) run the same module. */
  var locationSearch = (typeof window !== "undefined" && window.location
    && typeof window.location.search === "string") ? window.location.search : "";
  if (/([?&])buscar=1(&|$)/.test(locationSearch)) {
    openClientSearch();
  }

  /* Enter in a customer search input opens its first visible result. */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") { return; }
    var field = event.target;
    if (!field || field.tagName !== "INPUT" || field.type !== "search") { return; }
    var results = field.closest("#client-search")
      ? document.getElementById("client-search-results")
      : document.getElementById("resultados");
    if (!results) { return; }
    var link = field.closest("#client-search")
      ? results.querySelector(".search-row:not([hidden]) .search-row-link")
      : results.querySelector("a[href]");
    if (!link) { return; }
    event.preventDefault();
    link.click();
  });

  /* Arrow keys walk the visible search rows: ↓ from the input focuses the
     first visible link, ↓/↑ move between visible rows and ↑ on the first
     returns focus to the input. Hidden rows are skipped. */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") { return; }
    var modal = document.getElementById("client-search");
    var fromInput = event.target && event.target.tagName === "INPUT" && event.target.type === "search";
    var fromLink = event.target && event.target.classList && event.target.classList.contains("search-row-link");
    if (!modal) { return; }
    if (!fromInput && !fromLink) { return; }
    if (fromInput && !modal.contains(event.target)) { return; }
    var rows = modal ? modal.querySelectorAll(".search-row") : [];
    if (!rows.length) { return; }
    var links = [];
    rows.forEach(function (row) {
      if (row.hidden) { return; }
      var link = row.querySelector(".search-row-link");
      if (link) { links.push(link); }
    });
    if (!links.length) { return; }
    event.preventDefault();
    var index = fromLink ? links.indexOf(event.target) : -1;
    if (event.key === "ArrowDown") {
      (links[index + 1] || (fromLink ? links[index] : links[0])).focus();
      return;
    }
    // ArrowUp: previous link, or back to the search input on the first row.
    if (index <= 0) {
      var input = modal.querySelector("input[type='search']");
      if (input) { input.focus(); }
      return;
    }
    links[index - 1].focus();
  });

  /* Chips narrow the rendered rows; every HTMX swap re-applies the active chip. */
  function applySearchFilter() {
    var box = document.getElementById("client-search-results");
    if (!box) { return; }
    var active = document.querySelector("[data-search-filter].active");
    var mode = active ? active.getAttribute("data-search-filter") : "todas";
    var rows = box.querySelectorAll(".search-row");
    var visible = 0;
    rows.forEach(function (row) {
      var status = row.getAttribute("data-status") || "";
      var debt = Number(row.getAttribute("data-debt") || 0);
      var keep = mode === "todas"
        ? true
        : (mode === "deuda" ? debt > 0 : status === mode);
      row.hidden = !keep;
      if (keep) { visible += 1; }
    });
    var empty = document.querySelector("[data-filter-empty]");
    if (empty) { empty.hidden = !(rows.length > 0 && visible === 0); }
  }

  return applySearchFilter;
  };
})();
