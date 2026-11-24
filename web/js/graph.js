/**
 * OmniCalc — graficadora 2D (canvas).
 * El motor C evalúa las 4096 muestras de cada función en UNA llamada (oc_eval_range).
 * Soporta hasta 4 funciones, arrastre, pellizco, rueda, valores al pasar el cursor,
 * raíces en la ventana visible y exportar PNG.
 */
import { SLOT, fmt } from './core.js';
import { $, $$, el, store, setMsg, download, raf } from './ui.js';

const MAX_FNS = 4;
const DEFAULT_VIEW = { cx: 0, cy: 0, sx: 40, sy: 40 };   // centro (unidades) y píxeles por unidad

export function initGraph(core) {
  const canvas = $('#plot'), wrap = canvas.parentElement, tip = $('#plot-tip'), msg = $('#graph-msg');
  const list = $('#fn-list');
  const ctx2d = canvas.getContext('2d');
  let fns = (store.get('graph.fns') || ['sin(x)']).slice(0, MAX_FNS).map(String);
  let view = { ...DEFAULT_VIEW };
  let showRoots = false, W = 0, H = 0, dpr = 1;
  let roots = [];                  // [{x, i}]
  let hover = null;                // {px}

  const css = () => getComputedStyle(document.documentElement);
  const color = (i) => css().getPropertyValue(`--f${i + 1}`).trim() || '#19e6bd';

  /* ---------- Lista de funciones ---------- */
  function renderList() {
    list.replaceChildren(...fns.map((expr, i) => {
      const input = el('input', { class: 'input', type: 'text', value: expr, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `f${i + 1}(x)`, placeholder: 'Ej: sin(x)/x' });
      input.addEventListener('input', () => { fns[i] = input.value; input.classList.remove('invalid'); persist(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); plot(); } });
      const rm = el('button', { class: 'rm', type: 'button', 'aria-label': `Quitar f${i + 1}`, text: '×', onclick: () => { fns.splice(i, 1); if (!fns.length) fns.push(''); renderList(); plot(); } });
      return el('div', { class: 'fn-row' }, el('span', { class: 'dot f-c' + i, 'aria-hidden': 'true' }), el('label', { text: `f${i + 1}(x) =` }), input, rm);
    }));
    $('#btn-add-fn').disabled = fns.length >= MAX_FNS;
  }
  const persist = () => store.set('graph.fns', fns);

  /* ---------- Compilación ---------- */
  function compileAll() {
    const errs = [];
    const inputs = $$('.fn-row .input', list);
    const active = [];
    fns.forEach((expr, i) => {
      inputs[i]?.classList.remove('invalid');
      if (expr.trim() === '') return;
      const c = core.compile(expr, SLOT.GRAPH + i);
      if (!c.ok) { errs.push(`f${i + 1}: ${c.message}${c.pos >= 0 ? ` (posición ${c.pos + 1})` : ''}`); inputs[i]?.classList.add('invalid'); return; }
      active.push(i);
    });
    return { active, errs };
  }

  /* ---------- Dibujo ---------- */
  function niceStep(range) {
    const raw = range / 8, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  const toPx = (x) => W / 2 + (x - view.cx) * view.sx;
  const toPy = (y) => H / 2 - (y - view.cy) * view.sy;
  const fromPx = (px) => view.cx + (px - W / 2) / view.sx;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  }

  let activeFns = [];
  function draw() {
    const g = ctx2d, cs = css();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cs.getPropertyValue('--lcd').trim() || '#070b0f'; g.fillRect(0, 0, W, H);
    const dim = cs.getPropertyValue('--text-dim').trim() || '#8fa1b3', border = cs.getPropertyValue('--border').trim() || '#243241';
    const xmin = fromPx(0), xmax = fromPx(W), ymax = view.cy + H / 2 / view.sy, ymin = view.cy - H / 2 / view.sy;

    /* cuadrícula y ejes */
    const sx = niceStep(xmax - xmin), sy = niceStep(ymax - ymin);
    g.font = '11px ui-monospace, Menlo, Consolas, monospace'; g.lineWidth = 1;
    const ax = Math.min(Math.max(toPx(0), 0), W), ay = Math.min(Math.max(toPy(0), 0), H);
    g.strokeStyle = border; g.fillStyle = dim; g.beginPath();
    for (let x = Math.ceil(xmin / sx) * sx; x <= xmax; x += sx) { const px = Math.round(toPx(x)) + .5; g.moveTo(px, 0); g.lineTo(px, H); }
    for (let y = Math.ceil(ymin / sy) * sy; y <= ymax; y += sy) { const py = Math.round(toPy(y)) + .5; g.moveTo(0, py); g.lineTo(W, py); }
    g.stroke();
    g.strokeStyle = dim; g.beginPath(); g.moveTo(0, Math.round(ay) + .5); g.lineTo(W, Math.round(ay) + .5); g.moveTo(Math.round(ax) + .5, 0); g.lineTo(Math.round(ax) + .5, H); g.stroke();
    g.textBaseline = 'top'; g.textAlign = 'center';
    for (let x = Math.ceil(xmin / sx) * sx; x <= xmax; x += sx) { if (Math.abs(x) < sx / 2) continue; g.fillText(fmt(+x.toPrecision(10), 6), toPx(x), Math.min(ay + 4, H - 14)); }
    g.textAlign = 'left';
    for (let y = Math.ceil(ymin / sy) * sy; y <= ymax; y += sy) { if (Math.abs(y) < sy / 2) continue; g.fillText(fmt(+y.toPrecision(10), 6), Math.min(ax + 5, W - 40), toPy(y) - 14 < 0 ? toPy(y) + 2 : toPy(y) - 13); }

    /* curvas */
    const n = Math.min(Math.max(2, Math.ceil(W * 1.5)), core.caps.pts), dx = (xmax - xmin) / (n - 1);
    g.lineWidth = 2.2; g.lineJoin = 'round';
    for (const i of activeFns) {
      const ys = core.evalRange(SLOT.GRAPH + i, xmin, dx, n);
      g.strokeStyle = color(i); g.beginPath();
      let pen = false, prevY = 0;
      const lim = H * 6;
      for (let k = 0; k < n; k++) {
        const y = ys[k];
        if (!Number.isFinite(y)) { pen = false; continue; }
        const px = toPx(xmin + dx * k), py = toPy(y);
        if (py < -lim || py > H + lim) { pen = false; continue; }
        if (pen && Math.abs(py - prevY) > H * 1.2 && Math.sign(py - H / 2) !== Math.sign(prevY - H / 2)) pen = false;   // asíntota vertical
        if (pen) g.lineTo(px, py); else g.moveTo(px, py);
        pen = true; prevY = py;
      }
      g.stroke();
    }

    /* raíces */
    if (showRoots) {
      for (const r of roots) {
        const px = toPx(r.x), py = toPy(0);
        g.fillStyle = color(r.i); g.strokeStyle = cs.getPropertyValue('--lcd').trim(); g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, 5, 0, 7); g.fill(); g.stroke();
      }
    }

    /* cursor */
    if (hover) {
      g.strokeStyle = dim; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(hover.px) + .5, 0); g.lineTo(Math.round(hover.px) + .5, H); g.stroke(); g.setLineDash([]);
      const x = fromPx(hover.px);
      for (const i of activeFns) {
        const { value, flags } = core.eval(SLOT.GRAPH + i, x);
        if (Number.isFinite(value) && !flags) { g.fillStyle = color(i); g.beginPath(); g.arc(hover.px, toPy(value), 4.5, 0, 7); g.fill(); }
      }
    }
  }
  const redraw = raf(draw);

  function findRoots() {
    roots = [];
    if (!showRoots) return;
    const a = fromPx(0), b = fromPx(W);
    for (const i of activeFns) {
      const r = core.roots(fns[i], a, b, 24);
      if (r.ok) r.roots.forEach((x) => roots.push({ x, i }));
    }
  }

  function updateTip() {
    if (!hover) { tip.hidden = true; return; }
    const x = fromPx(hover.px);
    const rows = [el('div', { text: `x = ${fmt(x, 6)}` })];
    for (const i of activeFns) {
      const { value } = core.eval(SLOT.GRAPH + i, x);
      rows.push(el('div', { class: 'f-c' + i, text: `f${i + 1} = ${Number.isFinite(value) ? fmt(value, 6) : 'no definida'}` }));
    }
    tip.replaceChildren(...rows); tip.hidden = false;
    const tw = tip.offsetWidth || 120;
    tip.style.left = `${Math.min(Math.max(hover.px + 12, 4), W - tw - 4)}px`;
    tip.style.top = '8px';
  }

  /* ---------- API pública ---------- */
  function plot({ fit = false } = {}) {
    const { active, errs } = compileAll();
    activeFns = active;
    if (errs.length) setMsg(msg, errs.join(' · '), 'error');
    else if (!active.length) setMsg(msg, 'Escribe al menos una función de x.', 'warn');
    else setMsg(msg, '');
    if (fit) autoFit();
    findRoots(); draw(); persist();
  }

  /** Ajusta la ventana vertical al rango de valores visible (ignora extremos absurdos). */
  function autoFit() {
    const n = 400, xmin = fromPx(0), xmax = fromPx(W), vals = [];
    for (const i of activeFns) for (const y of core.evalRange(SLOT.GRAPH + i, xmin, (xmax - xmin) / (n - 1), n)) if (Number.isFinite(y)) vals.push(y);
    if (vals.length < 2) return;
    vals.sort((p, q) => p - q);
    const lo = vals[Math.floor(vals.length * 0.03)], hi = vals[Math.ceil(vals.length * 0.97) - 1];
    let span = hi - lo;
    if (!(span > 1e-9)) { view.cy = lo; view.sy = view.sx; return; }
    span *= 1.3;
    view.cy = (lo + hi) / 2; view.sy = Math.min(Math.max(H / span, 1e-6), 1e7);
  }

  function reset() {
    view = { ...DEFAULT_VIEW }; view.sx = Math.max(20, Math.min(60, W / 20)); view.sy = view.sx;
    plot({ fit: false });
  }
  function zoom(f, px = W / 2, py = H / 2) {
    const x = fromPx(px), y = view.cy - (py - H / 2) / view.sy;
    view.sx = Math.min(Math.max(view.sx * f, 1e-6), 1e7); view.sy = Math.min(Math.max(view.sy * f, 1e-6), 1e7);
    view.cx = x - (px - W / 2) / view.sx; view.cy = y + (py - H / 2) / view.sy;
    findRoots(); updateTip(); redraw();
  }

  /* ---------- Interacción ---------- */
  const pointers = new Map();
  let pinch = 0, moved = false;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = false;
    if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch = Math.hypot(p.x - q.x, p.y - q.y); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) { hover = { px: e.offsetX }; updateTip(); redraw(); return; }
    if (pointers.size === 1) {
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      view.cx -= dx / view.sx; view.cy += dy / view.sy; hover = moved ? null : { px: e.offsetX };
      findRoots(); updateTip(); redraw();
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; hover = null; moved = true;
    }
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  });
  const endPtr = (e) => {
    pointers.delete(e.pointerId); pinch = 0;
    if (e.type === 'pointerup' && !moved && e.pointerType !== 'mouse') { hover = { px: e.offsetX }; updateTip(); redraw(); }
  };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) { hover = null; updateTip(); redraw(); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => zoom(2, e.offsetX, e.offsetY));

  $('#btn-add-fn').addEventListener('click', () => { if (fns.length < MAX_FNS) { fns.push(''); renderList(); $$('.fn-row .input', list).at(-1)?.focus(); } });
  $('#btn-plot').addEventListener('click', () => plot({ fit: true }));
  $('.toolbar', $('#tab-graph')).addEventListener('click', (e) => {
    const b = e.target.closest('[data-gact]'); if (!b) return;
    const a = b.dataset.gact;
    if (a === 'zoomin') zoom(1.4); else if (a === 'zoomout') zoom(1 / 1.4); else if (a === 'reset') reset();
    else if (a === 'roots') { showRoots = !showRoots; b.setAttribute('aria-pressed', String(showRoots)); findRoots(); draw(); }
    else if (a === 'png') canvas.toBlob((blob) => blob && download(blob, 'omnicalc-grafica.png'), 'image/png');
  });
  new ResizeObserver(() => { if (!canvas.offsetParent) return; resize(); }).observe(canvas);
  document.addEventListener('omni:themechange', redraw);
  document.addEventListener('omni:anglechange', () => { if (activeFns.length) { findRoots(); draw(); } });

  renderList();
  return {
    /** Muestra el panel con una expresión como f1(x) */
    setFunction(expr) { fns[0] = expr; renderList(); },
    /** Se llama al activar la pestaña (el canvas no tiene tamaño mientras está oculto). */
    show() { requestAnimationFrame(() => { resize(); if (!activeFns.length && fns.some((f) => f.trim())) { reset(); plot({ fit: true }); } else draw(); }); },
    plot,
  };
}
