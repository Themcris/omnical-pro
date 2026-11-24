#!/usr/bin/env bash
# Compila src/core.c -> web/omnicalc.wasm usando SOLO clang + lld (no hace falta Emscripten).
#   Linux:  sudo apt install clang lld        macOS:  brew install llvm lld
#   Windows: instalar LLVM (https://releases.llvm.org) y ejecutar desde Git Bash
set -euo pipefail
cd "$(dirname "$0")"
CC="${CC:-clang}"
OUT=web/omnicalc.wasm

echo "▶ Compilando $OUT con $($CC --version | head -1)"
"$CC" --target=wasm32 -O3 -flto -std=c11 -Wall -Wextra \
  -nostdlib -ffreestanding -fno-builtin-printf -fvisibility=hidden \
  -mbulk-memory -mnontrapping-fptoint \
  -fuse-ld=lld \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--gc-sections -Wl,--strip-all \
  -Wl,-z,stack-size=131072 -Wl,--initial-memory=1572864 -Wl,--max-memory=1572864 \
  -o "$OUT" src/core.c

# Optimización extra si binaryen está instalado (opcional)
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int "$OUT" -o "$OUT"
  echo "▶ wasm-opt aplicado"
fi

echo "▶ $(wc -c < "$OUT") bytes"
# Sella el Service Worker con un hash de los archivos de web/ (invalida la caché solo cuando algo cambia)
if command -v node >/dev/null 2>&1; then node tools/stamp-sw.mjs; fi
echo "✔ Listo. Sirve la carpeta web/ con:  python3 -m http.server -d web 8080"
