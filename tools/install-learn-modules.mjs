// Instala los módulos Conjuntos / Polinomios / Proporción en una copia existente de OmniCalc.
//   node tools/install-learn-modules.mjs        (es idempotente; guarda copias en backup-learn/ la primera vez)
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(root, ...a);
for (const f of ['frac', 'poly', 'sets', 'venn', 'ratio', 'learn']) if (!existsSync(P('web/js', f + '.js'))) throw new Error(`Falta web/js/${f}.js`);

function edit(file, fn) {
  const path = P(file), bak = P('backup-learn', file.split('/').pop()); mkdirSync(P('backup-learn'), { recursive: true }); if (!existsSync(bak)) copyFileSync(path, bak);
  const before = readFileSync(path, 'utf8'), after = fn(before);
  if (after !== before) { writeFileSync(path, after); console.log('✔ modificado', file); } else console.log('· sin cambios', file, '(ya instalado)');
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

edit('web/index.html', (s) => {
  if (!s.includes('id="t-sets"')) {
    const m = /^.*id="t-network".*\n/m.exec(s); must(m, 'No encuentro la pestaña Redes en index.html');
    s = s.replace(m[0], m[0] + readFileSync(P('patch/learn-tabs.html'), 'utf8'));
  }
  if (!s.includes('id="tab-sets"')) { must(s.includes('</main>'), 'No encuentro </main>'); s = s.replace('</main>', readFileSync(P('patch/learn-sections.html'), 'utf8') + '\n  </main>'); }
  return s;
});

edit('web/js/app.js', (s) => {
  if (!s.includes("from './learn.js'")) {
    const m = /^import .*from '\.\/tools\.js';\n/m.exec(s); must(m, "No encuentro el import de './tools.js'");
    s = s.replace(m[0], m[0] + "import { initSets, initPoly, initRatio } from './learn.js';\n");
  }
  if (!s.includes("'sets'")) { must(s.includes("'discrete', 'network']"), 'No encuentro la lista TABS'); s = s.replace("'discrete', 'network']", "'discrete', 'network', 'sets', 'poly', 'ratio']"); }
  if (!s.includes('initSets()')) { must(s.includes('initNetwork(core);'), 'No encuentro initNetwork(core);'); s = s.replace('initNetwork(core);', 'initNetwork(core);\n  mods.sets = initSets(); mods.poly = initPoly(); mods.ratio = initRatio();'); }
  return s.replace('/^[1-8]$/.test(e.key)', '/^[1-9]$/.test(e.key)');
});

edit('web/style.css', (s) => (s.includes('learn-modules') ? s : s.replace(/\s*$/, '\n') + readFileSync(P('patch/learn.css'), 'utf8')));

if (process.argv.includes('--no-stamp')) process.exit(0);
await import('./stamp-sw.mjs');
