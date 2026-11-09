// Card verticale 1080x1920 della Rom-Com, generata sul telefono (nessun carico sul server).
import { C, paper, brush, scribble, plus, wrap, loadImage, fontsReady } from './deco.js';

const F = 'Archivo, system-ui, sans-serif';

export async function makeCard({ profile, cfg, nick }) {
  await fontsReady();
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const seed = [...profile.id].reduce((a, c) => a + c.charCodeAt(0), 11);
  paper(ctx, W, H, seed);
  scribble(ctx, 70, 1560, 300, 90, C.lime, 14, seed);
  plus(ctx, 980, 330, 26);
  plus(ctx, 110, 1180, 22);

  // logo piccolo
  const logo = await loadImage('/img/logo.webp');
  if (logo) ctx.drawImage(logo, 70, 60, 120, 120 * logo.height / logo.width);

  // intestazione
  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 50px ${F}`;
  ctx.textAlign = 'center';
  const who = nick ? `LA ROM-COM DEL CUORE DI ${String(nick).toUpperCase()} È:` : 'LA MIA ROM-COM DEL CUORE È:';
  wrap(ctx, who, W / 2, 290, 900, 60, 'center');

  // locandina incorniciata e leggermente ruotata
  const poster = await loadImage(profile.locandina?.startsWith('data:') || profile.locandina?.startsWith('/') ? profile.locandina : '/' + profile.locandina);
  const pw = 540, ph = 810, px = (W - pw) / 2, py = 400;
  ctx.save();
  ctx.translate(W / 2, py + ph / 2);
  ctx.rotate(-0.025);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(-pw / 2 + 18, -ph / 2 + 18, pw + 24, ph + 24);
  ctx.fillStyle = '#fff'; ctx.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
  if (poster) ctx.drawImage(poster, -pw / 2, -ph / 2, pw, ph);
  ctx.lineWidth = 6; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
  ctx.restore();

  // titolo del film su pennellata
  ctx.font = `900 76px ${F}`;
  const title = profile.titolo.toUpperCase();
  const lines = [];
  { const words = title.split(' '); let l = ''; for (const w of words) { const t = l ? `${l} ${w}` : w; if (ctx.measureText(t).width > 880 && l) { lines.push(l); l = w; } else l = t; } if (l) lines.push(l); }
  const ty = py + ph + 70;
  brush(ctx, 60, ty, 960, 70 + lines.length * 84, C.viola, seed + 2);
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, ty + 92 + i * 84));
  let y = ty + 70 + lines.length * 84 + 50;
  if (profile.anno) {
    ctx.font = `900 34px ${F}`;
    const yr = `(${profile.anno})`;
    const yw = ctx.measureText(yr).width + 40;
    ctx.fillStyle = C.lime; ctx.fillRect(W / 2 - yw / 2, y - 40, yw, 56);
    ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 4; ctx.strokeRect(W / 2 - yw / 2, y - 40, yw, 56);
    ctx.fillStyle = C.inchiostro; ctx.fillText(yr, W / 2, y);
    y += 70;
  }
  // descrizione
  ctx.fillStyle = C.inchiostro;
  ctx.font = `700 38px ${F}`;
  wrap(ctx, profile.descrizione, W / 2, y, 900, 50, 'center');

  // solo il nostro @
  ctx.font = `900 42px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText(cfg.show.instagramHandle || '', W / 2, H - 70);
  ctx.textAlign = 'left';
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
