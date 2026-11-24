/**
 * OmniCalc — mini CAS de polinomios (multivariable, coeficientes racionales exactos).
 * Decisión de diseño: se hace en JS con BigInt (no en C/WASM) porque la aritmética exacta
 * de fracciones y la manipulación de cadenas/mapas son naturales aquí, y el motor C no tiene
 * malloc ni BigInt. Rendimiento más que suficiente para expresiones de clase.
 *
 *   analyze("(x+3)^2") -> { ok, display, ascii, kind, degree, steps:[...], check, remainder? }
 */
import { Frac } from './frac.js';

export class PolyError extends Error {
  constructor(message, pos = -1) { super(message); this.pos = pos; }
}
const MAX_TERMS = 4000;
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };

/* ===================================================================
 *  Monomios y polinomios
 * =================================================================== */
const monoKey = (m) => Object.keys(m).filter((v) => m[v] !== 0).sort().map((v) => v + m[v]).join(',');
const cleanMono = (m) => { const o = {}; for (const v of Object.keys(m)) if (m[v] !== 0) o[v] = m[v]; return o; };
const totalDeg = (m) => Object.values(m).reduce((s, e) => s + e, 0);
const fpow = (f, k) => (k >= 0 ? f.pow(k) : new Frac(1).div(f.pow(-k)));

export class Poly {
  constructor() { this.t = new Map(); }
  static constant(c) { const p = new Poly(); p.addTerm(Frac.of(c), {}); return p; }
  static variable(v) { const p = new Poly(); p.addTerm(new Frac(1), { [v]: 1 }); return p; }
  static term(c, m) { const p = new Poly(); p.addTerm(Frac.of(c), m); return p; }
  clone() { const p = new Poly(); for (const [k, v] of this.t) p.t.set(k, { c: v.c, m: { ...v.m } }); return p; }
  addTerm(c, m) {
    if (c.isZero()) return;
    m = cleanMono(m);
    const k = monoKey(m), cur = this.t.get(k);
    if (!cur) this.t.set(k, { c, m });
    else { const s = cur.c.add(c); if (s.isZero()) this.t.delete(k); else cur.c = s; }
    if (this.t.size > MAX_TERMS) throw new PolyError('La expresión es demasiado grande para desarrollarla aquí.');
  }
  isZero() { return this.t.size === 0; }
  isConst() { for (const { m } of this.t.values()) if (Object.keys(m).length) return false; return true; }
  constValue() { for (const { c, m } of this.t.values()) if (!Object.keys(m).length) return c; return new Frac(0); }
  size() { return this.t.size; }
  single() { return this.t.size === 1 ? this.t.values().next().value : null; }
  vars() { const s = new Set(); for (const { m } of this.t.values()) for (const v of Object.keys(m)) s.add(v); return [...s].sort(); }
  degree() { let d = 0; for (const { m } of this.t.values()) d = Math.max(d, totalDeg(m)); return d; }
  /** Orden lexicográfico (como en clase): primero mayor exponente de la 1.ª letra (x antes que y); a igualdad, siguiente letra. */
  terms() {
    return [...this.t.values()].sort((a, b) => {
      const vs = [...new Set([...Object.keys(a.m), ...Object.keys(b.m)])].sort();
      for (const v of vs) { const e = (b.m[v] || 0) - (a.m[v] || 0); if (e) return e; }
      return 0;
    });
  }
  add(o) { const r = this.clone(); for (const { c, m } of o.t.values()) r.addTerm(c, m); return r; }
  sub(o) { const r = this.clone(); for (const { c, m } of o.t.values()) r.addTerm(c.neg(), m); return r; }
  neg() { const r = new Poly(); for (const { c, m } of this.t.values()) r.addTerm(c.neg(), m); return r; }
  scale(k) { k = Frac.of(k); const r = new Poly(); for (const { c, m } of this.t.values()) r.addTerm(c.mul(k), m); return r; }
  mul(o) {
    if (this.t.size * o.t.size > 250000) throw new PolyError('La expresión es demasiado grande para desarrollarla aquí.');
    const r = new Poly();
    for (const a of this.t.values()) for (const b of o.t.values()) {
      const m = { ...a.m }; for (const v of Object.keys(b.m)) m[v] = (m[v] || 0) + b.m[v];
      r.addTerm(a.c.mul(b.c), m);
    }
    return r;
  }
  pow(k) {
    if (k < 0) {
      const s = this.single(); if (!s) throw new PolyError('Un exponente negativo solo se admite en monomios (por ejemplo x^-2).');
      const m = {}; for (const v of Object.keys(s.m)) m[v] = s.m[v] * k;
      return Poly.term(fpow(s.c, k), m);
    }
    let r = Poly.constant(1);
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  eq(o) { if (this.t.size !== o.t.size) return false; for (const [k, v] of this.t) { const w = o.t.get(k); if (!w || !w.c.eq(v.c)) return false; } return true; }
  evalAt(env) {
    let s = new Frac(0);
    for (const { c, m } of this.t.values()) {
      let x = c; for (const v of Object.keys(m)) x = x.mul(fpow(env[v], m[v]));
      s = s.add(x);
    }
    return s;
  }
}
const termPoly = (t) => Poly.term(t.c, t.m);
const sameTerm = (a, b) => monoKey(a.m) === monoKey(b.m) && a.c.eq(b.c);
const negTerm = (t) => ({ c: t.c.neg(), m: t.m });

/* ===================================================================
 *  Formato
 * =================================================================== */
const MINUS = '−';
function expStr(e, ascii) {
  if (e === 1) return '';
  if (ascii) return e < 0 ? `^(${e})` : `^${e}`;
  return String(e).split('').map((ch) => SUP[ch]).join('');
}
function termBody(c, m, ascii) {                    // c ≥ 0
  const vs = Object.keys(m).sort();
  const vp = vs.map((v) => v + expStr(m[v], ascii)).join('');
  if (!vs.length) return c.toString();
  if (c.eq(1)) return vp;
  return (c.isInt() ? c.toString() : `(${c})`) + vp;
}
export function joinTerms(list, ascii = false) {
  if (!list.length) return '0';
  const minus = ascii ? '-' : MINUS;
  let out = '';
  list.forEach((t, i) => {
    const neg = t.c.isNeg(), body = termBody(t.c.abs(), t.m, ascii);
    out += i === 0 ? (neg ? minus : '') + body : (neg ? ` ${minus} ` : ' + ') + body;
  });
  return out;
}
export const formatPoly = (p, ascii = false) => joinTerms(p.terms(), ascii);
const P = (p) => formatPoly(p);
const PT = (t) => formatPoly(termPoly(t));
const par = (s) => `(${s})`;

/* ===================================================================
 *  Análisis léxico y sintáctico
 * =================================================================== */
function tokenize(src) {
  const s = src.replace(/[−–—]/g, '-').replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4');
  const toks = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m;
    if ((m = /^(\d+([.,]\d+)?|\.\d+)/.exec(s.slice(i)))) { toks.push({ t: 'num', v: m[0].replace(',', '.'), pos: i }); i += m[0].length; continue; }
    if (/[A-Za-z]/.test(ch)) { toks.push({ t: 'id', v: ch, pos: i }); i++; continue; }
    if ('+-*/^()'.includes(ch)) { toks.push({ t: ch, pos: i }); i++; continue; }
    throw new PolyError(`Carácter no válido «${ch}».`, i);
  }
  toks.push({ t: 'end', pos: s.length });
  return toks;
}

function parse(src) {
  const toks = tokenize(src); let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const expect = (t, msg) => { if (peek().t !== t) throw new PolyError(msg, peek().pos); return next(); };

  function expr() {
    let a = term();
    while (peek().t === '+' || peek().t === '-') { const op = next().t; a = { k: op === '+' ? 'add' : 'sub', a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    while (peek().t === '*' || peek().t === '/') { const op = next().t; a = { k: op === '*' ? 'mul' : 'div', a, b: unary() }; }
    return a;
  }
  function unary() {
    if (peek().t === '-') { next(); return { k: 'neg', a: unary() }; }
    if (peek().t === '+') { next(); return unary(); }
    return seq();
  }
  /** Yuxtaposición (3x, 2(x+1), (x+1)(x+2), xy): une más fuerte que «/». */
  function seq() {
    let a = power();
    while (peek().t === 'id' || peek().t === '(') a = { k: 'mul', a, b: power(), implicit: true };
    return a;
  }
  function power() {
    const base = atom();
    if (peek().t !== '^') return base;
    next();
    const e = intExp();
    if (peek().t === '^') throw new PolyError('Usa paréntesis en potencias encadenadas, p. ej. (x^2)^3.', peek().pos);
    return { k: 'pow', a: base, e };
  }
  function intExp() {
    let paren = false;
    if (peek().t === '(') { paren = true; next(); }
    let sign = 1;
    if (peek().t === '-') { sign = -1; next(); } else if (peek().t === '+') next();
    const tk = peek();
    if (tk.t !== 'num' || !/^\d+$/.test(tk.v)) throw new PolyError('El exponente debe ser un número entero.', tk.pos);
    next();
    if (paren) expect(')', 'Falta cerrar el paréntesis del exponente.');
    const e = sign * Number(tk.v);
    if (Math.abs(e) > 60) throw new PolyError('Exponente demasiado grande (máximo 60).', tk.pos);
    return e;
  }
  function atom() {
    const tk = peek();
    if (tk.t === 'num') { next(); const f = Frac.parse(tk.v); return { k: 'num', v: f }; }
    if (tk.t === 'id') { next(); return { k: 'var', v: tk.v }; }
    if (tk.t === '(') { next(); const e = expr(); expect(')', 'Falta cerrar un paréntesis.'); return e; }
    if (tk.t === 'end') throw new PolyError('La expresión está incompleta.', tk.pos);
    throw new PolyError(`No se esperaba «${tk.t}» aquí.`, tk.pos);
  }
  const ast = expr();
  if (peek().t !== 'end') throw new PolyError(peek().t === ')' ? 'Sobra un paréntesis de cierre.' : 'Expresión mal formada.', peek().pos);
  return ast;
}

/* ===================================================================
 *  Evaluación con registro de operaciones
 * =================================================================== */
function longDivide(a, b, v) {
  const degOf = (p) => { let d = -1; for (const { m } of p.t.values()) d = Math.max(d, m[v] || 0); return d; };
  const coefAt = (p, e) => { for (const { c, m } of p.t.values()) if ((m[v] || 0) === e) return c; return new Frac(0); };
  for (const p of [a, b]) for (const { m } of p.t.values()) if ((m[v] || 0) < 0) throw new PolyError('La división larga no admite exponentes negativos.');
  const db = degOf(b), lb = coefAt(b, db);
  let r = a.clone(), q = new Poly(); const iters = [];
  while (!r.isZero() && degOf(r) >= db && iters.length < 300) {
    const dr = degOf(r), lr = coefAt(r, dr);
    const T = Poly.term(lr.div(lb), dr - db ? { [v]: dr - db } : {});
    const prod = T.mul(b), nr = r.sub(prod);
    iters.push({ lead: Poly.term(lr, dr ? { [v]: dr } : {}), leadB: Poly.term(lb, db ? { [v]: db } : {}), T, prod, rest: nr });
    q = q.add(T); r = nr;
  }
  return { q, r, iters };
}

function divide(a, b, ctx, isRoot) {
  if (b.isZero()) throw new PolyError('No se puede dividir entre cero.');
  const sb = b.single();
  if (sb) {
    const r = new Poly();
    for (const { c, m } of a.t.values()) {
      const mm = { ...m }; for (const v of Object.keys(sb.m)) mm[v] = (mm[v] || 0) - sb.m[v];
      r.addTerm(c.div(sb.c), mm);
    }
    return { r, ev: { op: 'div', mode: 'mono', a, b, r } };
  }
  const vs = [...new Set([...a.vars(), ...b.vars()])];
  if (vs.length !== 1) throw new PolyError('Dividir polinomio entre polinomio requiere una sola variable (por ejemplo x).');
  const { q, r: rem, iters } = longDivide(a, b, vs[0]);
  if (!rem.isZero()) {
    if (!isRoot) throw new PolyError('La división no es exacta (hay residuo); solo se admite como operación final.');
    ctx.remainder = { poly: rem, divisor: b };
  }
  return { r: q, ev: { op: 'div', mode: 'long', a, b, r: q, rem, iters } };
}

function parts2(node, ctx) {                       // (a ± b) con a y b monomios, conservando el orden escrito
  if (node.k !== 'add' && node.k !== 'sub') return null;
  const A = evalNode(node.a, { ...ctx, silent: true }), B = evalNode(node.b, { ...ctx, silent: true });
  if (A.size() !== 1 || B.size() !== 1) return null;
  return { kind: node.k, A, B };
}

/** ¿El subárbol solo construye un monomio escrito de corrido (3xy^5, -x^2, 4)? Esos pasos no se muestran. */
const isAtomic = (n) => n.k === 'num' || n.k === 'var' || (n.k === 'neg' && isAtomic(n.a))
  || (n.k === 'pow' && (n.a.k === 'var' || n.a.k === 'num')) || (n.k === 'mul' && n.implicit && isAtomic(n.a) && isAtomic(n.b));

function evalNode(n, ctx, isRoot = false) {
  const rec = (ev, skip = false) => {
    if (ctx.silent || skip) return;
    if (ev.a?.isConst() && (ev.b ? ev.b.isConst() : true)) return;
    if (ev.base?.isConst()) return;
    ctx.events.push(ev);
  };
  switch (n.k) {
    case 'num': return Poly.constant(n.v);
    case 'var': return Poly.variable(n.v);
    case 'neg': return evalNode(n.a, ctx).neg();
    case 'add': case 'sub': {
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
      const r = n.k === 'add' ? a.add(b) : a.sub(b);
      rec({ op: n.k, a, b, r }, !isRoot && r.size() === a.size() + b.size()); return r;
    }
    case 'mul': {
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx), r = a.mul(b);
      rec({ op: 'mul', a, b, r }, !isRoot && isAtomic(n)); return r;
    }
    case 'div': {
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
      const { r, ev } = divide(a, b, ctx, isRoot);
      rec(ev); return r;
    }
    case 'pow': {
      const base = evalNode(n.a, ctx), r = base.pow(n.e);
      rec({ op: 'pow', base, k: n.e, r, parts: ctx.silent ? null : parts2(n.a, ctx) }, !isRoot && isAtomic(n)); return r;
    }
    default: throw new PolyError('Expresión no válida.');
  }
}

/** Evalúa el AST directamente con fracciones (independiente del desarrollo: sirve de comprobación). */
function evalAst(n, env) {
  switch (n.k) {
    case 'num': return n.v;
    case 'var': return env[n.v];
    case 'neg': return evalAst(n.a, env).neg();
    case 'add': return evalAst(n.a, env).add(evalAst(n.b, env));
    case 'sub': return evalAst(n.a, env).sub(evalAst(n.b, env));
    case 'mul': return evalAst(n.a, env).mul(evalAst(n.b, env));
    case 'div': return evalAst(n.a, env).div(evalAst(n.b, env));
    case 'pow': return fpow(evalAst(n.a, env), n.e);
    default: throw new Error('nodo');
  }
}
const astVars = (n, s = new Set()) => { if (n.k === 'var') s.add(n.v); for (const c of [n.a, n.b]) if (c) astVars(c, s); return s; };

/* ===================================================================
 *  Redacción del procedimiento
 * =================================================================== */
const sgn = (minus) => (minus ? '−' : '+');
const sq = (A, B, minus) => {
  const r = minus ? A.mul(A).sub(A.mul(B).scale(2)).add(B.mul(B)) : A.mul(A).add(A.mul(B).scale(2)).add(B.mul(B));
  return {
    title: minus ? 'Cuadrado de la diferencia (producto notable)' : 'Cuadrado de la suma (producto notable)',
    lines: [
      `Fórmula: (a ${sgn(minus)} b)² = a² ${sgn(minus)} 2ab + b²`,
      `Aquí  a = ${P(A)}   y   b = ${P(B)}`,
      `a²  = ${par(P(A))}² = ${P(A.mul(A))}`,
      `2ab = 2${par(P(A))}${par(P(B))} = ${P(A.mul(B).scale(2))}`,
      `b²  = ${par(P(B))}² = ${P(B.mul(B))}`,
      `Resultado: ${P(r)}`,
    ],
  };
};
const cube = (A, B, minus) => {
  const a3 = A.mul(A).mul(A), b3 = B.mul(B).mul(B), a2b = A.mul(A).mul(B).scale(3), ab2 = A.mul(B).mul(B).scale(3);
  const r = minus ? a3.sub(a2b).add(ab2).sub(b3) : a3.add(a2b).add(ab2).add(b3);
  return {
    title: minus ? 'Cubo de la diferencia (producto notable)' : 'Cubo de la suma (producto notable)',
    lines: [
      `Fórmula: (a ${sgn(minus)} b)³ = a³ ${sgn(minus)} 3a²b + 3ab² ${sgn(minus)} b³`,
      `Aquí  a = ${P(A)}   y   b = ${P(B)}`,
      `a³   = ${par(P(A))}³ = ${P(a3)}`,
      `3a²b = 3${par(P(A))}²${par(P(B))} = ${P(a2b)}`,
      `3ab² = 3${par(P(A))}${par(P(B))}² = ${P(ab2)}`,
      `b³   = ${par(P(B))}³ = ${P(b3)}`,
      `Resultado: ${P(r)}`,
    ],
  };
};

function descAddSub(ev) {
  const isSub = ev.op === 'sub';
  const list = [...ev.a.terms(), ...(isSub ? ev.b.neg() : ev.b).terms()];
  const groups = new Map();
  for (const t of list) { const k = monoKey(t.m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const lines = [`${par(P(ev.a))} ${isSub ? '−' : '+'} ${par(P(ev.b))}`];
  if (isSub) lines.push('Se quitan los paréntesis cambiando el signo de cada término del sustraendo.');
  lines.push(`Sin paréntesis: ${joinTerms(list)}`);
  let any = false;
  for (const g of groups.values()) {
    if (g.length < 2) continue; any = true;
    const sum = g.reduce((s, t) => s.add(t.c), new Frac(0));
    lines.push(`Semejantes: ${joinTerms(g)} = ${sum.isZero() ? '0' : joinTerms([{ c: sum, m: g[0].m }])}`);
  }
  if (!any) lines.push('No hay términos semejantes que reducir.');
  lines.push(`Resultado: ${P(ev.r)}`);
  return { title: isSub ? 'Resta de polinomios' : 'Suma de polinomios', lines };
}

function descMul(ev) {
  const ta = ev.a.terms(), tb = ev.b.terms();
  if (ta.length === 1 && tb.length === 1) {
    const [x, y] = [ta[0], tb[0]], lines = [`${par(P(ev.a))}${par(P(ev.b))}`];
    const cs = (c) => (c.isNeg() ? `(${c})` : String(c)).replace('-', '−');
    lines.push(`Coeficientes: ${cs(x.c)} × ${cs(y.c)} = ${String(x.c.mul(y.c)).replace('-', '−')}`);
    const vs = [...new Set([...Object.keys(x.m), ...Object.keys(y.m)])].sort();
    for (const v of vs) {
      if (x.m[v] !== undefined && y.m[v] !== undefined) lines.push(`${v}: se suman exponentes ${x.m[v]} + ${y.m[v]} = ${x.m[v] + y.m[v]}`);
      else lines.push(`${v}: aparece una sola vez, se conserva`);
    }
    lines.push(`Ley de los signos: (${x.c.isNeg() ? '−' : '+'})(${y.c.isNeg() ? '−' : '+'}) = ${x.c.isNeg() !== y.c.isNeg() ? '−' : '+'}`);
    lines.push(`Resultado: ${P(ev.r)}`);
    return { title: 'Multiplicación de monomios', lines };
  }
  if (ta.length === 1 || tb.length === 1) {
    const monoLeft = ta.length === 1, mono = monoLeft ? ta[0] : tb[0], poly = monoLeft ? tb : ta;
    const lines = [`${par(P(ev.a))}${par(P(ev.b))}`, 'Se multiplica el monomio por cada término del polinomio (propiedad distributiva):'];
    const parts = [];
    for (const t of poly) {
      const prod = monoLeft ? termPoly(mono).mul(termPoly(t)) : termPoly(t).mul(termPoly(mono));
      lines.push(`  ${par(monoLeft ? PT(mono) : PT(t))}${par(monoLeft ? PT(t) : PT(mono))} = ${P(prod)}`);
      parts.push(...prod.terms());
    }
    lines.push(`Se reúnen los productos: ${joinTerms(parts)}`);
    if (parts.length !== ev.r.size()) lines.push(`Se reducen términos semejantes: ${P(ev.r)}`);
    lines.push(`Resultado: ${P(ev.r)}`);
    return { title: mono.m && Object.keys(mono.m).length ? 'Polinomio por monomio' : 'Polinomio por una constante', lines };
  }
  if (ta.length === 2 && tb.length === 2) {
    const A = ta, B = tb;
    if (ev.a.eq(ev.b)) return { ...(A[1].c.isNeg() ? sq(termPoly(A[0]), termPoly(negTerm(A[1])), true) : sq(termPoly(A[0]), termPoly(A[1]), false)), title: 'Binomio al cuadrado (producto notable)' };
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      if (sameTerm(A[i], B[j]) && sameTerm(A[1 - i], negTerm(B[1 - j]))) {
        const u = termPoly(A[i]), v = termPoly(A[1 - i].c.isNeg() ? negTerm(A[1 - i]) : A[1 - i]);
        return { title: 'Suma por diferencia (producto notable)', lines: [
          'Fórmula: (a + b)(a − b) = a² − b²',
          `Aquí  a = ${P(u)}   y   b = ${P(v)}`,
          `a² = ${par(P(u))}² = ${P(u.mul(u))}`,
          `b² = ${par(P(v))}² = ${P(v.mul(v))}`,
          `Resultado: a² − b² = ${P(ev.r)}`] };
      }
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      if (sameTerm(A[i], B[j])) {
        const u = termPoly(A[i]), a1 = termPoly(A[1 - i]), b1 = termPoly(B[1 - j]), s = a1.add(b1);
        return { title: 'Binomios con término común (producto notable)', lines: [
          'Fórmula: (x + a)(x + b) = x² + (a + b)x + ab',
          `Término común  x = ${P(u)}`,
          `Términos no comunes  a = ${P(a1)}   y   b = ${P(b1)}`,
          `x²       = ${par(P(u))}² = ${P(u.mul(u))}`,
          `(a + b)x = ${par(P(s))}${par(P(u))} = ${P(s.mul(u))}`,
          `ab       = ${par(P(a1))}${par(P(b1))} = ${P(a1.mul(b1))}`,
          `Resultado: ${P(ev.r)}`] };
      }
    }
  }
  const pairs = [], lines = [`${par(P(ev.a))}${par(P(ev.b))}`, 'Se multiplica cada término del primero por cada término del segundo:'];
  let shown = 0;
  for (const x of ta) for (const y of tb) {
    const prod = termPoly(x).mul(termPoly(y)); pairs.push(...prod.terms());
    if (shown++ < 16) lines.push(`  ${par(PT(x))}${par(PT(y))} = ${P(prod)}`);
  }
  if (shown > 16) lines.push(`  … (${shown - 16} productos más)`);
  lines.push(`Suma de productos: ${pairs.length > 24 ? joinTerms(pairs.slice(0, 24)) + ' + …' : joinTerms(pairs)}`);
  lines.push(pairs.length !== ev.r.size() ? `Se reducen términos semejantes: ${P(ev.r)}` : `Resultado: ${P(ev.r)}`);
  return { title: 'Polinomio por polinomio (propiedad distributiva)', lines };
}

function descPow(ev) {
  if (ev.parts && (ev.k === 2 || ev.k === 3)) return (ev.k === 2 ? sq : cube)(ev.parts.A, ev.parts.B, ev.parts.kind === 'sub');
  const s = ev.base.single();
  if (s) {
    const lines = [`${par(P(ev.base))}${expStr(ev.k, false) || '¹'}`, 'Potencia de un producto: (ab)ⁿ = aⁿbⁿ   y   (aᵐ)ⁿ = aᵐⁿ', `Coeficiente: ${par(s.c.toString())}^${ev.k} = ${fpow(s.c, ev.k)}`];
    for (const v of Object.keys(s.m).sort()) lines.push(`${v}: ${s.m[v]} × ${ev.k} = ${s.m[v] * ev.k}`);
    lines.push(`Resultado: ${P(ev.r)}`);
    return { title: 'Potencia de un monomio', lines };
  }
  return { title: 'Potencia de un polinomio', lines: [
    `${par(P(ev.base))}^${ev.k} = ${Array(Math.min(ev.k, 6)).fill(par(P(ev.base))).join('')}${ev.k > 6 ? '…' : ''}`,
    'Se multiplica el polinomio por sí mismo las veces indicadas y se reducen términos semejantes.',
    `Resultado: ${P(ev.r)}`] };
}

function descDiv(ev) {
  if (ev.mode === 'mono') {
    const ta = ev.a.terms(), sb = ev.b.single(), lines = [`${par(P(ev.a))} ÷ ${par(P(ev.b))}`];
    if (ta.length === 1) {
      const x = ta[0];
      lines.push(`Coeficientes: ${x.c} ÷ ${sb.c} = ${x.c.div(sb.c)}`);
      for (const v of [...new Set([...Object.keys(x.m), ...Object.keys(sb.m)])].sort()) {
        const e1 = x.m[v] || 0, e2 = sb.m[v] || 0;
        lines.push(`${v}: se restan exponentes ${e1} − ${e2} = ${e1 - e2}`);
      }
    } else {
      lines.push('Se divide cada término del polinomio entre el monomio:');
      for (const t of ta) lines.push(`  ${PT(t)} ÷ ${par(P(ev.b))} = ${P(termPoly(t).mul(Poly.term(new Frac(1).div(sb.c), Object.fromEntries(Object.keys(sb.m).map((v) => [v, -sb.m[v]])))))}`);
    }
    lines.push(`Resultado: ${P(ev.r)}`);
    return { title: ta.length === 1 ? 'División de monomios' : 'División de polinomio entre monomio', lines };
  }
  const lines = [`Dividendo: ${P(ev.a)}`, `Divisor:   ${P(ev.b)}`, 'Ambos ordenados de mayor a menor grado.'];
  ev.iters.forEach((it, i) => {
    lines.push(`Paso ${i + 1}: ${P(it.lead)} ÷ ${P(it.leadB)} = ${P(it.T)}`);
    lines.push(`   ${par(P(it.T))}${par(P(ev.b))} = ${P(it.prod)}`);
    lines.push(`   Se resta y queda: ${P(it.rest)}`);
  });
  lines.push(`Cociente: ${P(ev.r)}`, `Residuo:  ${P(ev.rem)}${ev.rem.isZero() ? '  → la división es exacta' : ''}`);
  lines.push(`Comprobación: ${par(P(ev.b))}${par(P(ev.r))}${ev.rem.isZero() ? '' : ' + ' + par(P(ev.rem))} = ${P(ev.b.mul(ev.r).add(ev.rem))}`);
  return { title: 'División de polinomio entre polinomio', lines };
}

const DESC = { add: descAddSub, sub: descAddSub, mul: descMul, div: descDiv, pow: descPow };

/* ===================================================================
 *  API pública
 * =================================================================== */
const kindOf = (n) => (n === 0 ? 'Cero' : n === 1 ? 'Monomio' : n === 2 ? 'Binomio' : n === 3 ? 'Trinomio' : 'Polinomio');

export function analyze(text) {
  try {
    if (!String(text).trim()) throw new PolyError('Escribe una expresión, por ejemplo (x+3)^2');
    const ast = parse(text);
    const ctx = { events: [] };
    const result = evalNode(ast, ctx, true);
    const events = ctx.events;
    const shown = events.length > 10 ? events.slice(-10) : events;
    const steps = [];
    if (!events.length) steps.push({ title: 'Expresión sencilla', lines: [`Resultado: ${P(result)}`] });
    shown.forEach((ev) => steps.push(DESC[ev.op](ev)));
    if (events.length > 10) steps.unshift({ title: 'Nota', lines: [`Se muestran solo las últimas 10 de ${events.length} operaciones.`] });

    // Comprobación numérica independiente (el AST se evalúa sin desarrollar nada)
    let check = null;
    const vars = [...astVars(ast)].sort();
    if (vars.length && !ctx.remainder) {
      const pool = [2, 3, 5, 7, 4, 6, 8, 9];
      for (let attempt = 0; attempt < 4 && !check; attempt++) {
        const env = {}; vars.forEach((v, i) => { env[v] = new Frac(pool[(i + attempt) % pool.length]); });
        try {
          const lhs = evalAst(ast, env), rhs = result.evalAt(env);
          check = { env: vars.map((v) => `${v}=${env[v]}`).join(', '), lhs: lhs.toString(), rhs: rhs.toString(), ok: lhs.eq(rhs) };
        } catch { /* división por cero con esos valores: se prueba otro */ }
      }
    }
    return {
      ok: true, result,
      display: formatPoly(result), ascii: formatPoly(result, true),
      kind: kindOf(result.size()), terms: result.size(), degree: result.degree(), vars: result.vars(),
      steps, check,
      remainder: ctx.remainder ? { display: formatPoly(ctx.remainder.poly), divisor: formatPoly(ctx.remainder.divisor) } : null,
    };
  } catch (err) {
    if (err instanceof PolyError) return { ok: false, message: err.message, pos: err.pos };
    if (err instanceof RangeError) return { ok: false, message: err.message, pos: -1 };
    throw err;
  }
}

/** Texto plano del procedimiento (para mostrar en la caja de pasos). */
export function stepsText(steps) {
  return steps.map((s, i) => `Paso ${i + 1}. ${s.title}\n${s.lines.map((l) => '   ' + l).join('\n')}`).join('\n\n');
}
