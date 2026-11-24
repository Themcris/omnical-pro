/**
 * OmniCalc — utilidades de interfaz compartidas por todos los módulos.
 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Crea un elemento: el('div', {class:'x', text:'hola', onclick}, hijo1, 'texto') */
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

/* ---------- Almacenamiento seguro (puede fallar en modo privado) ---------- */
const PREFIX = 'omnicalc.v2.';
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } },
  clearAll() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('omnicalc.')).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
  },
};

/* ---------- Avisos (toast) ---------- */
let toastTimer = 0;
export function toast(msg, { error = false, action = '', onAction = null, ms = 3200 } = {}) {
  const t = $('#toast');
  t.replaceChildren(el('span', { text: msg }));
  if (action) t.append(el('button', { class: 'link-btn', type: 'button', text: action, onclick: () => { hideToast(); onAction?.(); } }));
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() { clearTimeout(toastTimer); $('#toast').hidden = true; }

/* ---------- Mensajes de estado bajo cada formulario ---------- */
export function setMsg(node, text = '', kind = 'error') {
  node.textContent = text;
  node.className = text ? `msg ${kind}` : 'msg';
}

/* ---------- Portapapeles (con alternativa para contextos sin permisos) ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado al portapapeles'); return true; }
  catch {
    const ta = el('textarea', { 'aria-hidden': 'true' });
    ta.style.cssText = 'position:fixed;opacity:0;left:-999px';   // CSSOM sí está permitido por la CSP
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* nada */ }
    ta.remove();
    toast(ok ? 'Copiado al portapapeles' : 'No se pudo copiar', { error: !ok });
    return ok;
  }
}

/* ---------- Números escritos por el usuario ---------- */
/**
 * Convierte "1, 2;3\n4,5" en [1,2,3,4,5]. Acepta coma decimal solo si no hay otros separadores
 * ("3,5" -> 3.5 únicamente cuando el texto completo es un solo número con coma).
 * Devuelve {values} o {error, token} con el primer elemento inválido.
 */
export function parseNumberList(text) {
  const t = String(text).trim();
  if (t === '') return { values: [] };
  const single = /^[-+]?\d+,\d+$/.test(t) ? t.replace(',', '.') : t;
  const tokens = single.split(/[\s;,]+/).filter(Boolean);
  const values = [];
  for (const raw of tokens) {
    const tok = raw.replace(/^\+/, '').replace('−', '-');
    if (!/^[-]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) return { error: `«${raw}» no es un número.`, token: raw };
    const v = Number(tok);
    if (!Number.isFinite(v)) return { error: `«${raw}» está fuera de rango.`, token: raw };
    values.push(v);
  }
  return { values };
}

/** Descarga un Blob como archivo. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Marca una caja de pasos con texto preformateado (el motor ya devuelve el texto). */
export function showSteps(node, text) {
  if (!text) { node.hidden = true; node.textContent = ''; return; }
  node.hidden = false; node.textContent = text;
}

/** Ejecuta fn como mucho una vez por fotograma. */
export function raf(fn) {
  let pending = false;
  return (...a) => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; fn(...a); }); };
}
