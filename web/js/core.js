/**
 * OmniCalc — puente JS <-> WebAssembly
 * -------------------------------------------------------------
 * Toda la comunicación con el motor C pasa por AQUÍ. El resto de la app
 * nunca toca punteros ni memoria.
 *
 *  · El módulo WASM no usa malloc: expone unos pocos buffers fijos
 *    (entrada de texto, salida de texto, vectores de datos, matrices...).
 *    Sus direcciones se piden una vez al cargar -> cero fugas posibles.
 *  · Las cadenas se escriben con TextEncoder.encodeInto() y se leen con
 *    TextDecoder; las funciones de C devuelven códigos de error numéricos
 *    que aquí se traducen a mensajes en español.
 *  · El módulo importa de JS las funciones de Math.* y el formateo/parseo
 *    de números (así el resultado es idéntico al del navegador).
 */

/* ---------- Formato numérico ---------- */
export const PRECISIONS = [6, 10, 12, 15, 17];
let _digits = 15;
export function setPrecision(d) { _digits = PRECISIONS.includes(d) ? d : 15; }
export function getPrecision() { return _digits; }

/** Número -> texto legible (cifras significativas configurables, sin ceros sobrantes). */
export function fmt(v, digits = _digits) {
  if (typeof v !== 'number') return String(v);
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  if (Object.is(v, -0)) v = 0;
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  let s = v.toPrecision(digits);
  if (s.includes('e')) {
    let [m, e] = s.split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    return `${m}e${e.replace('+', '')}`;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/* ---------- Mensajes de error ---------- */
const PARSE_ERRORS = {
  1: 'Escribe una expresión.',
  2: 'Carácter o símbolo inesperado',
  3: 'Nombre desconocido (¿función o constante mal escrita?)',
  4: 'Falta cerrar un paréntesis',
  5: 'Paréntesis de cierre sin su apertura',
  6: 'Expresión demasiado compleja',
  7: 'Las funciones necesitan paréntesis, ej. sin(x)',
  8: 'Número incorrecto de argumentos',
  9: 'La expresión está incompleta',
  10: 'Número mal formado',
};
const FLAG_MESSAGES = [
  [1, 'División entre cero'],
  [2, 'Operación fuera de dominio (ej. √ de un negativo, ln(x≤0), asin fuera de [-1,1])'],
  [4, 'Resultado demasiado grande (desbordamiento)'],
];
export const flagMessage = (f) => (FLAG_MESSAGES.find(([bit]) => f & bit) || [0, ''])[1];

const NET_ERRORS = { 1: 'Dirección IP inválida (formato A.B.C.D con cada octeto de 0 a 255).', 2: 'Máscara inválida (usa /24 o 255.255.255.0).', 3: 'La máscara no es contigua (debe ser unos seguidos de ceros).', 4: 'Falta la máscara: escribe IP/CIDR (ej. 192.168.1.10/24) o rellena el campo máscara.', 5: 'El nuevo prefijo debe ser mayor que el actual y como máximo 32.' };

/* Normaliza símbolos tipográficos a lo que entiende el parser de C */
export function normalizeExpr(s) {
  return String(s)
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
    .replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/φ/g, 'phi').replace(/∞/g, 'inf')
    .replace(/√\(/g, 'sqrt(').replace(/∛\(/g, 'cbrt(')
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/sin⁻¹\(/g, 'asin(').replace(/cos⁻¹\(/g, 'acos(').replace(/tan⁻¹\(/g, 'atan(')
    .replace(/^\s*(y|f\(x\))\s*=\s*/i, '');
}
/** Cierra automáticamente los paréntesis abiertos (como una calculadora de bolsillo). */
export function autoClose(s) {
  let open = 0;
  for (const ch of s) { if (ch === '(') open++; else if (ch === ')' && open > 0) open--; }
  return open > 0 ? s + ')'.repeat(open) : s;
}

export const SLOT = { GRAPH: 0, CALCULUS: 4, CONST: 5, BASIC: 6, TMP: 7 };

const enc = new TextEncoder();
const dec = new TextDecoder();

export class OmniCore {
  /** @param {string|ArrayBuffer|Uint8Array} source URL del .wasm o sus bytes */
  static async load(source) {
    const holder = { core: null };
    const env = {
      m_sin: Math.sin, m_cos: Math.cos, m_tan: Math.tan, m_asin: Math.asin, m_acos: Math.acos, m_atan: Math.atan,
      m_atan2: Math.atan2, m_sinh: Math.sinh, m_cosh: Math.cosh, m_tanh: Math.tanh, m_exp: Math.exp, m_log: Math.log,
      m_log10: Math.log10, m_log2: Math.log2, m_pow: Math.pow, m_cbrt: Math.cbrt, m_hypot: Math.hypot, m_fmod: (a, b) => a % b,
      h_fmt: (v, ptr, cap) => {
        const bytes = enc.encode(fmt(v));
        const n = Math.min(bytes.length, cap - 1);
        const u8 = new Uint8Array(holder.core.mem.buffer);
        u8.set(bytes.subarray(0, n), ptr); u8[ptr + n] = 0;
        return n;
      },
      h_num: (ptr, len) => parseFloat(dec.decode(new Uint8Array(holder.core.mem.buffer, ptr, len))),
    };
    let result;
    if (typeof source === 'string') {
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`No se pudo cargar ${source} (${resp.status})`);
      try { result = await WebAssembly.instantiateStreaming(resp.clone(), { env }); }       // exige MIME application/wasm
      catch { result = await WebAssembly.instantiate(await resp.arrayBuffer(), { env }); }  // servidor con MIME incorrecto
    } else {
      result = await WebAssembly.instantiate(source, { env });
    }
    const core = new OmniCore(result.instance);
    holder.core = core;
    return core;
  }

  constructor(instance) {
    this.x = instance.exports;
    this.mem = this.x.memory;
    this.inP = this.x.oc_in(); this.outP = this.x.oc_out(); this.xP = this.x.oc_x(); this.yP = this.x.oc_y();
    this.ptsP = this.x.oc_pts(); this.auxP = this.x.oc_aux(); this.matP = this.x.oc_mat();
    this.caps = { in: this.x.oc_cap(0), out: this.x.oc_cap(1), data: this.x.oc_cap(2), pts: this.x.oc_cap(3), aux: this.x.oc_cap(4), matN: this.x.oc_cap(5) };
    this.version = this.x.oc_version();
  }

  /* ---- E/S de bajo nivel (único lugar que toca memoria) ---- */
  _f64(ptr, len) { return new Float64Array(this.mem.buffer, ptr, len); }
  get aux() { return this._f64(this.auxP, this.caps.aux); }
  /** Escribe campos de texto en el buffer de entrada. Devuelve false si no caben. */
  _put(...fields) {
    const u8 = new Uint8Array(this.mem.buffer, this.inP, this.caps.in);
    const { read, written } = enc.encodeInto(fields.join('\n'), u8.subarray(0, this.caps.in - 1));
    if (read < fields.join('\n').length) return false;
    u8[written] = 0;
    return true;
  }
  _out() {
    const u8 = new Uint8Array(this.mem.buffer, this.outP, this.caps.out);
    const end = u8.indexOf(0);
    return dec.decode(u8.subarray(0, end < 0 ? this.caps.out : end));
  }
  _lines() { const s = this._out(); return s === '' ? [] : s.split('\n'); }

  /* ================= Parser / evaluador ================= */
  setAngle(mode) { this.x.oc_set_angle({ rad: 0, deg: 1, grad: 2 }[mode] ?? 0); }
  setAns(v) { this.x.oc_set_ans(Number.isFinite(v) ? v : 0); }

  /** Compila en un slot. -> {ok} | {ok:false, code, pos, message} */
  compile(expr, slot = SLOT.TMP) {
    const src = normalizeExpr(expr);
    if (!this._put(src)) return { ok: false, code: 6, pos: 0, message: 'La expresión es demasiado larga (máx. 4000 caracteres).' };
    const code = this.x.oc_compile(slot);
    if (code === 0) return { ok: true, usesX: !!this.x.oc_uses_x(slot) };
    const pos = this.x.oc_err_pos();
    return { ok: false, code, pos, message: PARSE_ERRORS[code] || 'Error de sintaxis' };
  }
  eval(slot, x = 0) { const v = this.x.oc_eval(slot, x); return { value: v, flags: this.x.oc_flags() }; }

  /** Compila + evalúa una expresión sin variable. -> {ok, value} | {ok:false, message, pos} */
  evaluate(expr, { slot = SLOT.BASIC, x = 0 } = {}) {
    const c = this.compile(expr, slot);
    if (!c.ok) return c;
    const { value, flags } = this.eval(slot, x);
    if (!Number.isFinite(value)) return { ok: false, message: flagMessage(flags) || 'Resultado no definido', code: 100, pos: -1, value, flags };
    return { ok: true, value, flags };
  }
  /** Evalúa una constante (límites, parámetros...): admite pi, e, inf, 2*pi... pero no x. */
  constant(text, fallback = NaN) {
    if (String(text).trim() === '') return { ok: true, value: fallback };
    const c = this.compile(text, SLOT.CONST);
    if (!c.ok) return c;
    if (c.usesX) return { ok: false, message: 'Aquí no puede aparecer la variable x', pos: -1, code: 101 };
    const { value, flags } = this.eval(SLOT.CONST, 0);
    if (Number.isNaN(value)) return { ok: false, message: flagMessage(flags) || 'Valor no definido', pos: -1, code: 100 };
    return { ok: true, value };
  }
  /** Evalúa n puntos en una sola llamada. Devuelve una COPIA (Float64Array). */
  evalRange(slot, x0, dx, n) {
    n = Math.min(n, this.caps.pts);
    this.x.oc_eval_range(slot, x0, dx, n);
    return this._f64(this.ptsP, n).slice();
  }

  /* ================= Cálculo numérico ================= */
  integral(expr, a, b) {
    const c = this.compile(expr, SLOT.CALCULUS); if (!c.ok) return c;
    const value = this.x.oc_integral(SLOT.CALCULUS, a, b);
    const aux = this.aux;
    if (Number.isNaN(value)) return { ok: false, message: 'La función no está definida en el intervalo, o la integral no converge.', code: 100, pos: -1 };
    return { ok: true, value, error: aux[0], bad: aux[1], evals: aux[2] };
  }
  derivative(expr, x, order = 1) {
    const c = this.compile(expr, SLOT.CALCULUS); if (!c.ok) return c;
    const value = this.x.oc_deriv(SLOT.CALCULUS, x, order);
    if (!Number.isFinite(value)) return { ok: false, message: 'La función no es evaluable/derivable en ese punto.', code: 100, pos: -1 };
    const aux = this.aux;
    return { ok: true, value, error: aux[0], kink: aux[1] === 1 };
  }
  roots(expr, a, b, max = 64) {
    const c = this.compile(expr, SLOT.CALCULUS); if (!c.ok) return c;
    const n = this.x.oc_roots(SLOT.CALCULUS, a, b, max);
    return { ok: true, roots: Array.from(this._f64(this.ptsP, n)) };
  }

  /* ================= Estadística ================= */
  stats(values) {
    if (values.length > this.caps.data) return { ok: false, message: `Máximo ${this.caps.data} datos.` };
    this._f64(this.xP, values.length).set(values);
    const st = this.x.oc_stats(values.length);
    if (st === 1) return { ok: false, message: 'Ingresa al menos un dato.' };
    if (st !== 0) return { ok: false, message: 'Hay valores no finitos en los datos.' };
    const a = this.aux;
    return { ok: true, n: a[0], sum: a[1], mean: a[2], median: a[3], min: a[4], max: a[5], range: a[6], q1: a[7], q3: a[8], iqr: a[9],
      varP: a[10], varS: a[11], sdP: a[12], sdS: a[13], sem: a[14], cv: a[15], modeCount: a[16], skew: a[18], kurt: a[19],
      sumSq: a[20], geo: a[21], harm: a[22], modes: this._lines().map(Number), sorted: null };
  }
  linreg(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    this._f64(this.xP, n).set(xs.slice(0, n)); this._f64(this.yP, n).set(ys.slice(0, n));
    const st = this.x.oc_linreg(n);
    if (st === 1) return { ok: false, message: 'La regresión necesita al menos 2 pares (x, y).' };
    if (st === 3) return { ok: false, message: 'Todos los valores de x son iguales: no hay recta de regresión.' };
    if (st !== 0) return { ok: false, message: 'Datos no válidos.' };
    const a = this.aux;
    return { ok: true, slope: a[32], intercept: a[33], r: a[34], r2: a[35], n: a[36], meanX: a[37], meanY: a[38] };
  }

  /* ================= Álgebra lineal ================= */
  /** @param {number[]} A n*n (fila a fila) @param {number[]} B n*n */
  matrix(op, n, A, B = new Array(n * n).fill(0), k = 0) {
    this._f64(this.matP, n * n).set(A);
    this._f64(this.matP + 25 * 8, n * n).set(B);
    const st = this.x.oc_matrix(op, n, k);
    const steps = this._out();
    const res = { status: st, steps };
    if (st === 0) res.matrix = Array.from(this._f64(this.matP + 50 * 8, n * n));
    if (st === 1) res.scalar = this.aux[0];
    res.cond = this.aux[1];
    res.ok = st === 0 || st === 1;
    res.message = { 2: 'La matriz es singular (det = 0): no tiene inversa.', 3: 'Argumentos inválidos.', 4: 'El sistema es incompatible: no tiene solución.', 5: 'El sistema tiene infinitas soluciones.', 6: 'Hay valores no finitos en las matrices.' }[st] || '';
    return res;
  }

  /* ================= Programador ================= */
  bits(op, width, base, a, b) {
    if (!this._put(a, b)) return { ok: false, message: 'Entrada demasiado larga.' };
    const st = this.x.oc_bits(op, width, base);
    const msg = { 1: 'A no es un número válido en la base elegida.', 2: 'B no es un número válido en la base elegida.', 3: 'División entre cero.', 4: 'Operación o tamaño de palabra no válido.', 5: 'A no cabe en 64 bits.', 6: 'B no cabe en 64 bits.' }[st];
    if (st) return { ok: false, message: msg };
    const [bin, oct, dec_, sdec, hex, pop, lz, tz] = this._lines();
    const f = this.aux;
    return { ok: true, bin, oct, dec: dec_, sdec, hex, pop: +pop, lz: +lz, tz: +tz,
      flags: { cf: !!f[0], of: !!f[1], zf: !!f[2], sf: !!f[3] }, truncA: !!f[4], truncB: !!f[5], shiftOver: !!f[6] };
  }
  ieee(v, float32) {
    this.x.oc_ieee(v, float32 ? 1 : 0);
    const [sign, exp, man, hex, e, cls, stored] = this._lines();
    return { sign, exp, man, hex, e: +e, cls, stored };
  }

  /* ================= Matemáticas discretas ================= */
  discrete(op, n, r) {
    const st = this.x.oc_discrete(op, n, r);
    if (st === 1) return { ok: false, message: 'Usa enteros ≥ 0 (y r ≤ n cuando corresponda).' };
    if (st === 2) return { ok: false, message: 'El resultado es demasiado grande (más de 9900 dígitos).' };
    return { ok: true, text: this._out(), digits: this.aux[0] };
  }
  numtheory(op, ...fields) {
    if (!this._put(...fields.map(String))) return { ok: false, message: 'Entrada demasiado larga.' };
    const st = this.x.oc_numtheory(op);
    const msg = { 1: 'Escribe enteros no negativos válidos.', 2: 'Número fuera de rango (máx. 2⁶⁴−1; 2⁶² para Bézout/inverso).', 3: 'No existe inverso: a y m no son coprimos.', 4: 'El módulo no puede ser 0.', 5: 'El mcm excede 64 bits.' }[st];
    if (st) return { ok: false, message: msg };
    return { ok: true, lines: this._lines() };
  }
  truth(expr) {
    const src = expr.replace(/[¬~]/g, '!').replace(/[∧]/g, '&').replace(/[∨]/g, '|').replace(/[⊕]/g, '^').replace(/→/g, '->').replace(/↔/g, '<->');
    if (!this._put(src)) return { ok: false, message: 'Expresión demasiado larga.' };
    const st = this.x.oc_truth();
    if (st) return { ok: false, code: st, pos: this.x.oc_err_pos(), message: st === 6 ? 'Máximo 6 variables (a–z).' : (PARSE_ERRORS[st] || 'Error de sintaxis') };
    const [vars, ...rows] = this._lines();
    return { ok: true, vars: vars ? vars.split(' ') : [], rows: rows.map((r) => { const [bits, out] = r.split('|'); return { bits, out: out === '1' }; }), src };
  }

  /* ================= Redes ================= */
  net(ip, mask) {
    if (!this._put(ip, mask)) return { ok: false, message: 'Entrada demasiado larga.' };
    const st = this.x.oc_net();
    if (st) return { ok: false, message: NET_ERRORS[st] };
    const [network, broadcast, first, last, hosts, wildcard, maskDotted, prefix, cls, type, binIp, binMask, binNet, ipInt, ipHex, rdns] = this._lines();
    return { ok: true, network, broadcast, first, last, hosts, wildcard, mask: maskDotted, prefix: +prefix.slice(1), cls, type, binIp, binMask, binNet, ipInt, ipHex, rdns };
  }
  subnets(ip, mask, newPrefix, start = 0, count = 64) {
    if (!this._put(ip, mask)) return { ok: false, message: 'Entrada demasiado larga.' };
    const st = this.x.oc_subnets(newPrefix, start, count);
    if (st) return { ok: false, message: NET_ERRORS[st] };
    return { ok: true, total: this.aux[0], rows: this._lines().map((l) => { const [i, net, first, last, bc] = l.split('|'); return { i: +i, net, first, last, bc }; }) };
  }
  prefixForHosts(h) { return this.x.oc_prefix_for_hosts(h); }
}
