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
  const r = rng(seed);

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

  // foto in polaroid
  const box = 660, py = 360;
  ctx.save();
  ctx.translate(W / 2, py + box / 2 + 30);
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
  ctx.font = `900 54px ${F}`;
  ctx.fillText(String(nick || '').toUpperCase(), 0, box / 2 + 82, box);
  ctx.restore();
  if (gen?.timbro) stamp(ctx, gen.timbro, 820, 450, seed);

  // dati affiancati, come su un documento vero
  const dy = 1210, dw = 920, dh = 170, dx = (W - dw) / 2;
  ctx.fillStyle = C.inchiostro; ctx.fillRect(dx + 10, dy + 10, dw, dh);
  ctx.fillStyle = '#fff'; ctx.fillRect(dx, dy, dw, dh);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(dx + 300, dy + 28, 4, dh - 56);
  ctx.textAlign = 'left';
  ctx.font = `800 26px ${F}`; ctx.fillStyle = '#6b6575';
  ctx.fillText('ANNO', dx + 44, dy + 62); ctx.fillText('GENERAZIONE', dx + 344, dy + 62);
  ctx.fillStyle = C.inchiostro; ctx.font = `900 68px ${F}`;
  ctx.fillText(String(year || ''), dx + 44, dy + 134, 230);
  ctx.fillStyle = C.viola;
  ctx.fillText((gen?.nome || '').toUpperCase(), dx + 344, dy + 134, dw - 380);

  // frase ironica
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `800 38px ${F}`;
  const endY = wrap(ctx, gen?.testo || '', W / 2, dy + dh + 100, 860, 50, 'center');

  // rilascio + logo al centro in basso
  const d = new Date();
  const issued = `Rilasciata il ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} · ${cfg.show.titolo || ''}`;
  ctx.textAlign = 'center'; // wrap() riporta l'allineamento a sinistra
  ctx.font = `700 26px ${F}`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(issued, W / 2, Math.max(endY + 40, 1660), 960);
  const logo = await loadImage('/img/logo.webp');
  if (logo) { const lh = 170, lw = lh * logo.width / logo.height; ctx.drawImage(logo, W / 2 - lw / 2, H - lh - 50, lw, lh); }
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
  const bw = tw + 90, bh = lines.length * 54 + 64;
  const col = '#d6186b';
  c.strokeStyle = col; c.lineWidth = 9; c.strokeRect(-bw / 2, -bh / 2, bw, bh);
  c.lineWidth = 3; c.strokeRect(-bw / 2 + 12, -bh / 2 + 12, bw - 24, bh - 24);
  c.fillStyle = col; c.textAlign = 'center';
  lines.forEach((s, i) => c.fillText(s, 0, -bh / 2 + 72 + i * 54));
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 110; i++) { c.beginPath(); c.arc((r() - 0.5) * bw, (r() - 0.5) * bh, r() * 2.4, 0, Math.PI * 2); c.fill(); }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.22);
  ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillRect(-bw / 2, -bh / 2, bw, bh); // fondo pulito, leggibile anche su foto scure
  ctx.globalAlpha = 0.92;
  ctx.drawImage(L, -L.width / 2, -L.height / 2);
  ctx.restore();
}
