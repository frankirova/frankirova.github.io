'use strict';

/* Demo glue: registers the service worker that fakes the panel's server, blocks every
   write form and tells the visitor why nothing is saved. */

(() => {
  const SW = '/rm-tools/sw.js';
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(SW, { scope: '/rm-tools/' }).then(() => navigator.serviceWorker.ready).then(() => {
      // The first visit loads before the worker controls the page: reload once so the
      // page's own background requests are answered by it.
      if (!navigator.serviceWorker.controller && !sessionStorage.getItem('rm-demo-reloaded')) {
        sessionStorage.setItem('rm-demo-reloaded', '1');
        location.reload();
      }
    });
  }

  /* The customer page refreshes itself from ISPCube when it opens. In the demo that call is
     answered with the page's own data, marked as fresh, so the page shows no error. */
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    const match = target.pathname.match(/^\/clientes\/(\d+)\/actualizar$/);
    const method = ((init && init.method) || 'GET').toUpperCase();
    const current = document.getElementById('customer-body');
    if (match && method === 'POST' && current && window.__rmDemoBody && current.dataset.customerCode === match[1]) {
      const clone = window.__rmDemoBody.cloneNode(true);
      clone.dataset.customerFetchedAt = new Date().toISOString();
      return Promise.resolve(new Response(clone.outerHTML, {
        status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    }
    return realFetch(input, init);
  };

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/rm-tools/demo/demo.css';
  document.head.append(css);

  function toast(message) {
    let box = document.getElementById('demo-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'demo-toast';
      box.setAttribute('role', 'status');
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove('show'), 3500);
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.matches('[data-demo-blocked]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('No disponible en la demo: los cambios no se guardan.');
    }
  }, true);

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[aria-disabled="true"]');
    if (link) {
      event.preventDefault();
      toast('Enlace externo no disponible en la demo.');
    }
  });

  document.addEventListener('htmx:responseError', (event) => {
    if (event.detail && event.detail.xhr && event.detail.xhr.status === 403) {
      toast('No disponible en la demo: los cambios no se guardan.');
    }
  });
})();
