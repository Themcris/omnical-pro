/**
 * OmniCalc — módulos de la interfaz: Matrices, Estadística, Cálculo, Programador,
 * Matemáticas discretas y Redes. Cada init*() recibe el puente `core` y enlaza su pestaña.
 */
import { fmt, SLOT } from './core.js';
import { $, $$, el, store, setMsg, copyText, parseNumberList, showSteps, toast } from './ui.js';

/* ====================================================================
 *  MATRICES
 * ==================================================================== */
export function initMatrix(core) {
  const sizeSel = $('#mx-size'), kIn = $('#mx-k'), msg = $('#mx-msg');
  const gridA = $('#grid-a'), gridB = $('#grid-b'), gridR = $('#grid-r'), scalar = $('#mx-scalar'), toA = $('#mx-to-a'), steps = $('#steps-matrix');
  const saved = store.get('matrix', null);
  let n = Number(saved?.n) || 3;
  let data = { A: saved?.A || [], B: saved?.B || [] };      // texto de cada celda (n*n, fila a fila)
  let lastResult = null;
  sizeSel.value = String(n);

  const cells = (g) => $$('input', g);
  function build(grid, key) {
    grid.style.setProperty('--n', n);
    const old = data[key];
    grid.replaceChildren(...Array.from({ length: n * n }, (_, i) => {
      const r = Math.floor(i / n), c = i % n;
      const input = el('input', { class: 'input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `${key}[${r + 1},${c + 1}]`, value: old[r * (data.n || n) + c] ?? (r === c && key === 'A' ? '1' : '0') });
      input.addEventListener('input', () => { input.classList.remove('invalid'); store.set('matrix', snapshot()); });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => {
        const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: n, ArrowUp: -n }[e.key];
        if (move && (e.key.length > 5 && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || input.selectionStart === input.value.length || input.selectionStart === 0))) {
          const nx = cells(grid)[i + move]; if (nx) { e.preventDefault(); nx.focus(); }
        }
        if (e.key === 'Enter') { e.preventDefault(); const nx = cells(grid)[i + 1]; if (nx) nx.focus(); }
      });
      return input;
    }));
  }
  function snapshot() { return { n, A: cells(gridA).map((i) => i.value), B: cells(gridB).map((i) => i.value) }; }
  function rebuild(newN) {
    const prev = snapshot(); data = { A: prev.A, B: prev.B, n: prev.n };
    n = newN; build(gridA, 'A'); build(gridB, 'B'); data.n = n;
    renderResult(null); store.set('matrix', snapshot());
  }
  function fill(key, mode) {
    const g = key === 'A' ? gridA : gridB;
    cells(g).forEach((inp, i) => {
      const r = Math.floor(i / n), c = i % n;
      inp.value = mode === 'id' ? (r === c ? '1' : '0') : mode === 'zero' ? '0' : String(Math.floor(Math.random() * 19) - 9);
      inp.classList.remove('invalid');
    });
    store.set('matrix', snapshot());
  }

  function readGrid(grid, name) {
    const out = [];
    for (const inp of cells(grid)) {
      const t = inp.value.trim();
      if (t === '') { out.push(0); continue; }
      const c = core.constant(t, 0);
      if (!c.ok || !Number.isFinite(c.value)) { inp.classList.add('invalid'); inp.focus(); return { error: `Matriz ${name}: «${t}» no es un número válido (${c.message || 'valor no finito'}).` }; }
      out.push(c.value);
    }
    return { values: out };
  }

  function renderResult(res) {
    gridR.style.setProperty('--n', n);
    gridR.replaceChildren(); scalar.textContent = ''; toA.hidden = true; lastResult = null;
    if (!res) { showSteps(steps, ''); return; }
    if (res.matrix) {
      gridR.replaceChildren(...res.matrix.map((v) => el('div', { class: 'cell', text: fmt(Object.is(v, -0) ? 0 : v) })));
      lastResult = res.matrix; toA.hidden = false;
    }
  }

  const NAMES = { 1: 'A + B', 2: 'A − B', 3: 'A × B', 4: 'Aᵀ', 5: 'A⁻¹', 6: 'det(A)', 7: 'rango(A)', 8: 'traza(A)', 9: 'Aⁿ', 10: 'Solución x de A·x = b', 11: 'k · A' };
  function run(op) {
    setMsg(msg, '');
    cells(gridA).concat(cells(gridB)).forEach((i) => i.classList.remove('invalid'));
    const A = readGrid(gridA, 'A'); if (A.error) return setMsg(msg, A.error);
    const needB = [1, 2, 3, 10].includes(op);
    const B = needB ? readGrid(gridB, 'B') : { values: new Array(n * n).fill(0) }; if (B.error) return setMsg(msg, B.error);
    let k = 0;
    if (op === 9 || op === 11) {
      const kc = core.constant(kIn.value, NaN);
      if (!kc.ok || !Number.isFinite(kc.value)) { kIn.classList.add('invalid'); return setMsg(msg, 'El valor de k / n no es válido.'); }
      kIn.classList.remove('invalid');
      if (op === 9 && (!Number.isInteger(kc.value) || Math.abs(kc.value) > 64)) return setMsg(msg, 'El exponente n debe ser un entero entre −64 y 64.');
      k = kc.value;
    }
    const res = core.matrix(op, n, A.values, B.values, k);
    renderResult(res);
    showSteps(steps, res.steps);
    if (!res.ok) { setMsg(msg, res.message); return; }
    if (res.scalar !== undefined) {
      const lbl = NAMES[op]; scalar.textContent = `${lbl} = ${fmt(res.scalar)}`;
      if (op === 6 && res.scalar === 0) setMsg(msg, 'det = 0: la matriz es singular (sin inversa).', 'warn');
    } else if (op === 5 && res.cond > 1e10) setMsg(msg, `Aviso: matriz mal condicionada (κ ≈ ${res.cond.toExponential(2)}); la inversa puede tener errores numéricos.`, 'warn');
    else if (op === 10) scalar.textContent = 'x = ' + `[${res.matrix.filter((_, i) => i % n === 0).map((v) => fmt(v)).join(', ')}]ᵀ`;
  }

  $('#mx-ops').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) run(Number(b.dataset.op)); });
  $('#mx-clear').addEventListener('click', () => { fill('A', 'zero'); fill('B', 'zero'); renderResult(null); setMsg(msg, ''); });
  $('#tab-matrix').addEventListener('click', (e) => { const b = e.target.closest('[data-mx]'); if (b) { const [k, m] = b.dataset.mx.split(':'); fill(k, m); } });
  sizeSel.addEventListener('change', () => rebuild(Number(sizeSel.value)));
  toA.addEventListener('click', () => { if (!lastResult) return; cells(gridA).forEach((inp, i) => { inp.value = fmt(lastResult[i], 12); }); store.set('matrix', snapshot()); toast('Resultado copiado a A'); });
  kIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(11); });

  data.n = saved?.n || n; build(gridA, 'A'); build(gridB, 'B'); data.n = n; renderResult(null);
}

/* ====================================================================
 *  ESTADÍSTICA
 * ==================================================================== */
export function initStats(core) {
  const xIn = $('#st-x'), yIn = $('#st-y'), msg = $('#st-msg'), out = $('#st-results'), reg = $('#st-reg'), hist = $('#st-hist');
  const saved = store.get('stats', null);
  if (saved) { xIn.value = saved.x ?? xIn.value; yIn.value = saved.y ?? ''; }
  let lastText = '';

  function histogram(values) {
    const n = values.length; if (n < 2) { hist.hidden = true; return; }
    const lo = Math.min(...values), hi = Math.max(...values);
    if (lo === hi) { hist.hidden = true; return; }
    const bins = Math.min(20, Math.max(5, Math.ceil(Math.log2(n) + 1)));
    const counts = new Array(bins).fill(0), w = (hi - lo) / bins;
    for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
    hist.hidden = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3), r = hist.getBoundingClientRect(), W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    hist.width = W * dpr; hist.height = H * dpr;
    const g = hist.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    const max = Math.max(...counts), pad = 6, bw = (W - pad * 2) / bins;
    g.fillStyle = cs.getPropertyValue('--accent').trim() || '#19e6bd';
    counts.forEach((c, i) => { const h = (H - 26) * c / max; g.globalAlpha = .85; g.fillRect(pad + i * bw + 1, H - 16 - h, bw - 2, h); });
    g.globalAlpha = 1; g.fillStyle = cs.getPropertyValue('--text-dim').trim() || '#8fa1b3'; g.font = '10px ui-monospace, monospace'; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillText(fmt(lo, 5), pad, H - 3); g.textAlign = 'right'; g.fillText(fmt(hi, 5), W - pad, H - 3);
    g.textAlign = 'center'; g.fillText(`${bins} clases · máx. ${max}`, W / 2, H - 3);
  }

  function run() {
    setMsg(msg, ''); out.replaceChildren(); reg.hidden = true; hist.hidden = true; lastText = '';
    store.set('stats', { x: xIn.value, y: yIn.value });
    const px = parseNumberList(xIn.value);
    if (px.error) return setMsg(msg, `Datos X: ${px.error}`);
    if (!px.values.length) return setMsg(msg, 'Ingresa al menos un dato en X.');
    const s = core.stats(px.values);
    if (!s.ok) return setMsg(msg, s.message);
    const items = [
      ['n', s.n], ['Suma', s.sum], ['Media', s.mean], ['Mediana', s.median], ['Moda', s.modeCount > 1 ? s.modes.map((m) => fmt(m)).join(', ') + (s.modes.length >= 12 ? '…' : '') + ` (×${s.modeCount})` : 'sin moda'],
      ['Mínimo', s.min], ['Máximo', s.max], ['Rango', s.range], ['Q1', s.q1], ['Q3', s.q3], ['RIC (IQR)', s.iqr],
      ['Varianza poblacional σ²', s.varP], ['Varianza muestral s²', s.varS], ['Desv. estándar σ', s.sdP], ['Desv. estándar s', s.sdS],
      ['Error estándar', s.sem], ['Coef. de variación', s.cv], ['Asimetría', s.skew], ['Curtosis (exceso)', s.kurt],
      ['Σx²', s.sumSq], ['Media geométrica', s.geo], ['Media armónica', s.harm],
    ];
    const show = (v) => (typeof v === 'number' ? (Number.isNaN(v) ? 'n/d' : fmt(v)) : v);
    out.replaceChildren(...items.map(([k, v]) => el('div', { class: 'stat' }, el('span', { text: k }), el('b', { text: show(v) }))));
    lastText = items.map(([k, v]) => `${k}: ${show(v)}`).join('\n');
    histogram(px.values);

    if (yIn.value.trim()) {
      const py = parseNumberList(yIn.value);
      if (py.error) return setMsg(msg, `Datos Y: ${py.error}`);
      if (py.values.length !== px.values.length) return setMsg(msg, `X tiene ${px.values.length} valores e Y tiene ${py.values.length}: deben ser iguales.`, 'warn');
      const r = core.linreg(px.values, py.values);
      if (!r.ok) return setMsg(msg, r.message);
      const sign = r.slope < 0 ? '−' : '+';
      const eq = `y = ${fmt(r.intercept)} ${sign} ${fmt(Math.abs(r.slope))}·x`;
      const strength = Math.abs(r.r) > .9 ? 'muy fuerte' : Math.abs(r.r) > .7 ? 'fuerte' : Math.abs(r.r) > .4 ? 'moderada' : 'débil';
      reg.hidden = false;
      reg.replaceChildren(
        el('div', { class: 'big-result', text: eq }),
        el('dl', { class: 'kv mono' },
          ...[['Pendiente b', fmt(r.slope)], ['Intercepto a', fmt(r.intercept)], ['Correlación r', fmt(r.r)], ['Determinación R²', fmt(r.r2)], ['Pares (x, y)', fmt(r.n)]]
            .map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))),
        el('p', { class: 'muted small', text: `Correlación ${r.r >= 0 ? 'positiva' : 'negativa'} ${strength}. Correlación no implica causalidad.` }));
      lastText += `\n\nRegresión lineal: ${eq}\nr = ${fmt(r.r)}, R² = ${fmt(r.r2)}`;
    }
  }

  $('#st-calc').addEventListener('click', run);
  $('#st-clear').addEventListener('click', () => { xIn.value = ''; yIn.value = ''; out.replaceChildren(); reg.hidden = true; hist.hidden = true; setMsg(msg, ''); lastText = ''; store.set('stats', { x: '', y: '' }); xIn.focus(); });
  $('#st-copy').addEventListener('click', () => { if (!lastText) run(); if (lastText) copyText(lastText); });
  for (const t of [xIn, yIn]) t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  window.addEventListener('resize', () => { if (!hist.hidden && $('#tab-stats').hidden === false) run(); });
  return { show() { if (lastText) run(); } };
}

/* ====================================================================
 *  CÁLCULO
 * ==================================================================== */
export function initCalculus(core, { toGraph }) {
  const exprIn = $('#cx-expr'), aIn = $('#cx-a'), bIn = $('#cx-b'), xIn = $('#cx-x'), msg = $('#cx-msg');
  const label = $('#cx-label'), result = $('#cx-result'), detail = $('#cx-detail'), steps = $('#steps-calculus');
  const saved = store.get('calculus', null);
  if (saved) { exprIn.value = saved.f ?? exprIn.value; aIn.value = saved.a ?? aIn.value; bIn.value = saved.b ?? bIn.value; xIn.value = saved.x ?? xIn.value; }

  const val = (inp, name) => {
    const c = core.constant(inp.value, NaN);
    inp.classList.remove('invalid');
    if (!c.ok || Number.isNaN(c.value)) { inp.classList.add('invalid'); return { error: `${name}: ${c.message || 'escribe un valor'}${c.pos >= 0 && c.pos !== undefined ? ` (posición ${c.pos + 1})` : ''}` }; }
    return { v: c.value };
  };
  const clear = () => { result.textContent = '—'; detail.textContent = ''; showSteps(steps, ''); };
  const errNote = (e) => (e > 0 && Number.isFinite(e) ? `error estimado ≈ ${e.toExponential(1)}` : 'error estimado ≈ 0');

  function run(kind) {
    setMsg(msg, ''); clear();
    store.set('calculus', { f: exprIn.value, a: aIn.value, b: bIn.value, x: xIn.value });
    const f = exprIn.value.trim();
    if (!f) return setMsg(msg, 'Escribe la función f(x).');
    const probe = core.compile(f, SLOT.CALCULUS);
    if (!probe.ok) { exprIn.classList.add('invalid'); return setMsg(msg, `f(x): ${probe.message}${probe.pos >= 0 ? ` (posición ${probe.pos + 1})` : ''}`); }
    exprIn.classList.remove('invalid');

    if (kind === 'integral' || kind === 'roots') {
      const a = val(aIn, 'Límite a'); if (a.error) return setMsg(msg, a.error);
      const b = val(bIn, 'Límite b'); if (b.error) return setMsg(msg, b.error);
      if (kind === 'integral') {
        const r = core.integral(f, a.v, b.v);
        if (!r.ok) return setMsg(msg, r.message);
        label.textContent = `∫ f(x) dx  de ${fmt(a.v, 8)} a ${fmt(b.v, 8)}`;
        result.textContent = fmt(r.value);
        detail.textContent = `${errNote(r.error)} · ${r.evals.toLocaleString('es')} evaluaciones`;
        showSteps(steps, 'Método: cuadratura de Simpson adaptativa (32 paneles iniciales, refinamiento recursivo con extrapolación de Richardson).\nLos límites infinitos se transforman con t = x/(1+|x|) al intervalo finito.');
        if (r.bad > 0) setMsg(msg, `Aviso: la función no está definida en ${r.bad} punto(s) del intervalo (se omitieron). Revisa singularidades.`, 'warn');
        else if (a.v === b.v) setMsg(msg, 'Los límites son iguales: la integral es 0.', 'warn');
      } else {
        if (!(a.v < b.v) || !Number.isFinite(a.v) || !Number.isFinite(b.v)) return setMsg(msg, 'Para buscar raíces necesitas a < b, ambos finitos.');
        const r = core.roots(f, a.v, b.v);
        label.textContent = `Raíces de f(x) = 0 en [${fmt(a.v, 8)}, ${fmt(b.v, 8)}]`;
        if (!r.roots.length) { result.textContent = 'Sin raíces'; detail.textContent = 'No se detectó ningún cambio de signo (puede haber raíces dobles tangentes).'; }
        else { result.textContent = r.roots.length === 1 ? fmt(r.roots[0]) : `${r.roots.length} raíces`; detail.textContent = r.roots.map((x) => `x = ${fmt(x)}`).join('  ·  '); }
        showSteps(steps, 'Método: barrido de la función buscando cambios de signo y refinamiento por bisección.');
      }
    } else {
      const x = val(xIn, 'Punto x'); if (x.error) return setMsg(msg, x.error);
      const order = kind === 'deriv2' ? 2 : 1;
      const r = core.derivative(f, x.v, order);
      if (!r.ok) return setMsg(msg, r.message);
      label.textContent = `${order === 1 ? "f'" : "f''"}(${fmt(x.v, 8)})`;
      result.textContent = fmt(r.value);
      detail.textContent = errNote(r.error);
      showSteps(steps, `Método: diferencias finitas centradas de 5 puntos con extrapolación (h ≈ ${order === 1 ? '10⁻³' : '4·10⁻³'}).`);
      if (r.kink) setMsg(msg, 'Aviso: la función parece no ser derivable en ese punto (esquina o discontinuidad); el valor puede no ser fiable.', 'warn');
    }
  }

  $('#tab-calculus').addEventListener('click', (e) => { const b = e.target.closest('[data-cx]'); if (b) run(b.dataset.cx); });
  for (const inp of [exprIn, aIn, bIn, xIn]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run('integral'); });
  $('#cx-graph').addEventListener('click', () => { if (exprIn.value.trim()) toGraph(exprIn.value); else setMsg(msg, 'Escribe primero la función.'); });
  $('#cx-clear').addEventListener('click', () => { exprIn.value = ''; clear(); setMsg(msg, ''); exprIn.focus(); });
  return { setExpr(e) { exprIn.value = e; } };
}

/* ====================================================================
 *  PROGRAMADOR
 * ==================================================================== */
export function initProgrammer(core) {
  const word = $('#pg-word'), base = $('#pg-base'), aIn = $('#pg-a'), bIn = $('#pg-b'), msg = $('#pg-msg'), bitGrid = $('#bit-grid');
  const saved = store.get('prog', null);
  if (saved) { word.value = saved.w ?? '64'; base.value = saved.base ?? '10'; aIn.value = saved.a ?? aIn.value; bIn.value = saved.b ?? bIn.value; }
  let lastOp = null;
  const persist = () => store.set('prog', { w: word.value, base: base.value, a: aIn.value, b: bIn.value });

  /* texto en base -> BigInt (para convertir entre bases sin perder los 64 bits) */
  function toBig(text, b) {
    let t = text.trim().replace(/_/g, ''), neg = false;
    if (t.startsWith('-')) { neg = true; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
    const m = /^0([xbo])/i.exec(t);
    if (m) { b = { x: 16, b: 2, o: 8 }[m[1].toLowerCase()]; t = t.slice(2); }
    if (!t) return null;
    let v = 0n; const B = BigInt(b);
    for (const ch of t.toLowerCase()) { const d = parseInt(ch, 36); if (Number.isNaN(d) || d >= b) return null; v = v * B + BigInt(d); }
    return neg ? -v : v;
  }
  let prevBase = Number(base.value);
  base.addEventListener('change', () => {
    const nb = Number(base.value);
    for (const inp of [aIn, bIn]) { const v = toBig(inp.value, prevBase); if (v !== null && inp.value.trim()) inp.value = v.toString(nb).toUpperCase(); }
    prevBase = nb; persist(); refresh();
  });

  const flagIds = { cf: '#fl-cf', of: '#fl-of', zf: '#fl-zf', sf: '#fl-sf' };
  function show(r) {
    $('#pg-bin').textContent = r.bin; $('#pg-oct').textContent = r.oct; $('#pg-dec').textContent = r.dec; $('#pg-sdec').textContent = r.sdec; $('#pg-hex').textContent = '0x' + r.hex;
    for (const [k, id] of Object.entries(flagIds)) $(id).classList.toggle('on', r.flags[k]);
    $('#pg-stats').textContent = `bits en 1: ${r.pop} · ceros a la izquierda: ${r.lz} · ceros a la derecha: ${r.tz}`;
  }
  function clearShow() {
    for (const id of ['#pg-bin', '#pg-oct', '#pg-dec', '#pg-sdec', '#pg-hex']) $(id).textContent = '—';
    $$('.flag').forEach((f) => f.classList.remove('on')); $('#pg-stats').textContent = '';
  }

  function renderBits() {
    const w = Number(word.value);
    const r = core.bits(11, w, Number(base.value), aIn.value, '0');
    if (!r.ok) { bitGrid.replaceChildren(); return; }
    const bits = r.bin.replace(/ /g, '');
    const groups = [];
    for (let i = 0; i < w; i += 4) {
      const chunk = bits.slice(i, i + 4);
      groups.push(el('div', { class: 'nibble' },
        el('div', { class: 'nibble-bits' }, ...[...chunk].map((ch, j) => el('button', { type: 'button', class: 'bit' + (ch === '1' ? ' on' : ''), 'aria-pressed': String(ch === '1'), 'aria-label': `bit ${w - 1 - (i + j)}`, dataset: { i: i + j }, text: ch }))),
        el('div', { class: 'nibble-hex', text: parseInt(chunk, 2).toString(16).toUpperCase() })));
    }
    bitGrid.replaceChildren(...groups);
  }

  function run(op) {
    setMsg(msg, '');
    persist();
    const w = Number(word.value), b = Number(base.value);
    const r = core.bits(op, w, b, aIn.value, bIn.value);
    if (!r.ok) { clearShow(); setMsg(msg, r.message); return false; }
    show(r);
    const warn = [];
    if (r.truncA) warn.push(`A no cabe en ${w} bits: se usaron los ${w} bits menos significativos.`);
    if (r.truncB) warn.push(`B no cabe en ${w} bits: se truncó.`);
    if (r.shiftOver) warn.push(`El desplazamiento es ≥ ${w}: resultado 0 (o signo extendido).`);
    if (warn.length) setMsg(msg, warn.join(' '), 'warn');
    renderBits();
    return true;
  }
  function refresh() { if (lastOp) run(lastOp); else { run(11); } }

  $('#pg-ops').addEventListener('click', (e) => { const btn = e.target.closest('[data-op]'); if (btn) { lastOp = Number(btn.dataset.op); run(lastOp); } });
  $('#pg-clear').addEventListener('click', () => { aIn.value = '0'; bIn.value = '0'; lastOp = null; setMsg(msg, ''); run(11); persist(); });
  word.addEventListener('change', () => { persist(); refresh(); });
  for (const inp of [aIn, bIn]) {
    inp.addEventListener('input', () => { persist(); refresh(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(); });
  }
  bitGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.bit'); if (!btn) return;
    const w = Number(word.value), i = Number(btn.dataset.i);
    const r = core.bits(11, w, Number(base.value), aIn.value, '0'); if (!r.ok) return;
    const chars = r.bin.replace(/ /g, '').split(''); chars[i] = chars[i] === '1' ? '0' : '1';
    aIn.value = BigInt('0b' + chars.join('')).toString(Number(base.value)).toUpperCase();
    persist(); refresh();
  });

  /* ---- IEEE-754 ---- */
  const ieV = $('#ie-v'), ieT = $('#ie-t'), ieOut = $('#ie-out');
  function ieee() {
    const c = core.constant(ieV.value, NaN);
    ieV.classList.remove('invalid');
    if (!c.ok && !/^\s*(nan|-?inf)\s*$/i.test(ieV.value)) { ieV.classList.add('invalid'); ieOut.replaceChildren(el('div', { class: 'msg error', text: c.message || 'Número no válido' })); return; }
    const v = /^\s*nan\s*$/i.test(ieV.value) ? NaN : c.value;
    const f32 = ieT.value === '32', r = core.ieee(v, f32);
    ieOut.replaceChildren(
      el('div', { class: 'bits' }, el('span', { class: 'b-sign', title: 'signo', text: r.sign }), ' ', el('span', { class: 'b-exp', title: 'exponente', text: r.exp }), ' ', el('span', { class: 'b-man', title: 'mantisa', text: r.man })),
      el('div', { class: 'muted small' }, el('span', { class: 'b-sign', text: 'signo' }), ' · ', el('span', { class: 'b-exp', text: `exponente (${r.exp.length} bits)` }), ' · ', el('span', { class: 'b-man', text: `mantisa (${r.man.length} bits)` })),
      el('dl', { class: 'kv' },
        ...[['Clase', r.cls], ['Hex', '0x' + r.hex], ['Exponente real', String(r.e)], [f32 ? 'Valor almacenado (float)' : 'Valor almacenado', fmt(+r.stored, 17)]]
          .map(([k, val]) => el('div', {}, el('dt', { text: k }), el('dd', { text: val })))));
  }
  ieV.addEventListener('input', ieee); ieT.addEventListener('change', ieee);

  run(11); ieee();
  return { show() { refresh(); } };
}

/* ====================================================================
 *  DISCRETAS
 * ==================================================================== */
export function initDiscrete(core) {
  /* --- pestañas internas --- */
  const segs = $$('.seg', $('#tab-discrete'));
  function section(name) {
    segs.forEach((s) => { const on = s.dataset.dsec === name; s.classList.toggle('active', on); s.setAttribute('aria-selected', String(on)); });
    for (const id of ['comb', 'num', 'logic']) $(`#dsec-${id}`).hidden = id !== name;
    store.set('dsec', name);
  }
  segs.forEach((s) => s.addEventListener('click', () => section(s.dataset.dsec)));
  section(store.get('dsec', 'comb'));

  /* --- combinatoria --- */
  const nIn = $('#ds-n'), rIn = $('#ds-r'), dmsg = $('#ds-msg'), dres = $('#ds-result'), dlabel = $('#ds-label'), ddetail = $('#ds-detail'), dcopy = $('#ds-copy'), dsteps = $('#steps-discrete');
  let fullNumber = '';
  const DN = {
    1: ['P(n, r) = n!/(n−r)!', 'Permutaciones sin repetición', (n, r) => `P(${n}, ${r}) = ${n}!/(${n}−${r})! = ${n}·(${n}−1)·…·(${n - r + 1})`],
    2: ['C(n, r) = n!/(r!(n−r)!)', 'Combinaciones', (n, r) => `C(${n}, ${r}) = ${n}!/(${r}!·${n - r}!)`],
    3: ['n!', 'Factorial', (n) => `${n}! = 1·2·…·${n}`],
    4: ['Fibonacci(n)', 'Sucesión de Fibonacci (F₀=0, F₁=1)', (n) => `F(${n}) = F(${n}−1) + F(${n}−2)`],
    5: ['nʳ', 'Variaciones con repetición', (n, r) => `${n}^${r} = ${n} · ${n} · … (${r} veces)`],
    6: ['C(n+r−1, r)', 'Combinaciones con repetición', (n, r) => `C(${n}+${r}−1, ${r}) = C(${n + r - 1}, ${r})`],
    7: ['Catalan(n)', 'Número de Catalan Cₙ = C(2n, n)/(n+1)', (n) => `C(${n}) = C(${2 * n}, ${n})/(${n}+1)`],
  };
  const intOnly = (t) => /^\s*\d{1,10}\s*$/.test(t);
  function comb(op) {
    setMsg(dmsg, ''); dcopy.hidden = true; showSteps(dsteps, ''); fullNumber = '';
    nIn.classList.remove('invalid'); rIn.classList.remove('invalid');
    const needR = [1, 2, 5, 6].includes(op);
    if (!intOnly(nIn.value)) { nIn.classList.add('invalid'); return setMsg(dmsg, 'n debe ser un entero ≥ 0 (solo dígitos).'); }
    if (needR && !intOnly(rIn.value)) { rIn.classList.add('invalid'); return setMsg(dmsg, 'r debe ser un entero ≥ 0 (solo dígitos).'); }
    const n = Number(nIn.value), r = needR ? Number(rIn.value) : 0;
    const res = core.discrete(op, n, r);
    dlabel.textContent = DN[op][0] + ' — ' + DN[op][1];
    if (!res.ok) { dres.textContent = '—'; ddetail.textContent = ''; return setMsg(dmsg, res.message); }
    fullNumber = res.text;
    dres.textContent = res.text.length > 48 ? `${res.text.slice(0, 20)}…${res.text.slice(-20)}` : res.text;
    ddetail.textContent = res.digits > 1 ? `${res.digits.toLocaleString('es')} dígitos${res.text.length > 48 ? ' (resultado abreviado)' : ''}` : '';
    dcopy.hidden = res.text.length <= 48 && res.digits < 12;
    showSteps(dsteps, DN[op][2](n, r) + (res.digits > 1 ? `\n= ${res.text.length > 120 ? res.text.slice(0, 117) + '…' : res.text}` : `\n= ${res.text}`));
  }
  $('#ds-ops').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) comb(Number(b.dataset.op)); });
  $('#ds-clear').addEventListener('click', () => { nIn.value = ''; rIn.value = ''; dres.textContent = '—'; ddetail.textContent = ''; setMsg(dmsg, ''); showSteps(dsteps, ''); dcopy.hidden = true; nIn.focus(); });
  dcopy.addEventListener('click', () => copyText(fullNumber));
  for (const i of [nIn, rIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') comb(2); });

  /* --- teoría de números --- */
  const na = $('#nt-a'), nb = $('#nt-b'), nm = $('#nt-m'), nmsg = $('#nt-msg'), nout = $('#nt-out');
  const kv = (rows) => nout.replaceChildren(...rows.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
  function num(op) {
    setMsg(nmsg, ''); nout.replaceChildren();
    const fields = op === 1 ? [na.value, nb.value] : op === 2 ? [na.value] : op === 3 ? [na.value, nb.value, nm.value] : [na.value, nm.value];
    const r = core.numtheory(op, ...fields.map((f) => f.trim().replace(/[ _,]/g, '')));
    if (!r.ok) return setMsg(nmsg, r.message);
    const L = r.lines;
    if (op === 1) kv([['mcd(a, b)', L[0]], ['mcm(a, b)', L[1]], ['Bézout: x', L[2]], ['Bézout: y', L[3]], ['Identidad', `${na.value.trim()}·(${L[2]}) + ${nb.value.trim()}·(${L[3]}) = ${L[0]}`]]);
    else if (op === 2) {
      const rows = [['Estado', L[0]]];
      if (L[1] && L[1] !== '-' ) rows.push(['Factorización', L[1]]);
      rows.push(['Nº de divisores τ(n)', L[2]], ['φ de Euler', L[3]]);
      kv(rows);
    } else if (op === 3) kv([[`${na.value.trim()}^${nb.value.trim()} mod ${nm.value.trim()}`, L[0]]]);
    else kv([[`${na.value.trim()}⁻¹ mod ${nm.value.trim()}`, L[0]], ['Comprobación', `${na.value.trim()} · ${L[0]} ≡ 1 (mod ${nm.value.trim()})`]]);
  }
  $('#nt-ops').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) num(Number(b.dataset.op)); });
  for (const i of [na, nb, nm]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') num(1); });

  /* --- lógica --- */
  const lg = $('#lg-expr'), lmsg = $('#lg-msg'), lsum = $('#lg-summary'), ltab = $('#lg-table');
  function logic() {
    setMsg(lmsg, ''); lsum.hidden = true; ltab.hidden = true;
    const src = lg.value;
    const r = core.truth(src);
    if (!r.ok) {
      const pos = r.pos >= 0 ? ` (carácter ${r.pos + 1})` : '';
      return setMsg(lmsg, `${r.message}${pos}`);
    }
    const total = r.rows.length, trues = r.rows.filter((x) => x.out).length;
    const kind = trues === total ? 'Tautología (siempre verdadera)' : trues === 0 ? 'Contradicción (siempre falsa)' : 'Contingencia (depende de los valores)';
    lsum.hidden = false;
    lsum.replaceChildren(el('strong', { text: kind }), el('div', { class: 'muted small', text: `${trues} de ${total} combinaciones dan verdadero · ${r.vars.length} variable(s)` }));
    const head = el('tr', {}, ...r.vars.map((v) => el('th', { text: v })), el('th', { text: 'Resultado' }));
    const body = r.rows.map((row) => el('tr', {}, ...[...row.bits].map((b) => el('td', { text: b })), el('td', { class: row.out ? 'lg-true' : 'lg-false', text: row.out ? '1' : '0' })));
    ltab.replaceChildren(el('thead', {}, head), el('tbody', {}, ...body)); ltab.hidden = false;
  }
  $('#lg-run').addEventListener('click', logic);
  lg.addEventListener('keydown', (e) => { if (e.key === 'Enter') logic(); });
  $('#lg-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ins]'); if (!b) return;
    const s = lg.selectionStart ?? lg.value.length, t = lg.selectionEnd ?? s;
    lg.setRangeText(b.dataset.ins, s, t, 'end'); lg.focus();
  });
  comb(2);
}

/* ====================================================================
 *  REDES
 * ==================================================================== */
export function initNetwork(core) {
  const ipIn = $('#nw-ip'), maskIn = $('#nw-mask'), msg = $('#nw-msg'), box = $('#nw-result'), kvEl = $('#nw-kv'), split = $('#nw-split');
  const newp = $('#nw-newp'), hosts = $('#nw-hosts'), smsg = $('#nw-smsg'), table = $('#nw-table'), more = $('#nw-more'), hint = $('#nw-hint');
  const saved = store.get('net', null);
  if (saved) { ipIn.value = saved.ip ?? ipIn.value; maskIn.value = saved.mask ?? maskIn.value; }
  let cur = null, shown = 0, totalSubnets = 0, curPrefix = 0;
  const PAGE = 64;

  function binLine(bin, prefix, colorize) {
    const nodes = []; let count = 0;
    for (const ch of bin) {
      if (ch === '.') { nodes.push('.'); continue; }
      nodes.push(colorize ? el('span', { class: count < prefix ? 'net-bit' : 'host-bit', text: ch }) : ch);
      count++;
    }
    return nodes;
  }

  function analyze() {
    setMsg(msg, ''); box.hidden = true; split.hidden = true;
    store.set('net', { ip: ipIn.value, mask: maskIn.value });
    const r = core.net(ipIn.value.trim(), maskIn.value.trim());
    if (!r.ok) return setMsg(msg, r.message);
    cur = r; curPrefix = r.prefix;
    const rows = [['Dirección de red', `${r.network}/${r.prefix}`], ['Broadcast', r.broadcast], ['Primer host', r.first], ['Último host', r.last], ['Hosts utilizables', Number(r.hosts).toLocaleString('es')],
      ['Máscara', r.mask], ['Wildcard', r.wildcard], ['Clase', r.cls], ['Tipo', r.type], ['IP como entero', r.ipInt], ['IP en hex', r.ipHex], ['DNS inverso', r.rdns]];
    kvEl.replaceChildren(...rows.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
    $('#nw-binip').replaceChildren(...binLine(r.binIp, r.prefix, true));
    $('#nw-binmask').replaceChildren(...binLine(r.binMask, r.prefix, true));
    box.hidden = false;
    if (r.prefix >= 32) { split.hidden = true; } else { split.hidden = false; newp.value = String(Math.min(32, Math.max(r.prefix + 1, Number(newp.value) > r.prefix ? Number(newp.value) : r.prefix + 2))); hint.textContent = `Prefijo actual: /${r.prefix}`; }
    if (r.prefix >= 31) setMsg(msg, r.prefix === 32 ? 'Un /32 identifica un único host.' : 'Un /31 es un enlace punto a punto (2 hosts, RFC 3021).', 'warn');
  }

  function divide(start = 0) {
    setMsg(smsg, '');
    if (!cur) return;
    let p = Number(newp.value);
    if (hosts.value.trim() !== '') {
      if (!/^\d+$/.test(hosts.value.trim())) return setMsg(smsg, 'Los hosts necesarios deben ser un número entero.');
      p = core.prefixForHosts(Number(hosts.value));
      if (p < 0) return setMsg(smsg, 'Esa cantidad de hosts no cabe en una subred IPv4.');
      newp.value = String(p);
    } else if (!/^\d+$/.test(newp.value.trim())) return setMsg(smsg, 'Escribe el nuevo prefijo (número entero).');
    const r = core.subnets(ipIn.value.trim(), maskIn.value.trim(), p, start, PAGE);
    if (!r.ok) return setMsg(smsg, r.message);
    totalSubnets = r.total;
    const usable = p >= 31 ? 2 ** (32 - p) : 2 ** (32 - p) - 2;
    hint.textContent = `${totalSubnets.toLocaleString('es')} subredes /${p} · ${usable.toLocaleString('es')} host(s) utilizables por subred`;
    const rowsEl = r.rows.map((x) => el('tr', {}, el('td', { text: x.i }), el('td', { text: x.net }), el('td', { text: x.first }), el('td', { text: x.last }), el('td', { text: x.bc })));
    if (start === 0) { table.replaceChildren(el('thead', {}, el('tr', {}, ...['#', 'Red', 'Primer host', 'Último host', 'Broadcast'].map((h) => el('th', { text: h })))), el('tbody', {}, ...rowsEl)); shown = rowsEl.length; }
    else { $('tbody', table).append(...rowsEl); shown += rowsEl.length; }
    table.hidden = false; more.hidden = shown >= totalSubnets;
    if (!more.hidden) more.textContent = `Mostrar más (${shown} de ${totalSubnets.toLocaleString('es')})`;
  }

  $('#nw-run').addEventListener('click', analyze);
  for (const i of [ipIn, maskIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
  $('#nw-clear').addEventListener('click', () => { ipIn.value = ''; maskIn.value = ''; box.hidden = true; split.hidden = true; table.hidden = true; more.hidden = true; setMsg(msg, ''); cur = null; ipIn.focus(); store.set('net', { ip: '', mask: '' }); });
  $('#nw-div').addEventListener('click', () => divide(0));
  more.addEventListener('click', () => divide(shown));
  hosts.addEventListener('input', () => { if (hosts.value.trim() && /^\d+$/.test(hosts.value.trim())) { const p = core.prefixForHosts(Number(hosts.value)); hint.textContent = p >= 0 ? `Se necesita un /${p}` : 'No cabe en IPv4'; } });
  analyze();
}
