// Sella web/sw.js: calcula un hash de todos los archivos de web/ y escribe la lista exacta a precargar.
//   node tools/stamp-sw.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const skip = new Set(['sw.js']);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d).sort()) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (!skip.has(relative(web, p)) && !n.startsWith('.')) files.push(relative(web, p).split('\\').join('/'));
  }
})(web);

const h = createHash('sha256');
for (const f of files) { h.update(f); h.update(readFileSync(join(web, f))); }
const version = h.digest('hex').slice(0, 10);
const assets = ['./', ...files.map((f) => './' + f)];

let sw = readFileSync(join(web, 'sw.js'), 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
       .replace(/const ASSETS = \[[^\]]*\];[^\n]*/, `const ASSETS = ${JSON.stringify(assets)};`);
writeFileSync(join(web, 'sw.js'), sw);
console.log(`▶ Service Worker sellado: v${version}, ${assets.length} archivos precargados`);
