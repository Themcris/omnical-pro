/**
 * OmniCalc — Diagramas de Venn en Canvas 2D (1, 2 o 3 conjuntos).
 * Cada una de las 2^n regiones se pinta recortando (clip) con los círculos:
 *   - dentro de un círculo  -> clip(círculo)
 *   - fuera de un círculo   -> clip(rectángulo + círculo, 'evenodd')
 * Así se sombrean regiones exactas sin manipular píxeles. Colores tomados del tema (CSS vars).
 */
const TAU = Math.PI * 2;

function layout(n, W, H) {
  const cx = W / 2;
  if (n === 0) return { circles: [] };
  if (n === 1) { const r = Math.min(W * 0.3, H * 0.34); return { circles: [{ x: cx, y: H / 2 + 6, r }], labels: [{ x: cx, y: H / 2 + 6 - r - 8 }] }; }
  if (n === 2) {
    const r = Math.min(H * 0.34, W * 0.27), cy = H / 2 + 8, dx = r * 0.62;
    return { circles: [{ x: cx - dx, y: cy, r }, { x: cx + dx, y: cy, r }], labels: [{ x: cx - dx - r * 0.55, y: cy - r - 7 }, { x: cx + dx + r * 0.55, y: cy - r - 7 }] };
  }
  const r = Math.min(H * 0.255, W * 0.25), d = r * 1.12, cy = H / 2 - r * 0.12;
  const A = { x: cx - d / 2, y: cy - d * 0.28, r }, B = { x: cx + d / 2, y: cy - d * 0.28, r }, C = { x: cx, y: cy + d * 0.58, r };
  return { circles: [A, B, C], labels: [{ x: A.x - r * 0.75, y: A.y - r * 0.8 }, { x: B.x + r * 0.75, y: B.y - r * 0.8 }, { x: C.x, y: C.y + r + 11 }] };
}

const inMask = (circles, mask, px, py) => circles.every((c, i) => (((px - c.x) ** 2 + (py - c.y) ** 2) <= c.r * c.r) === !!((mask >> i) & 1));

/** Centro y holgura (cuerda horizontal/vertical) de una región, muestreando la cuadrícula. */
function regionBox(circles, mask, rect, avoid = [], biasDown = false) {
  let sx = 0, sy = 0, n = 0;
  const step = 3;
  if (mask === 0 && circles.length) {
    // Región EXTERIOR (solo universo): el centroide caería entre los círculos. Se busca el punto más
    // despejado (máxima distancia a círculos y bordes), evitando rótulos y favoreciendo la parte baja.
    let best = -Infinity, bx = 0, by = 0, count = 0;
    for (let y = rect.y + 4; y < rect.y + rect.h - 4; y += step) for (let x = rect.x + 4; x < rect.x + rect.w - 4; x += step) {
      if (!inMask(circles, 0, x, y)) continue;
      count++;
      let clr = Math.min(x - rect.x, rect.x + rect.w - x, y - rect.y, rect.y + rect.h - y);
      for (const c of circles) clr = Math.min(clr, Math.hypot(x - c.x, y - c.y) - c.r);
      for (const a of avoid) if (Math.hypot(x - a.x, y - a.y) < 28) clr -= 40;
      const score = clr + (biasDown ? (y - rect.y) / rect.h * 8 : 0);
      if (score > best) { best = score; bx = x; by = y; }
    }
    if (count < 12) return null;
    const run0 = (dx, dy) => { let k = 0; while (k < 400 && inMask(circles, 0, bx + dx * k, by + dy * k) && bx + dx * k > rect.x && bx + dx * k < rect.x + rect.w && by + dy * k > rect.y && by + dy * k < rect.y + rect.h) k++; return k; };
    return { x: bx, y: by, w: run0(1, 0) + run0(-1, 0), h: run0(0, 1) + run0(0, -1), area: count * step * step };
  }
  for (let y = rect.y; y < rect.y + rect.h; y += step) for (let x = rect.x; x < rect.x + rect.w; x += step) {
    if (inMask(circles, mask, x, y)) { sx += x; sy += y; n++; }
  }
  if (n < 12) return null;
  const px = sx / n, py = sy / n;
  // Si el centroide cae fuera de la región (formas curvas), busca el punto interior más cercano
  let cx = px, cy = py;
  if (!inMask(circles, mask, cx, cy)) {
    let best = Infinity;
    for (let y = rect.y; y < rect.y + rect.h; y += step) for (let x = rect.x; x < rect.x + rect.w; x += step) {
      if (inMask(circles, mask, x, y)) { const d = (x - px) ** 2 + (y - py) ** 2; if (d < best) { best = d; cx = x; cy = y; } }
    }
  }
  const run = (dx, dy) => { let k = 0; while (k < 400 && inMask(circles, mask, cx + dx * k, cy + dy * k)) k++; return k; };
  const w = run(1, 0) + run(-1, 0), h = run(0, 1) + run(0, -1);
  return { x: cx, y: cy, w, h, area: n * step * step };
}

function wrap(g, items, maxW) {
  const lines = []; let cur = '';
  for (const it of items) {
    const t = cur ? cur + ', ' + it : it;
    if (cur && g.measureText(t).width > maxW) { lines.push(cur + ','); cur = it; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * spec = { names:['A','B'], sets:{A:Set,B:Set}, universe:[...], holds:(mask)=>boolean }
 * Devuelve true si dibujó (1–3 conjuntos), false si no se puede (más de 3).
 */
export function drawVenn(canvas, spec) {
  const names = spec.names;
  if (names.length > 3) return false;
  const css = getComputedStyle(document.documentElement);
  const v = (k, d) => css.getPropertyValue(k).trim() || d;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r0 = canvas.getBoundingClientRect();
  const W = Math.max(120, Math.round(r0.width)), H = Math.max(100, Math.round(r0.height));
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const bg = v('--lcd', '#070b0f'), text = v('--text', '#e8eef4'), dim = v('--text-dim', '#8fa1b3');
  const stroke = v('--border-strong', '#35485b'), accent = v('--accent', '#19e6bd');
  const font = v('--font', 'system-ui, sans-serif'), mono = v('--mono', 'monospace');

  const pad = 8, rect = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
  const n = names.length, { circles, labels } = layout(n, W, H);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // 1) regiones del resultado
  const nm = 1 << n;
  for (let mask = 0; mask < nm; mask++) {
    if (!spec.holds(mask)) continue;
    g.save();
    g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip();
    circles.forEach((c, i) => {
      g.beginPath();
      if ((mask >> i) & 1) { g.arc(c.x, c.y, c.r, 0, TAU); g.clip(); }
      else { g.rect(rect.x, rect.y, rect.w, rect.h); g.moveTo(c.x + c.r, c.y); g.arc(c.x, c.y, c.r, 0, TAU); g.clip('evenodd'); }
    });
    g.globalAlpha = 0.42; g.fillStyle = accent; g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.restore();
  }

  // 2) contornos
  g.lineWidth = 2; g.strokeStyle = stroke; g.strokeRect(rect.x, rect.y, rect.w, rect.h);
  circles.forEach((c) => { g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.stroke(); });

  // 3) rótulos
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 14px ${font}`; g.fillStyle = text;
  names.forEach((name, i) => g.fillText(name, Math.min(W - pad - 10, Math.max(pad + 10, labels[i].x)), Math.min(H - pad - 8, Math.max(pad + 9, labels[i].y))));
  g.textAlign = 'right'; g.fillStyle = dim; g.font = `700 12px ${font}`; g.fillText('U', W - pad - 6, pad + 10);

  // 4) elementos por región
  const buckets = Array.from({ length: nm }, () => []);
  for (const e of spec.universe) {
    let mask = 0; names.forEach((nme, i) => { if (spec.sets[nme].has(e)) mask |= 1 << i; });
    buckets[mask].push(e);
  }
  g.textAlign = 'center'; g.fillStyle = text;
  for (let mask = 0; mask < nm; mask++) {
    const items = buckets[mask]; if (!items.length) continue;
    const box = regionBox(circles, mask, rect, [...labels, { x: W - pad - 6, y: pad + 10 }], n < 3); if (!box) continue;
    const maxW = Math.max(18, box.w * 0.86), maxH = box.h * 0.86;
    let drawn = false;
    for (let fp = 13; fp >= 9 && !drawn; fp--) {
      g.font = `600 ${fp}px ${mono}`;
      const lines = wrap(g, items, maxW), lh = fp + 3;
      if (lines.length * lh <= maxH && lines.every((l) => g.measureText(l).width <= maxW + 1)) {
        const y0 = box.y - ((lines.length - 1) * lh) / 2;
        lines.forEach((l, k) => g.fillText(l.replace(/,$/, k < lines.length - 1 ? ',' : ''), box.x, y0 + k * lh));
        drawn = true;
      }
    }
    if (!drawn) { g.font = `600 11px ${font}`; g.fillStyle = dim; g.fillText(`${items.length} elem.`, box.x, box.y); g.fillStyle = text; }
  }
  return true;
}
