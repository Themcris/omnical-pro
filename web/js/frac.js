/**
 * OmniCalc — aritmética racional exacta con BigInt (sin errores de coma flotante).
 * La usan los módulos de Polinomios y Proporcionalidad.
 */
const big = (n) => (typeof n === 'bigint' ? n : BigInt(n));
const babs = (a) => (a < 0n ? -a : a);
function gcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }

export class Frac {
  constructor(n, d = 1n) {
    n = big(n); d = big(d);
    if (d === 0n) throw new RangeError('División entre cero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  static of(x) { return x instanceof Frac ? x : new Frac(x); }
  /** "12", "-3.25", "1/4", "0,5" -> Frac. Devuelve null si no es un número válido. */
  static parse(text) {
    let t = String(text).trim().replace('−', '-').replace(/\s+/g, '');
    if (t === '') return null;
    if (/^[-+]?\d+,\d+$/.test(t)) t = t.replace(',', '.');
    let m = /^([-+]?)(\d+)\/(\d+)$/.exec(t);
    if (m) { if (BigInt(m[3]) === 0n) return null; return new Frac(BigInt(m[1] + m[2]), BigInt(m[3])); }
    m = /^([-+]?)(\d*)\.?(\d*)$/.exec(t);
    if (!m || (m[2] === '' && m[3] === '')) return null;
    const dec = m[3] || '';
    return new Frac(BigInt((m[1] === '-' ? '-' : '') + ((m[2] || '0') + dec)), 10n ** BigInt(dec.length));
  }
  add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { o = Frac.of(o); if (o.n === 0n) throw new RangeError('División entre cero'); return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
  abs() { return new Frac(babs(this.n), this.d); }
  pow(k) { let r = new Frac(1), b = this; for (let i = 0; i < k; i++) r = r.mul(b); return r; }
  isZero() { return this.n === 0n; }
  isInt() { return this.d === 1n; }
  isNeg() { return this.n < 0n; }
  eq(o) { o = Frac.of(o); return this.n === o.n && this.d === o.d; }
  cmp(o) { o = Frac.of(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  floor() { let q = this.n / this.d; if (this.n < 0n && this.n % this.d !== 0n) q -= 1n; return q; }
  toNumber() { return Number(this.n) / Number(this.d); }
  /** "3/4" o "5" */
  toString() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
}

/**
 * Decimal con `digits` cifras (redondeo half-up, sin ceros finales).
 * Devuelve {text, exact}: exact = true si el decimal es exactamente igual a la fracción.
 */
export function decimalString(f, digits = 6) {
  f = Frac.of(f);
  const neg = f.n < 0n, n = babs(f.n), scale = 10n ** BigInt(digits);
  let q = (n * scale * 2n + f.d) / (f.d * 2n);                 // redondeo half-up
  const exact = (n * scale) % f.d === 0n;
  let s = q.toString().padStart(digits + 1, '0');
  let int = s.slice(0, s.length - digits), dec = s.slice(s.length - digits).replace(/0+$/, '');
  const text = (neg && (q !== 0n) ? '-' : '') + int + (dec ? '.' + dec : '');
  return { text, exact };
}

/** Texto para mostrar: entero, o "3/4 ≈ 0.75" cuando no es entero y no es decimal finito corto. */
export function showFrac(f, digits = 6) {
  f = Frac.of(f);
  if (f.isInt()) return f.n.toString();
  const { text, exact } = decimalString(f, digits);
  return exact ? text : `${f.toString()} ≈ ${text}`;
}
/** Solo el valor numérico (decimal si no es entero). */
export function plainFrac(f, digits = 6) {
  f = Frac.of(f);
  return f.isInt() ? f.n.toString() : decimalString(f, digits).text;
}
