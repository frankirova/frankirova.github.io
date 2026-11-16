'use strict';

/* enlaces — the page is a viewer. It polls one read-only endpoint and repaints
   only what changed: the list is rebuilt when a link's data changes, never on
   every tick, so a row that is being read keeps its focus and its open detail. */

(() => {
  const POLL_MS = 2000;
  const AGE_TICK_MS = 500;
  const STATUS_ORDER = ['DOWN', 'LOW', 'UNREACHABLE', 'UNKNOWN', 'PENDING', 'OK'];

  const ui = {
    mode: document.getElementById('mode'),
    scan: document.getElementById('scan'),
    age: document.getElementById('age'),
    sentence: document.getElementById('sentence'),
    breakdown: document.getElementById('breakdown'),
    note: document.getElementById('note'),
    demoNote: document.getElementById('demo-note'),
    links: document.getElementById('links'),
    alert: document.getElementById('alert-text'),
    provenance: document.getElementById('provenance'),
    announcer: document.getElementById('announcer'),
  };

  const root = document.documentElement;
  const expanded = new Set();
  let payload = null;
  let lastState = null;
  let lastListSignature = null;

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  function figure(value) {
    const span = document.createElement('span');
    span.className = 'fig';
    span.textContent = value;
    return span;
  }

  function counter(value) {
    const span = document.createElement('span');
    span.className = 'num';
    span.textContent = String(value);
    return span;
  }

  function command(value) {
    const code = document.createElement('code');
    code.textContent = value;
    return code;
  }

  function duration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    if (total < 60) return `${total}s`;
    if (total < 3600) return `${Math.floor(total / 60)}m`;
    return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  }

  function clock(stamp) {
    return new Date(stamp * 1000).toLocaleTimeString([], { hour12: false });
  }

  function renderSentence(state) {
    const verdict = state.verdict;
    if (state.state === 'disconnected') return ui.sentence.replaceChildren('No hay monitor corriendo.');
    if (state.state === 'outdated') return ui.sentence.replaceChildren('El monitor corre una versión anterior.');
    if (state.state === 'starting') return ui.sentence.replaceChildren('Esperando el primer escaneo.');
    if (verdict.total === 0) return ui.sentence.replaceChildren('Sin enlaces configurados.');
    // A link nobody could read is not a healthy link, so it is named in the sentence.
    const without = verdict.no_data > 0
      ? [', ', counter(verdict.no_data), ' sin dato.'] : ['.'];
    if (verdict.out_of_spec > 0) {
      return ui.sentence.replaceChildren(
        plural(verdict.total, 'enlace', 'enlaces'), ', ',
        counter(verdict.out_of_spec), ' fuera de norma', ...without);
    }
    if (verdict.no_data > 0) {
      return ui.sentence.replaceChildren(
        plural(verdict.total, 'enlace', 'enlaces'), ', ninguno fuera de norma, ',
        counter(verdict.no_data), ' sin dato.');
    }
    return ui.sentence.replaceChildren(
      plural(verdict.total, 'enlace', 'enlaces'), verdict.total === 1 ? ', en norma.' : ', todos en norma.');
  }

  function renderBreakdown(state) {
    const known = STATUS_ORDER.filter((status) => state.counts[status]);
    const extra = Object.keys(state.counts)
      .filter((status) => !STATUS_ORDER.includes(status))
      .sort();
    ui.breakdown.textContent = known.concat(extra)
      .map((status) => `${status} ${state.counts[status]}`)
      .join(' · ');
  }

  function renderNote(state) {
    ui.note.replaceChildren();
    switch (state.state) {
      case 'disconnected':
        ui.note.replaceChildren('Arrancalo con ', command('dashboard.py'), ' o ',
          command('monitor.py --demo'), '. Reintentando.');
        break;
      case 'outdated':
        ui.note.replaceChildren('Paralo y arrancalo de nuevo para que publique filas por enlace.');
        break;
      case 'starting':
        ui.note.replaceChildren('El monitor está vivo pero todavía no completó un escaneo.');
        break;
      case 'stale':
        ui.note.replaceChildren(
          `Dejó de completar escaneos: estos datos son de hace ${duration(state.age)}. No implican enlaces sanos.`);
        break;
      default:
        ui.note.hidden = true;
        return;
    }
    ui.note.hidden = false;
  }

  function renderDetail(link) {
    const list = document.createElement('dl');
    const field = (label, value, className) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      definition.textContent = value;
      if (className) definition.className = className;
      list.append(term, definition);
    };
    field('estado', link.status);
    field('velocidad', link.speed_text === '-' ? 'sin dato' : `${link.speed_text} negociada`);
    field('mínimo', link.minimum_text);
    field('puerto', link.index === null || link.index === undefined ? 'sin ifindex' : `ifindex ${link.index}`);
    field('ip', link.ip || 'sin ip');
    if (link.detail) field('motivo', link.detail, 'reason');
    return list;
  }

  function rowKey(link) {
    return `${link.ip}:${link.index}`;
  }

  function buildLink(link, index) {
    const key = rowKey(link);
    const item = document.createElement('li');
    item.className = 'link';
    item.dataset.tone = link.tone;
    item.dataset.status = link.status;

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.id = `detail-${index}`;
    detail.hidden = !expanded.has(key);
    detail.append(renderDetail(link));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row';
    button.dataset.key = key;
    button.setAttribute('aria-controls', detail.id);
    button.setAttribute('aria-expanded', String(expanded.has(key)));

    const led = document.createElement('span');
    led.className = 'led';
    led.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = link.name || 'sin nombre';

    const port = document.createElement('span');
    port.className = 'port';
    port.textContent = link.index === null || link.index === undefined
      ? link.ip : `${link.ip}:${link.index}`;

    const speed = document.createElement('span');
    speed.className = 'speed';
    if (link.speed_text === '-') {
      speed.append('sin velocidad · mínimo ', figure(link.minimum_text));
    } else {
      speed.append(figure(link.speed_text), ' negociado · mínimo ', figure(link.minimum_text));
    }

    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = link.status;

    button.append(led, name, port, speed, word);
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      if (open) expanded.delete(key);
      else expanded.add(key);
      button.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
    });

    item.append(button, detail);
    return item;
  }

  function renderLinks(state) {
    const signature = JSON.stringify(state.links.map((link) => [link.name, link.ip, link.index, link.status,
      link.tone, link.speed_text, link.minimum_text, link.detail]));
    if (signature === lastListSignature) return;
    lastListSignature = signature;

    const focused = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.key : null;

    if (!state.links.length) {
      const empty = document.createElement('li');
      empty.className = 'link-empty';
      empty.textContent = state.state === 'disconnected'
        ? 'Sin filas: no hay monitor del cual leerlas.'
        : 'Sin filas todavía: el monitor publica su primer escaneo al terminar.';
      ui.links.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.links.forEach((link, index) => fragment.append(buildLink(link, index)));
    ui.links.replaceChildren(fragment);

    if (focused) {
      const again = ui.links.querySelector(`[data-key="${CSS.escape(focused)}"]`);
      if (again) again.focus();
    }
  }

  function renderAlert(state) {
    const notices = state.notices || [];
    const last = notices.length ? notices[notices.length - 1] : '';
    ui.alert.textContent = last || 'Sin avisos desde que arrancó este monitor.';
    ui.alert.classList.toggle('is-empty', !last);
  }

  function renderProvenance(state) {
    const bits = [];
    bits.push(state.demo ? 'datos: demo sintético' : `datos: ${state.source || 'sin origen'}`);
    bits.push(`escaneos: ${state.scans}`);
    // With no monitor running, the requested interval is not a fact about anything yet.
    if (state.interval && state.scans) bits.push(`intervalo: ${Math.round(state.interval)}s`);
    if (state.pid) bits.push(`pid: ${state.pid}`);
    ui.provenance.textContent = bits.join(' · ');
  }

  /* The badge never claims a mode the panel cannot see: with no monitor running there is
     neither LIVE nor DEMO, and a stale or starting snapshot says so next to the mode. */
  function renderMode(state) {
    if (state.state === 'disconnected') {
      ui.mode.textContent = 'DISCONNECTED';
      ui.mode.dataset.mode = 'none';
      return;
    }
    const mode = state.demo ? 'DEMO' : 'LIVE';
    const freshness = state.state === 'live' ? '' : ` ${state.state.toUpperCase()}`;
    ui.mode.textContent = `${mode}${freshness}`;
    ui.mode.dataset.mode = state.demo ? 'demo' : 'live';
  }

  function renderAge() {
    if (!payload || !payload.updated) {
      ui.age.textContent = '—';
      return;
    }
    const age = Math.max(0, Date.now() / 1000 - payload.updated);
    ui.age.textContent = `hace ${duration(age)}`;
  }

  function announce(state) {
    if (state.state === lastState) return;
    lastState = state.state;
    ui.announcer.textContent = ui.sentence.textContent || '';
  }

  function render(state) {
    payload = state;
    document.body.classList.remove('is-loading');
    root.dataset.reach = 'ok';
    root.dataset.trust = state.state === 'live' ? 'true' : 'false';
    renderMode(state);
    ui.demoNote.hidden = !state.demo;
    ui.scan.textContent = state.updated ? `escaneo ${clock(state.updated)}` : 'sin escaneo';
    renderSentence(state);
    renderBreakdown(state);
    renderNote(state);
    renderLinks(state);
    renderAlert(state);
    renderProvenance(state);
    renderAge();
    announce(state);
  }

  function unreachable() {
    root.dataset.reach = 'lost';
    root.dataset.trust = 'false';
    /* The badge is not a fact about the monitor here: nothing answered, so it stops
       repeating the last state the server said and names the missing server instead. */
    ui.mode.textContent = 'SIN SERVIDOR';
    ui.mode.dataset.mode = 'none';
    ui.sentence.replaceChildren('No se pudo leer el panel.');
    ui.breakdown.textContent = '';
    ui.note.hidden = false;
    ui.note.replaceChildren(`El servidor local no responde; reintentando cada ${POLL_MS / 1000} segundos.`);
  }

  async function poll() {
    try {
      const response = await fetch('/api/snapshot', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(String(response.status));
      render(await response.json());
    } catch (error) {
      unreachable();
    }
  }

  document.body.classList.add('is-loading');
  poll();
  setInterval(renderAge, AGE_TICK_MS);
  setInterval(() => {
    if (!document.hidden) poll();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
})();
