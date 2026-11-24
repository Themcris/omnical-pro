# OmniCalc Pro v2

Calculadora científica y de ingeniería 100 % offline (PWA). Motor en C → WebAssembly, interfaz en JS vanilla.

## Estructura
- `src/core.c` – motor (sin libc ni malloc: toda la memoria es estática; sin Emscripten).
- `web/js/core.js` – único puente JS↔WASM (buffers fijos, TextEncoder/Decoder, códigos de error → mensajes).
- `web/js/{app,graph,tools,ui}.js` – interfaz por módulos.
- `web/sw.js`, `web/manifest.json` – PWA. `tools/stamp-sw.mjs` sella el SW con un hash y la lista exacta de archivos.
- `tests/engine.test.mjs` – 456 pruebas del motor.

## Uso
```
sudo apt install clang lld     # una sola vez
./build.sh                     # compila web/omnicalc.wasm y sella el Service Worker
node tests/engine.test.mjs     # pruebas
python3 -m http.server -d web 8080
```
Alt+1…8 cambia de módulo. Cada vez que cambies algo en `web/`, ejecuta `./build.sh` (o `node tools/stamp-sw.mjs`) para que los usuarios reciban la actualización.

## Módulos didácticos (Conjuntos · Polinomios · Proporción)
- `web/js/frac.js` – fracciones exactas con BigInt (sin errores de coma flotante).
- `web/js/sets.js` + `venn.js` – álgebra de conjuntos con expresiones y diagrama de Venn en Canvas (1–3 conjuntos).
- `web/js/poly.js` – mini CAS multivariable (suma, resta, ×, ÷, potencias, productos notables, división larga) con procedimiento.
- `web/js/ratio.js` – regla de tres simple/compuesta y porcentajes.
- `web/js/learn.js` – interfaz de los tres módulos. `patch/` + `tools/install-learn-modules.mjs` los instalan en una copia antigua.
- Pruebas: `node tests/learn.test.mjs` (170) y `node tests/engine.test.mjs` (456). Alt+9 abre Conjuntos.
