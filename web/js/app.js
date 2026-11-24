/**
 * OmniCalc Pro — arranque de la aplicación: motor WASM, pestañas, ajustes,
 * calculadora básica (con historial y memoria) y registro del Service Worker.
 */
import { OmniCore, setPrecision, fmt, SLOT, normalizeExpr, autoClose, PRECISIONS } from './core.js';
import { $, $$, el, store, toast, setMsg, copyText, raf } from './ui.js';
import { initGraph } from './graph.js';
import { initMatrix, initStats, initCalculus, initProgrammer, initDiscrete, initNetwork } from './tools.js';
import { initSets, initPoly, initRatio } from './learn.js';

const TABS = ['calc', 'graph', 'matrix', 'stats', 'calculus', 'prog', 'discrete', 'network', 'sets', 'poly', 'ratio'];
const ANGLES = ['rad', 'deg', 'grad'];
const ANGLE_LABEL = { rad: 'RAD', deg: 'DEG', grad: 'GRAD' };

async function main() {
  let core;
  try {
    core = await OmniCore.load('omnicalc.wasm');
  } catch (err) {
    $('#boot').textContent = 'No se pudo cargar el motor WebAssembly. Recarga la página.';
    $('#boot').classList.add('error');
    console.error(err);
    return;
  }

  /* ---------------- Ajustes ---------------- */
  const settings = { theme: 'auto', prec: 15, angle: 'rad', ...store.get('settings', {}) };
  const saveSettings = () => store.set('settings', settings);
  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    setPrecision(PRECISIONS.includes(settings.prec) ? settings.prec : 15);
    core.setAngle(settings.angle);
    $('#btn-angle').textContent = ANGLE_LABEL[settings.angle];
    $('#set-theme').value = settings.theme; $('#set-prec').value = String(settings.prec); $('#set-angle').value = settings.angle;
  }
  applySettings();

  /* ---------------- Pestañas ---------------- */
  const mods = {};
  let current = 'calc';
  function openTab(name, { focus = false } = {}) {
    if (!TABS.includes(name)) name = 'calc';
    current = name;
    for (const t of TABS) {
      const on = t === name;
      const tab = $(`#t-${t}`); tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
      $(`#tab-${t}`).hidden = !on;
      if (on && focus) tab.focus();
    }
    $(`#t-${name}`).scrollIntoView({ block: 'nearest', inline: 'center' });
    store.set('tab', name);
    mods[name]?.show?.();
  }
  $('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
  $('.tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault(); openTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
  });

  /* ---------------- Calculadora básica ---------------- */
  const display = $('#display'), preview = $('#preview'), errBox = $('#calc-error'), histLine = $('#history-line');
  let history = store.get('history', []);
  let memory = store.get('memory', 0);
  let lastValue = 0, justEvaluated = false, shift = false;

  const OPERATOR_KEYS = new Set(['÷', '×', '-', '+', '^', '^2', '^3', '!', '^(-1)', ')']);

  function insert(text) {
    if (justEvaluated) {
      const keepsResult = OPERATOR_KEYS.has(text);
      if (!keepsResult) display.value = '';
      justEvaluated = false;
    }
    const s = display.selectionStart ?? display.value.length, e = display.selectionEnd ?? s;
    display.setRangeText(text, s, e, 'end');
    display.focus({ preventScroll: true });
    onInput();
  }
  function del() {
    if (justEvaluated) { justEvaluated = false; }
    const s = display.selectionStart ?? 0, e = display.selectionEnd ?? s;
    if (s !== e) display.setRangeText('', s, e, 'end');
    else if (s > 0) {
      const before = display.value.slice(0, s), m = /[a-z]+\($/i.exec(before);        // borra "sin(" de una vez
      const cut = m ? m[0].length : 1;
      display.setRangeText('', s - cut, s, 'end');
    }
    onInput();
  }
  function clearAll() { display.value = ''; histLine.textContent = ''; setError(''); preview.textContent = ''; justEvaluated = false; display.focus({ preventScroll: true }); }

  /** Muestra un error con la posición resaltada sobre la expresión normalizada. */
  function setError(res, src = '') {
    errBox.replaceChildren();
    if (!res) { errBox.hidden = true; return; }
    errBox.hidden = false;
    errBox.append(res.message || String(res));
    if (typeof res.pos === 'number' && res.pos >= 0 && src) {
      const p = Math.min(res.pos, src.length);
      errBox.append(el('div', {}, src.slice(0, p), el('span', { class: 'err-pos', text: src[p] ?? '␣' }), src.slice(p + 1)));
    }
  }

  function evaluateDisplay() {
    const raw = display.value.trim();
    if (!raw) return { empty: true };
    const src = autoClose(normalizeExpr(raw));
    const c = core.compile(src, SLOT.BASIC);
    if (!c.ok) return { ok: false, ...c, src };
    if (c.usesX) return { ok: false, message: 'La variable x solo se usa en Gráficos y Cálculo. Pulsa «Graficar» para ver la función.', pos: -1, src };
    const { value, flags } = core.eval(SLOT.BASIC, 0);
    if (!Number.isFinite(value)) return { ok: false, message: (core.evaluate(src).message) || 'Resultado no definido', pos: -1, src };
    return { ok: true, value, src, flags };
  }

  const livePreview = raf(() => {
    const r = evaluateDisplay();
    const isPlain = /^[-+]?[\d.]+$/.test(display.value.trim());
    preview.textContent = r.ok && !isPlain ? '= ' + fmt(r.value) : '';
  });
  function onInput() { setError(''); livePreview(); }

  function equals() {
    const r = evaluateDisplay();
    if (r.empty) return;
    if (!r.ok) { setError(r, r.src); display.classList.remove('shake'); void display.offsetWidth; display.classList.add('shake'); return; }
    setError('');
    const text = fmt(r.value);
    const exprShown = display.value.trim();
    histLine.textContent = exprShown + ' =';
    display.value = text; preview.textContent = '';
    lastValue = r.value; core.setAns(r.value); justEvaluated = true;
    if (history[0]?.e !== exprShown || history[0]?.r !== text) history.unshift({ e: exprShown, r: text });
    history = history.slice(0, 60); store.set('history', history); renderHistory();
    if (r.flags & 4) setError({ message: 'Aviso: resultado muy grande (cerca del desbordamiento).' });
  }

  function currentNumber() {
    const r = evaluateDisplay();
    if (r.ok) return r.value;
    return lastValue;
  }
  function renderMem() { $('#mem-ind').hidden = memory === 0; }

  function renderHistory() {
    const ul = $('#history-list');
    ul.replaceChildren(...history.map((h) => el('li', {}, el('button', { type: 'button', title: 'Reutilizar resultado (Mayús+clic: reutilizar expresión)', onclick: (ev) => { insertFromHistory(ev.shiftKey ? h.e : h.r); } },
      el('div', { class: 'h-expr', text: h.e }), el('div', { class: 'h-res', text: '= ' + h.r })))));
    $('#history-empty').hidden = history.length > 0;
  }
  function insertFromHistory(t) {
    justEvaluated = false; insert(t);
    if (window.matchMedia('(max-width: 899px)').matches) toggleHistory(false);
  }
  function toggleHistory(force) {
    const card = $('#history-card'), open = force ?? !card.classList.contains('open');
    card.classList.toggle('open', open); $('#btn-hist-toggle').setAttribute('aria-expanded', String(open));
  }

  function setShift(on) {
    shift = on; $('#btn-2nd').setAttribute('aria-pressed', String(on)); $('#keys').classList.toggle('shifted', on);
    for (const k of $$('.k[data-alt]')) {
      if (!k.dataset.label) k.dataset.label = k.textContent;
      k.textContent = on ? k.dataset.altlabel : k.dataset.label;
    }
  }

  const ACTIONS = {
    ac: clearAll, del, eval: equals,
    mc: () => { memory = 0; store.set('memory', 0); renderMem(); toast('Memoria borrada'); },
    mr: () => { if (memory !== 0) insert(fmt(memory, 17)); else toast('La memoria está vacía'); },
    mplus: () => { memory += currentNumber(); store.set('memory', memory); renderMem(); toast(`M = ${fmt(memory)}`); },
    mminus: () => { memory -= currentNumber(); store.set('memory', memory); renderMem(); toast(`M = ${fmt(memory)}`); },
    graph: () => { const t = display.value.trim(); if (!t) return toast('Escribe una función de x, por ejemplo sin(x)'); mods.graph.setFunction(normalizeExpr(t)); openTab('graph'); mods.graph.plot({ fit: true }); },
    copy: () => { const r = evaluateDisplay(); copyText(r.ok && !justEvaluated ? fmt(r.value) : display.value); },
    deriv: () => { const t = display.value.trim(); if (t) mods.calculus.setExpr(normalizeExpr(t)); openTab('calculus'); toast('Elige el punto x y pulsa «d/dx en x»'); },
    integ: () => { const t = display.value.trim(); if (t) mods.calculus.setExpr(normalizeExpr(t)); openTab('calculus'); toast('Elige los límites y pulsa «Integral definida»'); },
  };

  $('#keys').addEventListener('click', (e) => {
    const k = e.target.closest('.k'); if (!k) return;
    if (k.dataset.act) { ACTIONS[k.dataset.act]?.(); return; }
    const text = shift && k.dataset.alt ? k.dataset.alt : k.dataset.k;
    if (text) { insert(text); if (shift) setShift(false); }
  });
  $('.calc-tools').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) ACTIONS[b.dataset.act]?.(); });
  $('#btn-2nd').addEventListener('click', () => setShift(!shift));
  $('#btn-hist-toggle').addEventListener('click', () => toggleHistory());
  $('#btn-clear-history').addEventListener('click', () => { history = []; store.set('history', history); renderHistory(); });
  display.addEventListener('input', () => { justEvaluated = false; onInput(); });
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); equals(); }
    else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
  });
  $('#btn-angle').addEventListener('click', () => {
    settings.angle = ANGLES[(ANGLES.indexOf(settings.angle) + 1) % ANGLES.length]; saveSettings(); applySettings();
    document.dispatchEvent(new Event('omni:anglechange')); onInput(); toast(`Ángulos en ${settings.angle === 'rad' ? 'radianes' : settings.angle === 'deg' ? 'grados' : 'gradianes'}`);
  });

  /* ---------------- Módulos ---------------- */
  mods.graph = initGraph(core);
  initMatrix(core);
  mods.stats = initStats(core);
  mods.calculus = initCalculus(core, { toGraph: (expr) => { mods.graph.setFunction(normalizeExpr(expr)); openTab('graph'); mods.graph.plot({ fit: true }); } });
  mods.prog = initProgrammer(core);
  initDiscrete(core);
  initNetwork(core);
  mods.sets = initSets(); mods.poly = initPoly(); mods.ratio = initRatio();

  /* ---------------- Diálogo de ajustes ---------------- */
  const dlg = $('#dlg-settings');
  $('#btn-settings').addEventListener('click', () => { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); });
  $('#set-theme').addEventListener('change', (e) => { settings.theme = e.target.value; saveSettings(); applySettings(); document.dispatchEvent(new Event('omni:themechange')); });
  $('#set-prec').addEventListener('change', (e) => { settings.prec = Number(e.target.value); saveSettings(); applySettings(); onInput(); });
  $('#set-angle').addEventListener('change', (e) => { settings.angle = e.target.value; saveSettings(); applySettings(); document.dispatchEvent(new Event('omni:anglechange')); onInput(); });
  $('#btn-reset-all').addEventListener('click', () => {
    if (!confirm('¿Borrar historial, memoria y todos los datos guardados?')) return;
    store.clearAll(); history = []; memory = 0; renderHistory(); renderMem(); toast('Datos borrados. Se aplicarán los valores por defecto al recargar.');
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });     // clic en el fondo cierra
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => document.dispatchEvent(new Event('omni:themechange')));
  $('#about-line').textContent = `Motor C/WebAssembly v${(core.version / 100).toFixed(1)} · ${(core.mem.buffer.byteLength / 1024 / 1024).toFixed(1)} MB de memoria fija · 100% sin conexión`;

  /* ---------------- Conexión e instalación ---------------- */
  const pill = $('#offline-pill');
  const net = () => { pill.hidden = navigator.onLine; };
  addEventListener('online', net); addEventListener('offline', net); net();
  let installEvt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btn-install').hidden = true; });
  addEventListener('appinstalled', () => { $('#btn-install').hidden = true; toast('Aplicación instalada'); });

  /* ---------------- Atajos globales ---------------- */
  addEventListener('keydown', (e) => {
    if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); openTab(TABS[Number(e.key) - 1], { focus: false }); }
  });

  /* ---------------- Inicio ---------------- */
  renderHistory(); renderMem(); setShift(false);
  $('#boot').hidden = true; $('#main').hidden = false;
  const startTab = (location.hash || '').replace('#', '') || store.get('tab', 'calc');
  openTab(TABS.includes(startTab) ? startTab : 'calc');
  if (current === 'calc') display.focus({ preventScroll: true });
  window.__omni = { core };      // útil para depurar en consola

  /* ---------------- Service Worker ---------------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const offerUpdate = (worker) => toast('Hay una versión nueva disponible', { action: 'Actualizar', ms: 0, onAction: () => worker.postMessage('SKIP_WAITING') });
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    } catch (err) { console.warn('Service Worker no disponible', err); }
  }
}

main();
