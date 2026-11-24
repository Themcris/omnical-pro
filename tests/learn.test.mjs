// Pruebas de los módulos Conjuntos / Polinomios / Proporción (lógica pura, sin navegador).
//   node tests/learn.test.mjs
import { analyze } from '../web/js/poly.js';
import { solveSets, parseExpr, evalBool, EXAMPLES } from '../web/js/sets.js';
import { simpleRule, compoundRule, percentCalc } from '../web/js/ratio.js';
import { Frac, decimalString } from '../web/js/frac.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`  ✗ ${name}\n     obtuve:   ${got}\n     esperaba: ${want}`); } };
const ok = (name, c) => eq(name, !!c, true);
const section = (t) => console.log(`\n▸ ${t}`);

section('Fracciones exactas');
eq('0.1+0.2', Frac.parse('0.1').add(Frac.parse('0.2')).toString(), '3/10');
eq('decimal', decimalString(new Frac(2, 3), 4).text, '0.6667');
eq('coma decimal', Frac.parse('0,5').toString(), '1/2');
eq('espacios', Frac.parse('1 200').toString(), '1200');

section('Polinomios: ejemplos de la guía');
const P = [
  ['(5x+7)^2', '25x^2 + 70x + 49'], ['(3x-8y)^2', '9x^2 - 48xy + 64y^2'], ['(x^3-9)(x^3+9)', 'x^6 - 81'],
  ['(3+y^2)^3', 'y^6 + 9y^4 + 27y^2 + 27'], ['(a^2-2b)^3', 'a^6 - 6a^4b + 12a^2b^2 - 8b^3'], ['(x+7)(x+2)', 'x^2 + 9x + 14'],
  ['(x+3)^2', 'x^2 + 6x + 9'], ['(x-2)^2', 'x^2 - 4x + 4'], ['(x+4)(x-4)', 'x^2 - 16'], ['(x+2)^3', 'x^3 + 6x^2 + 12x + 8'], ['(x-2)^3', 'x^3 - 6x^2 + 12x - 8'],
  ['(2p^5+5q^3)^2', '4p^10 + 20p^5q^3 + 25q^6'], ['(2x^4+3y)^3', '8x^12 + 36x^8y + 54x^4y^2 + 27y^3'], ['(2a^4-3b^3)^3', '8a^12 - 36a^8b^3 + 54a^4b^6 - 27b^9'],
  ['(5x^2+2y^5)(5x^2-2y^5)', '25x^4 - 4y^10'], ['(x+8)(x-5)', 'x^2 + 3x - 40'],
  ['5x+2x', '7x'], ['9a-4a', '5a'], ['-3x^2-2x^2', '-5x^2'], ['10z^3-3z^3+z^3', '8z^3'], ['3x^2y+5x^2y-x^2y', '7x^2y'],
  ['(3xy^5)(-6x^4y)', '-18x^5y^6'], ['2x^3y(4x^2-3xy+5y^2)', '8x^5y - 6x^4y^2 + 10x^3y^3'], ['(3x^2)(4x^3)', '12x^5'], ['(-2a^3b)(5ab^2)', '-10a^4b^3'],
  ['3x(2x^2-4x+5)', '6x^3 - 12x^2 + 15x'], ['-2a^2(3a^3+a-6)', '-6a^5 - 2a^3 + 12a^2'], ['(2x-3)(x+4)', '2x^2 + 5x - 12'],
  ['12x^5y^3/(4x^2y)', '3x^3y^2'], ['12x^5y^3/4x^2y', '3x^3y^2'], ['(8x^4-6x^3+2x^2)/(2x^2)', '4x^2 - 3x + 1'], ['(10a^4-6a^3+2a^2)/(2a^2)', '5a^2 - 3a + 1'],
  ['15x^6y^4/(5x^2y^2)', '3x^4y^2'], ['24m^5n^3/(6m^2n)', '4m^3n^2'],
  ['(x^2+5x+6)/(x+2)', 'x + 3'], ['(x^2+7x+12)/(x+3)', 'x + 4'], ['(x^2-5x+6)/(x-2)', 'x - 3'], ['(x^2+2x-15)/(x-3)', 'x + 5'],
  ['(3x+2)+(5x-4)', '8x - 2'], ['(x+6)(x+3)', 'x^2 + 9x + 18'], ['(x^2+2x)(x+1)', 'x^3 + 3x^2 + 2x'], ['(x^2+3x)(x+2)', 'x^3 + 5x^2 + 6x'],
  ['(4n^2+3n)/n', '4n + 3'], ['(12n^3+8n^2)/(4n)', '3n^2 + 2n'], ['(2x+5)+(4x-3)+(x+7)', '7x + 9'],
  ['(1/2)x+(1/3)x', '(5/6)x'], ['0.5x+0.25x', '(3/4)x'], ['x-x', '0'], ['2x^3(3x)', '6x^4'],
];
for (const [e, want] of P) { const r = analyze(e); eq(e, r.ok ? r.ascii : 'ERR ' + r.message, want); if (r.ok && r.check) ok(`comprobación ${e}`, r.check.ok); }

section('Polinomios: residuo, errores y notación');
{
  const r = analyze('(x^2+5x+7)/(x+2)'); eq('cociente', r.ascii, 'x + 3'); eq('residuo', r.remainder?.display, '1');
  eq('x^-2', analyze('x^3*x^-2').ascii, 'x');
  eq('unicode', analyze('(x²+2x)×(x+1)').ascii, 'x^3 + 3x^2 + 2x');
  for (const bad of ['', '(x+', 'x+*2', '2/0', '(x^2+1)/(x+y)', 'x^1.5', '3$x', '(x+1)^2^2', '((x+1)^2)^3)']) ok(`error «${bad}»`, !analyze(bad).ok);
  ok('Paso notable', analyze('(5x+7)^2').steps[0].title.includes('Cuadrado de la suma'));
  ok('suma por diferencia', analyze('(x+4)(x-4)').steps[0].title.includes('Suma por diferencia'));
  ok('término común', analyze('(x+8)(x-5)').steps[0].title.includes('término común'));
  ok('cubo diferencia', analyze('(a^2-2b)^3').steps[0].title.includes('Cubo de la diferencia'));
}

section('Polinomios: pruebas aleatorias (motor vs evaluación independiente del AST)');
{
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const atom = () => ['x', 'y', String(1 + rnd(9)), `${1 + rnd(5)}x`, `${1 + rnd(5)}y`, `x^${1 + rnd(3)}`, `${1 + rnd(4)}xy`][rnd(7)];
  const sum = () => `(${atom()}${['+', '-'][rnd(2)]}${atom()}${rnd(2) ? ['+', '-'][rnd(2)] + atom() : ''})`;
  let n = 0, bad = 0;
  for (let i = 0; i < 400; i++) {
    const e = [`${sum()}${sum()}`, `${sum()}^${2 + rnd(2)}`, `${sum()}${['+', '-'][rnd(2)]}${sum()}`, `${atom()}${sum()}`, `${sum()}${sum()}${sum()}`][rnd(5)];
    const r = analyze(e); n++;
    if (!r.ok || (r.check && !r.check.ok)) { bad++; if (bad < 4) console.log('   falla:', e, r.ok ? r.check : r.message); }
  }
  ok(`${n} expresiones aleatorias coherentes`, bad === 0);
}

section('Conjuntos: ejemplos del tema y actividad (a)–(o)');
const S = (i) => solveSets(EXAMPLES[i].sets, EXAMPLES[i].expr).resultText;
eq('unión', S(0), '{3, 4, 5, 7, 8, 9, 10}'); eq('intersección', S(1), '{5, 8, 9}'); eq('complemento', S(2), '{1, 2, 5, 8, 9, 10}');
eq('diferencia', S(3), '{u, x, y}'); eq('simétrica', S(4), '{1, 2, 3, 4, 5, 7, 30, 40, 50}');
const want = ['{a, b, c}', '{a, b, c}', '{a}', '{d, e}', '{a, f, g}', '{d, e, f, g}', '{a, b, c, d, e, f, g}', '{b, c, d, e, g}', '{a, b, c, f, g}', '{a, b, c, f}', '∅', '{d, e}', '{a, b, c, g}', '{b, c, f}', '{a, b, c, g}'];
want.forEach((w, i) => eq(EXAMPLES[5 + i].label, S(5 + i), w));
eq('paréntesis como la guía', solveSets('A=(a,b,c)\nB={c,d}', 'A ∩ B').resultText, '{c}');
eq('rango', solveSets('A = {1..5}\nB = {4..8}', 'A ∩ B').resultText, '{4, 5}');
eq('ASCII', solveSets('A={1,2,3}\nB={3,4}', "A | B & A'").resultText, '{1, 2, 3, 4}');
eq('^c', solveSets('A={1,2}\nB={2,3}', '(A ∪ B)^c').resultText, '∅');
eq('vacío', solveSets('A={}\nB={1}', 'A ∪ B').resultText, '{1}');
for (const [s, e] of [['A={1}', 'A ∪ Z'], ['A={1}', 'A ∪'], ['A={1}\nU={2}', 'A′'], ['', 'A'], ['A={1}', '']]) ok(`error ${JSON.stringify(e)}`, !solveSets(s, e).ok);

section('Conjuntos: Venn por región ≡ operación por elementos (aleatorio)');
{
  let seed = 99; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ops = ['∪', '∩', '−', 'Δ'];
  const gen = (d) => (d === 0 || rnd(3) === 0 ? ['A', 'B', 'C'][rnd(3)] + (rnd(4) === 0 ? '′' : '') : `(${gen(d - 1)} ${ops[rnd(4)]} ${gen(d - 1)})`);
  let bad = 0;
  for (let t = 0; t < 300; t++) {
    const pick = () => [...Array(8).keys()].filter(() => rnd(2)).join(', ');
    const sets = `A = {${pick()}}\nB = {${pick()}}\nC = {${pick()}}\nU = {0..7}`;
    const e = gen(3), r = solveSets(sets, e); if (!r.ok) { bad++; continue; }
    const defs = Object.fromEntries(['A', 'B', 'C'].map((n) => [n, new Set(r.usedDefs[n] ?? solveSets(sets, n).usedDefs[n])]));
    const ast = parseExpr(e);
    for (const el of r.universe) {
      const viaRegion = evalBool(ast, (n) => (n === 'U' ? true : defs[n].has(el)));
      if (viaRegion !== r.result.includes(el)) bad++;
    }
  }
  ok('300 expresiones aleatorias coherentes', bad === 0);
}

section('Proporcionalidad: ejemplos de la guía');
const T = (r) => (r.ok ? r.text : 'ERR ' + r.message).replace(/\u00A0/g, ' ');
eq('simple directa (8→40, x→75)', T(simpleRule({ cells: ['8', '40', '', '75'], type: 'directa' })), '15');
eq('x en otra casilla', T(simpleRule({ cells: ['', '40', '15', '75'], type: 'directa' })), '8');
eq('leche 2→90, 5→x', T(simpleRule({ cells: ['2', '90', '5', ''], type: 'directa' })), '225');
eq('simple inversa (6→12, 9→x)', T(simpleRule({ cells: ['6', '12', '9', ''], type: 'inversa' })), '8');
eq('inversa 4→10, 2→x', T(simpleRule({ cells: ['4', '10', '2', ''], type: 'inversa' })), '20');
ok('sin incógnita', !simpleRule({ cells: ['1', '2', '3', '4'], type: 'directa' }).ok);
ok('cero', !simpleRule({ cells: ['0', '2', '3', ''], type: 'directa' }).ok);
eq('compuesta directa → 720', T(compoundRule({ unknown: { label: 'm²', v1: '240' }, rows: [{ v1: '4', v2: '6', rel: 'directa' }, { v1: '6', v2: '8', rel: 'directa' }, { v1: '10', v2: '15', rel: 'directa' }] })), '720');
eq('compuesta mixta → 20', T(compoundRule({ unknown: { label: 'días', v1: '15' }, rows: [{ v1: '6', v2: '9', rel: 'inversa' }, { v1: '8', v2: '6', rel: 'inversa' }, { v1: '360', v2: '540', rel: 'directa' }] })), '20');
eq('muro 4 trab → 120 m en 6 d (guía) …', T(compoundRule({ unknown: { label: 'm', v1: '120' }, rows: [{ v1: '4', v2: '6', rel: 'directa' }, { v1: '6', v2: '10', rel: 'directa' }] })), '300');
const pc = (m, a, b) => T(percentCalc(m, a, b));
eq('12 % de 2500', pc('parte', '12', '2500'), '300'); eq('560 de 800', pc('porcentaje', '560', '800'), '70 %');
eq('total 180 = 15 %', pc('total', '180', '15'), '1 200'); eq('+8 % de 85000', pc('aumento', '85000', '8'), '91 800');
eq('−7 % de 120000', pc('descuento', '120000', '7'), '111 600'); eq('variación 250→300', pc('variacion', '250', '300'), '20 %');
eq('variación negativa', pc('variacion', '300', '250'), '-16.666667 %'.replace('-', '−'));
ok('total con 0 %', !percentCalc('total', '10', '0').ok);
eq('decimales exactos', pc('parte', '0.1', '300'), '0.3');


section('Regla del paso a paso usa los nombres reales de los operandos');
{
  const r = solveSets('A = {a,b,c}\nC = {b,c,d}', 'A ∩ C'); const txt = JSON.stringify(r.steps);
  ok('menciona A ∩ C', txt.includes('A ∩ C: solo los elementos que están en A y en C a la vez'));
  ok('no menciona B', !txt.includes('B'));
  const r2 = solveSets('A = {1}\nB = {2}\nC = {3}', '(A − C) ∪ B'); ok('compuesta', JSON.stringify(r2.steps).includes('(A − C) ∪ B: elementos que están en (A − C), en B o en ambos'));
  ok('complemento', JSON.stringify(solveSets('A = {1}\nU = {1,2}', "A'").steps).includes('A′ = U − A'));
  console.log(`\n${fail ? '✗' : '✔'} ${pass} pruebas correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
}
