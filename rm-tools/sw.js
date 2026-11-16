'use strict';

/* Stand-in for the panel's server. The pages in /rm-tools/ are static; every request the
   page makes to a root path (htmx fragments, background refreshes) is answered here from
   recorded fake data. Nothing leaves the browser. Writes are refused. */

importScripts('/rm-tools/demo/data.js', '/rm-tools/demo/filter.js');

const D = self.DEMO_DATA;
const NOTICE = '<div class="notice" role="status">No disponible en la demo</div>';
const ROUTER = '<div class="wifi-bands-data"><div data-wifi-band="2.4GHz">'
  + '<span data-wifi-ssid>Demo-WiFi</span>'
  + '<input type="password" readonly autocomplete="off" aria-label="Clave 2.4 GHz" value="Demo-WiFi-2026" data-wifi-pass>'
  + '</div></div><div class="notice ok" role="status">Router leído · TL-WR850N</div>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const html = (body, status = 200) => new Response(body, {
  status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

function answer(request, url) {
  const key = request.method + ' ' + url.pathname;
  if (request.method === 'GET' && url.pathname === '/clientes/buscar') {
    return html(self.demoSearch(D, url.searchParams.get('q') || ''));
  }
  const antenna = url.pathname.match(/^\/antenas\/(\d+)\/(actualizar|ping)$/);
  if (request.method === 'POST' && antenna && D.antennaFixtures[antenna[1]]) {
    return html(D.antennaFixtures[antenna[1]][antenna[2]]);
  }
  if (request.method === 'GET' && /\/router-wifi\/current$/.test(url.pathname)) return html(ROUTER);
  const hit = D.fixtures[key + url.search] || D.fixtures[key];
  if (request.method === 'GET') {
    if (hit) return new Response(hit.body, { headers: { 'Content-Type': hit.type } });
    return new Response(null, { status: 204 });
  }
  return html(NOTICE, 403);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rm-tools/') || event.request.mode === 'navigate') return;
  event.respondWith(answer(event.request, url));
});
