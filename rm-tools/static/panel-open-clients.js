/* Open clients registry and rail. Initialization remains ordered by app.js. */
(function () {
  "use strict";
  var panel = window.rmPanel = window.rmPanel || {};

  panel.initOpenClients = function () {
  /* ── Open clients rail (B-005) ────────────────────────────────────────
     Database accounts use server preferences; bootstrap retains localStorage.
     Closing an item only removes it from the list, never the customer. */
  var RAIL_KEY = "rm.openClients";

  function readOpenClients() {
    if (window.rmPreferences) { return window.rmPreferences.clients; }
    try {
      var items = JSON.parse(localStorage.getItem(RAIL_KEY) || "[]");
      return Array.isArray(items) ? items : [];
    } catch (e) { return []; }
  }

  function saveOpenClients(items) {
    try { localStorage.setItem(RAIL_KEY, JSON.stringify(items)); } catch (e) { /* storage unavailable */ }
  }

  // "14500" → "$ 14.500,00"; anything unparseable renders nothing.
  function railMoneyText(debt) {
    var n = Number(debt);
    if (debt === null || debt === undefined || debt === "" || !Number.isFinite(n)) { return null; }
    var parts = n.toFixed(2).split(".");
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "$ " + whole + "," + parts[1];
  }

  function renderRail() {
    var list = document.querySelector("[data-rail-list]");
    if (!list) { return; }
    var items = readOpenClients();
    while (list.firstChild) { list.removeChild(list.firstChild); }
    if (!items.length) {
      var empty = document.createElement("li");
      empty.className = "rail-empty muted";
      empty.textContent = "Sin clientes abiertos.";
      list.appendChild(empty);
      return;
    }
    // Newest first: the customer just registered sits on top.
    items.slice().reverse().forEach(function (item) {
      var code = String(item.code || "");
      var li = document.createElement("li");
      li.className = "rail-item";
      // N2: only entries carrying a status field get a dot — older saved rows
      // (no status key) render plain, no migration needed.
      if (Object.prototype.hasOwnProperty.call(item, "status")) {
        var dot = document.createElement("span");
        dot.className = "rail-dot";
        if (item.status === "enabled") { dot.classList.add("is-ok"); }
        if (item.status === "blocked") { dot.classList.add("is-err"); }
        li.appendChild(dot);
      }
      var link = document.createElement("a");
      link.className = "rail-item-link";
      link.href = "/rm-tools/clientes/" + encodeURIComponent(code) + "/";
      var fullName = String(item.name || code);
      var nameEl = document.createElement("span");
      nameEl.className = "rail-item-name";
      nameEl.textContent = fullName;
      var codeEl = document.createElement("span");
      codeEl.className = "rail-item-code";
      codeEl.textContent = code;
      link.appendChild(nameEl);
      link.appendChild(codeEl);
      // The name is truncated by the narrow rail; hover shows it in full.
      link.title = code + " · " + fullName;
      if (window.location.pathname === "/rm-tools/clientes/" + encodeURIComponent(code) + "/") {
        li.classList.add("is-current");
        link.setAttribute("aria-current", "page");
      }
      var close = document.createElement("button");
      close.type = "button";
      close.className = "rail-item-close";
      close.setAttribute("aria-label", "Quitar " + code + " del panel lateral");
      close.innerHTML =
        '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg>';
      close.addEventListener("click", function () {
        if (window.rmPreferenceChange) { window.rmPreferenceChange({remove: code}); }
        else { saveOpenClients(readOpenClients().filter(function (open) {
          return String(open.code) !== code;
        })); }
        renderRail();
      });
      li.appendChild(link);
      // N2: mono debt chip, muted on purpose (no ficha tone semantics here).
      var money = railMoneyText(item.debt);
      if (Object.prototype.hasOwnProperty.call(item, "debt") && money) {
        var debt = document.createElement("span");
        debt.className = "rail-debt";
        debt.textContent = money;
        li.appendChild(debt);
      }
      li.appendChild(close);
      list.appendChild(li);
    });
  }

  // N2: the registry entry is {code, name, status, debt}. Re-registering a
  // code merges the current visit into the stored entry so the dot/debt
  // update without moving it; fields the caller does not supply keep
  // whatever the stored entry already had (older rows stay untouched).
  // An absent or empty value means "not supplied": it never overwrites a stored one.
  function suppliedExtra(value) { return value !== undefined && value !== null && value !== ""; }
  function addOpenClient(code, name, extras) {
    code = String(code || "").trim();
    if (!code) { return; }
    extras = extras || {};
    if (window.rmPreferenceChange) {
      var item = {code: code, name: String(name || code)};
      ['status', 'debt'].forEach(function (key) {
        if (suppliedExtra(extras[key])) { item[key] = String(extras[key]); }
      });
      window.rmPreferenceChange({add: item});
      return;
    }
    var items = readOpenClients();
    var existing = null;
    function build() {
      return {
        code: code,
        name: String(name || code),
        status: suppliedExtra(extras.status)
          ? String(extras.status)
          : (existing && typeof existing.status === "string" ? existing.status : ""),
        debt: suppliedExtra(extras.debt)
          ? String(extras.debt)
          : (existing && existing.debt !== undefined && existing.debt !== null ? String(existing.debt) : "")
      };
    }
    var occupied = items.some(function (open, index) {
      if (String(open.code) !== code) { return false; }
      existing = open;
      items[index] = build(); // merge in place: keeps the order position
      return true;
    });
    if (!occupied) { items.push(build()); }
    if (items.length > 30) { items = items.slice(items.length - 30); }
    saveOpenClients(items);
  }

  function registerOpenClient() {
    var body = document.getElementById("customer-body");
    if (!body) { return; }
    var extras = {};
    var state = body.getAttribute("data-customer-state");
    if (state !== null) { extras.status = state; }
    var debt = body.getAttribute("data-customer-debt");
    if (debt !== null) { extras.debt = debt; }
    addOpenClient(body.getAttribute("data-customer-code"), body.getAttribute("data-customer-name"), extras);
  }

  document.addEventListener('rm:preferences', renderRail);
  window.addEventListener("storage", function (event) {
    if (!window.rmPreferences && event.key === RAIL_KEY) { renderRail(); }
  });

  registerOpenClient();
  renderRail();
  return {registerOpenClient: registerOpenClient, renderRail: renderRail, addOpenClient: addOpenClient};
  };
})();
