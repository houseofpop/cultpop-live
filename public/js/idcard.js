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

export async function makeIdCard({ nick, year, gen, photo, cfg }) {
  await fontsReady();
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const seed = (year || 2000) + (nick || '').length * 7;
  paper(ctx, W, H, seed);
  scribble(ctx, 760, 1640, 260, 90, C.lime, 14, seed);
  plus(ctx, 990, 250, 24);
  plus(ctx, 80, 1290, 22);

  const logo = await loadImage('/img/logo.webp');
  if (logo) ctx.drawImage(logo, 50, 50, 115, 115 * logo.height / logo.width);

  // titolo
  ctx.textAlign = 'center';
  brush(ctx, 240, 70, 790, 150, C.viola, 4);
  ctx.fillStyle = '#fff';
  ctx.font = `900 76px ${F}`;
  ctx.fillText("CARTA D'IDENTITÀ", 635, 172, 720);
  ctx.font = `900 40px ${F}`;
  const sub = 'GENERAZIONALE';
  const sw = ctx.measureText(sub).width + 50;
  ctx.fillStyle = C.lime; ctx.fillRect(620 - sw / 2, 240, sw, 64);
  ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 5; ctx.strokeRect(620 - sw / 2, 240, sw, 64);
  ctx.fillStyle = C.inchiostro; ctx.fillText(sub, 620, 287);

  // foto (o, senza foto, l'immagine della generazione) in una polaroid
  const box = 640, bx = (W - box) / 2, by = 370;
  ctx.save();
  ctx.translate(W / 2, by + box / 2 + 40);
  ctx.rotate(-0.03);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(-box / 2 - 10, -box / 2 - 10, box + 60, box + 140);
  ctx.fillStyle = '#fff'; ctx.fillRect(-box / 2 - 30, -box / 2 - 30, box + 60, box + 140);
  ctx.lineWidth = 6; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(-box / 2 - 30, -box / 2 - 30, box + 60, box + 140);
  let pic = photo;
  if (!pic && gen?.immagine) pic = await loadImage(src(gen.immagine));
  if (pic) {
    const w = pic.width || pic.naturalWidth, h = pic.height || pic.naturalHeight;
    const s = Math.max(box / w, box / h);
    ctx.save();
    ctx.beginPath(); ctx.rect(-box / 2, -box / 2, box, box); ctx.clip();
    if (photo) ctx.filter = 'brightness(1.12) contrast(1.06) saturate(1.05)'; // le foto in sala sono scure
    ctx.drawImage(pic, -w * s / 2, -h * s / 2, w * s, h * s);
    ctx.filter = 'none';
    ctx.restore();
  } else { ctx.fillStyle = C.carta; ctx.fillRect(-box / 2, -box / 2, box, box); }
  ctx.lineWidth = 4; ctx.strokeRect(-box / 2, -box / 2, box, box);
  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 46px ${F}`;
  ctx.fillText(String(nick || '').toUpperCase(), 0, box / 2 + 70, box);
  ctx.restore();

  // dati
  const fy = 1180;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(98, fy + 8, 900, 300);
  ctx.fillStyle = '#fff'; ctx.fillRect(90, fy, 900, 300);
  ctx.lineWidth = 5; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(90, fy, 900, 300);
  ctx.textAlign = 'left';
  const row = (label, value, yy, color) => {
    ctx.font = `800 26px ${F}`; ctx.fillStyle = '#4b4553'; ctx.fillText(label, 130, yy);
    ctx.font = `900 54px ${F}`; ctx.fillStyle = color || C.inchiostro; ctx.fillText(value, 130, yy + 56, 820);
  };
  row('ANNO DI NASCITA', String(year || ''), fy + 60);
  row('GENERAZIONE', (gen?.nome || '').toUpperCase(), fy + 190, C.viola);

  // frase ironica
  ctx.fillStyle = C.inchiostro;
  ctx.font = `800 36px ${F}`;
  ctx.textAlign = 'center';
  wrap(ctx, `«${gen?.testo || ''}»`, W / 2, fy + 380, 900, 46, 'center');

  // timbro
  if (gen?.timbro) stamp(ctx, gen.timbro, 800, 470, seed); // sull'angolo della foto, come un vero timbro

  ctx.textAlign = 'center';
  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 40px ${F}`;
  ctx.fillText(cfg.show.instagramHandle || '', W / 2, H - 60);
  ctx.textAlign = 'left';
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

/** Timbro a inchiostro, leggermente consumato (disegnato su un livello a parte). */
function stamp(ctx, text, x, y, seed) {
  const r = rng(seed + 99);
  const L = document.createElement('canvas'); L.width = 560; L.height = 380;
  const c = L.getContext('2d');
  c.translate(L.width / 2, L.height / 2);
  c.font = `900 44px ${F}`;
  const words = text.split(' ');
  const lines = [];
  let l = '';
  for (const w of words) { const t = l ? `${l} ${w}` : w; if (c.measureText(t).width > 380 && l) { lines.push(l); l = w; } else l = t; }
  if (l) lines.push(l);
  const tw = Math.max(...lines.map((s) => c.measureText(s).width));
  const bw = tw + 70, bh = lines.length * 52 + 46;
  const col = '#d6186b';
  c.fillStyle = 'rgba(255,255,255,.82)'; c.fillRect(-bw / 2, -bh / 2, bw, bh); // leggibile anche su foto scure
  c.strokeStyle = col; c.lineWidth = 9; c.strokeRect(-bw / 2, -bh / 2, bw, bh);
  c.lineWidth = 3; c.strokeRect(-bw / 2 + 12, -bh / 2 + 12, bw - 24, bh - 24);
  c.fillStyle = col; c.textAlign = 'center';
  lines.forEach((s, i) => c.fillText(s, 0, -bh / 2 + 62 + i * 52));
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) { c.beginPath(); c.arc((r() - 0.5) * bw, (r() - 0.5) * bh, r() * 3.2, 0, Math.PI * 2); c.fill(); }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.22);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(L, -L.width / 2, -L.height / 2);
  ctx.restore();
}
