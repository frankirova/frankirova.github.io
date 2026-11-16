'use strict';

/* Runs right before the panel's own scripts. The pages were saved from the build-time
   database, so their "fetched at" stamp is already old: stamp them as of now so the demo
   reads as up to date, and keep a pristine copy for the simulated refresh. */

(() => {
  const body = document.getElementById('customer-body');
  if (!body) return;
  body.dataset.customerFresh = 'true';
  body.dataset.customerFetchedAt = new Date().toISOString();
  window.__rmDemoBody = body.cloneNode(true);
})();
