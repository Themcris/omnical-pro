/**
 * OmniCalc — Teoría de conjuntos: lectura de conjuntos, álgebra de conjuntos con expresiones
 * (A ∪ B, (A − C) ∩ (A − B), (B ∪ C)′ …) y explicación paso a paso.
 * Lógica pura (sin DOM): se prueba con Node.
 */
export class SetError extends Error { constructor(message, pos = -1) { super(message); this.pos = pos; } }

const MAX_ELEMS = 600;

/* ---------------------------------------------------------------
 *  Lectura de conjuntos:  A = {1,2,3}; B = {3,4}   (una por línea o separadas por ;)
 *  Acepta (), [] o {} ; ∅ o {} para vacío ; rangos 1..10 ; la letra U es el universo.
 * --------------------------------------------------------------- */
function splitTop(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) {
    if ('{(['.includes(ch)) depth++;
    if ('})]'.includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === '\n') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseSets(text) {
  const defs = new Map(); let universe = null;
  for (const decl of splitTop(String(text).replace(/[𝐴-𝑧]/gu, (c) => c))) {
    const m = /^([A-Za-z])\s*=\s*(.*)$/s.exec(decl.replace(/∅/g, '{}'));
    if (!m) throw new SetError(`No entiendo «${decl.slice(0, 24)}». Usa el formato  A = {1, 2, 3}`);
    const name = m[1];
    let body = m[2].trim();
    const open = /^[{(\[]/.test(body), close = /[})\]]$/.test(body);
    if (open !== close) throw new SetError(`Falta cerrar o abrir la llave en el conjunto ${name}.`);
    if (open) body = body.slice(1, -1);
    const elems = [];
    for (const raw of body.split(',')) {
      const t = raw.trim(); if (!t) continue;
      const r = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(t);
      if (r) {
        const a = Number(r[1]), b = Number(r[2]);
        if (Math.abs(b - a) > MAX_ELEMS) throw new SetError('Rango demasiado grande.');
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) elems.push(String(i));
      } else elems.push(t.replace(/^["']|["']$/g, ''));
    }
    const uniq = [...new Set(elems)];
    if (uniq.length > MAX_ELEMS) throw new SetError(`El conjunto ${name} tiene demasiados elementos (máx. ${MAX_ELEMS}).`);
    if (name === 'U') { if (universe) throw new SetError('El universo U está definido dos veces.'); universe = uniq; continue; }
    if (defs.has(name)) throw new SetError(`El conjunto ${name} está definido dos veces.`);
    defs.set(name, uniq);
  }
  if (!defs.size) throw new SetError('Define al menos un conjunto, por ejemplo  A = {1, 2, 3}');
  return { defs, universe };
}

/* ---------------------------------------------------------------
 *  Expresiones
 * --------------------------------------------------------------- */
function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('^c', i) && !/[A-Za-z]/.test(src[i + 2] || '')) { toks.push({ t: 'cp', pos: i }); i += 2; continue; }
    if ("'’′ᶜ".includes(ch)) { toks.push({ t: 'cp', pos: i }); i++; continue; }
    if ('∪|+'.includes(ch)) { toks.push({ t: 'un', pos: i }); i++; continue; }
    if ('∩&*'.includes(ch)) { toks.push({ t: 'in', pos: i }); i++; continue; }
    if ('-−–\\∖'.includes(ch)) { toks.push({ t: 'df', pos: i }); i++; continue; }
    if ('Δ△^⊕'.includes(ch)) { toks.push({ t: 'sd', pos: i }); i++; continue; }
    if ('!~¬'.includes(ch)) { toks.push({ t: 'not', pos: i }); i++; continue; }
    if (ch === '(') { toks.push({ t: '(', pos: i }); i++; continue; }
    if (ch === ')') { toks.push({ t: ')', pos: i }); i++; continue; }
    if (/[A-Za-z]/.test(ch)) { toks.push({ t: 'set', v: ch, pos: i }); i++; continue; }
    throw new SetError(`Símbolo no válido «${ch}».`, i);
  }
  toks.push({ t: 'end', pos: src.length });
  return toks;
}

/** Precedencia: ′ (complemento) > ∩ > ∪ , − , Δ (de izquierda a derecha). Usa paréntesis si dudas. */
export function parseExpr(src) {
  const toks = tokenize(src); let i = 0;
  const peek = () => toks[i];
  function expr() {
    let a = inter();
    while (['un', 'df', 'sd'].includes(peek().t)) { const op = toks[i++].t; a = { k: op, a, b: inter() }; }
    return a;
  }
  function inter() {
    let a = unary();
    while (peek().t === 'in') { i++; a = { k: 'in', a, b: unary() }; }
    return a;
  }
  function unary() {
    if (peek().t === 'not') { i++; return { k: 'cp', a: unary() }; }
    let a = atom();
    while (peek().t === 'cp') { i++; a = { k: 'cp', a }; }
    return a;
  }
  function atom() {
    const tk = peek();
    if (tk.t === 'set') { i++; return { k: 'set', v: tk.v }; }
    if (tk.t === '(') {
      i++; const e = expr();
      if (peek().t !== ')') throw new SetError('Falta cerrar un paréntesis.', peek().pos);
      i++; return e;
    }
    if (tk.t === 'end') throw new SetError('La expresión está incompleta.', tk.pos);
    throw new SetError('Se esperaba un conjunto o un paréntesis.', tk.pos);
  }
  const ast = expr();
  if (peek().t !== 'end') throw new SetError(peek().t === ')' ? 'Sobra un paréntesis de cierre.' : 'Expresión mal formada.', peek().pos);
  return ast;
}

const SYM = { un: '∪', in: '∩', df: '−', sd: 'Δ' };
export function exprText(n, top = true) {
  switch (n.k) {
    case 'set': return n.v;
    case 'cp': return (n.a.k === 'set' ? n.a.v : `(${exprText(n.a, true)})`) + '′';
    default: {
      const side = (c) => (c.k === 'set' || c.k === 'cp' ? exprText(c, false) : `(${exprText(c, true)})`);
      const s = `${side(n.a)} ${SYM[n.k]} ${side(n.b)}`;
      return s;
    }
  }
}
/** Operando con paréntesis si es compuesto: (A − C), pero A o A′ sin ellos. */
export const operandText = (c) => (c.k === 'set' || c.k === 'cp' ? exprText(c, false) : `(${exprText(c, true)})`);
export function exprSets(n, acc = new Set()) { if (n.k === 'set') acc.add(n.v); for (const c of [n.a, n.b]) if (c) exprSets(c, acc); return acc; }

/** Evalúa la expresión para UNA región del diagrama o un elemento: inFn(nombre) → ¿pertenece? */
export function evalBool(n, inFn) {
  switch (n.k) {
    case 'set': return inFn(n.v);
    case 'cp': return !evalBool(n.a, inFn);
    case 'un': return evalBool(n.a, inFn) || evalBool(n.b, inFn);
    case 'in': return evalBool(n.a, inFn) && evalBool(n.b, inFn);
    case 'df': return evalBool(n.a, inFn) && !evalBool(n.b, inFn);
    case 'sd': return evalBool(n.a, inFn) !== evalBool(n.b, inFn);
    default: throw new SetError('Expresión no válida.');
  }
}

/* ---------------------------------------------------------------
 *  Resolución completa
 * --------------------------------------------------------------- */
function orderList(list) {
  if (list.every((s) => /^-?\d+(\.\d+)?$/.test(s))) return [...list].sort((a, b) => Number(a) - Number(b));
  if (list.every((s) => [...s].length === 1)) return [...list].sort();
  return list;
}
export const showSet = (arr) => (arr.length ? `{${arr.join(', ')}}` : '∅');

/** Regla en palabras, con los NOMBRES REALES de los operandos (A ∩ C, (A − C) ∪ B, …). */
const RULE = {
  un: (L, R) => `${L} ∪ ${R}: elementos que están en ${L}, en ${R} o en ambos (sin repetir).`,
  in: (L, R) => `${L} ∩ ${R}: solo los elementos que están en ${L} y en ${R} a la vez.`,
  df: (L, R) => `${L} − ${R}: los elementos de ${L} que NO están en ${R}.`,
  sd: (L, R) => `${L} Δ ${R}: los que están en uno de los dos (${L} o ${R}), pero no en ambos.`,
  cp: (L) => `${L}′ = U − ${L}: lo que está en el universo U y no está en ${L}.`,
};

export function solveSets(setsText, exprSrc) {
  try {
    const { defs, universe: givenU } = parseSets(setsText);
    if (!String(exprSrc).trim()) throw new SetError('Escribe una operación, por ejemplo  A ∪ B');
    const ast = parseExpr(exprSrc);
    const used = [...exprSets(ast)].sort();
    for (const v of used) if (v !== 'U' && !defs.has(v)) throw new SetError(`El conjunto ${v} no está definido arriba.`);

    // Universo
    const all = []; for (const arr of defs.values()) for (const e of arr) if (!all.includes(e)) all.push(e);
    let uniList, autoU = false;
    if (givenU) {
      const missing = all.filter((e) => !givenU.includes(e));
      if (missing.length) throw new SetError(`El universo U debe contener todos los elementos. Faltan: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
      uniList = orderList(givenU);
    } else { uniList = orderList(all); autoU = true; }
    const rank = new Map(uniList.map((e, i) => [e, i]));
    const sortU = (arr) => [...arr].sort((a, b) => rank.get(a) - rank.get(b));
    const universe = new Set(uniList);
    const setOf = (v) => (v === 'U' ? universe : new Set(defs.get(v)));

    // Evaluación por nodos (con registro para el paso a paso)
    const log = [];
    function ev(n) {
      if (n.k === 'set') return setOf(n.v);
      const A = ev(n.a), B = n.b ? ev(n.b) : null; let R;
      if (n.k === 'cp') R = new Set([...universe].filter((e) => !A.has(e)));
      else if (n.k === 'un') R = new Set([...A, ...B]);
      else if (n.k === 'in') R = new Set([...A].filter((e) => B.has(e)));
      else if (n.k === 'df') R = new Set([...A].filter((e) => !B.has(e)));
      else R = new Set([...A, ...B].filter((e) => A.has(e) !== B.has(e)));
      log.push({ node: n, A, B, R });
      return R;
    }
    const res = ev(ast);
    const result = sortU([...res]);

    // ---- pasos
    const steps = [];
    const dataLines = used.filter((v) => v !== 'U').map((v) => `${v} = ${showSet(sortU(defs.get(v)))}`);
    dataLines.push(`U = ${showSet(uniList)}${autoU ? '   (se tomó la unión de todos los conjuntos)' : ''}`);
    steps.push({ title: 'Datos', lines: dataLines });
    if (!log.length) steps.push({ title: 'Operación', lines: [`La expresión es solo el conjunto ${exprText(ast)}.`, `Resultado: ${showSet(result)}`] });
    log.forEach((l, i) => {
      const last = i === log.length - 1;
      steps.push({
        title: log.length > 1 ? `${exprText(l.node)}${last ? '   (resultado final)' : ''}` : exprText(l.node),
        lines: [RULE[l.node.k](operandText(l.node.a), l.node.b ? operandText(l.node.b) : ''), `${exprText(l.node)} = ${showSet(sortU([...l.R]))}`],
      });
    });
    // Por qué entra o sale cada elemento (sobre la operación final)
    const root = log.length ? log[log.length - 1] : null;
    if (root) {
      const L = operandText(root.node.a), Rt = root.node.b ? operandText(root.node.b) : null;
      const cands = root.node.k === 'cp' ? uniList : sortU([...new Set([...root.A, ...(root.B || [])])]);
      const lines = [];
      for (const e of cands.slice(0, 40)) {
        const inA = root.A.has(e), inB = root.B ? root.B.has(e) : false, inR = root.R.has(e);
        const mem = Rt ? `${e} ${inA ? '∈' : '∉'} ${L},  ${e} ${inB ? '∈' : '∉'} ${Rt}` : `${e} ${inA ? '∈' : '∉'} ${L}`;
        let why;
        switch (root.node.k) {
          case 'un': why = inA && inB ? 'está en ambos → se escribe una sola vez' : inA ? `está en ${L}` : `está en ${Rt}`; break;
          case 'in': why = inA && inB ? 'está en ambos' : inA ? `no está en ${Rt}` : `no está en ${L}`; break;
          case 'df': why = inA && !inB ? `está en ${L} y no en ${Rt}` : inA ? `también está en ${Rt}` : `no está en ${L}`; break;
          case 'sd': why = inA && inB ? 'está en ambos → se excluye' : inA ? `solo está en ${L}` : `solo está en ${Rt}`; break;
          default: why = inA ? `está en ${L}, por eso NO está en el complemento` : `está en U y no en ${L}`;
        }
        lines.push(`${mem}  →  ${inR ? 'SÍ entra' : 'NO entra'}: ${why}`);
      }
      if (cands.length > 40) lines.push(`… (${cands.length - 40} elementos más)`);
      steps.push({ title: `¿Por qué entra o sale cada elemento? (${exprText(root.node)})`, lines });
    }
    steps.push({ title: 'Resultado', lines: [`${exprText(ast)} = ${showSet(result)}`, `Cardinal: ${result.length} elemento${result.length === 1 ? '' : 's'}`] });

    return { ok: true, ast, text: exprText(ast), result, resultText: showSet(result), used, usedDefs: Object.fromEntries(used.map((v) => [v, sortU(v === 'U' ? uniList : defs.get(v))])), universe: uniList, autoU, steps };
  } catch (err) {
    if (err instanceof SetError) return { ok: false, message: err.message, pos: err.pos };
    throw err;
  }
}

/* ---------------------------------------------------------------
 *  Ejemplos (guía de Conjuntos, enc. 7)
 * --------------------------------------------------------------- */
const G = 'A = {a, b, c, d, e, f}\nB = {d, e, f, g}\nC = {b, c, d, e}\nU = {a, b, c, d, e, f, g}';
export const EXAMPLES = [
  { group: 'Ejemplos del tema', label: 'Unión A ∪ B', sets: 'A = {3, 4, 5, 8, 9}\nB = {5, 7, 8, 9, 10}', expr: 'A ∪ B' },
  { group: 'Ejemplos del tema', label: 'Intersección A ∩ B', sets: 'A = {3, 4, 5, 8, 9}\nB = {5, 7, 8, 9, 10}', expr: 'A ∩ B' },
  { group: 'Ejemplos del tema', label: 'Complemento A′', sets: 'U = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}\nA = {3, 4, 6, 7}', expr: "A'" },
  { group: 'Ejemplos del tema', label: 'Diferencia C − D', sets: 'C = {u, v, x, y, z}\nD = {s, t, z, v, p, q}', expr: 'C − D' },
  { group: 'Ejemplos del tema', label: 'Diferencia simétrica A Δ B', sets: 'A = {1, 3, 4, 5, 6, 7, 20, 30}\nB = {2, 6, 20, 40, 50}', expr: 'A Δ B' },
  ...[['(a)', 'A − B'], ['(b)', "B'"], ['(c)', '(A − C) ∩ (A − B)'], ['(d)', 'B ∩ C'], ['(e)', '(A ∪ B) − C'], ['(f)', '(B ∪ C) − (A − B)'],
    ['(g)', 'A ∪ B'], ['(h)', "(A − C)'"], ['(i)', "(B ∩ C)'"], ['(j)', 'A − (B ∩ C)'], ['(k)', "(A ∪ B)'"], ['(l)', 'A ∩ B ∩ C'],
    ['(m)', 'A Δ B'], ['(n)', 'A ∩ (B Δ C)'], ['(o)', 'B Δ (A ∪ C)']].map(([n, e]) => ({ group: 'Actividad independiente', label: `${n} ${e}`, sets: G, expr: e })),
];
