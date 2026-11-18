// Scene per il LED wall, disegnate su canvas. Stesso codice per la pagina LED (animata),
// per le anteprime in regia (fotogramma finale) e per l'export PNG.
// Si adatta a qualsiasi proporzione: la risoluzione del LED è ancora da confermare.
import { C, paper, brush, scribble, plus, loadImage, fontsReady, rng } from './deco.js';

const F = 'Archivo, system-ui, sans-serif';
const imgs = new Map(); // src -> Image (solo quando caricata)
export function preload(srcs) {
  return Promise.all(srcs.filter(Boolean).map(async (src) => {
    if (imgs.has(src)) return;
    const im = await loadImage(src);
    if (im) imgs.set(src, im);
  }));
}
const img = (src) => imgs.get(src);

const bgCache = new Map();
function background(W, H) {
  const k = `${W}x${H}`;
  if (!bgCache.has(k)) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    paper(c.getContext('2d'), W, H, 21);
    bgCache.set(k, c);
  }
  return bgCache.get(k);
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const L = 'ABCD';

/**
 * Disegna una scena.
 *  el: millisecondi dall'inizio della scena (Infinity = fotogramma finale, per anteprime e PNG)
 *  env: { config, qr, now (ora del server), closedSeenAt }
 */
export function drawScene(cv, scene, env, { width = 1920, height = 1080, el = Infinity, transparent = false } = {}) {
  if (cv.width !== width) cv.width = width;
  if (cv.height !== height) cv.height = height;
  const ctx = cv.getContext('2d');
  const W = width, H = height, u = Math.min(W / 1920, H / 1080) * (W / H < 1.3 ? 1.25 : 1);
  ctx.clearRect(0, 0, W, H);
  if (!transparent) ctx.drawImage(background(W, H), 0, 0);
  const g = { ctx, W, H, u, el, env, t: el === Infinity ? 0 : el };
  if (!transparent) decorations(g);
  const type = scene?.type || 'promo';
  if (type === 'promo') promo(g);
  else if (type === 'classifica') classifica(g, scene);
  else if (type === 'generazioni') generazioni(g, scene);
  else if (type === 'sos') sos(g, scene);
  else if (type === 'quiz') quiz(g, scene);
  else if (type === 'fine') fine(g);
  else if (type === 'premio') premio(g, scene);
  else if (type === 'verdetto') verdetto(g, scene);
  else if (type === 'chiuse') chiuse(g);
  return cv;
}

function decorations({ ctx, W, H, u, t }) {
  const wob = Math.sin(t / 700) * 6 * u;
  scribble(ctx, W * 0.02, H * 0.84 + wob, W * 0.16, H * 0.1, C.lime, 13 * u, 3);
  scribble(ctx, W * 0.82, H * 0.04 - wob, W * 0.16, H * 0.08, C.lime, 11 * u, 8);
  ctx.save();
  ctx.translate(W * 0.94, H * 0.9); ctx.rotate(t / 1500);
  plus(ctx, 0, 0, 22 * u, C.fucsia, 6 * u);
  ctx.restore();
  ctx.save();
  ctx.translate(W * 0.05, H * 0.1); ctx.rotate(-t / 1800);
  plus(ctx, 0, 0, 18 * u, C.fucsia, 6 * u);
  ctx.restore();
}

function title(g, text, y, { size = 86, color = C.viola, maxW } = {}) {
  const { ctx, W, u, t } = g;
  ctx.font = `900 ${size * u}px ${F}`;
  const tw = Math.min(ctx.measureText(text).width, maxW || W * 0.8);
  const bw = tw + 160 * u, bh = size * 1.75 * u;
  brush(ctx, W / 2 - bw / 2, y, bw, bh, color, text.length);
  ctx.save();
  ctx.translate(W / 2, y + bh * 0.62);
  ctx.rotate(Math.sin(t / 900) * 0.008);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 0, maxW || W * 0.8);
  ctx.restore();
  return y + bh;
}

function tag(g, text, x, y, { bg = C.lime, size = 30, align = 'center' } = {}) {
  const { ctx, u } = g;
  ctx.font = `800 ${size * u}px ${F}`;
  const w = ctx.measureText(text).width + 40 * u;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg; ctx.fillRect(x0, y, w, size * 1.55 * u);
  ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 3 * u; ctx.strokeRect(x0, y, w, size * 1.55 * u);
  ctx.fillStyle = C.inchiostro; ctx.textAlign = 'left';
  ctx.fillText(text, x0 + 20 * u, y + size * 1.1 * u);
  return w;
}

function logo(g, x, y, h) {
  const im = img('/img/logo.webp');
  if (im) g.ctx.drawImage(im, x, y, h * im.width / im.height, h);
}

// ---------- PROMO / QR: "Sei tu a decidere chi vincerà" ----------
function promo(g) {
  const { ctx, W, H, u, t, env } = g;
  const cfg = env.config;
  const wide = W / H > 1.3;
  logo(g, 60 * u, 50 * u, 220 * u);
  const p = cfg?.show?.promo || { titolo: 'Sei tu a decidere chi vincerà', testo: 'Inquadra il QR e vota per tutta la puntata' };
  const words = p.titolo.toUpperCase().split(' ');
  // dividi il titolo in due righe il più possibile equilibrate
  let best = 1, diff = Infinity;
  for (let k = 1; k < words.length; k++) {
    const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
    if (d < diff) { diff = d; best = k; }
  }
  const lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  const qrSize = (wide ? 500 : 600) * u;
  const qx = wide ? W - qrSize - 150 * u : W / 2 - qrSize / 2;
  const qy = wide ? H / 2 - qrSize / 2 + 30 * u : H * 0.52;
  const textCx = wide ? (qx - 60 * u) / 2 + 30 * u : W / 2;
  const textTop = wide ? H * 0.28 : H * 0.18;
  const maxW = wide ? qx - 320 * u : W * 0.8;
  // emoji che salgono (richiamo alle reazioni), dietro ai testi
  const em = ['😂', '❤️', '😬', '😡'];
  ctx.font = `${64 * u}px ${F}`;
  for (let i = 0; i < 7; i++) {
    const r = rng(i + 3);
    const sp = 9000 + r() * 5000;
    const ph = ((t + r() * sp) % sp) / sp;
    const x = (wide ? textCx - 420 * u : W * 0.1) + r() * (wide ? 840 * u : W * 0.8);
    const y = H + 60 * u - ph * (H * 0.55);
    ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.85;
    ctx.fillText(em[i % 4], x, y);
  }
  ctx.globalAlpha = 1;
  ctx.font = `900 ${100 * u}px ${F}`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const fs = Math.min(100, (100 * maxW) / widest);
  lines.forEach((line, i) => {
    ctx.font = `900 ${fs * u}px ${F}`;
    const tw = ctx.measureText(line).width;
    const bob = Math.sin(t / 420 + i * 1.4) * 8 * u;
    const y = textTop + i * (fs * 1.6) * u + bob;
    brush(ctx, textCx - tw / 2 - 60 * u, y, tw + 120 * u, fs * 1.55 * u, i ? C.fucsia : C.viola, 11 + i);
    ctx.fillStyle = i ? C.inchiostro : '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(line, textCx, y + fs * 1.08 * u);
  });
  // sottotitolo
  ctx.font = `800 ${40 * u}px ${F}`;
  const sub = p.testo;
  const sw = ctx.measureText(sub).width + 50 * u;
  const sy = textTop + fs * 3.4 * u;
  ctx.fillStyle = '#fff'; ctx.fillRect(textCx - sw / 2, sy, sw, 72 * u);
  ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 4 * u; ctx.strokeRect(textCx - sw / 2, sy, sw, 72 * u);
  ctx.fillStyle = C.inchiostro; ctx.fillText(sub, textCx, sy + 50 * u);
  // QR che pulsa
  const pulse = 1 + Math.sin(t / 380) * 0.025;
  ctx.save();
  ctx.translate(qx + qrSize / 2, qy + qrSize / 2);
  ctx.scale(pulse, pulse);
  ctx.rotate(-0.02);
  const pad = 34 * u;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(-qrSize / 2 - pad + 14 * u, -qrSize / 2 - pad + 14 * u, qrSize + pad * 2, qrSize + pad * 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(-qrSize / 2 - pad, -qrSize / 2 - pad, qrSize + pad * 2, qrSize + pad * 2);
  ctx.lineWidth = 6 * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(-qrSize / 2 - pad, -qrSize / 2 - pad, qrSize + pad * 2, qrSize + pad * 2);
  const q = env.qr && img(env.qr.dataUrl);
  if (q) ctx.drawImage(q, -qrSize / 2, -qrSize / 2, qrSize, qrSize);
  else { ctx.fillStyle = C.carta; ctx.fillRect(-qrSize / 2, -qrSize / 2, qrSize, qrSize); }
  ctx.restore();
  ctx.textAlign = 'left';
  tag(g, 'INQUADRA QUI ↑', qx + qrSize / 2, qy + qrSize + 70 * u, { bg: C.lime, size: 34 });
  if (env.qr?.url) {
    ctx.font = `700 ${24 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText(env.qr.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), qx + qrSize / 2, qy + qrSize + 160 * u);
  }
  // titolo dello show in basso
  if (cfg?.show) {
    ctx.font = `800 ${30 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = wide ? 'left' : 'center';
    ctx.fillText(cfg.show.testoLed || cfg.show.titolo, wide ? 60 * u : W / 2, H - 50 * u, W - 120 * u);
  }
  ctx.textAlign = 'left';
}

// ---------- CLASSIFICA (fotografata al momento della preparazione) ----------
/** Quando entra ogni squadra in classifica (ms): la pagina LED ci aggancia il suono della squadra. */
export const CLASSIFICA_STEPS = (i) => 350 + i * 450;

function classifica(g, scene) {
  const { ctx, W, H, u, env } = g;
  const y0 = title(g, 'CLASSIFICA', 40 * u, { size: 86 });
  const when = scene.standings?.t ? new Date(scene.standings.t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  tag(g, `PROVVISORIA${when ? ' · ORE ' + when : ''}`, W / 2, y0 + 4 * u, { bg: C.giallo, size: 28 });
  logo(g, 40 * u, 30 * u, 150 * u);
  const teams = scene.standings?.coppie || [];
  const conts = Object.fromEntries((env.config?.concorrenti || []).map((c) => [c.id, c]));
  const top = y0 + 80 * u, bottom = H - 50 * u;
  const wide = W / H > 1.3;
  teams.forEach((t, i) => {
    let x, y, w, h;
    if (wide) { const gap = 40 * u, cw = (W - gap * (teams.length + 1)) / teams.length; x = gap + i * (cw + gap); y = top; w = cw; h = bottom - top; }
    else { const gap = 30 * u, ch = (bottom - top - gap * (teams.length - 1)) / teams.length; x = 50 * u; y = top + i * (ch + gap); w = W - 100 * u; h = ch; }
    const k = ease((g.t - CLASSIFICA_STEPS(i)) / 600);
    ctx.save();
    ctx.globalAlpha = g.el === Infinity ? 1 : k;
    ctx.translate(0, g.el === Infinity ? 0 : (1 - k) * 60 * u);
    teamCard(g, t, conts, x, y, w, h, wide, i, true);
    ctx.restore();
  });
}

function teamCard(g, t, conts, x, y, w, h, wide, i, details) {
  const { ctx, u } = g;
  const rot = [-0.012, 0.008, -0.006][i % 3];
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(10 * u, 10 * u, w, h);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 5 * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = t.colore || C.lime;
  const band = wide ? 90 * u : h;
  if (wide) ctx.fillRect(0, 0, w, band); else ctx.fillRect(0, 0, 140 * u, h);
  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 ${(wide ? 70 : 90) * u}px ${F}`;
  const pos = `${t.posizione}°${t.exAequo ? '=' : ''}`;
  if (wide) ctx.fillText(pos, 24 * u, 70 * u);
  else { ctx.textAlign = 'center'; ctx.fillText(pos, 70 * u, h / 2 + 32 * u); ctx.textAlign = 'left'; }
  ctx.font = `900 ${(wide ? 40 : 44) * u}px ${F}`;
  const nameX = wide ? 150 * u : 170 * u;
  ctx.fillText(t.nome.toUpperCase(), nameX, wide ? 60 * u : 62 * u, w - nameX - 20 * u);
  const ph = wide ? Math.min(w * 0.36, h * 0.30) : Math.min(h * 0.62, 200 * u);
  const py = wide ? band + 24 * u : h - ph - 22 * u;
  let px = wide ? 24 * u : 170 * u;
  for (const cid of t.membri) {
    const c = conts[cid];
    const im = c && img(c.foto);
    ctx.fillStyle = t.colore || C.carta; ctx.fillRect(px, py, ph, ph); // foto scontornate: dietro il colore della squadra
    if (im) ctx.drawImage(im, px, py, ph, ph);
    ctx.lineWidth = 4 * u; ctx.strokeRect(px, py, ph, ph);
    ctx.fillStyle = C.inchiostro; ctx.fillRect(px, py + ph - 38 * u, ph, 38 * u);
    ctx.fillStyle = '#fff'; ctx.font = `900 ${22 * u}px ${F}`; ctx.textAlign = 'center';
    ctx.fillText((c?.nome || '').toUpperCase(), px + ph / 2, py + ph - 11 * u, ph - 8 * u);
    ctx.textAlign = 'left';
    px += ph + 16 * u;
  }
  if (details) {
    const rows = [['QUIZ', t.quiz], ['PUBBLICO', t.pubblico]];
    if (t.sugarfree) rows.push(['SUGARFREE', t.sugarfree]);
    if (t.correzioni) rows.push(['CORREZIONI', t.correzioni]);
    ctx.font = `800 ${26 * u}px ${F}`;
    let ry = wide ? py + ph + 50 * u : 110 * u;
    const rx = wide ? 24 * u : px + 20 * u;
    const rw = wide ? w - 48 * u : 300 * u;
    for (const [k, v] of rows) {
      ctx.fillStyle = C.inchiostro; ctx.fillText(k, rx, ry);
      ctx.textAlign = 'right'; ctx.fillText(fmt(v), rx + rw, ry); ctx.textAlign = 'left';
      ry += 40 * u;
    }
  }
  const totS = fmt(t.totale);
  ctx.font = `900 ${(wide ? 120 : 130) * u}px ${F}`;
  const tw = ctx.measureText(totS).width;
  const tx = wide ? w / 2 - tw / 2 : w - tw - 50 * u;
  const ty = wide ? h - 50 * u : h / 2 + 46 * u;
  ctx.fillStyle = C.viola; ctx.fillRect(tx - 24 * u, ty - 112 * u, tw + 48 * u, 136 * u);
  ctx.fillStyle = C.lime; ctx.fillText(totS, tx, ty);
  ctx.restore();
}

// ---------- GENERAZIONI IN SALA ----------
/** Quando parte ogni barra delle generazioni (ms): la pagina LED ci aggancia il «pop». */
export const GENERAZIONI_STEPS = (i) => 300 + i * 220;

function generazioni(g, scene) {
  const { ctx, W, H, u, env } = g;
  const y0 = title(g, 'CHI C\'È IN SALA STASERA?', 40 * u, { size: 80 });
  logo(g, 40 * u, 30 * u, 150 * u);
  const st = scene.stats || { total: 0, counts: {} };
  const gens = (env.config?.generazioni || []).filter((x) => st.counts[x.id] > 0);
  if (!st.total) {
    ctx.font = `900 ${60 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText('Ancora nessun dato', W / 2, H / 2 + 60 * u); ctx.textAlign = 'left';
    return;
  }
  const top = y0 + 60 * u, bottom = H - 60 * u;
  const rowH = Math.min(120 * u, (bottom - top) / gens.length);
  const labelW = 470 * u, x0 = 90 * u, barMax = W - x0 - labelW - 260 * u;
  const max = Math.max(...gens.map((x) => st.counts[x.id]));
  gens.forEach((gn, i) => {
    const y = top + i * rowH;
    const pct = st.counts[gn.id] / st.total;
    const k = ease((g.t - GENERAZIONI_STEPS(i)) / 1200);
    const prog = g.el === Infinity ? 1 : k;
    ctx.font = `900 ${Math.min(44, rowH / u * 0.42) * u}px ${F}`;
    ctx.fillStyle = C.inchiostro; ctx.textAlign = 'right';
    ctx.fillText(gn.nome.toUpperCase(), x0 + labelW - 20 * u, y + rowH * 0.62, labelW - 20 * u);
    ctx.textAlign = 'left';
    const bw = Math.max(8 * u, barMax * (st.counts[gn.id] / max) * prog);
    const bh = rowH * 0.7;
    ctx.fillStyle = C.inchiostro; ctx.fillRect(x0 + labelW + 8 * u, y + (rowH - bh) / 2 + 8 * u, bw, bh);
    ctx.fillStyle = gn.colore || C.lime; ctx.fillRect(x0 + labelW, y + (rowH - bh) / 2, bw, bh);
    ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 4 * u; ctx.strokeRect(x0 + labelW, y + (rowH - bh) / 2, bw, bh);
    ctx.font = `900 ${Math.min(56, rowH / u * 0.5) * u}px ${F}`;
    ctx.fillStyle = C.inchiostro;
    ctx.fillText(`${Math.round(pct * 100 * prog)}%`, x0 + labelW + bw + 24 * u, y + rowH * 0.66);
  });
}

// ---------- SOS: domanda + countdown, poi percentuali, poi risposta corretta ----------
/** Percentuali dell'SOS: partono dopo il buzzer e si riempiono mentre suona «barre»; alla fine compare l'eventuale PARITÀ. */
export const SOS_BARRE = { da: 500, durata: 3400 };
function sos(g, scene) {
  const { ctx, W, H, u, env } = g;
  const s = scene.sos;
  if (!s) return promo(g);
  const y0 = title(g, 'SOS DEL PUBBLICO', 34 * u, { size: 78, color: C.viola });
  logo(g, 40 * u, 26 * u, 140 * u);
  if (s.coppia) tag(g, `AIUTA LA ${s.coppia.toUpperCase()}`, W / 2, y0, { bg: s.colore || C.lime, size: 30 });
  const wide = W / H > 1.3;
  const now = env.now ? env.now() : Date.now();
  const left = Math.max(0, s.endsAt - now);
  const closed = s.closed || left <= 0;
  const ringR = 110 * u;
  const qx = 70 * u, qy = y0 + 80 * u;
  const qw = wide ? W - 140 * u - (closed ? 0 : ringR * 2 + 60 * u) : W - 140 * u;
  // domanda
  ctx.font = `900 ${54 * u}px ${F}`;
  const lines = wrapLines(ctx, s.domanda, qw - 60 * u);
  const qh = Math.max(130 * u, lines.length * 64 * u + 50 * u);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(qx + 10 * u, qy + 10 * u, qw, qh);
  ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qw, qh);
  ctx.lineWidth = 5 * u; ctx.strokeRect(qx, qy, qw, qh);
  ctx.fillStyle = C.inchiostro;
  lines.forEach((l, i) => ctx.fillText(l, qx + 30 * u, qy + 75 * u + i * 64 * u));
  // countdown
  if (!closed) {
    const cx = wide ? W - 70 * u - ringR : W / 2, cy = wide ? qy + qh / 2 : H - 160 * u;
    const total = Math.max(1000, s.endsAt - s.startedAt);
    ctx.lineWidth = 26 * u; ctx.strokeStyle = 'rgba(23,18,31,.15)';
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = left < 6000 ? '#ff4d5e' : C.viola; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / total)); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, ringR - 16 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = left < 6000 ? '#ff4d5e' : C.inchiostro; ctx.font = `900 ${100 * u}px ${F}`; ctx.textAlign = 'center';
    ctx.fillText(String(Math.ceil(left / 1000)), cx, cy + 36 * u);
    ctx.textAlign = 'left';
  }
  // opzioni (2x2)
  const oy = qy + qh + 50 * u;
  const footer = closed ? 40 * u : 110 * u;
  const cols = 2, gap = 30 * u;
  const ow = (W - 140 * u - gap) / cols;
  const oh = Math.min(150 * u, (H - oy - footer - gap) / 2);
  const total = s.counts ? s.counts.reduce((a, b) => a + b, 0) : 0;
  if (closed && g.el !== Infinity && !env.closedSeenAt) env.closedSeenAt = performance.now();
  const kClosed = g.el === Infinity || !env.closedSeenAt ? 1 : ease((performance.now() - env.closedSeenAt - SOS_BARRE.da) / SOS_BARRE.durata);
  s.opzioni.forEach((o, i) => {
    const x = 70 * u + (i % cols) * (ow + gap), y = oy + Math.floor(i / cols) * (oh + gap);
    const isTop = closed && s.top?.includes(i);
    const isCorrect = s.corretta === i;
    ctx.fillStyle = C.inchiostro; ctx.fillRect(x + 8 * u, y + 8 * u, ow, oh);
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, ow, oh);
    if (closed && s.counts) {
      const pct = total ? s.counts[i] / total : 0;
      ctx.fillStyle = isCorrect ? C.turchese : isTop ? C.fucsia : C.lime;
      ctx.fillRect(x, y, ow * pct * kClosed, oh);
    }
    ctx.lineWidth = (isCorrect ? 10 : isTop ? 8 : 5) * u;
    ctx.strokeStyle = C.inchiostro; ctx.strokeRect(x, y, ow, oh);
    ctx.fillStyle = C.inchiostro; ctx.fillRect(x + 20 * u, y + oh / 2 - 40 * u, 80 * u, 80 * u);
    ctx.fillStyle = '#fff'; ctx.font = `900 ${54 * u}px ${F}`; ctx.textAlign = 'center';
    ctx.fillText(L[i], x + 60 * u, y + oh / 2 + 20 * u);
    ctx.textAlign = 'left'; ctx.fillStyle = C.inchiostro; ctx.font = `800 ${44 * u}px ${F}`;
    ctx.fillText(o, x + 125 * u, y + oh / 2 + 16 * u, ow - (closed ? 330 : 150) * u);
    if (closed && s.counts) {
      const pct = total ? Math.round((s.counts[i] / total) * 100 * kClosed) : 0;
      ctx.font = `900 ${64 * u}px ${F}`; ctx.textAlign = 'right';
      ctx.fillText(`${pct}%`, x + ow - 30 * u, y + oh / 2 + 22 * u);
      ctx.textAlign = 'left';
    }
    if (isCorrect) tag(g, '✓ RISPOSTA CORRETTA', x + ow, y - 34 * u, { bg: C.turchese, size: 26, align: 'right' });
  });
  // piede
  ctx.textAlign = 'center';
  if (!closed) {
    ctx.font = `900 ${50 * u}px ${F}`; ctx.fillStyle = C.inchiostro;
    const pulse = 1 + Math.sin(g.t / 260) * 0.03;
    ctx.save(); ctx.translate(W / 2, H - 50 * u); ctx.scale(pulse, pulse);
    ctx.fillText(`VOTA ORA DAL TELEFONO · ${s.voters} VOTI`, 0, 0); ctx.restore();
  } else if (s.counts && kClosed >= 1 && s.corretta == null) {
    ctx.font = `900 ${40 * u}px ${F}`; ctx.fillStyle = C.inchiostro;
    if (!total || s.tie) ctx.fillText(!total ? 'NESSUN VOTO' : 'PARITÀ! IL PUBBLICO È DIVISO', W / 2, H - 30 * u);
  }
  ctx.textAlign = 'left';
}

// ---------- QUIZ: domanda, risposte una alla volta, timer, lavagnette delle squadre, SOS sulla stessa domanda ----------
function ring(g, cx, cy, R, left, total, { label = null, alert = 6000 } = {}) {
  const { ctx, u } = g;
  ctx.lineWidth = 24 * u; ctx.strokeStyle = 'rgba(23,18,31,.15)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const hot = left > 0 && left < alert;
  ctx.strokeStyle = hot ? '#ff4d5e' : C.viola; ctx.lineCap = 'round';
  if (left > 0) { ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left / Math.max(1, total))); ctx.stroke(); }
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, R - 15 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hot || left <= 0 ? '#ff4d5e' : C.inchiostro; ctx.textAlign = 'center';
  let fs = (label ? 46 : 88) * u;
  ctx.font = `900 ${fs}px ${F}`;
  if (label) { const w = ctx.measureText(label).width, max = (R - 22 * u) * 2; if (w > max) { fs *= max / w; ctx.font = `900 ${fs}px ${F}`; } } // la scritta resta dentro il cerchio
  ctx.fillText(label || String(Math.ceil(left / 1000)), cx, cy + (label ? fs * 0.35 : 32 * u));
  ctx.textAlign = 'left';
}

function quiz(g, scene) {
  const { ctx, W, H, u, env } = g;
  const z = scene.quiz;
  if (!z) return promo(g);
  const now = env.now ? env.now() : Date.now();
  const anim = (at, dur = 420) => (g.el === Infinity || !at ? 1 : ease((now - at) / dur));
  const y0 = title(g, `QUIZ · DOMANDA ${z.n} DI ${z.tot}`, 30 * u, { size: 70, color: C.viola });
  logo(g, 40 * u, 24 * u, 130 * u);
  const S = z.sos;
  const sosVoting = S && !S.closed && now < S.endsAt;
  if (S) tag(g, sosVoting ? `🆘 SOS · IL PUBBLICO AIUTA LA ${S.coppia.toUpperCase()}` : `🆘 SOS DELLA ${S.coppia.toUpperCase()}`, W / 2, y0, { bg: S.colore || C.lime, size: 28 });
  if (!z.testo) return;
  const wide = W / H > 1.3;
  // cerchio a destra della domanda: countdown dell'SOS mentre si vota, altrimenti il timer del quiz
  const T = z.timer;
  const showRing = sosVoting || T;
  const R = 92 * u;
  const qx = 70 * u, qy = y0 + 62 * u;
  const qw = W - 140 * u - (showRing && wide ? R * 2 + 50 * u : 0);
  const kq = anim(z.shownAt?.[1], 500);
  ctx.save(); ctx.globalAlpha = kq; ctx.translate(0, (1 - kq) * 30 * u);
  ctx.font = `900 ${58 * u}px ${F}`;
  const lines = wrapLines(ctx, z.testo, qw - 56 * u).slice(0, 3);
  const qh = Math.max(130 * u, lines.length * 68 * u + 50 * u);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(qx + 10 * u, qy + 10 * u, qw, qh);
  ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qw, qh);
  ctx.lineWidth = 5 * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(qx, qy, qw, qh);
  ctx.fillStyle = C.inchiostro;
  lines.forEach((l, i) => ctx.fillText(l, qx + 28 * u, qy + 78 * u + i * 68 * u));
  ctx.restore();
  if (showRing) {
    const cx = wide ? W - 70 * u - R : W - 70 * u - R, cy = qy + qh / 2;
    if (sosVoting) ring(g, cx, cy, R, S.endsAt - now, S.endsAt - S.startedAt);
    else {
      const left = T.running ? T.endsAt - now : T.left;
      const paused = !T.running && left > 0;
      ring(g, cx, cy, R, left, T.dur, { label: left <= 0 ? 'TEMPO!' : paused ? (S && !S.mostrato ? 'SOS' : 'STOP') : null, alert: 10000 });
    }
  }
  // risposte 2x2: compaiono una alla volta
  const oy = qy + qh + 44 * u;
  const stripH = 110 * u;
  const footer = stripH + 50 * u + 56 * u; // spazio fisso per la riga «vota ora» / «parità»: le risposte non si spostano
  const gap = 40 * u, ow = (W - 140 * u - 30 * u) / 2;
  const oh = Math.max(90 * u, Math.min(190 * u, (H - oy - footer - gap) / 2));
  const counts = S?.counts, total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
  for (let i = 0; i < 4; i++) {
    const x = 70 * u + (i % 2) * (ow + 30 * u), y = oy + Math.floor(i / 2) * (oh + gap);
    const shown = i < z.opzioni.length;
    if (!shown) { // segnaposto tratteggiato: si vede che arrivano altre risposte
      ctx.setLineDash([14 * u, 12 * u]); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(23,18,31,.25)'; ctx.strokeRect(x, y, ow, oh); ctx.setLineDash([]);
      continue;
    }
    const k = anim(z.shownAt?.[i + 2]);
    const isCorrect = z.corretta === i;
    const picked = z.teamsRevealed ? z.squadre.filter((t) => t.idx === i) : [];
    ctx.save(); ctx.globalAlpha = k;
    const sc = 0.85 + 0.15 * k; ctx.translate(x + ow / 2, y + oh / 2); ctx.scale(sc, sc); ctx.translate(-(x + ow / 2), -(y + oh / 2));
    ctx.fillStyle = C.inchiostro; ctx.fillRect(x + 8 * u, y + 8 * u, ow, oh);
    ctx.fillStyle = isCorrect ? C.turchese : '#fff'; ctx.fillRect(x, y, ow, oh);
    if (counts && total && !isCorrect) { // voti del pubblico (dopo «Mostra i voti»)
      const kb = anim(S.shownAt, 1600);
      ctx.fillStyle = 'rgba(255,107,214,.45)'; ctx.fillRect(x, y, ow * (counts[i] / total) * kb, oh);
    }
    ctx.lineWidth = (isCorrect ? 10 : 5) * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(x, y, ow, oh);
    // tutto DENTRO la casella, niente che sporga: lettera (lime con ✓ se giusta), testo, bollini delle squadre sotto il testo, percentuale a destra
    const bs = Math.min(92 * u, oh - 30 * u);
    const two = z.teamsRevealed; // con le lavagnette girate: testo in alto, bollini sotto
    ctx.fillStyle = isCorrect ? C.lime : C.inchiostro; ctx.fillRect(x + 20 * u, y + oh / 2 - bs / 2, bs, bs);
    if (isCorrect) { ctx.lineWidth = 4 * u; ctx.strokeRect(x + 20 * u, y + oh / 2 - bs / 2, bs, bs); }
    ctx.fillStyle = isCorrect ? C.inchiostro : '#fff'; ctx.font = `900 ${bs * 0.66}px ${F}`; ctx.textAlign = 'center';
    ctx.fillText(isCorrect ? '✓' : L[i], x + 20 * u + bs / 2, y + oh / 2 + bs * 0.23);
    const tx = x + 40 * u + bs, right = (counts && total ? 170 : 30) * u, tw = ow - 40 * u - bs - right;
    const fs = Math.min(50 * u, oh * (two ? 0.3 : 0.36));
    ctx.textAlign = 'left'; ctx.fillStyle = C.inchiostro; ctx.font = `800 ${fs}px ${F}`;
    ctx.fillText((isCorrect ? L[i] + '. ' : '') + z.opzioni[i], tx, two ? y + oh * 0.42 : y + oh / 2 + fs * 0.36, tw);
    if (counts && total) { ctx.font = `900 ${60 * u}px ${F}`; ctx.textAlign = 'right'; ctx.fillText(`${Math.round((counts[i] / total) * 100)}%`, x + ow - 26 * u, y + oh / 2 + 22 * u); ctx.textAlign = 'left'; }
    ctx.restore();
    // bollini delle squadre che hanno scritto questa lettera: compaiono uno alla volta (ognuno con il suo suono)
    let bx = tx;
    const ch = Math.min(42 * u, oh * 0.28), cy0 = y + oh * 0.56;
    picked.forEach((t) => {
      const ti = z.squadre.indexOf(t);
      const kk = anim(z.teamsRevealedAt ? z.teamsRevealedAt + ti * QUIZ_TEAM_STEP : null, 300);
      if (kk <= 0) return;
      const label = t.nome.replace(/^squadra\s+/i, '').toUpperCase() + (t.esito === false ? ' ✗' : t.esito ? ' ✓' : '');
      ctx.font = `900 ${ch * 0.62}px ${F}`;
      const w = ctx.measureText(label).width + 26 * u;
      if (bx + w > x + ow - right) return; // non esce mai dalla casella
      ctx.save(); ctx.globalAlpha = kk; ctx.translate(bx + w / 2, cy0 + ch / 2); const sc2 = 0.6 + 0.4 * kk; ctx.scale(sc2, sc2); ctx.translate(-(bx + w / 2), -(cy0 + ch / 2));
      ctx.fillStyle = C.inchiostro; ctx.fillRect(bx + 4 * u, cy0 + 4 * u, w, ch);
      ctx.fillStyle = t.colore || C.lime; ctx.fillRect(bx, cy0, w, ch);
      ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 3 * u; ctx.strokeRect(bx, cy0, w, ch);
      ctx.fillStyle = t.esito === false ? '#b3001b' : C.inchiostro; ctx.fillText(label, bx + 13 * u, cy0 + ch * 0.7);
      ctx.restore();
      bx += w + 10 * u;
    });
  }
  // voto in corso dal telefono
  if (sosVoting) {
    ctx.font = `900 ${42 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    const pulse = 1 + Math.sin(g.t / 260) * 0.03;
    ctx.save(); ctx.translate(W / 2, H - stripH - 56 * u); ctx.scale(pulse, pulse);
    ctx.fillText(`VOTA ORA DAL TELEFONO · ${S.voters} VOTI`, 0, 0); ctx.restore(); ctx.textAlign = 'left';
  } else if (S && S.closed && !S.mostrato) {
    ctx.font = `900 ${34 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText('VOTO DEL PUBBLICO CHIUSO · I RISULTATI TRA POCO', W / 2, H - stripH - 56 * u); ctx.textAlign = 'left';
  } else if (counts && S.tie) {
    ctx.font = `900 ${34 * u}px ${F}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText('PARITÀ! IL PUBBLICO È DIVISO', W / 2, H - stripH - 56 * u); ctx.textAlign = 'left';
  }
  // lavagnette delle squadre
  const n = z.squadre.length, sg = 24 * u, sw = (W - 140 * u - sg * (n - 1)) / n, sy = H - stripH - 26 * u;
  z.squadre.forEach((t, i) => {
    const x = 70 * u + i * (sw + sg);
    const status = t.esito === true ? `✓ GIUSTA${t.punti != null ? ' · +' + t.punti : ''}` : t.esito === false ? '✗ SBAGLIATA' : t.idx != null ? `RISPOSTA ${L[t.idx]}` : t.risposto ? '✓ HA RISPOSTO' : 'PENSA…';
    ctx.fillStyle = C.inchiostro; ctx.fillRect(x + 7 * u, sy + 7 * u, sw, stripH);
    ctx.fillStyle = t.risposto || t.esito != null ? t.colore || C.lime : '#fff'; ctx.fillRect(x, sy, sw, stripH);
    ctx.lineWidth = 4 * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(x, sy, sw, stripH);
    ctx.fillStyle = C.inchiostro; ctx.font = `900 ${32 * u}px ${F}`;
    ctx.fillText(t.nome.toUpperCase() + (t.sos ? '  🆘' : ''), x + 22 * u, sy + 42 * u, sw - 44 * u);
    ctx.font = `900 ${38 * u}px ${F}`;
    ctx.fillText(status, x + 22 * u, sy + 90 * u, sw - 44 * u);
  });
}

// ---------- PREMIAZIONE: busta dorata che gira, poi (al comando della regia) si apre ed esce la gift card ----------
/** Tempi dell'apertura (ms dal comando «Apri la busta»): la card arriva al centro in meno di 3 secondi. */
export const PREMIO_TEMPI = { gira: 450, lembo: 850, esce: 1700, centro: 2700 };
function popcorn(ctx, x, y, r, rot, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
  const blobs = [[0, 0, 1], [-0.62, -0.25, 0.72], [0.6, -0.3, 0.7], [-0.25, -0.75, 0.66], [0.32, -0.72, 0.62], [0.05, 0.45, 0.6]];
  ctx.fillStyle = 'rgba(23,18,31,.25)';
  for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(bx * r + r * 0.12, by * r + r * 0.12, br * r * 0.62, 0, Math.PI * 2); ctx.fill(); }
  for (const [bx, by, br] of blobs) {
    const gr = ctx.createRadialGradient(bx * r - br * r * 0.2, by * r - br * r * 0.25, 1, bx * r, by * r, br * r * 0.62);
    gr.addColorStop(0, '#fffdf2'); gr.addColorStop(0.7, '#fbeec4'); gr.addColorStop(1, '#e8c77a');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(bx * r, by * r, br * r * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#d99a2b'; ctx.beginPath(); ctx.arc(r * 0.1, r * 0.55, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// oro "foil": tanti passaggi di luce, come una lamina vera
function foil(ctx, x0, y0, x1, y1, shift = 0) {
  const gr = ctx.createLinearGradient(x0, y0, x1, y1);
  const k = (v) => Math.min(1, Math.max(0, v + shift * 0.25));
  gr.addColorStop(0, '#5e3c0c'); gr.addColorStop(k(0.18), '#9a6c1f'); gr.addColorStop(k(0.36), '#dcb862');
  gr.addColorStop(k(0.48), '#fff0c2'); gr.addColorStop(k(0.6), '#d9b35f'); gr.addColorStop(k(0.8), '#94661c'); gr.addColorStop(1, '#5a390b');
  return gr;
}
// trama spazzolata della carta metallizzata (generata una volta sola)
let foilTex = null;
function foilPattern(ctx) {
  if (!foilTex && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d'), r = rng(42);
    x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2200; i++) {
      const v = Math.floor(90 + r() * 80), y = r() * 512, len = 40 + r() * 260, x0 = r() * 512;
      x.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`; x.lineWidth = 0.6 + r() * 1.2;
      x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + len, y + len * 0.08); x.stroke();
    }
    foilTex = c;
  }
  return foilTex ? ctx.createPattern(foilTex, 'repeat') : null;
}
function sparkle(ctx, x, y, r, a) {
  if (a <= 0.02) return;
  ctx.save(); ctx.globalAlpha = Math.min(1, a); ctx.translate(x, y);
  ctx.shadowColor = 'rgba(255,220,140,.9)'; ctx.shadowBlur = r * 1.5; ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.18 : r, an = (i / 8) * Math.PI * 2; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function premio(g, scene) {
  const { ctx, W, H, u, t, env } = g;
  const P = env.config?.show?.premio || {};
  const card = img(srcOf(P.immagine || '/img/premio/cinema-pass.webp'));
  const now = env.now ? env.now() : Date.now();
  const o = scene.apertoAt ? (g.el === Infinity ? 1e9 : now - scene.apertoAt) : null; // ms dall'apertura
  const T = PREMIO_TEMPI, e = (a, b) => (o == null ? 0 : ease((o - a) / (b - a)));
  const live = g.el !== Infinity;
  // sala al buio con un occhio di bue caldo al centro
  const vg = ctx.createRadialGradient(W / 2, H * 0.56, 60 * u, W / 2, H * 0.56, Math.max(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(40,26,8,.30)'); vg.addColorStop(0.45, 'rgba(20,13,22,.72)'); vg.addColorStop(1, 'rgba(10,7,14,.92)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  logo(g, 40 * u, 26 * u, 140 * u);
  const y0 = title(g, (P.titolo || 'LA PREMIAZIONE').toUpperCase(), 30 * u, { size: 76, color: C.viola });
  const vinc = scene.vincitori || [];
  const team = vinc.length ? (vinc.length > 1 ? 'VINCONO ' + vinc.map((v) => v.nome.toUpperCase()).join(' E ') : 'VINCE LA ' + vinc[0].nome.toUpperCase()) : '';
  const tagS = 50, tagY = H - tagS * 1.55 * u - 24 * u;
  // misure e movimento: la busta sale dal basso e si posa, poi respira appena finché non si apre
  const ew = Math.min(W * 0.34, 660 * u), eh = ew * 0.62;
  const still = 1 - e(0, T.gira);
  const kIn = live ? Math.min(1, t / 1100) : 1, back = kIn >= 1 ? 1 : 1 + 2.2 * Math.pow(kIn - 1, 3) + 1.2 * Math.pow(kIn - 1, 2);
  const enter = (1 - back) * H * 0.75, alphaIn = live ? ease(t / 450) : 1;
  const cx = W / 2, baseY = H * 0.6 + enter + Math.sin(t / 1100) * 6 * u * still;
  const tilt = ((1 - back) * -0.08 + Math.sin(t / 1700) * 0.008) * still;
  const drop = e(T.esce, T.centro) * (H * 0.55), fade = 1 - e(T.esce + 300, T.centro);
  const ex = cx - ew / 2, ey = baseY - eh / 2 + drop, ecy = ey + eh / 2;
  const sx = Math.sin(t / 1800) * still; // la luce scorre piano sull'oro
  const fl = 1 - 2 * e(T.gira, T.lembo); // lembo: 1 chiuso, -1 aperto
  // alone dorato dietro la busta (poi dietro la card)
  const mvG = e(T.esce, T.centro);
  const gR = (ew * 0.85 + mvG * ew * 0.55) * (1 + Math.sin(t / 900) * 0.04), gy = ecy - mvG * (ecy - H * 0.52);
  const glow = ctx.createRadialGradient(cx, gy, 0, cx, gy, gR);
  glow.addColorStop(0, `rgba(255,205,110,${0.32 * alphaIn})`); glow.addColorStop(1, 'rgba(255,205,110,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - gR, gy - gR, gR * 2, gR * 2);
  // la card: dentro la busta, poi sale, poi va al centro e si ingrandisce
  const finalW = Math.min(W * 0.62, (tagY - y0 - 50 * u) * 1.415), finalH = finalW / 1.415;
  const inW = ew * 0.88, inH = inW / 1.415;
  const rise = e(T.lembo - 100, T.esce), mv = e(T.esce, T.centro);
  const inY = ey + eh * 0.1 - rise * inH * 0.62;
  const fy = y0 + 18 * u + (tagY - y0 - 36 * u - finalH) / 2;
  const cw = inW + (finalW - inW) * mv, chh = cw / 1.415;
  const float = o != null && o > T.centro ? Math.sin((o - T.centro) / 700) * 6 * u : 0;
  const drawCard = () => {
    if (!card || o == null || rise <= 0) return;
    const x = cx - cw / 2, y = (mv > 0 ? inY + (fy - inY) * mv : inY) + float;
    ctx.save(); ctx.translate(cx, y + chh / 2); ctx.rotate((1 - mv) * -0.03); ctx.translate(-cx, -(y + chh / 2));
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 18 * u;
    ctx.drawImage(card, x, y, cw, chh); ctx.shadowColor = 'transparent';
    if (o > T.centro) { // riflesso che attraversa la card
      const ph = ((o - T.centro) % 4200) / 1400;
      if (ph < 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, chh); ctx.clip();
        const sxp = x - cw * 0.3 + ph * cw * 1.6, gr = ctx.createLinearGradient(sxp - 120 * u, 0, sxp + 120 * u, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.translate(sxp, y + chh / 2); ctx.rotate(0.35); ctx.fillRect(-120 * u, -chh, 240 * u, chh * 2); ctx.restore();
      }
    }
    ctx.restore();
  };
  // ---- busta: corpo, alette laterali, aletta inferiore, lembo superiore, sigillo di ceralacca ----
  const envT = () => { ctx.globalAlpha = fade * alphaIn; ctx.translate(cx, ecy); ctx.rotate(tilt); ctx.translate(-cx, -ecy); };
  const rr = 8 * u;
  const bodyPath = () => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(ex, ey, ew, eh, rr) : ctx.rect(ex, ey, ew, eh); };
  const piece = (pts, fill, shadow = 0) => {
    ctx.save();
    if (shadow) { ctx.shadowColor = 'rgba(40,22,2,.45)'; ctx.shadowBlur = shadow * u; ctx.shadowOffsetY = shadow * 0.3 * u; }
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.strokeStyle = 'rgba(255,238,190,.45)'; ctx.lineWidth = 1.6 * u; ctx.stroke(); // filo di luce sulla piega
  };
  const texture = () => { // trama spazzolata sopra tutto l'oro
    const pat = foilPattern(ctx); if (!pat) return;
    ctx.save(); bodyPath(); ctx.clip(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha *= 0.4;
    ctx.fillStyle = pat; ctx.fillRect(ex, ey - eh, ew, eh * 2); ctx.restore();
  };
  const pocket = () => {
    piece([[ex, ey], [cx - ew * 0.02, ey + eh * 0.56], [ex, ey + eh]], foil(ctx, ex, ey, cx, ey + eh, sx - 0.6));
    piece([[ex + ew, ey], [cx + ew * 0.02, ey + eh * 0.56], [ex + ew, ey + eh]], foil(ctx, ex + ew, ey, cx, ey + eh, -sx - 0.6));
    piece([[ex, ey + eh], [cx, ey + eh * 0.44], [ex + ew, ey + eh]], foil(ctx, ex, ey + eh * 0.4, ex + ew, ey + eh, sx + 0.2), 16);
  };
  const flap = () => {
    const tip = ey + eh * 0.6 * fl;
    piece([[ex, ey], [ex + ew, ey], [cx, tip]], fl > 0 ? foil(ctx, ex, ey, ex + ew, tip, sx + 0.4) : foil(ctx, ex, tip, ex + ew, ey, -1.2), fl > 0 ? 22 : 0);
  };
  const seal = () => {
    const sr = eh * 0.13, sy = ey + eh * 0.6 * fl - sr * 0.15, r = rng(7);
    ctx.save(); ctx.shadowColor = 'rgba(30,0,5,.55)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 5 * u;
    ctx.beginPath();
    for (let i = 0; i < 28; i++) { const an = (i / 28) * Math.PI * 2, k = sr * (1 + (r() - 0.5) * 0.14); ctx.lineTo(cx + Math.cos(an) * k, sy + Math.sin(an) * k); }
    ctx.closePath();
    const wax = ctx.createRadialGradient(cx - sr * 0.35, sy - sr * 0.4, sr * 0.1, cx, sy, sr * 1.1);
    wax.addColorStop(0, '#e04257'); wax.addColorStop(0.55, '#a5132e'); wax.addColorStop(1, '#5c0515');
    ctx.fillStyle = wax; ctx.fill(); ctx.restore();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(60,0,10,.45)'; ctx.beginPath(); ctx.arc(cx, sy, sr * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,160,170,.25)'; ctx.beginPath(); ctx.arc(cx - 1.5 * u, sy - 1.5 * u, sr * 0.7, Math.PI * 0.9, Math.PI * 1.7); ctx.stroke();
    // stella impressa in oro
    const star = (dx, dy, R) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + (i / 10) * Math.PI * 2, k = i % 2 ? R * 0.45 : R; ctx.lineTo(cx + dx + Math.cos(an) * k, sy + dy + Math.sin(an) * k); } ctx.closePath(); };
    star(1.5 * u, 2 * u, sr * 0.48); ctx.fillStyle = 'rgba(50,0,8,.55)'; ctx.fill();
    star(0, 0, sr * 0.48); ctx.fillStyle = foil(ctx, cx - sr * 0.5, sy - sr * 0.5, cx + sr * 0.5, sy + sr * 0.5, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(cx - sr * 0.4, sy - sr * 0.45, sr * 0.28, sr * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  };
  const shine = () => { // riflesso che attraversa la busta ogni tanto
    if (o != null || !live) return;
    const ph = ((t + 1200) % 4200) / 1500; if (ph >= 1) return;
    ctx.save(); bodyPath(); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
    const xs = ex - ew * 0.3 + ph * ew * 1.6, gr = ctx.createLinearGradient(xs - 110 * u, 0, xs + 110 * u, 0);
    gr.addColorStop(0, 'rgba(255,230,170,0)'); gr.addColorStop(0.5, 'rgba(255,230,170,.32)'); gr.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = gr; ctx.translate(xs, ecy); ctx.rotate(0.35); ctx.fillRect(-110 * u, -eh, 220 * u, eh * 2); ctx.restore();
  };
  const cardOnTop = mv > 0;
  if (fade > 0) {
    ctx.save(); envT();
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 60 * u; ctx.shadowOffsetY = 30 * u;
    bodyPath(); ctx.fillStyle = fl > 0 ? foil(ctx, ex, ey, ex + ew, ey + eh, sx) : '#3a2405'; ctx.fill(); ctx.restore();
    if (fl <= 0) { const inn = ctx.createLinearGradient(0, ey, 0, ey + eh * 0.6); inn.addColorStop(0, '#2a1903'); inn.addColorStop(1, '#6b4612'); ctx.fillStyle = inn; bodyPath(); ctx.fill(); }
    if (fl > 0) {
      pocket(); flap(); texture(); shine();
      if (fl > 0.2) seal();
      bodyPath(); ctx.strokeStyle = 'rgba(70,42,6,.8)'; ctx.lineWidth = 2 * u; ctx.stroke();
      ctx.restore();
    } else { // aperta: interno scuro, lembo ribaltato in alto, card, tasca davanti
      flap();
      ctx.restore();
      if (!cardOnTop) drawCard();
      ctx.save(); envT(); pocket(); texture(); ctx.restore();
    }
  }
  if (cardOnTop) drawCard();
  // scintille intorno alla busta (e poi intorno alla card)
  if (live) {
    const spots = [[-0.62, -0.55], [0.6, -0.62], [-0.7, 0.35], [0.68, 0.42], [-0.3, -0.85], [0.34, 0.82], [0.85, -0.1], [-0.88, -0.05]];
    const sw = ew * (1 + mvG * 0.9), sh = eh * (1 + mvG * 0.9), scy = mvG > 0 ? gy : ecy;
    spots.forEach(([fx, fy2], i) => sparkle(ctx, cx + fx * sw * 0.75, scy + fy2 * sh * 0.75, (14 + (i % 3) * 6) * u, Math.pow(Math.max(0, Math.sin(t / 520 + i * 1.7)), 6) * alphaIn));
  }
  // popcorn: solo quando si apre la busta (schizzano fuori), poi saltellano ai lati
  if (o != null && o > T.centro) {
    const ka = Math.min(1, (o - T.centro) / 500);
    [[0.05, 0], [0.1, 700], [0.15, 1400], [0.85, 300], [0.9, 1100], [0.95, 1800]].forEach(([fx, d], i) => {
      const ph = ((t + d) % 2200) / 2200, hgt = Math.sin(Math.min(1, ph * 1.6) * Math.PI) * 70 * u;
      popcorn(ctx, W * fx, H - 70 * u - hgt, 26 * u, Math.sin(t / 400 + i) * 0.4 + ph * 2, ka);
    });
  }
  if (o != null && o > T.lembo - 100) {
    const tt = o - (T.lembo - 100);
    for (let i = 0; i < 46; i++) {
      const r = rng(i * 7 + 3), start = i * 55 + r() * 120, k = tt - start;
      if (k < 0) continue;
      const s2 = k / 1000, vx = (r() - 0.5) * 900 * u, vy = -(700 + r() * 650) * u, gyy = 1500 * u;
      const x = cx + (r() - 0.5) * ew * 0.6 + vx * s2, y = ey + eh * 0.1 + vy * s2 + 0.5 * gyy * s2 * s2;
      if (y > H + 60 * u) continue;
      popcorn(ctx, x, y, (18 + r() * 16) * u, r() * 6 + s2 * (r() - 0.5) * 8, Math.min(1, k / 120));
    }
  }
  if (o != null && o > T.centro - 200 && live) confetti(ctx, W, H, u, o - T.centro + 200);
  if (team) tag(g, team, W / 2, tagY, { bg: vinc[0]?.colore || C.lime, size: tagS });
}

// ---------- FINE: grazie e seguici (con la canzone sotto) ----------
function fine(g) {
  const { ctx, W, H, u, t, env } = g;
  const wide = W / H > 1.3;
  logo(g, 60 * u, 46 * u, 200 * u);
  // emoji che salgono, come nel promemoria
  const em = ['😂', '❤️', '😬', '😡', '🎬', '💔'];
  ctx.font = `${70 * u}px ${F}`;
  for (let i = 0; i < 9; i++) {
    const r = rng(i + 11), sp = 8000 + r() * 5000, ph = ((t + r() * sp) % sp) / sp;
    ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.7;
    ctx.fillText(em[i % em.length], 80 * u + r() * (W - 220 * u), H + 60 * u - ph * H * 0.7);
  }
  ctx.globalAlpha = 1;
  const qrSize = (wide ? 400 : 480) * u;
  const qx = wide ? W - qrSize - 130 * u : W / 2 - qrSize / 2, qy = wide ? H / 2 - qrSize / 2 + 40 * u : H * 0.56;
  const cx = wide ? (qx - 40 * u) / 2 + 20 * u : W / 2, maxW = wide ? qx - 200 * u : W * 0.86;
  const k = (d) => (g.el === Infinity ? 1 : ease((t - d) / 600));
  // titolo
  ctx.save(); ctx.globalAlpha = k(0); ctx.translate(cx, H * (wide ? 0.27 : 0.2)); ctx.rotate(-0.025);
  ctx.font = `900 ${118 * u}px ${F}`; ctx.textAlign = 'center';
  const tt = 'È FINITA.', w1 = Math.min(ctx.measureText(tt).width, maxW);
  brush(ctx, -w1 / 2 - 50 * u, -100 * u, w1 + 100 * u, 140 * u, C.viola, 31);
  ctx.fillStyle = '#fff'; ctx.fillText(tt, 0, 0, maxW);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = k(350); ctx.textAlign = 'center';
  ctx.font = `900 ${50 * u}px ${F}`; ctx.fillStyle = C.inchiostro;
  ctx.fillText('(PER STASERA)', cx, H * (wide ? 0.27 : 0.2) + 75 * u, maxW);
  ctx.restore();
  // ringraziamento ironico
  const y2 = H * (wide ? 0.5 : 0.37);
  ctx.save(); ctx.globalAlpha = k(800); ctx.textAlign = 'center';
  ctx.font = `900 ${56 * u}px ${F}`; ctx.fillStyle = C.inchiostro;
  ctx.fillText('Grazie per aver giocato con noi!', cx, y2, maxW);
  ctx.font = `800 ${42 * u}px ${F}`;
  ['Millennials: il mal di schiena vi aspetta a casa.', 'Gen Z: potete riaprire TikTok, lo sappiamo che non vedevate l’ora.']
    .forEach((l, i) => ctx.fillText(l, cx, y2 + 72 * u + i * 56 * u, maxW));
  ctx.restore();
  // QR di Instagram
  const qr = env.qr?.ig && img(env.qr.ig);
  ctx.save(); ctx.globalAlpha = k(1300);
  ctx.translate(qx + qrSize / 2, qy + qrSize / 2); ctx.rotate(0.03); ctx.translate(-(qx + qrSize / 2), -(qy + qrSize / 2));
  ctx.fillStyle = C.inchiostro; ctx.fillRect(qx + 14 * u, qy + 14 * u, qrSize + 30 * u, qrSize + 30 * u);
  ctx.fillStyle = '#fff'; ctx.fillRect(qx - 15 * u, qy - 15 * u, qrSize + 30 * u, qrSize + 30 * u);
  if (qr) ctx.drawImage(qr, qx, qy, qrSize, qrSize);
  ctx.restore();
  const handle = (env.config?.show?.instagramHandle || '@cultpop.it').toUpperCase();
  ctx.save(); ctx.globalAlpha = k(1500);
  tag(g, `SEGUICI ${handle}`, qx + qrSize / 2, qy - 80 * u, { bg: C.fucsia, size: 40 });
  tag(g, 'NON TI LIBERERAI DI NOI COSÌ FACILMENTE', qx + qrSize / 2, qy + qrSize + 40 * u, { bg: C.lime, size: 24 });
  ctx.restore();
}

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// ---------- VERDETTO: rivelazione dal 3° al 1° posto ----------
/** Lavagnette girate: i bollini delle squadre compaiono uno alla volta (ms tra uno e l'altro). */
export const QUIZ_TEAM_STEP = 450;
export const VERDICT_STEPS = [4000, 9000, 11500]; // dal 2° al 1° poco: a quel punto il vincitore si è già capito // ms: quando compaiono 3°, 2°, 1° (lento: rullo lungo, tromba sul 1°)
function verdetto(g, scene) {
  const { ctx, W, H, u, env, t } = g;
  const y0 = title(g, 'IL VERDETTO', 36 * u, { size: 90, color: C.viola });
  logo(g, 40 * u, 26 * u, 150 * u);
  const teams = scene.standings?.coppie || [];
  const conts = Object.fromEntries((env.config?.concorrenti || []).map((c) => [c.id, c]));
  const positions = [...new Set(teams.map((x) => x.posizione))].sort((a, b) => b - a); // peggiore → migliore
  const revealAt = (pos) => {
    const k = positions.indexOf(pos);
    return VERDICT_STEPS[Math.min(VERDICT_STEPS.length - 1, VERDICT_STEPS.length - positions.length + k)] ?? 0;
  };
  const wide = W / H > 1.3;
  // podio: 2° a sinistra, 1° al centro (più alto), 3° a destra
  const order = [...teams].sort((a, b) => a.posizione - b.posizione);
  const slots = wide ? [1, 0, 2] : [0, 1, 2];
  const top = y0 + 50 * u, bottom = H - 150 * u; // spazio per la scritta «Vince la squadra…» senza coprire le carte
  const n = order.length;
  order.forEach((tm, rank) => {
    const slot = slots[rank] ?? rank;
    let x, y, w, h;
    if (wide) {
      const gap = 40 * u, cw = (W - gap * (n + 1)) / n;
      x = gap + slot * (cw + gap); w = cw;
      const lift = tm.posizione === 1 ? 0 : tm.posizione === 2 ? 50 * u : 90 * u;
      y = top + lift; h = bottom - top - lift;
    } else {
      const gap = 24 * u, ch = (bottom - top - gap * (n - 1)) / n;
      x = 50 * u; y = top + slot * (ch + gap); w = W - 100 * u; h = ch;
    }
    const ra = revealAt(tm.posizione);
    const k = g.el === Infinity ? 1 : ease((t - ra) / 700);
    if (k <= 0) {
      // carta coperta
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate([-0.012, 0.008, -0.006][slot % 3]);
      ctx.fillStyle = C.inchiostro; ctx.fillRect(-w / 2 + 10 * u, -h / 2 + 10 * u, w, h);
      ctx.fillStyle = C.viola; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.lineWidth = 5 * u; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = C.lime; ctx.font = `900 ${200 * u}px ${F}`; ctx.textAlign = 'center';
      ctx.fillText('?', 0, 70 * u + Math.sin(t / 200 + slot) * 8 * u); ctx.textAlign = 'left';
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k); ctx.translate(-(x + w / 2), -(y + h / 2));
    teamCard(g, tm, conts, x, y, w, h, wide, slot, true);
    ctx.restore();
  });
  const winners = order.filter((x) => x.posizione === 1);
  const last = VERDICT_STEPS[VERDICT_STEPS.length - 1];
  const kw = g.el === Infinity ? 1 : ease((t - last - 500) / 600);
  if (kw > 0 && winners.length) {
    const txt = winners.length > 1 ? 'EX AEQUO! VINCONO ' + winners.map((w) => w.nome.toUpperCase()).join(' E ') : `VINCE LA ${winners[0].nome.toUpperCase()}!`;
    ctx.save(); ctx.globalAlpha = kw;
    ctx.font = `900 ${64 * u}px ${F}`;
    const tw = Math.min(ctx.measureText(txt).width, W - 200 * u);
    brush(ctx, W / 2 - tw / 2 - 60 * u, H - 125 * u, tw + 120 * u, 110 * u, C.fucsia, 7);
    ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText(txt, W / 2, H - 50 * u, W - 200 * u);
    ctx.restore();
    if (g.el !== Infinity) confetti(ctx, W, H, u, t - last - 300);
  }
}

/** Coriandoli: due cannoni dagli angoli bassi + pioggia dall'alto, con attrito e sfarfallio. */
function confetti(ctx, W, H, u, t) {
  if (t < 0 || t > 9000) return;
  const cols = [C.lime, C.fucsia, C.turchese, C.giallo, C.viola, '#ffffff'];
  const tau = 0.55, term = 160 * u; // attrito (s) e velocità di caduta (px/s)
  const N = 170;
  for (let i = 0; i < N; i++) {
    const r = rng(i * 7 + 3);
    const cannon = i < 110;
    const delay = cannon ? r() * 0.5 : 0.3 + r() * 2.2;
    const tt = t / 1000 - delay;
    if (tt < 0) continue;
    let x0, y0, vx, vy;
    if (cannon) {
      const left = i % 2 === 0;
      x0 = left ? -10 * u : W + 10 * u; y0 = H * (0.82 + r() * 0.1);
      const ang = (left ? -1 : -1) * (Math.PI / 2 - (0.35 + r() * 0.55)) ;
      const sp = (1100 + r() * 900) * u;
      vx = (left ? 1 : -1) * Math.cos(ang) * sp; vy = Math.sin(ang) * sp;
    } else { x0 = r() * W; y0 = -30 * u; vx = (r() - 0.5) * 60 * u; vy = 40 * u; }
    const e = 1 - Math.exp(-tt / tau);
    const x = x0 + vx * tau * e + Math.sin(tt * (2 + r() * 2) + i) * 30 * u;
    const y = y0 + vy * tau * e + term * (tt - tau * e);
    if (y > H + 40 * u) continue;
    const fade = Math.min(1, (9 - t / 1000) / 1.5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(x, y);
    ctx.rotate(r() * 6 + tt * (2 + r() * 4));
    ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(tt * (5 + r() * 6) + i))));
    ctx.fillStyle = cols[i % cols.length];
    const w = (10 + r() * 10) * u, h = (6 + r() * 6) * u;
    if (i % 5 === 0) { ctx.beginPath(); ctx.arc(0, 0, h * 0.8, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export const SCENE_LABEL = { promo: 'Promemoria QR', classifica: 'Classifica provvisoria', generazioni: 'Generazioni in sala', sos: 'SOS', quiz: 'Quiz', chiuse: 'Votazioni chiuse', verdetto: 'Verdetto finale', premio: 'Premiazione', fine: 'Grazie e seguici' };

// ---------- VOTAZIONI CHIUSE: attesa del verdetto ----------
function chiuse(g) {
  const { ctx, W, H, u, t, env } = g;
  logo(g, 60 * u, 50 * u, 200 * u);
  const vc = env.config?.show?.votazioniChiuse || {};
  const wide = W / H > 1.3;
  // timbro "VOTAZIONI CHIUSE" che entra e oscilla
  const k = g.el === Infinity ? 1 : ease(t / 700);
  ctx.save();
  ctx.translate(W / 2, H * 0.26);
  ctx.rotate(-0.06 + Math.sin(t / 900) * 0.01);
  ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
  ctx.globalAlpha = k;
  ctx.font = `900 ${(wide ? 150 : 120) * u}px ${F}`;
  const txt = (vc.titolo || 'Votazioni chiuse').toUpperCase();
  const tw = Math.min(ctx.measureText(txt).width, W * 0.86);
  brush(ctx, -tw / 2 - 70 * u, -130 * u, tw + 140 * u, 220 * u, C.viola, 5);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText(txt, 0, 45 * u, W * 0.86);
  ctx.restore();
  // riquadro: gli Sugarfree possono ancora ribaltare tutto
  ctx.globalAlpha = g.el === Infinity ? 1 : ease((t - 600) / 600);
  ctx.font = `800 ${44 * u}px ${F}`;
  const sub = vc.testoLed || 'Ma gli Sugarfree possono confermare o ribaltare il risultato…';
  const lines = wrapLines(ctx, sub, Math.min(W - 200 * u, 1300 * u));
  const sw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 70 * u;
  const sh = lines.length * 56 * u + 34 * u;
  const sy = H * 0.45;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(W / 2 - sw / 2 + 8 * u, sy + 8 * u, sw, sh);
  ctx.fillStyle = '#fff'; ctx.fillRect(W / 2 - sw / 2, sy, sw, sh);
  ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 5 * u; ctx.strokeRect(W / 2 - sw / 2, sy, sw, sh);
  ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, sy + 58 * u + i * 56 * u));
  // immagine al centro, con un'oscillazione «da cucina»
  const im = vc.immagineLed && img(srcOf(vc.immagineLed));
  if (im) {
    const ih = Math.min(H - (sy + sh) - 16 * u, H * 0.42);
    const iw = ih * im.width / im.height;
    const kk = g.el === Infinity ? 1 : ease((t - 900) / 700);
    const sway = g.el === Infinity ? 0 : Math.sin(t / 260) * 0.06;
    ctx.save();
    ctx.globalAlpha = kk;
    ctx.translate(W / 2, H);
    ctx.rotate(sway);
    ctx.scale(0.7 + 0.3 * kk, 0.7 + 0.3 * kk);
    ctx.drawImage(im, -iw / 2, -ih, iw, ih);
    ctx.restore();
  } else {
    ctx.font = `${110 * u}px ${F}`;
    ['🥁', '🥁', '🥁'].forEach((d, i) => ctx.fillText(d, W / 2 + (i - 1) * 190 * u, H * 0.92 - (g.el === Infinity ? 0 : Math.abs(Math.sin(t / 160 + i * 1.1)) * 26 * u)));
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
const srcOf = (p) => (/^(data:|blob:|https?:|\/)/.test(p) ? p : '/' + p);

export async function prepareAssets(config, qr) {
  await fontsReady();
  const vc = config?.show?.votazioniChiuse;
  const pr = config?.show?.premio;
  await preload(['/img/logo.webp', qr?.dataUrl, qr?.ig, pr?.immagine && srcOf(pr.immagine), vc?.immagineLed && srcOf(vc.immagineLed), ...(config?.concorrenti || []).map((c) => c.foto)]);
}

export async function downloadPng(cv, name = 'cultpop-led.png') {
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
