// Pruebas del motor C/WASM a través del puente real (web/js/core.js).
//   node tests/engine.test.mjs
import { readFileSync } from 'node:fs';
import { OmniCore, setPrecision, fmt, SLOT } from '../web/js/core.js';

const core = await OmniCore.load(readFileSync(new URL('../web/omnicalc.wasm', import.meta.url)));
let pass = 0, fail = 0;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function ok(name, cond, extra = '') { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } }
function section(t) { console.log(`\n▸ ${t}`); }
const ev = (e, x = 0) => core.evaluate(e, { x });

setPrecision(15);

section('Parser: precedencia y asociatividad');
const cases = [
  ['1+2*3', 7], ['(1+2)*3', 9], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-2', 0.25], ['2*-3', -6],
  ['10/4', 2.5], ['10-3-2', 5], ['2^0.5', Math.SQRT2], ['--3', 3], ['+3', 3], ['5!', 120], ['3!^2', 36], ['(2+3)!', 120],
  ['0!', 1], ['.5+.5', 1], ['5.', 5], ['1e3', 1000], ['1E-2', 0.01], ['2e', 2 * Math.E], ['2e3', 2000],
  ['sin(x)+1', Math.sin(0) + 1], ['abs(-3)', 3], ['cbrt(-8)', -2], ['sqrt(16)', 4], ['ln(e)', 1], ['log(1000)', 3], ['log2(8)', 3],
  ['exp(1)', Math.E], ['floor(2.7)', 2], ['ceil(2.1)', 3], ['round(2.5)', 3], ['round(-2.5)', -3], ['sign(-9)', -1],
  ['min(3,7)', 3], ['max(3,7)', 7], ['mod(10,3)', 1], ['hypot(3,4)', 5], ['atan2(1,1)', Math.PI / 4], ['root(27,3)', 3], ['root(-8,3)', -2],
  ['ncr(5,2)', 10], ['npr(5,2)', 20], ['gcd(12,18)', 6], ['logb(8,2)', 3], ['(-8)^(1/3)', -2],
  ['2pi', 2 * Math.PI], ['pi', Math.PI], ['tau', 2 * Math.PI], ['phi', (1 + Math.sqrt(5)) / 2], ['3(4+1)', 15], ['(2)(3)', 6], ['2(3)(4)', 24],
  ['2 sin(0)', 0], ['SIN(0)+COS(0)', 1], ['  1 +  2 ', 3], ['2^2^-1', Math.SQRT2], ['4.5!', 52.34277778455352], ['sinh(0)', 0], ['cosh(0)', 1], ['asinh(0)', 0], ['acosh(1)', 0], ['atanh(0)', 0],
  ['1/3*3', 1], ['0.1+0.2', 0.30000000000000004], ['100000000000000000000', 1e20], ['inf', Infinity === Infinity ? 0 : 0],
];
for (const [e, want] of cases) {
  if (e === 'inf') continue;
  const r = ev(e);
  ok(`${e} = ${want}`, r.ok && near(r.value, want, 1e-12), JSON.stringify(r));
}
ok('x implícita: 2x con x=3', near(ev('2x', 3).value, 6));
ok('x implícita: x(x+1) con x=3', near(ev('x(x+1)', 3).value, 12));
ok('x implícita: 3x^2', near(ev('3x^2', 2).value, 12));
ok('xsin(x)', near(ev('xsin(x)', 1).value, Math.sin(1)));
ok('pix', near(ev('pix', 2).value, 2 * Math.PI));
ok('ans', (core.setAns(42), near(ev('ans*2').value, 84)));

section('Parser: errores con posición');
const errs = [
  ['', 1], ['   ', 1], ['2+', 9], ['(2+3', 4], ['2+3)', 5], ['2 3', 2], ['1.2.3', 2], ['foo(1)', 3], ['sinx', 7], ['sin x', 7], ['sin(1,2)', 8], ['min(1)', 8],
  ['2+*3', 2], ['@', 2], ['5!!!!', 0], ['abc', 3], ['()', 2], ['sin()', 2], ['*2', 2],
];
for (const [e, code] of errs) {
  const r = core.compile(e, SLOT.TMP);
  if (e === '5!!!!') { ok('5!!!! compila (factoriales repetidos)', r.ok); continue; }
  ok(`error "${e}" -> ${code}`, !r.ok && r.code === code, JSON.stringify(r));
}
{ const r = core.compile('2+3)', SLOT.TMP); ok('posición ")" = 3', r.pos === 3, JSON.stringify(r)); }
{ const r = core.compile('2+@', SLOT.TMP); ok('posición "@" = 2', r.pos === 2); }

section('Parser: división por cero y dominio (ya no devuelve 0 en silencio)');
for (const [e, flag] of [['1/0', 1], ['0/0', 1], ['1/(x-x)', 1], ['sqrt(-1)', 2], ['ln(-1)', 2], ['ln(0)', 1], ['asin(2)', 2], ['acos(-2)', 2], ['(-1)^0.5', 2], ['0^-1', 1], ['(-3)!', 2], ['mod(5,0)', 1], ['10^400', 4], ['171!', 4], ['tan(pi/2)', 2]]) {
  const r = ev(e);
  ok(`${e} -> error`, !r.ok, JSON.stringify(r));
  if (r.flags !== undefined) ok(`${e} flag=${flag}`, (r.flags & flag) !== 0, `flags=${r.flags}`);
}
ok('1/0 mensaje', /cero/i.test(ev('1/0').message));

section('Ángulos');
core.setAngle('deg');
for (const [e, w] of [['sin(30)', 0.5], ['cos(60)', 0.5], ['sin(180)', 0], ['cos(90)', 0], ['sin(90)', 1], ['tan(45)', 1], ['asin(1)', 90], ['atan(1)', 45], ['sin(360)', 0], ['cos(-90)', 0], ['sin(-90)', -1], ['tan(180)', 0]]) {
  const r = ev(e); ok(`DEG ${e}`, r.ok && near(r.value, w, 1e-12) && (w !== 0 || r.value === 0), JSON.stringify(r));
}
ok('DEG tan(90) indefinida', !ev('tan(90)').ok);
core.setAngle('grad'); ok('GRAD sin(100)=1', near(ev('sin(100)').value, 1)); ok('GRAD atan(1)=50', near(ev('atan(1)').value, 50));
core.setAngle('rad'); ok('RAD sin(pi)=0 limpio', ev('sin(pi)').value === 0); ok('RAD cos(pi/2)=0 limpio', ev('cos(pi/2)').value === 0);
ok('RAD sin(1e-20) conserva valor', ev('sin(1e-20)').value === 1e-20);

section('Parser: robustez (fuzz) — nunca debe romper ni colgarse');
{
  const alphabet = '0123456789+-*/^()!.,xepisnctalgqrbdfmouh E_@#$ \t\n';
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let t0 = Date.now(), n = 0;
  for (let i = 0; i < 40000; i++) {
    let len = 1 + Math.floor(rnd() * 40), s = '';
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    try { const r = core.compile(s, SLOT.TMP); if (r.ok) { core.eval(SLOT.TMP, rnd() * 10 - 5); n++; } } catch (e) { ok('fuzz sin excepción', false, `${JSON.stringify(s)} -> ${e}`); break; }
  }
  ok(`fuzz 40000 entradas (${n} válidas) en ${Date.now() - t0} ms`, true);
  // anidamiento extremo
  for (const s of ['('.repeat(3000) + '1' + ')'.repeat(3000), '-'.repeat(3000) + '1', '2' + '^2'.repeat(2000), 'sin('.repeat(500) + '1' + ')'.repeat(500), '1+'.repeat(2000) + '1', 'x'.repeat(3500), '9'.repeat(3900)]) {
    const r = core.compile(s, SLOT.TMP); ok(`profundidad extrema (${s.slice(0, 6)}… len ${s.length}) no revienta`, typeof r.ok === 'boolean');
  }
  ok('expresión > 4000 chars rechazada', !core.compile('1+'.repeat(3000), SLOT.TMP).ok);
  // Todavía funciona después del abuso
  ok('motor sano tras fuzz', near(ev('2+2').value, 4));
}

section('evalRange (gráficas)');
{
  core.compile('x^2-4', 0);
  const pts = core.evalRange(0, -2, 1, 5);
  ok('x^2-4 en [-2..2]', [0, -3, -4, -3, 0].every((v, i) => near(pts[i], v)), Array.from(pts).join());
  core.compile('1/x', 1); const q = core.evalRange(1, -1, 1, 3);
  ok('1/x en 0 es NaN (no 0)', Number.isNaN(q[1]) && near(q[0], -1) && near(q[2], 1));
  ok('n > capacidad se recorta', core.evalRange(0, 0, 1, 99999).length === core.caps.pts);
  const big = core.evalRange(0, 0, 0.001, 4096); ok('4096 puntos sin error', big.length === 4096);
}

section('Cálculo');
{
  const I = (e, a, b) => core.integral(e, a, b);
  ok('∫0..2 x^2 = 8/3', near(I('x^2', 0, 2).value, 8 / 3, 1e-12));
  ok('∫0..pi sin = 2', near(I('sin(x)', 0, Math.PI).value, 2, 1e-11));
  ok('∫0..2pi sin = 0 (antes fallaba por Simpson inicial)', Math.abs(I('sin(x)', 0, 2 * Math.PI).value) < 1e-10);
  ok('∫1..e 1/x = 1', near(I('1/x', 1, Math.E).value, 1, 1e-11));
  ok('límites invertidos cambian el signo', near(I('x', 2, 0).value, -2));
  ok('a=b da 0', I('x', 3, 3).value === 0);
  ok('∫0..inf e^-x = 1', near(I('exp(-x)', 0, Infinity).value, 1, 1e-8), JSON.stringify(I('exp(-x)', 0, Infinity)));
  ok('∫-inf..inf e^(-x^2) = √π', near(I('exp(-x^2)', -Infinity, Infinity).value, Math.sqrt(Math.PI), 1e-8), JSON.stringify(I('exp(-x^2)', -Infinity, Infinity)));
  ok('∫1..inf 1/x^2 = 1', near(I('1/x^2', 1, Infinity).value, 1, 1e-7), JSON.stringify(I('1/x^2', 1, Infinity)));
  ok('singularidad integrable ∫0..1 1/sqrt(x) ≈ 2', Math.abs(I('1/sqrt(x)', 0, 1).value - 2) < 1e-3, JSON.stringify(I('1/sqrt(x)', 0, 1)));
  ok('∫0..1 ln(x) ≈ -1', Math.abs(I('ln(x)', 0, 1).value + 1) < 1e-3, JSON.stringify(I('ln(x)', 0, 1)));
  const bad = I('sqrt(x)', -1, 1); ok('f no definida en parte: avisa (bad>0)', bad.ok && bad.bad > 0, JSON.stringify(bad));
  ok('integral de expresión inválida da error', !I('2+', 0, 1).ok);
  ok('función constante', near(I('5', 0, 3).value, 15));
  const D = (e, x, o = 1) => core.derivative(e, x, o);
  ok("d/dx x^2 en 3 = 6", near(D('x^2', 3).value, 6, 1e-9), JSON.stringify(D('x^2', 3)));
  ok("d/dx sin en 0 = 1", near(D('sin(x)', 0).value, 1, 1e-9));
  ok("d/dx e^x en 1 = e", near(D('exp(x)', 1).value, Math.E, 1e-9));
  ok("d/dx ln en 2 = .5", near(D('ln(x)', 2).value, 0.5, 1e-9));
  ok("d/dx x^3 en 1000 = 3e6", near(D('x^3', 1000).value, 3e6, 1e-8));
  ok("d²/dx² x^3 en 2 = 12", near(D('x^3', 2, 2).value, 12, 1e-6), JSON.stringify(D('x^3', 2, 2)));
  ok("d²/dx² sin en pi/2 = -1", near(D('sin(x)', Math.PI / 2, 2).value, -1, 1e-6));
  ok("|x| en 0 avisa punto anguloso", D('abs(x)', 0).kink === true, JSON.stringify(D('abs(x)', 0)));
  ok("|x| en 2 sin aviso y = 1", D('abs(x)', 2).kink === false && near(D('abs(x)', 2).value, 1));
  ok("derivada fuera de dominio da error", !D('ln(x)', -1).ok);
  const R = (e, a, b) => core.roots(e, a, b).roots;
  ok('raíces x^2-4 en [-5,5]', (() => { const r = R('x^2-4', -5, 5); return r.length === 2 && near(r[0], -2, 1e-12) && near(r[1], 2, 1e-12); })(), String(R('x^2-4', -5, 5)));
  ok('raíces sin(x) en [0,10]: 0,π,2π,3π', (() => { const r = R('sin(x)', 0, 10); return r.length === 4 && near(r[1], Math.PI, 1e-12) && near(r[3], 3 * Math.PI, 1e-12); })(), String(R('sin(x)', 0, 10)));
  ok('1/x no tiene raíces ni polos falsos', R('1/x', -5, 5).length === 0, String(R('1/x', -5, 5)));
  ok('tan(x) en [-1,1]: sólo x=0', (() => { const r = R('tan(x)', -1, 1); return r.length === 1 && Math.abs(r[0]) < 1e-12; })(), String(R('tan(x)', -1, 1)));
  ok('x^3-x en [-2,2]: -1,0,1', (() => { const r = R('x^3-x', -2, 2); return r.length === 3; })(), String(R('x^3-x', -2, 2)));
  ok('raíz exacta en extremo', R('x', 0, 1).length >= 1);
  ok('intervalo inválido -> sin raíces', R('x', 2, 1).length === 0);
}

section('Estadística');
{
  const s = core.stats([4, 8, 15, 16, 23, 42]);
  ok('media 18', near(s.mean, 18)); ok('mediana 15.5', near(s.median, 15.5));
  ok('var poblacional 151.667', near(s.varP, 910 / 6)); ok('var muestral 168.4', near(s.varS, 182));
  ok('desv pob', near(s.sdP, Math.sqrt(910 / 6))); ok('Q1/Q3 (interpolación lineal)', near(s.q1, 9.75) && near(s.q3, 21.25), `${s.q1} ${s.q3}`);
  ok('min/max/rango', s.min === 4 && s.max === 42 && s.range === 38); ok('sin moda', s.modeCount === 1 && s.modes.length === 0);
  const m = core.stats([1, 2, 2, 3, 3, 4]); ok('bimodal', m.modes.join() === '2,3' && m.modeCount === 2, JSON.stringify(m.modes));
  ok('un solo dato: var muestral NaN', Number.isNaN(core.stats([5]).varS));
  ok('geométrica ', near(core.stats([1, 2, 4]).geo, 2)); ok('armónica', near(core.stats([1, 2, 4]).harm, 12 / 7));
  ok('negativos: geo = NaN', Number.isNaN(core.stats([-1, 2]).geo));
  ok('vacío -> error', !core.stats([]).ok);
  ok('Infinity -> error', !core.stats([1, Infinity]).ok);
  const big = Array.from({ length: 16384 }, (_, i) => Math.sin(i)); ok('16384 datos', core.stats(big).ok);
  ok('16385 datos rechazado', !core.stats(new Array(16385).fill(1)).ok);
  ok('estabilidad numérica (Welford)', near(core.stats([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]).varP, 22.5, 1e-6), String(core.stats([1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]).varP));
  const sorted = Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5003); const sm = core.stats(sorted);
  ok('mediana de 5000 datos (heapsort)', near(sm.median, sorted.slice().sort((a, b) => a - b)[2499] / 2 + sorted.slice().sort((a, b) => a - b)[2500] / 2));
  const lr = core.linreg([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  ok('regresión: b=0.6 a=2.2', near(lr.slope, 0.6) && near(lr.intercept, 2.2) && near(lr.r2, 0.6 * 0.6 * 10 / 6, 1e-9), JSON.stringify(lr));
  ok('regresión con x constante -> error', !core.linreg([1, 1, 1], [1, 2, 3]).ok);
  ok('regresión con 1 par -> error', !core.linreg([1], [1]).ok);
}

section('Álgebra lineal');
{
  const A3 = [1, 2, 3, 0, 1, 4, 5, 6, 0], I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let r = core.matrix(6, 3, A3); ok('det 3x3 = 1', r.scalar === 1, JSON.stringify(r.scalar));
  r = core.matrix(5, 3, A3); ok('inversa clásica', r.ok && [-24, 18, 5, 20, -15, -4, -5, 4, 1].every((v, i) => near(r.matrix[i], v)), String(r.matrix));
  ok('inversa trae pasos', /cofactores/.test(r.steps) && /Adjunta/.test(r.steps));
  const inv = r.matrix; const prod = core.matrix(3, 3, A3, inv); ok('A × A⁻¹ = I', prod.matrix.every((v, i) => near(v, I3[i], 1e-12)));
  ok('cond finita', Number.isFinite(r.cond) && r.cond > 1);
  r = core.matrix(5, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]); ok('singular detectada', r.status === 2 && /singular/.test(r.message));
  r = core.matrix(5, 2, [0.1, 0.2, 0.3, 0.6]); ok('singular con decimales (tolerancia relativa)', r.status === 2);
  r = core.matrix(6, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]); ok('det singular = 0 exacto', r.scalar === 0);
  r = core.matrix(1, 3, A3, I3); ok('A+B', r.matrix[0] === 2 && r.matrix[1] === 2);
  r = core.matrix(2, 3, A3, I3); ok('A-B', r.matrix[0] === 0 && r.matrix[4] === 0);
  r = core.matrix(4, 3, A3); ok('Aᵀ', r.matrix.join() === [1, 0, 5, 2, 1, 6, 3, 4, 0].join());
  r = core.matrix(8, 3, A3); ok('traza = 2', r.scalar === 2);
  r = core.matrix(7, 3, A3); ok('rango 3', r.scalar === 3); r = core.matrix(7, 3, [1, 2, 3, 2, 4, 6, 1, 1, 1]); ok('rango 2', r.scalar === 2);
  r = core.matrix(7, 3, [0, 0, 0, 0, 0, 0, 0, 0, 0]); ok('rango 0', r.scalar === 0);
  r = core.matrix(9, 2, [1, 1, 1, 0], [0, 0, 0, 0], 10); ok('Fibonacci con A^10', r.matrix.join() === '89,55,55,34', String(r.matrix));
  r = core.matrix(9, 2, [2, 0, 0, 2], [0, 0, 0, 0], -2); ok('A^-2', near(r.matrix[0], 0.25) && near(r.matrix[3], 0.25), String(r.matrix));
  r = core.matrix(9, 2, [2, 0, 0, 2], [0, 0, 0, 0], 0); ok('A^0 = I', r.matrix.join() === '1,0,0,1');
  r = core.matrix(9, 2, [1, 1, 1, 1], [0, 0, 0, 0], 0.5); ok('A^0.5 rechazado', r.status === 3);
  r = core.matrix(11, 2, [1, 2, 3, 4], [0, 0, 0, 0], 2.5); ok('k·A', r.matrix.join() === '2.5,5,7.5,10');
  r = core.matrix(10, 3, [2, 1, -1, -3, -1, 2, -2, 1, 2], [8, 0, 0, -11, 0, 0, -3, 0, 0]);
  ok('Ax=b única (2,3,-1)', r.status === 0 && near(r.matrix[0], 2) && near(r.matrix[3], 3) && near(r.matrix[6], -1), String(r.matrix));
  r = core.matrix(10, 2, [1, 1, 2, 2], [1, 0, 3, 0]); ok('Ax=b incompatible', r.status === 4);
  r = core.matrix(10, 2, [1, 1, 2, 2], [1, 0, 2, 0]); ok('Ax=b infinitas', r.status === 5);
  let r5 = core.matrix(6, 5, [2, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 6]); ok('det 5x5 diag = 720', r5.scalar === 720);
  r5 = core.matrix(5, 5, Array.from({ length: 25 }, (_, i) => (i % 6 === 0 ? 2 : (i * 7) % 5 - 2))); ok('inversa 5x5 ejecuta', r5.status === 0 || r5.status === 2);
  ok('n=1 rechazado', core.matrix(6, 1, [1]).status === 3); ok('n=6 rechazado', core.matrix(6, 6, new Array(36).fill(1)).status === 3);
  ok('NaN en matriz rechazado', core.matrix(6, 2, [NaN, 0, 0, 1]).status === 6); ok('Infinity en matriz rechazado', core.matrix(6, 2, [Infinity, 0, 0, 1]).status === 6);
  ok('op desconocida', core.matrix(99, 2, [1, 0, 0, 1]).status === 3);
}

section('Programador (64 bits exactos)');
{
  const B = (op, w, a, b = '0', base = 10) => core.bits(op, w, base, a, b);
  let r = B(1, 8, '12', '10'); ok('12 AND 10 = 8', r.dec === '8' && r.bin === '0000 1000' && r.hex === '8' && r.oct === '10');
  r = B(2, 8, '12', '10'); ok('OR = 14', r.dec === '14'); r = B(3, 8, '12', '10'); ok('XOR = 6', r.dec === '6');
  r = B(6, 8, '5'); ok('NOT 5 (8b) = 250', r.dec === '250' && r.sdec === '-6');
  r = B(6, 64, '0'); ok('NOT 0 (64b) = 2^64-1 exacto', r.dec === '18446744073709551615' && r.sdec === '-1' && r.hex === 'FFFFFFFFFFFFFFFF');
  r = B(7, 8, '12', '10'); ok('NAND', r.dec === String(~(12 & 10) & 255)); r = B(8, 8, '12', '10'); ok('NOR', r.dec === String(~(12 | 10) & 255));
  r = B(4, 8, '1', '7'); ok('1<<7 = 128', r.dec === '128'); r = B(4, 8, '1', '8'); ok('1<<8 en 8 bits = 0 + aviso', r.dec === '0' && r.shiftOver);
  r = B(4, 64, '1', '63'); ok('1<<63 exacto', r.dec === '9223372036854775808' && r.sdec === '-9223372036854775808');
  r = B(4, 64, '1', '64'); ok('1<<64 = 0 (antes: UB)', r.dec === '0' && r.shiftOver);
  r = B(5, 8, '128', '7'); ok('128>>7 = 1', r.dec === '1');
  r = B(16, 8, '-128', '3'); ok('SAR -128>>3 = -16', r.sdec === '-16' && r.dec === '240');
  r = B(16, 8, '64', '3'); ok('SAR 64>>3 = 8', r.dec === '8'); r = B(16, 32, '-1', '40'); ok('SAR -1>>40 = -1', r.sdec === '-1');
  r = B(9, 8, '129', '1'); ok('ROL 0x81 por 1 = 0x03', r.dec === '3'); r = B(9, 8, '129', '0'); ok('ROL por 0 = identidad', r.dec === '129');
  r = B(9, 64, '1', '0'); ok('ROL 64b por 0 sin UB', r.dec === '1'); r = B(10, 8, '1', '1'); ok('ROR 1 por 1 = 128', r.dec === '128');
  r = B(9, 16, '32768', '17'); ok('ROL por > ancho usa módulo', r.dec === '1');
  r = B(11, 8, '200', '100'); ok('200+100 en 8b = 44, CF', r.dec === '44' && r.flags.cf && !r.flags.of);
  r = B(11, 8, '100', '100'); ok('100+100: OF, sin CF', r.dec === '200' && r.flags.of && !r.flags.cf && r.flags.sf);
  r = B(11, 64, '18446744073709551615', '1'); ok('64b: max+1 = 0, CF y ZF', r.dec === '0' && r.flags.cf && r.flags.zf);
  r = B(12, 8, '5', '10'); ok('5-10 = 251 (-5), CF', r.dec === '251' && r.sdec === '-5' && r.flags.cf);
  r = B(12, 8, '-128', '1'); ok('-128-1: OF', r.flags.of);
  r = B(13, 8, '16', '16'); ok('16*16 en 8b = 0, CF', r.dec === '0' && r.flags.cf && r.flags.zf);
  r = B(13, 8, '12', '10'); ok('12*10 = 120, sin flags', r.dec === '120' && !r.flags.cf && !r.flags.of);
  r = B(13, 8, '-8', '16'); ok('-8*16 = -128 sin OF', r.sdec === '-128' && !r.flags.of);
  r = B(13, 8, '-8', '17'); ok('-8*17 OF', r.flags.of);
  r = B(13, 64, '4294967296', '4294967296'); ok('2^32*2^32 en 64b: CF + OF', r.dec === '0' && r.flags.cf && r.flags.of);
  r = B(13, 64, '3037000499', '3037000499'); ok('3037000499² cabe en i63', r.dec === '9223372030926249001' && !r.flags.of && !r.flags.cf);
  r = B(14, 32, '100', '7'); ok('100/7 = 14', r.dec === '14'); r = B(15, 32, '100', '7'); ok('100%7 = 2', r.dec === '2');
  r = B(14, 8, '5', '0'); ok('÷0 -> error', !r.ok && /cero/i.test(r.message)); r = B(15, 8, '5', '0'); ok('mod 0 -> error', !r.ok);
  r = B(17, 8, '1'); ok('NEG 1 = 255', r.dec === '255' && r.sdec === '-1'); r = B(17, 8, '-128'); ok('NEG -128 = -128, OF', r.sdec === '-128' && r.flags.of);
  r = B(1, 16, '0xFF00', '0x0FF0'); ok('prefijos 0x', r.hex === 'F00');
  r = B(1, 8, '0b1100', '0b1010'); ok('prefijos 0b', r.dec === '8'); r = B(1, 8, '0o14', '0o12'); ok('prefijos 0o', r.dec === '8');
  r = B(1, 16, 'ff', 'f0', 16); ok('base 16 sin prefijo', r.dec === '240'); r = B(1, 8, '1100', '1010', 2); ok('base 2 sin prefijo', r.dec === '8');
  r = B(2, 8, '0b1111_0000', '0b0000_1111'); ok('separador _', r.dec === '255');
  r = B(1, 8, 'zz'); ok('letras en campo decimal -> error claro', !r.ok && /válido/.test(r.message));
  r = B(1, 8, '12abc'); ok('"12abc" -> error', !r.ok); r = B(1, 8, ''); ok('vacío -> error', !r.ok); r = B(1, 8, '1.5'); ok('decimales -> error', !r.ok);
  r = B(1, 8, '9', '-'); ok('"-" suelto -> error B', !r.ok);
  r = B(1, 8, '2', '2', 2); ok('dígito 2 en base 2 -> error', !r.ok);
  r = B(1, 64, '18446744073709551616'); ok('2^64 -> fuera de rango', !r.ok && /64 bits/.test(r.message));
  r = B(2, 64, '18446744073709551615'); ok('2^64-1 ok', r.ok && r.dec === '18446744073709551615');
  r = B(2, 64, '-9223372036854775808'); ok('-2^63 ok', r.ok && r.sdec === '-9223372036854775808');
  r = B(2, 8, '300'); ok('300 en 8 bits: aviso de truncamiento', r.ok && r.truncA && r.dec === '44');
  r = B(1, 8, '-129'); ok('-129 en 8 bits: truncado', r.truncA);
  r = B(1, 8, '-128'); ok('-128 en 8 bits no truncado', !r.truncA);
  r = B(1, 7, '1'); ok('ancho 7 inválido', !r.ok);
  r = B(6, 32, '0'); ok('popcount/lz/tz', r.pop === 32 && r.lz === 0 && r.tz === 0);
  r = B(2, 32, '8', '0'); ok('popcount=1 lz=28 tz=3', r.pop === 1 && r.lz === 28 && r.tz === 3);
  r = B(2, 8, '0', '0'); ok('cero: lz=8 tz=8 ZF', r.lz === 8 && r.tz === 8 && r.flags.zf);
  const f = core.ieee(0.1, false); ok('IEEE 0.1 f64', f.hex === '3FB999999999999A' && f.sign === '0' && f.exp === '01111111011' && f.cls === 'Normal' && f.e === -4);
  const g = core.ieee(-1.5, true); ok('IEEE -1.5 f32', g.hex === 'BFC00000' && g.sign === '1' && g.e === 0 && g.man === '10000000000000000000000');
  ok('IEEE ∞', core.ieee(Infinity, false).cls === '+Infinito'); ok('IEEE NaN', core.ieee(NaN, true).cls === 'NaN'); ok('IEEE 0', core.ieee(0, false).cls === 'Cero');
  ok('IEEE subnormal', core.ieee(5e-324, false).cls === 'Subnormal');
}

section('Matemáticas discretas (enteros exactos)');
{
  const D = (op, n, r = 0) => core.discrete(op, n, r);
  ok('20! exacto', D(3, 20).text === '2432902008176640000');
  ok('25! exacto (más que 2^53)', D(3, 25).text === '15511210043330985984000000');
  ok('100! exacto', D(3, 100).text === 93326215443944152681699238856266700490715968264381621468592963895217599993229915608941463976156518286253697920827223758251185210916864000000000000000000000000n.toString());
  ok('0! = 1', D(3, 0).text === '1');
  ok('1000! tiene 2568 dígitos', D(3, 1000).digits === 2568 && D(3, 1000).text.length === 2568);
  ok('3000! cabe', D(3, 3000).ok && D(3, 3000).digits === 9131);
  ok('3001! rechazado', !D(3, 3001).ok);
  ok('nCr(52,5) = 2598960', D(2, 52, 5).text === '2598960');
  ok('nCr(100,50) exacto', D(2, 100, 50).text === '100891344545564193334812497256');
  ok('nCr(n,0)=nCr(n,n)=1', D(2, 10, 0).text === '1' && D(2, 10, 10).text === '1');
  ok('nCr(5000,2500) ok', D(2, 5000, 2500).ok);
  ok('nCr(r>n) error', !D(2, 3, 5).ok);
  ok('nPr(10,3) = 720', D(1, 10, 3).text === '720'); ok('nPr(n,0)=1', D(1, 5, 0).text === '1');
  ok('nPr(100,50) exacto', D(1, 100, 50).text === (() => { let p = 1n; for (let i = 0; i < 50; i++) p *= BigInt(100 - i); return p.toString(); })());
  ok('Fib(10)=55', D(4, 10).text === '55'); ok('Fib(0)=0 Fib(1)=1', D(4, 0).text === '0' && D(4, 1).text === '1');
  ok('Fib(100) exacto', D(4, 100).text === '354224848179261915075');
  ok('Fib(1000) exacto', D(4, 1000).text === (() => { let a = 0n, b = 1n; for (let i = 0; i < 1000; i++) [a, b] = [b, a + b]; return a.toString(); })());
  ok('Fib(40000) cabe', D(4, 40000).ok); ok('Fib(40001) rechazado', !D(4, 40001).ok);
  ok('5^3 = 125', D(5, 5, 3).text === '125'); ok('2^64 exacto', D(5, 2, 64).text === '18446744073709551616'); ok('0^0 = 1', D(5, 0, 0).text === '1'); ok('0^3 = 0', D(5, 0, 3).text === '0');
  ok('7^2000 exacto', D(5, 7, 2000).text === (7n ** 2000n).toString());
  ok('3^1e6 -> demasiado grande', !D(5, 3, 1e6).ok);
  ok('C(n+r-1,r): 5 tipos, elegir 3 = 35', D(6, 5, 3).text === '35');
  ok('Catalan(10) = 16796', D(7, 10).text === '16796'); ok('Catalan(0)=1', D(7, 0).text === '1'); ok('Catalan(100) exacto', D(7, 100).text === '896519947090131496687170070074100632420837521538745909320');
  ok('negativos rechazados', !D(3, -1).ok); ok('decimales rechazados', !D(3, 2.5).ok); ok('NaN rechazado', !D(3, NaN).ok); ok('Infinity rechazado', !D(3, Infinity).ok);
  ok('n=4e9 en nCr no cuelga', (() => { const t = Date.now(); const r = D(2, 4e9, 3); return Date.now() - t < 500 && r.text === '10666666666000000000'.slice(0, 0) + (4000000000n * 3999999999n * 3999999998n / 6n).toString(); })());
  const NT = (op, ...f) => core.numtheory(op, ...f);
  let t = NT(1, '48', '18'); ok('gcd/lcm/Bezout 48,18', t.lines[0] === '6' && t.lines[1] === '144' && 48 * +t.lines[2] + 18 * +t.lines[3] === 6, JSON.stringify(t));
  t = NT(1, '0', '5'); ok('gcd(0,5)=5', t.lines[0] === '5' && t.lines[1] === '0'); t = NT(1, '0', '0'); ok('gcd(0,0)=0', t.lines[0] === '0');
  t = NT(1, '2305843009213693952', '3458764513820540928'); ok('gcd enorme', t.ok && t.lines[0] === '1152921504606846976', JSON.stringify(t));
  t = NT(2, '97'); ok('97 primo', t.lines[0] === 'primo' && t.lines[3] === '96');
  t = NT(2, '360'); ok('360 = 2^3 x 3^2 x 5, τ=24, φ=96', t.lines[1] === '2^3 x 3^2 x 5' && t.lines[2] === '24' && t.lines[3] === '96', JSON.stringify(t));
  t = NT(2, '1'); ok('1 es unidad', t.lines[0] === 'unidad'); t = NT(2, '0'); ok('0', t.lines[0] === 'cero');
  t = NT(2, '18446744073709551557'); ok('mayor primo < 2^64', t.lines[0] === 'primo', JSON.stringify(t));
  t = NT(2, '1000000007'); ok('10^9+7 primo', t.lines[0] === 'primo');
  { const t0 = Date.now(); t = NT(2, '999999999989'); ok('primo de 12 dígitos', t.lines[0] === 'primo'); }
  { const t0 = Date.now(); t = NT(2, '1000000016000000063'); ok('semiprimo (1e9+7)(1e9+9) factoriza rápido', t.lines[1] === '1000000007 x 1000000009' && Date.now() - t0 < 3000, JSON.stringify(t) + ' ' + (Date.now() - t0) + 'ms'); }
  t = NT(2, '9223372036854775807'); ok('2^63-1 = 7^2 x 73 x 127 x 337 x 92737 x 649657', t.lines[1] === '7^2 x 73 x 127 x 337 x 92737 x 649657', JSON.stringify(t));
  t = NT(2, '561'); ok('Carmichael 561 no es primo', t.lines[0] === 'compuesto' && t.lines[1] === '3 x 11 x 17');
  t = NT(2, '18446744073709551615'); ok('2^64-1 = 3·5·17·257·641·65537·6700417', t.lines[1] === '3 x 5 x 17 x 257 x 641 x 65537 x 6700417', JSON.stringify(t));
  t = NT(2, '4611686014132420609'); ok('(2^31-1)^2', t.lines[1] === '2147483647^2', JSON.stringify(t));
  t = NT(3, '2', '10', '1000'); ok('2^10 mod 1000 = 24', t.lines[0] === '24'); t = NT(3, '3', '200', '13'); ok('3^200 mod 13 = 9', t.lines[0] === '9');
  t = NT(3, '2', '1000000', '18446744073709551557'); ok('powmod 64 bits', t.ok);
  t = NT(3, '5', '3', '0'); ok('mod 0 -> error', !t.ok); t = NT(3, '5', '0', '1'); ok('x^0 mod 1 = 0', t.lines[0] === '0');
  t = NT(4, '3', '11'); ok('3^-1 mod 11 = 4', t.lines[0] === '4'); t = NT(4, '6', '9'); ok('sin inverso', !t.ok && /coprimos/.test(t.message));
  t = NT(4, '17', '3120'); ok('RSA clásico d = 2753', t.lines[0] === '2753');
  ok('negativo -> error', !NT(2, '-5').ok); ok('letras -> error', !NT(2, 'abc').ok); ok('2^64 -> fuera de rango', !NT(2, '18446744073709551616').ok); ok('vacío -> error', !NT(2, '').ok);
  const T = (e) => core.truth(e);
  let tt = T('p & q'); ok('p∧q', tt.ok && tt.vars.join() === 'p,q' && tt.rows.map((r) => +r.out).join('') === '0001');
  tt = T('p | q'); ok('p∨q', tt.rows.map((r) => +r.out).join('') === '0111');
  tt = T('p -> q'); ok('p→q', tt.rows.map((r) => +r.out).join('') === '1101');
  tt = T('p <-> q'); ok('p↔q', tt.rows.map((r) => +r.out).join('') === '1001');
  tt = T('p ^ q'); ok('p⊕q', tt.rows.map((r) => +r.out).join('') === '0110');
  tt = T('!(p & q) <-> (!p | !q)'); ok('De Morgan es tautología', tt.rows.every((r) => r.out), JSON.stringify(tt));
  tt = T('p & !p'); ok('contradicción', tt.rows.every((r) => !r.out));
  tt = T('a -> b -> c'); ok('-> asocia a la derecha (a→(b→c))', tt.rows.map((r) => +r.out).join('') === '11111101', tt.rows.map((r) => +r.out).join(''));
  tt = T('¬p ∨ q'); ok('símbolos unicode', tt.ok && tt.rows.map((r) => +r.out).join('') === '1101');
  tt = T('1 & p'); ok('constantes', tt.ok && tt.vars.join() === 'p');
  tt = T('p & q | r'); ok('& antes que |', tt.rows.map((r) => +r.out).join('') === '01010111', tt.rows.map((r) => +r.out).join(''));
  tt = T('a&b&c&d&e&f'); ok('6 variables = 64 filas', tt.ok && tt.rows.length === 64);
  tt = T('a&b&c&d&e&f&g'); ok('7 variables rechazado', !tt.ok && /6 variables/.test(tt.message));
  tt = T('p &'); ok('error de sintaxis con posición', !tt.ok && tt.pos >= 3, JSON.stringify(tt)); tt = T('(p & q'); ok('paréntesis', !tt.ok); tt = T('p q'); ok('sin operador', !tt.ok); tt = T(''); ok('vacío', !tt.ok);
  tt = T('!'.repeat(200) + 'p'); ok('negaciones profundas no revientan', typeof tt.ok === 'boolean'); tt = T('('.repeat(2000) + 'p' + ')'.repeat(2000)); ok('paréntesis profundos no revientan', typeof tt.ok === 'boolean');
}

section('Redes IPv4');
{
  const N = (ip, m = '') => core.net(ip, m);
  let r = N('192.168.1.10/24'); ok('192.168.1.10/24', r.ok && r.network === '192.168.1.0' && r.broadcast === '192.168.1.255' && r.first === '192.168.1.1' && r.last === '192.168.1.254' && r.hosts === '254' && r.mask === '255.255.255.0' && r.wildcard === '0.0.0.255' && r.cls === 'C' && r.type.startsWith('Privada'), JSON.stringify(r));
  r = N('192.168.1.10', '255.255.255.0'); ok('máscara punteada', r.ok && r.prefix === 24);
  r = N('192.168.1.10', '/26'); ok('máscara /26', r.ok && r.network === '192.168.1.0' && r.broadcast === '192.168.1.63' && r.hosts === '62');
  r = N('192.168.1.100', '26'); ok('máscara "26"', r.ok && r.network === '192.168.1.64');
  r = N('10.0.0.1/8'); ok('/8 clase A', r.ok && r.hosts === '16777214' && r.cls === 'A');
  r = N('172.16.5.4/12'); ok('/12 privada', r.network === '172.16.0.0' && r.broadcast === '172.31.255.255' && r.type.startsWith('Privada'));
  r = N('172.32.0.1/16'); ok('172.32 es pública', r.type === 'Pública');
  r = N('10.1.1.1/31'); ok('/31 punto a punto', r.hosts === '2' && r.first === '10.1.1.0' && r.last === '10.1.1.1');
  r = N('10.1.1.1/32'); ok('/32 host único', r.hosts === '1' && r.first === '10.1.1.1');
  r = N('0.0.0.0/0'); ok('/0', r.ok && r.hosts === '4294967294' && r.mask === '0.0.0.0' && r.broadcast === '255.255.255.255', JSON.stringify(r));
  r = N('255.255.255.255/32'); ok('255.255.255.255', r.ok && r.type === 'Broadcast limitado');
  r = N('127.0.0.1/8'); ok('loopback', r.type === 'Loopback'); r = N('169.254.1.1/16'); ok('APIPA', r.type.startsWith('APIPA')); r = N('224.0.0.1/4'); ok('multicast clase D', r.cls.startsWith('D') && r.type === 'Multicast');
  r = N('100.64.0.1/10'); ok('CGNAT', r.type.startsWith('CGNAT')); r = N('8.8.8.8/24'); ok('pública', r.type === 'Pública'); r = N('240.0.0.1/4'); ok('clase E', r.cls.startsWith('E'));
  r = N('203.0.113.5/24'); ok('documentación', r.type.includes('TEST-NET-3'));
  r = N('192.168.1.10/24'); ok('binarios', r.binIp === '11000000.10101000.00000001.00001010' && r.binMask === '11111111.11111111.11111111.00000000' && r.binNet === '11000000.10101000.00000001.00000000');
  ok('hex/int/rDNS', r.ipHex === '0xC0A8010A' && r.ipInt === '3232235786' && r.rdns === '10.1.168.192.in-addr.arpa');
  ok('IP con espacios', N('  192.168.1.10 / 24 ').ok === true);
  for (const [ip, m, why] of [['256.1.1.1', '/24', 'octeto 256'], ['1.2.3', '/24', '3 octetos'], ['1.2.3.4.5', '/24', '5 octetos'], ['a.b.c.d', '/24', 'letras'], ['', '/24', 'vacía'], ['192.168.1.1/33', '', 'CIDR 33'], ['192.168.1.1/', '', 'CIDR vacío'], ['192.168.1.1', '', 'sin máscara'], ['192.168.1.1', '255.0.255.0', 'no contigua'], ['192.168.1.1', '255.255.255.256', 'máscara 256'], ['192.168.1.1', 'abc', 'máscara texto'], ['01234.1.1.1', '/8', 'octeto 5 dígitos'], ['1..1.1', '/8', 'octeto vacío'], ['1.1.1.1/-1', '', 'cidr negativo'], ['1.1.1.1/24/8', '', 'doble cidr'], ['-1.1.1.1', '/8', 'negativo'], ['1.1.1.1 junk', '/8', 'basura']]) {
    const x = N(ip, m); ok(`inválido (${why}): "${ip}" "${m}"`, !x.ok && x.message, JSON.stringify(x));
  }
  let s = core.subnets('192.168.1.0/24', '', 26); ok('/24 -> 4 subredes /26', s.ok && s.total === 4 && s.rows.length === 4 && s.rows[1].net === '192.168.1.64/26' && s.rows[1].first === '192.168.1.65' && s.rows[1].last === '192.168.1.126' && s.rows[1].bc === '192.168.1.127', JSON.stringify(s.rows));
  s = core.subnets('10.0.0.0', '255.0.0.0', 16, 250, 10); ok('paginación: 256 subredes, desde 250', s.total === 256 && s.rows.length === 6 && s.rows[0].net === '10.250.0.0/16', JSON.stringify(s));
  s = core.subnets('10.0.0.0/8', '', 8); ok('mismo prefijo rechazado', !s.ok); s = core.subnets('10.0.0.0/8', '', 33); ok('prefijo 33 rechazado', !s.ok); s = core.subnets('10.0.0.0/8', '', 4); ok('prefijo menor rechazado', !s.ok);
  s = core.subnets('10.0.0.0/30', '', 31); ok('/30 -> /31', s.ok && s.total === 2 && s.rows[0].first === '10.0.0.0'); s = core.subnets('10.0.0.0/31', '', 32); ok('/31 -> /32', s.ok && s.total === 2);
  s = core.subnets('0.0.0.0/0', '', 32, 0, 1000); ok('/0 -> /32 recorta a 256 filas y no revienta', s.ok && s.rows.length === 256 && s.total === 4294967296);
  s = core.subnets('192.168.1.77/24', '', 25); ok('subredes parten de la red, no de la IP', s.rows[0].net === '192.168.1.0/25');
  ok('prefijo para 100 hosts = /25', core.prefixForHosts(100) === 25); ok('para 2 hosts = /30', core.prefixForHosts(2) === 30); ok('para 254 = /24', core.prefixForHosts(254) === 24); ok('para 255 = /23', core.prefixForHosts(255) === 23);
  ok('para 1 host = /30', core.prefixForHosts(1) === 30); ok('0 hosts inválido', core.prefixForHosts(0) === -1); ok('demasiados', core.prefixForHosts(5e9) === -1); ok('4294967294 = /0', core.prefixForHosts(4294967294) === 0);
}

section('Formato numérico');
{
  const f = (v, d) => fmt(v, d);
  ok('0.1+0.2 → 0.3 (15 cifras)', f(0.1 + 0.2, 15) === '0.3'); ok('17 cifras muestra el error binario', f(0.1 + 0.2, 17) === '0.30000000000000004');
  ok('enteros intactos', f(123456789012345) === '123456789012345'); ok('grandes con exponente', f(1.5e20, 15) === '1.5e20'); ok('pequeños', f(1.5e-10, 15) === '1.5e-10');
  ok('negativo cero', f(-0) === '0'); ok('∞', f(Infinity) === '∞' && f(-Infinity) === '-∞'); ok('NaN', f(NaN) === 'NaN'); ok('6 cifras', f(Math.PI, 6) === '3.14159'); ok('1/3', f(1 / 3, 10) === '0.3333333333');
  ok('1e21 entero', f(1e21) === '1e21'); ok('redondeo de 2.50000000000000', f(2.5) === '2.5'); ok('100.5', f(100.5) === '100.5');
}

console.log(`\n${fail ? '✗' : '✔'} ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
