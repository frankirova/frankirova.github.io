'use strict';

/* Static stand-in for the panel's local server. The page loads the real app.js unchanged;
   this file answers its /api/snapshot calls with synthetic data and reproduces the monitor's
   alert rule: a status change is confirmed only after 2 consecutive scans, then announced.
   Nothing here touches a network. */

(() => {
  const SCAN_MS = 2000;
  const HOSTS = [
    { name: 'AP-Norte-01', ip: '192.0.2.11', index: 1, minimum: 1000 },
    { name: 'AP-Norte-02', ip: '192.0.2.12', index: 1, minimum: 1000 },
    { name: 'CPE-001021', ip: '192.0.2.21', index: 2, minimum: 100 },
    { name: 'Enlace-Torre-Sur', ip: '198.51.100.5', index: 6, minimum: 1000 },
    { name: 'PTP-Centro-Oeste', ip: '198.51.100.9', index: 1, minimum: 1000 },
    { name: 'Repetidor-Cerro', ip: '198.51.100.14', index: 3, minimum: 100 },
  ];
  const DETAIL = {
    DOWN: 'Ethernet is not operational',
    UNREACHABLE: 'No SNMP response; port status is unknown',
    LOW: '',
    OK: '',
  };
  const TONE = { OK: 'ok', DOWN: 'alarm', LOW: 'alarm', UNREACHABLE: 'nodata', UNKNOWN: 'nodata' };
  const ORDER = ['DOWN', 'LOW', 'UNREACHABLE', 'UNKNOWN', 'PENDING', 'OK'];

  const forced = HOSTS.map(() => 'OK');
  const alarms = HOSTS.map(() => ({ candidate: null, count: 0, confirmed: 'OK', announced: 'OK' }));
  const notices = ['Telegram ready. Confirming transitions after 2 scans.'];
  let observed = HOSTS.map(() => 'OK');
  let scans = 1;
  let updated = Date.now() / 1000;

  const speedText = (mbps) => (mbps === null ? '-' : mbps >= 1000 ? `${(mbps / 1000).toFixed(1)}G` : `${mbps}M`);
  const speedFor = (host, status) => {
    if (status === 'OK') return host.minimum;
    if (status === 'LOW') return 100;
    return null;
  };

  function observe(alarm, status) {
    alarm.count = status === alarm.candidate ? alarm.count + 1 : 1;
    alarm.candidate = status;
    if (alarm.count >= 2) alarm.confirmed = status;
    if (status === alarm.confirmed && alarm.confirmed !== alarm.announced) return alarm.confirmed;
    return null;
  }

  function pushTelegram(message, recovery) {
    const list = document.getElementById('tg');
    if (!list) return;
    list.querySelector('.tg-empty')?.remove();
    const item = document.createElement('li');
    if (recovery) item.className = 'tg-recovery';
    item.textContent = message;
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    item.append(time);
    list.prepend(item);
  }

  function scan() {
    HOSTS.forEach((host, i) => {
      observed[i] = forced[i];
      const change = observe(alarms[i], observed[i]);
      if (!change) return;
      const mbps = speedFor(host, change);
      const value = mbps === null ? '-' : String(mbps);
      const recovery = change === 'OK';
      const message = `${recovery ? 'RECOVERY' : 'ALERT'}: ${host.name} (${host.ip}) Ethernet #${host.index}: ${change}, ${value} Mbps; minimum ${host.minimum} Mbps`;
      alarms[i].announced = change;
      notices.push(message);
      pushTelegram(message, recovery);
    });
    notices.splice(0, Math.max(0, notices.length - 3));
    scans += 1;
    updated = Date.now() / 1000;
  }

  function snapshot() {
    const links = HOSTS.map((host, i) => {
      const status = observed[i];
      return {
        name: host.name, ip: host.ip, index: host.index, status, tone: TONE[status],
        detail: DETAIL[status], speed_text: speedText(speedFor(host, status)),
        minimum_text: speedText(host.minimum),
      };
    }).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
    const counts = {};
    const verdict = { total: links.length, out_of_spec: 0, no_data: 0, ok: 0 };
    links.forEach((link) => {
      counts[link.status] = (counts[link.status] || 0) + 1;
      if (link.tone === 'alarm') verdict.out_of_spec += 1;
      else if (link.tone === 'ok') verdict.ok += 1;
      else verdict.no_data += 1;
    });
    return {
      generated: Date.now() / 1000, state: 'live', demo: true, scans, updated, age: 0,
      interval: SCAN_MS / 1000, source: 'hosts.example.csv', notices: notices.slice(-3),
      counts, verdict, links,
    };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (String(url).endsWith('/api/snapshot')) {
      return Promise.resolve(new Response(JSON.stringify(snapshot()), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return realFetch(url, options);
  };

  setInterval(scan, SCAN_MS);

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('sim-host');
    HOSTS.forEach((host, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `${host.name} (${host.ip})`;
      select.append(option);
    });
    document.querySelectorAll('[data-sim]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.sim;
        if (action === 'ALL') forced.fill('OK');
        else forced[Number(select.value)] = action;
      });
    });
  });
})();
