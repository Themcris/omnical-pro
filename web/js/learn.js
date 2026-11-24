/**
 * OmniCalc — interfaz de los módulos didácticos: Conjuntos (con Venn), Polinomios y Proporcionalidad.
 * La lógica vive en sets.js / poly.js / ratio.js (puras, probadas con Node); aquí solo hay DOM.
 */
import { $, $$, el, store, toast, setMsg, copyText, showSteps, download, raf } from './ui.js';
import { solveSets, evalBool, EXAMPLES as SET_EXAMPLES } from './sets.js';
import { drawVenn } from './venn.js';
import { analyze, stepsText } from './poly.js';
import { simpleRule, compoundRule, percentCalc, PERCENT_MODES } from './ratio.js';

/** Inserta texto en la posición del cursor de un <input>/<textarea>. */
function insertAt(input, text) {
  const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
  input.setRangeText(text, s, e, 'end'); input.focus();
}
const posNote = (r) => (r.pos >= 0 ? ` (carácter ${r.pos + 1})` : '');

/* ===================================================================
 *  CONJUNTOS
 * =================================================================== */
export function initSets() {
  const sel = $('#st-example'), setsIn = $('#st-sets'), exprIn = $('#st-expr'), msg = $('#st-msg');
  const label = $('#st-label'), result = $('#st-result'), detail = $('#st-detail');
  const canvas = $('#st-venn'), vnote = $('#st-vnote'), steps = $('#steps-sets');
  let last = null;

  // Ejemplos de la guía
  sel.replaceChildren(el('option', { value: '', text: '— Cargar un ejemplo de la guía —' }));
  const groups = {};
  SET_EXAMPLES.forEach((ex, i) => {
    if (!groups[ex.group]) { groups[ex.group] = el('optgroup', { label: ex.group }); sel.append(groups[ex.group]); }
    groups[ex.group].append(el('option', { value: String(i), text: ex.label }));
  });
  sel.addEventListener('change', () => {
    if (sel.value === '') return;
    const ex = SET_EXAMPLES[Number(sel.value)]; setsIn.value = ex.sets; exprIn.value = ex.expr; run();
  });

  function clearCanvas() { const g = canvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }

  function redraw() {
    if (!last) return;
    const names = last.used.filter((n) => n !== 'U');
    if (names.length > 3) { clearCanvas(); vnote.textContent = `El diagrama de Venn se dibuja con hasta 3 conjuntos (esta operación usa ${names.length}). El resultado y los pasos sí se calculan.`; return; }
    vnote.textContent = names.length === 0 ? 'La operación solo usa el universo U: todo el rectángulo está sombreado.' : '';
    const sets = Object.fromEntries(names.map((n) => [n, new Set(last.usedDefs[n])]));
    drawVenn(canvas, {
      names, sets, universe: last.universe,
      holds: (mask) => evalBool(last.ast, (nm) => (nm === 'U' ? true : !!((mask >> names.indexOf(nm)) & 1))),
    });
    canvas.setAttribute('aria-label', `Diagrama de Venn de ${last.text}. Resultado: ${last.resultText}`);
  }

  function run() {
    setMsg(msg, '');
    const r = solveSets(setsIn.value, exprIn.value);
    store.set('sets', { s: setsIn.value, e: exprIn.value });
    if (!r.ok) {
      setMsg(msg, r.message + posNote(r)); label.textContent = 'Resultado'; result.textContent = '—'; detail.textContent = '';
      showSteps(steps, ''); clearCanvas(); vnote.textContent = ''; last = null; return;
    }
    last = r;
    label.textContent = r.text; result.textContent = r.resultText;
    detail.textContent = `${r.result.length} elemento${r.result.length === 1 ? '' : 's'}`;
    showSteps(steps, stepsText(r.steps));
    redraw();
  }

  $('#st-run').addEventListener('click', run);
  exprIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  $('#st-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-ins]'); if (b) insertAt(exprIn, b.dataset.ins); });
  $('#st-ops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]'); if (!b) return;
    const names = [...setsIn.value.matchAll(/(?:^|[\n;])\s*([A-TV-Za-z])\s*=/g)].map((m) => m[1]);
    const [a, c = 'B'] = names.length ? names : ['A', 'B'];
    exprIn.value = { un: `${a} ∪ ${c}`, in: `${a} ∩ ${c}`, df: `${a} − ${c}`, df2: `${c} − ${a}`, sd: `${a} Δ ${c}`, cp: `${a}′` }[b.dataset.op];
    sel.value = ''; run();
  });
  $('#st-png').addEventListener('click', () => {
    if (!last) return toast('Primero calcula una operación');
    canvas.toBlob((b) => b ? download(b, `venn-${last.text.replace(/[^\w]+/g, '_')}.png`) : toast('No se pudo crear la imagen', { error: true }), 'image/png');
  });
  $('#st-copy').addEventListener('click', () => { if (last) copyText(`${last.text} = ${last.resultText}`); });

  const again = raf(redraw);
  document.addEventListener('omni:themechange', again);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (canvas.offsetParent) again(); }).observe(canvas.parentElement);

  const saved = store.get('sets', null);
  if (saved?.s) { setsIn.value = saved.s; exprIn.value = saved.e || ''; }
  else { const ex = SET_EXAMPLES[0]; setsIn.value = ex.sets; exprIn.value = ex.expr; }
  run();
  return { show: () => { if (last) requestAnimationFrame(redraw); } };
}

/* ===================================================================
 *  POLINOMIOS Y PRODUCTOS NOTABLES
 * =================================================================== */
const POLY_EXAMPLES = [
  ['Cuadrado de la suma', '(5x+7)^2'], ['Cuadrado de la diferencia', '(3x-8y)^2'], ['Suma por diferencia', '(x^3-9)(x^3+9)'],
  ['Cubo de la suma', '(3+y^2)^3'], ['Cubo de la diferencia', '(a^2-2b)^3'], ['Binomios con término común', '(x+7)(x+2)'],
  ['Suma y resta de monomios', '5x+2x-4x'], ['Suma de polinomios', '(3x+2)+(5x-4)'], ['Resta de polinomios', '(7x^2-3x+1)-(2x^2+x-5)'],
  ['Monomio × monomio', '(3xy^5)(-6x^4y)'], ['Polinomio × monomio', '2x^3y(4x^2-3xy+5y^2)'], ['Polinomio × polinomio', '(2x-3)(x+4)'],
  ['Monomio ÷ monomio', '12x^5y^3/(4x^2y)'], ['Polinomio ÷ monomio', '(8x^4-6x^3+2x^2)/(2x^2)'], ['Polinomio ÷ polinomio', '(x^2+7x+12)/(x+3)'],
  ['Problema: volumen del tanque', '(x^2+3x)(x+2)'], ['Problema: costo por usuario', '(12n^3+8n^2)/(4n)'],
];

export function initPoly() {
  const sel = $('#pl-example'), expr = $('#pl-expr'), msg = $('#pl-msg'), result = $('#pl-result');
  const kv = $('#pl-kv'), steps = $('#steps-poly'), check = $('#pl-check'), copyBtn = $('#pl-copy');
  let lastAscii = '';

  sel.replaceChildren(el('option', { value: '', text: '— Cargar un ejemplo de la guía —' }),
    ...POLY_EXAMPLES.map(([t, e], i) => el('option', { value: String(i), text: `${t}:  ${e}` })));
  sel.addEventListener('change', () => { if (sel.value !== '') { expr.value = POLY_EXAMPLES[Number(sel.value)][1]; run(); } });

  function run() {
    setMsg(msg, ''); setMsg(check, ''); copyBtn.hidden = true;
    const r = analyze(expr.value);
    store.set('poly', expr.value);
    if (!r.ok) { setMsg(msg, r.message + posNote(r)); result.textContent = '—'; kv.replaceChildren(); showSteps(steps, ''); return; }
    lastAscii = r.ascii; copyBtn.hidden = false;
    result.textContent = r.display;
    const row = (k, v) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }));
    const rows = [row('Tipo', r.kind), row('Nº de términos', String(r.terms))];
    if (r.vars.length) rows.push(row('Grado', String(r.degree)), row('Variables', r.vars.join(', ')));
    if (r.remainder) rows.push(row('Residuo', r.remainder.display), row('Divisor', r.remainder.divisor));
    kv.replaceChildren(...rows);
    showSteps(steps, stepsText(r.steps));
    if (r.remainder) setMsg(check, 'La división no es exacta: el resultado mostrado es el cociente; el residuo está arriba.', 'warn');
    else if (r.check) setMsg(check, `Comprobación con ${r.check.env}: expresión original = ${r.check.lhs}, resultado = ${r.check.rhs} ${r.check.ok ? '✓' : '✗ (no coinciden: avísame de este caso)'}`, r.check.ok ? 'ok' : 'error');
  }
  $('#pl-run').addEventListener('click', run);
  expr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  $('#pl-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-ins]'); if (b) insertAt(expr, b.dataset.ins); });
  copyBtn.addEventListener('click', () => copyText(lastAscii));
  expr.value = store.get('poly', '(x+3)^2');
  run();
  return { show() {} };
}

/* ===================================================================
 *  PROPORCIONALIDAD: regla de tres y porcentajes
 * =================================================================== */
export function initRatio() {
  const root = $('#tab-ratio');
  /* ---- secciones ---- */
  const segs = $$('.seg', root);
  function section(name) {
    segs.forEach((s) => { const on = s.dataset.rsec === name; s.classList.toggle('active', on); s.setAttribute('aria-selected', String(on)); });
    for (const id of ['rt', 'pc']) $(`#rsec-${id}`).hidden = id !== name;
    store.set('rsec', name);
  }
  segs.forEach((s) => s.addEventListener('click', () => section(s.dataset.rsec)));

  /* ---- regla de tres ---- */
  let type = 'directa';
  const rtMsg = $('#rt-msg'), rtRes = $('#rt-result'), rtLabel = $('#rt-label'), rtSteps = $('#steps-rt');
  const cells = [0, 1, 2, 3].map((i) => $(`#rt-c${i}`));
  const l1 = $('#rt-l1'), l2 = $('#rt-l2');
  const rowsBox = $('#rt-rows');
  const comp = { unknown: { label: 'Días', v1: '15' }, rows: [
    { label: 'Trabajadores', v1: '6', v2: '9', rel: 'inversa' }, { label: 'Horas diarias', v1: '8', v2: '6', rel: 'inversa' }, { label: 'Muro (m²)', v1: '360', v2: '540', rel: 'directa' }] };

  function setType(t) {
    type = t;
    $$('#rt-types .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rt === t)));
    $('#rt-simple').hidden = t === 'compuesta'; $('#rt-comp').hidden = t !== 'compuesta';
    rtRes.textContent = '—'; rtLabel.textContent = 'Resultado'; showSteps(rtSteps, ''); setMsg(rtMsg, '');
    store.set('rtype', t);
  }
  $('#rt-types').addEventListener('click', (e) => { const b = e.target.closest('[data-rt]'); if (b) setType(b.dataset.rt); });

  function renderRows() {
    const inp = (obj, key, props = {}) => el('input', { class: 'input mono', type: 'text', autocomplete: 'off', value: obj[key], ...props, oninput: (e) => { obj[key] = e.target.value; } });
    const head = el('div', { class: 'rt-row rt-head' }, el('span', { text: 'Magnitud' }), el('span', { text: 'Sit. 1' }), el('span', { text: 'Sit. 2' }), el('span', { text: 'Relación' }), el('span'));
    const rows = comp.rows.map((r, i) => el('div', { class: 'rt-row' },
      inp(r, 'label', { 'aria-label': `Nombre de la magnitud ${i + 1}`, inputmode: 'text' }),
      inp(r, 'v1', { inputmode: 'decimal', 'aria-label': `${r.label} situación 1` }),
      inp(r, 'v2', { inputmode: 'decimal', 'aria-label': `${r.label} situación 2` }),
      (() => {
        const s = el('select', { 'aria-label': `Relación de ${r.label} con la incógnita`, onchange: (e) => { r.rel = e.target.value; } },
          el('option', { value: 'directa', text: 'Directa' }), el('option', { value: 'inversa', text: 'Inversa' }));
        s.value = r.rel; return s;
      })(),
      el('button', { class: 'btn btn-sm rt-del', type: 'button', 'aria-label': `Quitar ${r.label}`, text: '✕', onclick: () => { comp.rows.splice(i, 1); renderRows(); } })));
    const unk = el('div', { class: 'rt-row rt-unknown' },
      inp(comp.unknown, 'label', { 'aria-label': 'Nombre de la magnitud incógnita' }),
      inp(comp.unknown, 'v1', { inputmode: 'decimal', 'aria-label': 'Incógnita, valor en la situación 1' }),
      el('input', { class: 'input mono', type: 'text', value: 'x', disabled: true, 'aria-label': 'Incógnita x' }),
      el('span', { class: 'muted small', text: 'incógnita' }), el('span'));
    rowsBox.replaceChildren(head, ...rows, unk);
  }
  $('#rt-add').addEventListener('click', () => { if (comp.rows.length >= 6) return toast('Máximo 6 magnitudes'); comp.rows.push({ label: `Magnitud ${comp.rows.length + 1}`, v1: '', v2: '', rel: 'directa' }); renderRows(); });
  $('#rt-example-simple').addEventListener('click', () => {
    setType('directa'); l1.value = 'Sacos de cemento'; l2.value = 'Área (m²)'; ['8', '40', '', '75'].forEach((v, i) => { cells[i].value = v; });
  });

  function runRt() {
    setMsg(rtMsg, '');
    const r = type === 'compuesta'
      ? compoundRule({ unknown: comp.unknown, rows: comp.rows })
      : simpleRule({ cells: cells.map((c) => c.value), type, l1: l1.value.trim() || 'Magnitud 1', l2: l2.value.trim() || 'Magnitud 2' });
    if (!r.ok) { setMsg(rtMsg, r.message); rtRes.textContent = '—'; showSteps(rtSteps, ''); return; }
    rtLabel.textContent = `Regla de tres ${type === 'compuesta' ? 'compuesta' : 'simple ' + type}`;
    rtRes.textContent = `x = ${r.text}`;
    showSteps(rtSteps, stepsText(r.steps));
  }
  $('#rt-run').addEventListener('click', runRt);
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('#rsec-rt') && e.target.tagName === 'INPUT') { e.preventDefault(); runRt(); } });

  /* ---- porcentajes ---- */
  const pcMode = $('#pc-mode'), pa = $('#pc-a'), pb = $('#pc-b'), la = $('#pc-la'), lb = $('#pc-lb');
  const pcMsg = $('#pc-msg'), pcRes = $('#pc-result'), pcLabel = $('#pc-label'), pcKv = $('#pc-kv'), pcSteps = $('#steps-pc');
  pcMode.replaceChildren(...Object.entries(PERCENT_MODES).map(([k, m]) => el('option', { value: k, text: m.label })));
  function loadMode(fill = true) {
    const m = PERCENT_MODES[pcMode.value];
    la.textContent = m.f1; lb.textContent = m.f2;
    if (fill) { pa.value = m.ex[0]; pb.value = m.ex[1]; }
    pcRes.textContent = '—'; pcLabel.textContent = 'Resultado'; pcKv.replaceChildren(); showSteps(pcSteps, ''); setMsg(pcMsg, '');
    store.set('pcmode', pcMode.value);
  }
  pcMode.addEventListener('change', () => loadMode(true));
  function runPc() {
    setMsg(pcMsg, '');
    const r = percentCalc(pcMode.value, pa.value, pb.value);
    if (!r.ok) { setMsg(pcMsg, r.message); pcRes.textContent = '—'; pcKv.replaceChildren(); showSteps(pcSteps, ''); return; }
    pcLabel.textContent = PERCENT_MODES[pcMode.value].label; pcRes.textContent = r.text;
    pcKv.replaceChildren(...r.kv.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
    showSteps(pcSteps, stepsText(r.steps));
  }
  $('#pc-run').addEventListener('click', runPc);
  for (const i of [pa, pb]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPc(); });

  /* ---- arranque ---- */
  renderRows();
  const savedMode = store.get('pcmode', 'parte'); pcMode.value = PERCENT_MODES[savedMode] ? savedMode : 'parte'; loadMode(true);
  $('#rt-example-simple').click();
  setType(store.get('rtype', 'directa'));
  section(store.get('rsec', 'rt'));
  runRt();
  return { show() {} };
}
