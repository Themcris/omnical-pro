/**
 * OmniCalc — Proporcionalidad: regla de tres simple (directa/inversa), compuesta y porcentajes.
 * Aritmética racional exacta (Frac): 1/3 de 90 da 30, no 29.999999.
 * Lógica pura; devuelve {ok, …, steps:[{title, lines}]} igual que poly.js y sets.js.
 */
import { Frac, plainFrac } from './frac.js';

export class RatioError extends Error {}

/* ---------- utilidades de formato ---------- */
const NB = '\u00A0';
export function grp(text) {                       // 1234567.5 -> 1 234 567.5
  const m = /^(-?)(\d+)(.*)$/.exec(text); if (!m) return text;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, NB) + m[3];
}
const N = (f) => grp(plainFrac(f, 6)).replace('-', '−');
const NP = (f) => (f.isNeg() ? `(${N(f)})` : N(f));
const frac = (a, b) => `${N(a)}/${N(b)}`;
const simp = (a, b) => { const r = a.div(b); return r.isInt() ? r.toString() : `${r.n}/${r.d}`; };
const REL = { directa: 'DIRECTA', inversa: 'INVERSA' };

export function parseNum(text, name) {
  const f = Frac.parse(String(text).replace(/%$/, '').replace(/^C\$/i, ''));
  if (!f) throw new RatioError(`«${name}» no es un número válido.`);
  return f;
}
function positive(f, name) { if (f.cmp(0) <= 0) throw new RatioError(`«${name}» debe ser mayor que cero.`); return f; }
const wrap = (fn) => (...a) => { try { return fn(...a); } catch (e) { if (e instanceof RatioError) return { ok: false, message: e.message }; throw e; } };

/* ===================================================================
 *  Regla de tres SIMPLE  (cuadrícula 2×2, una casilla es la incógnita x)
 *      l1      l2
 *      a   →   b      (situación 1)
 *      c   →   d      (situación 2)
 *  Directa:  a/b = c/d  →  a·d = b·c        Inversa:  a·b = c·d
 * =================================================================== */
export const simpleRule = wrap(({ cells, type, l1 = 'Magnitud 1', l2 = 'Magnitud 2' }) => {
  const names = ['a', 'b', 'c', 'd'], blank = [];
  cells.forEach((t, i) => { if (String(t).trim() === '' || /^x$/i.test(String(t).trim())) blank.push(i); });
  if (blank.length !== 1) throw new RatioError(blank.length === 0 ? 'Deja UNA casilla vacía: es la incógnita x.' : 'Deja vacía solo UNA casilla (la incógnita x); completa las demás.');
  const u = blank[0], inv = type === 'inversa';
  const v = cells.map((t, i) => (i === u ? null : positive(parseNum(t, ['Fila 1, col. 1', 'Fila 1, col. 2', 'Fila 2, col. 1', 'Fila 2, col. 2'][i]), names[i])));
  // pareja que se multiplica y valor que divide
  //   directa : x = (producto de la diagonal que NO contiene a x) / (valor conocido de la diagonal de x)
  //   inversa : x = (producto de la fila SIN x) / (valor conocido de la fila de x)
  const diag = [[0, 3], [1, 2]], row = [[0, 1], [2, 3]];
  let num, den, why;
  if (!inv) {
    const mine = diag.find((p) => p.includes(u)), other = diag.find((p) => !p.includes(u));
    num = [other[0], other[1]]; den = mine.find((i) => i !== u);
    why = 'Directa: se multiplican los dos valores conocidos que están en diagonal y se divide entre el valor conocido restante.';
  } else {
    const mine = row.find((p) => p.includes(u)), other = row.find((p) => !p.includes(u));
    num = [other[0], other[1]]; den = mine.find((i) => i !== u);
    why = 'Inversa: se multiplican los valores de la situación completa (la fila sin x) y se divide entre el valor conocido de la fila de x.';
  }
  const x = v[num[0]].mul(v[num[1]]).div(v[den]);
  const cell = (i) => (i === u ? 'x' : N(v[i]));
  const w = Math.max(l1.length, l2.length, 6, ...[0, 2].map((i) => cell(i).length));
  const table = [`${l1.padEnd(w)}   ${l2}`, `${cell(0).padEnd(w)} → ${cell(1)}`, `${cell(2).padEnd(w)} → ${cell(3)}`];
  const steps = [
    { title: 'Datos organizados', lines: table },
    { title: 'Tipo de relación', lines: [inv
      ? `Si «${l1}» aumenta, «${l2}» disminuye (y al revés) → regla de tres ${REL.inversa}.`
      : `Si «${l1}» aumenta, «${l2}» también aumenta (y al revés) → regla de tres ${REL.directa}.`] },
    { title: 'Planteamiento', lines: [why, `x = (${N(v[num[0]])})(${N(v[num[1]])}) / ${N(v[den])}`, `x = ${N(v[num[0]].mul(v[num[1]]))} / ${N(v[den])}`] },
    { title: 'Resultado', lines: [`x = ${N(x)}${x.isInt() ? '' : `   (= ${x.n}/${x.d})`}`] },
  ];
  return { ok: true, x, text: N(x), steps };
});

/* ===================================================================
 *  Regla de tres COMPUESTA
 *  Cada fila: magnitud, valor en la situación 1, valor en la situación 2, relación con la incógnita.
 *  La incógnita: valor conocido en la situación 1 (v1) y x en la situación 2.
 *    directa  -> razón v2/v1          inversa -> razón v1/v2
 *    x = v1(incógnita) × Π razones
 * =================================================================== */
export const compoundRule = wrap(({ unknown, rows }) => {
  if (!rows.length) throw new RatioError('Agrega al menos una magnitud además de la incógnita.');
  const uLabel = unknown.label || 'Incógnita';
  const base = positive(parseNum(unknown.v1, `${uLabel} (situación 1)`), `${uLabel} (situación 1)`);
  const fs = rows.map((r, i) => {
    const label = r.label || `Magnitud ${i + 1}`;
    return { label, rel: r.rel === 'inversa' ? 'inversa' : 'directa',
      v1: positive(parseNum(r.v1, `${label} (situación 1)`), `${label} (situación 1)`),
      v2: positive(parseNum(r.v2, `${label} (situación 2)`), `${label} (situación 2)`) };
  });
  fs.forEach((f) => { f.num = f.rel === 'directa' ? f.v2 : f.v1; f.den = f.rel === 'directa' ? f.v1 : f.v2; });
  const nums = fs.map((f) => f.num), dens = fs.map((f) => f.den);
  const N0 = nums.reduce((p, f) => p.mul(f), base), D0 = dens.reduce((p, f) => p.mul(f), new Frac(1));
  const x = N0.div(D0);

  const lw = Math.max(8, uLabel.length, ...fs.map((f) => f.label.length)), c = (s) => String(s).padEnd(lw);
  const wN = Math.max(...fs.map((f) => N(f.v1).length), N(base).length, 4);
  const table = [`${c('')}  ${'Sit. 1'.padEnd(wN)}   Sit. 2`,
    ...fs.map((f) => `${c(f.label)}  ${N(f.v1).padEnd(wN)} → ${N(f.v2)}`),
    `${c(uLabel)}  ${N(base).padEnd(wN)} → x`];
  const analysis = fs.map((f) => f.rel === 'directa'
    ? `${f.label}: pasa de ${N(f.v1)} a ${N(f.v2)} y «${uLabel}» cambia en el MISMO sentido → ${REL.directa} → razón ${frac(f.v2, f.v1)}`
    : `${f.label}: pasa de ${N(f.v1)} a ${N(f.v2)} y «${uLabel}» cambia en sentido CONTRARIO → ${REL.inversa} → razón ${frac(f.v1, f.v2)}`);
  const ratios = fs.map((f) => `(${frac(f.num, f.den)})`).join(' × ');
  const steps = [
    { title: 'Datos organizados', lines: table },
    { title: `Relación de cada magnitud con «${uLabel}»`, lines: [...analysis,
      'Regla: si se mueven en el mismo sentido es directa (razón nueva/antigua); si en sentido contrario, inversa (razón antigua/nueva).'] },
    { title: 'Planteamiento', lines: [
      `x = ${N(base)} × ${ratios}`,
      `x = (${[N(base), ...nums.map(N)].join(' × ')}) / (${dens.map(N).join(' × ')})`,
      `x = ${N(N0)} / ${N(D0)}`,
      ...(x.isInt() ? [] : [`x = ${x.n}/${x.d}`]),
    ] },
    { title: 'Resultado', lines: [`x = ${N(x)}  (${uLabel})`] },
  ];
  return { ok: true, x, text: N(x), steps };
});

/* ===================================================================
 *  PORCENTAJES
 * =================================================================== */
export const PERCENT_MODES = {
  parte:     { label: '¿Cuánto es el p % de T?',        f1: 'Porcentaje p (%)',     f2: 'Total T',           ex: ['12', '2500'] },
  porcentaje:{ label: '¿Qué % es X de Y?',               f1: 'Parte X',              f2: 'Total Y',           ex: ['560', '800'] },
  total:     { label: 'Total, conocida una parte y su %', f1: 'Parte',                f2: 'Porcentaje (%)',    ex: ['180', '15'] },
  aumento:   { label: 'Aumento de p %',                  f1: 'Valor original',       f2: 'Porcentaje p (%)',  ex: ['85000', '8'] },
  descuento: { label: 'Descuento de p %',                f1: 'Valor original',       f2: 'Porcentaje p (%)',  ex: ['120000', '7'] },
  variacion: { label: 'Variación porcentual (de A a B)', f1: 'Valor inicial A',      f2: 'Valor final B',     ex: ['250', '300'] },
};

export const percentCalc = wrap((mode, in1, in2) => {
  const M = PERCENT_MODES[mode]; if (!M) throw new RatioError('Operación desconocida.');
  const a = parseNum(in1, M.f1), b = parseNum(in2, M.f2);
  const pct = (f) => `${N(f)} %`;
  let value, label, kv, lines, title;
  switch (mode) {
    case 'parte': {
      const p = a, T = b; value = p.mul(T).div(100); label = `${pct(p)} de ${N(T)}`;
      title = 'Parte = porcentaje × total / 100';
      lines = [`Parte = (${N(p)} × ${N(T)}) / 100`, `Parte = ${N(p.mul(T))} / 100`, `Parte = ${N(value)}`];
      kv = [[label, N(value)], ['Fracción', `${N(p)}/100 = ${simp(p, new Frac(100))}`]]; break;
    }
    case 'porcentaje': {
      const X = a, Y = positive(b, M.f2); value = X.mul(100).div(Y); label = `${N(X)} es el … de ${N(Y)}`;
      title = 'Porcentaje = parte × 100 / total';
      lines = [`Porcentaje = (${N(X)} × 100) / ${N(Y)}`, `Porcentaje = ${N(X.mul(100))} / ${N(Y)}`, `Porcentaje = ${pct(value)}`];
      kv = [['Porcentaje', pct(value)], ['Falta para el total', pct(new Frac(100).sub(value))]]; break;
    }
    case 'total': {
      const part = a, p = positive(b, M.f2); value = part.mul(100).div(p); label = 'Total';
      title = 'Total = parte × 100 / porcentaje';
      lines = [`Total = (${N(part)} × 100) / ${N(p)}`, `Total = ${N(part.mul(100))} / ${N(p)}`, `Total = ${N(value)}`];
      kv = [['Total', N(value)]]; break;
    }
    case 'aumento': case 'descuento': {
      const V = a, p = b, inc = p.mul(V).div(100), nv = mode === 'aumento' ? V.add(inc) : V.sub(inc), up = mode === 'aumento';
      value = nv; label = up ? 'Nuevo valor' : 'Valor a pagar';
      title = up ? 'Aumento: incremento = p × V / 100; nuevo = V + incremento' : 'Descuento: descuento = p × V / 100; pago = V − descuento';
      lines = [`${up ? 'Incremento' : 'Descuento'} = (${N(p)} × ${N(V)}) / 100 = ${N(inc)}`,
        `${up ? 'Nuevo valor' : 'Pago'} = ${N(V)} ${up ? '+' : '−'} ${N(inc)} = ${N(nv)}`,
        `Atajo: ${N(V)} × ${plainFrac(new Frac(100).add(up ? p : p.neg()).div(100), 6)} = ${N(nv)}`];
      kv = [[up ? 'Incremento' : 'Descuento', N(inc)], [label, N(nv)]]; break;
    }
    default: {                                       // variacion
      const A = positive(a, M.f1), B = b, d = B.sub(A); value = d.mul(100).div(A);
      label = value.isNeg() ? 'Disminución' : 'Aumento';
      title = 'Variación % = (B − A) × 100 / A';
      lines = [`Diferencia = ${N(B)} − ${N(A)} = ${N(d)}`, `Variación = (${N(d)} × 100) / ${N(A)} = ${pct(value)}`,
        value.isZero() ? 'No hay variación.' : `Es un ${value.isNeg() ? 'descenso' : 'aumento'} de ${pct(value.abs())}.`];
      kv = [[label, pct(value.abs())]];
    }
  }
  const isPct = mode === 'porcentaje' || mode === 'variacion';
  const text = isPct ? pct(value) : N(value);
  return { ok: true, value, text, label, kv, steps: [{ title, lines }, { title: 'Resultado', lines: [`${isPct ? label || 'Porcentaje' : label} = ${text}`] }] };
});
