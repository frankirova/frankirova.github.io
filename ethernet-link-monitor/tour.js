'use strict';

/* Guided tour for the demo: a small card that points at one part of the page per step.
   It never blocks the page, so the visitor can try the simulator while reading. */

(() => {
  const STEPS = [
    {
      target: '#links',
      title: '1. El panel',
      text: 'Cada fila es un enlace Ethernet de un equipo. Los peores quedan arriba. Verde significa que la velocidad negociada alcanza el mínimo configurado.',
    },
    {
      target: '.sim-controls',
      title: '2. Provocá una falla',
      text: 'Elegí un equipo y apretá "Puerto caído". Es lo que pasaría si el cable se corta o la antena se apaga. "Velocidad baja" simula un puerto que negocia menos de lo esperado.',
    },
    {
      target: '#sentence',
      title: '3. El monitor confirma',
      text: 'El resumen pasa a "fuera de norma", pero todavía no avisa. El monitor espera 2 escaneos seguidos con el mismo estado, para no molestar por una falla de un solo instante.',
    },
    {
      target: '#tg',
      title: '4. Llega el aviso',
      text: 'Pasados unos 4 segundos sale el aviso por Telegram con el equipo, la IP, el puerto y la velocidad. Apretá "Recuperar equipo" para ver el mensaje de recuperación. En esta demo no se envía nada.',
    },
  ];

  const card = document.createElement('aside');
  card.className = 'tour';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Guía de la demo');
  card.hidden = true;

  const title = document.createElement('h2');
  const text = document.createElement('p');
  const counter = document.createElement('span');
  counter.className = 'tour-count';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Anterior';
  const next = document.createElement('button');
  next.type = 'button';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'tour-skip';
  skip.textContent = 'Cerrar';
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  actions.append(counter, back, next, skip);
  card.append(title, text, actions);
  document.body.append(card);

  const reopen = document.createElement('button');
  reopen.type = 'button';
  reopen.className = 'tour-reopen';
  reopen.textContent = '¿Cómo funciona?';
  reopen.hidden = true;
  document.body.append(reopen);

  let current = 0;
  let marked = null;

  function mark(selector) {
    if (marked) marked.classList.remove('tour-focus');
    marked = document.querySelector(selector);
    if (!marked) return;
    marked.classList.add('tour-focus');
    marked.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function show(index) {
    current = index;
    const step = STEPS[index];
    title.textContent = step.title;
    text.textContent = step.text;
    counter.textContent = `${index + 1} / ${STEPS.length}`;
    back.disabled = index === 0;
    next.textContent = index === STEPS.length - 1 ? 'Terminar' : 'Siguiente';
    card.hidden = false;
    reopen.hidden = true;
    mark(step.target);
  }

  function close() {
    card.hidden = true;
    reopen.hidden = false;
    if (marked) marked.classList.remove('tour-focus');
    marked = null;
  }

  back.addEventListener('click', () => show(Math.max(0, current - 1)));
  next.addEventListener('click', () => (current === STEPS.length - 1 ? close() : show(current + 1)));
  skip.addEventListener('click', close);
  reopen.addEventListener('click', () => show(0));

  document.addEventListener('DOMContentLoaded', () => show(0));
})();
