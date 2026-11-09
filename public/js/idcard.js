// Carta d'identità generazionale 1080x1920 (formato storie), composta sul telefono.
// La foto NON viene mai inviata al server: resta sul dispositivo.
import { C, paper, brush, scribble, plus, wrap, loadImage, fontsReady, rng } from './deco.js';

const F = 'Archivo, system-ui, sans-serif';
const src = (p) => (!p ? '' : /^(data:|blob:|https?:|\/)/.test(p) ? p : '/' + p);

/** Carica la foto scelta, ridimensionata (i telefoni scattano foto enormi). */
export function loadPhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const max = 1400, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('foto non leggibile')); };
    im.src = url;
  });
}

/** Divide un testo in righe che stanno in maxW (font già impostato). */
function lines(ctx, text, maxW) {
  const out = [];
  let l = '';
  for (const w of String(text).split(/\s+/)) { const t = l ? `${l} ${w}` : w; if (ctx.measureText(t).width > maxW && l) { out.push(l); l = w; } else l = t; }
  if (l) out.push(l);
  return out;
}

/** Scrive su una riga riducendo il carattere finché ci sta (invece di schiacciare il testo). */
function fitText(ctx, text, x, y, maxW, size, min = 30, weight = 900) {
  let fs = size;
  for (; fs > min; fs -= 2) { ctx.font = `${weight} ${fs}px ${F}`; if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = `${weight} ${fs}px ${F}`;
  ctx.fillText(text, x, y, maxW);
}

// Il timbro sta sul bordo bianco sotto la foto (mai sul viso) e il nickname va nei dati.
export async function makeIdCard({ nick, year, gen, photo, cfg }) {
  await fontsReady();
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const seed = (year || 2000) + (nick || '').length * 7;
  const r = rng(seed);
  const NICK = String(nick || '').toUpperCase();

  // fondo viola pieno con grana leggera e luce morbida: pulito, da storia
  ctx.fillStyle = C.viola; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 760, 80, W / 2, 760, 1100);
  glow.addColorStop(0, 'rgba(255,255,255,0.16)'); glow.addColorStop(1, 'rgba(23,18,31,0.28)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = r() > 0.5 ? '#000' : '#fff'; ctx.fillRect(r() * W, r() * H, 2, 2); }
  ctx.globalAlpha = 1;

  // titolo centrato
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `900 96px ${F}`;
  ctx.fillText("CARTA D'IDENTITÀ", W / 2, 190, 960);
  ctx.font = `900 46px ${F}`;
  const sub = 'GENERAZIONALE';
  const sw = ctx.measureText(sub).width + 64;
  ctx.save(); ctx.translate(W / 2, 252); ctx.rotate(-0.02);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(-sw / 2 + 8, -34 + 8, sw, 72);
  ctx.fillStyle = C.lime; ctx.fillRect(-sw / 2, -34, sw, 72);
  ctx.fillStyle = C.inchiostro; ctx.fillText(sub, 0, 17);
  ctx.restore();

  // foto in polaroid: il timbro non va MAI sul viso (centro e parte alta della foto)
  const box = 620, cy = 360 + 30 + box / 2;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.rotate(-0.035);
  ctx.fillStyle = 'rgba(23,18,31,0.45)'; ctx.fillRect(-box / 2 - 14, -box / 2 - 14, box + 60, box + 150);
  ctx.fillStyle = '#fff'; ctx.fillRect(-box / 2 - 30, -box / 2 - 30, box + 60, box + 150);
  let pic = photo;
  if (!pic && gen?.immagine) pic = await loadImage(src(gen.immagine));
  if (pic) {
    const w = pic.width || pic.naturalWidth, h = pic.height || pic.naturalHeight;
    const s = Math.max(box / w, box / h);
    ctx.save();
    ctx.beginPath(); ctx.rect(-box / 2, -box / 2, box, box); ctx.clip();
    if (photo) ctx.filter = 'brightness(1.1) contrast(1.06) saturate(1.05)'; // le foto in sala sono scure
    ctx.drawImage(pic, -w * s / 2, -h * s / 2, w * s, h * s);
    ctx.filter = 'none';
    ctx.restore();
  } else { ctx.fillStyle = C.carta; ctx.fillRect(-box / 2, -box / 2, box, box); }
  ctx.fillStyle = C.inchiostro;
  // timbro centrato sul bordo bianco sotto la foto: tocca appena il fondo della foto
  if (gen?.timbro) stamp(ctx, gen.timbro, 0, box / 2 + 62, seed, { size: 40, maxW: 560, rot: -0.05 });
  ctx.restore();

  // dati, come su un documento vero
  const dw = 920, dx = (W - dw) / 2;
  let dy = cy + box / 2 + 120 + 50;
  const dh = 270;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(dx + 10, dy + 10, dw, dh);
  ctx.fillStyle = '#fff'; ctx.fillRect(dx, dy, dw, dh);
  ctx.textAlign = 'left';
  ctx.font = `800 26px ${F}`; ctx.fillStyle = '#6b6575'; ctx.fillText('NOME', dx + 44, dy + 52);
  ctx.fillStyle = C.inchiostro; fitText(ctx, NICK, dx + 44, dy + 112, dw - 88, 58);
  ctx.fillStyle = '#e4e1e8'; ctx.fillRect(dx + 30, dy + 136, dw - 60, 3);
  const ry = dy + 100;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(dx + 300, ry + 64, 4, 170 - 92);
  ctx.font = `800 26px ${F}`; ctx.fillStyle = '#6b6575';
  ctx.fillText('ANNO', dx + 44, ry + 62); ctx.fillText('GENERAZIONE', dx + 344, ry + 62);
  ctx.fillStyle = C.inchiostro; ctx.font = `900 64px ${F}`;
  ctx.fillText(String(year || ''), dx + 44, ry + 134, 230);
  ctx.fillStyle = C.viola;
  fitText(ctx, (gen?.nome || '').toUpperCase(), dx + 344, ry + 134, dw - 380, 64);
  dy += dh;

  // in fondo, dal basso: data di rilascio, sopra il logo; la frase sta nello spazio che resta
  const issuedY = H - 56, lh = 130;
  const logoTop = issuedY - 46 - lh;
  const logo = await loadImage('/img/logo.webp');
  if (logo) { const lw = lh * logo.width / logo.height; ctx.drawImage(logo, W / 2 - lw / 2, logoTop, lw, lh); }
  const d = new Date();
  const issued = `Rilasciata il ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} · ${cfg.show.titolo || ''}`;
  ctx.textAlign = 'center';
  ctx.font = `700 26px ${F}`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(issued, W / 2, issuedY, 960);

  // frase ironica, centrata tra i dati e il logo; se è lunga il carattere si riduce
  const top = dy + 40, bottom = logoTop - 36;
  let fs = 38, tl;
  for (; fs >= 28; fs -= 2) { ctx.font = `800 ${fs}px ${F}`; tl = lines(ctx, gen?.testo || '', 880); if (tl.length * fs * 1.3 <= bottom - top) break; }
  const tlh = Math.round(fs * 1.3), blockH = tl.length * tlh;
  const ty = top + Math.max(0, (bottom - top - blockH) / 2) + fs;
  ctx.fillStyle = '#fff';
  tl.forEach((l, i) => ctx.fillText(l, W / 2, ty + i * tlh));
  ctx.textAlign = 'left';
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

/** Timbro a inchiostro, leggermente consumato (disegnato su un livello a parte). */
function stamp(ctx, text, x, y, seed, { size = 44, maxW = 380, rot = -0.22 } = {}) {
  const r = rng(seed + 99);
  const L = document.createElement('canvas'); L.width = maxW + 200; L.height = 420;
  const c = L.getContext('2d');
  c.translate(L.width / 2, L.height / 2);
  c.font = `900 ${size}px ${F}`;
  const words = text.split(' ');
  const lines = [];
  let l = '';
  for (const w of words) { const t = l ? `${l} ${w}` : w; if (c.measureText(t).width > maxW && l) { lines.push(l); l = w; } else l = t; }
  if (l) lines.push(l);
  const tw = Math.max(...lines.map((s) => c.measureText(s).width));
  const lh = Math.round(size * 1.22), bw = tw + size * 2, bh = lines.length * lh + size * 1.45;
  const col = '#d6186b';
  c.strokeStyle = col; c.lineWidth = 9; c.strokeRect(-bw / 2, -bh / 2, bw, bh);
  c.lineWidth = 3; c.strokeRect(-bw / 2 + 12, -bh / 2 + 12, bw - 24, bh - 24);
  c.fillStyle = col; c.textAlign = 'center';
  lines.forEach((s, i) => c.fillText(s, 0, -bh / 2 + size * 0.72 + size * 0.92 + i * lh));
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 110; i++) { c.beginPath(); c.arc((r() - 0.5) * bw, (r() - 0.5) * bh, r() * 2.4, 0, Math.PI * 2); c.fill(); }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillRect(-bw / 2, -bh / 2, bw, bh); // fondo pulito, leggibile anche su foto scure
  ctx.globalAlpha = 0.92;
  ctx.drawImage(L, -L.width / 2, -L.height / 2);
  ctx.restore();
}
