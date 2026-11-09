// Card verticale 1080x1920 della Rom-Com, generata sul telefono (nessun carico sul server).
// L'impaginazione si calcola sulla lunghezza di titolo e descrizione: niente sovrapposizioni.
import { C, paper, brush, plus, loadImage, fontsReady } from './deco.js';

const F = 'Archivo, system-ui, sans-serif';
const W = 1080, H = 1920;

/** Divide un testo in righe che stanno in maxW (con il font già impostato su ctx). */
function lines(ctx, text, maxW) {
  const out = [];
  let l = '';
  for (const w of String(text).split(/\s+/)) {
    const t = l ? `${l} ${w}` : w;
    if (ctx.measureText(t).width > maxW && l) { out.push(l); l = w; } else l = t;
  }
  if (l) out.push(l);
  return out;
}

/** Su due righe, divide il titolo nel punto più equilibrato (niente parola sola a capo). */
function balance(ctx, text, maxW) {
  const base = lines(ctx, text, maxW);
  if (base.length !== 2) return base;
  const words = String(text).split(/\s+/);
  let best = base, bestW = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (w <= maxW && w < bestW) { bestW = w; best = [a, b]; }
  }
  return best;
}

export async function makeCard({ profile, cfg, nick }) {
  await fontsReady();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const seed = [...profile.id].reduce((a, c) => a + c.charCodeAt(0), 11);
  paper(ctx, W, H, seed);
  plus(ctx, 990, 250, 24);
  plus(ctx, 90, 1180, 20);

  const logo = await loadImage('/img/logo.webp');
  if (logo) ctx.drawImage(logo, 60, 50, 120, 120 * logo.height / logo.width);

  // misure del testo, prima di disegnare
  ctx.font = `900 50px ${F}`;
  const who = nick ? `LA ROM-COM DEL CUORE DI ${String(nick).toUpperCase()} È:` : 'LA MIA ROM-COM DEL CUORE È:';
  const whoL = lines(ctx, who, 880);
  ctx.font = `900 72px ${F}`;
  const titleL = balance(ctx, profile.titolo.toUpperCase(), 860);
  let descFont = 38;
  ctx.font = `700 ${descFont}px ${F}`;
  let descL = lines(ctx, profile.descrizione, 880);
  if (descL.length > 5) { descFont = 34; ctx.font = `700 ${descFont}px ${F}`; descL = lines(ctx, profile.descrizione, 900); }
  const descLH = Math.round(descFont * 1.32);

  // spazio verticale: dall'alto verso il basso, la locandina prende quello che resta
  const headTop = 230, headH = whoL.length * 60;
  const titleH = titleL.length * 84 + 60;
  const yearH = profile.anno ? 80 : 0;
  const descH = descL.length * descLH;
  const footer = 150; // @cultpop.it in fondo
  const gaps = 40 + 60 + 26 + 36;
  const ph = Math.max(520, Math.min(780, H - headTop - headH - titleH - yearH - descH - footer - gaps));
  const pw = Math.round(ph * 2 / 3);

  // intestazione
  ctx.fillStyle = C.inchiostro;
  ctx.textAlign = 'center';
  ctx.font = `900 50px ${F}`;
  whoL.forEach((l, i) => ctx.fillText(l, W / 2, headTop + 46 + i * 60));
  let y = headTop + headH + 40;

  // locandina incorniciata e leggermente ruotata
  const src = profile.locandina?.startsWith('data:') || profile.locandina?.startsWith('/') ? profile.locandina : '/' + profile.locandina;
  const poster = await loadImage(src);
  ctx.save();
  ctx.translate(W / 2, y + ph / 2);
  ctx.rotate(-0.025);
  ctx.fillStyle = C.inchiostro; ctx.fillRect(-pw / 2 + 18, -ph / 2 + 18, pw + 24, ph + 24);
  ctx.fillStyle = '#fff'; ctx.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
  if (poster) ctx.drawImage(poster, -pw / 2, -ph / 2, pw, ph);
  ctx.lineWidth = 6; ctx.strokeStyle = C.inchiostro; ctx.strokeRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 24);
  ctx.restore();
  y += ph + 60;

  // titolo del film su pennellata, centrato
  brush(ctx, 70, y, W - 140, titleH, C.viola, seed + 2);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `900 72px ${F}`;
  titleL.forEach((l, i) => ctx.fillText(l, W / 2, y + 30 + 70 + i * 84, W - 200));
  y += titleH + 26;

  // anno su etichetta lime, centrato
  if (profile.anno) {
    ctx.font = `900 34px ${F}`;
    const yr = String(profile.anno);
    const yw = ctx.measureText(yr).width + 44;
    ctx.fillStyle = C.inchiostro; ctx.fillRect(W / 2 - yw / 2 + 6, y + 6, yw, 54);
    ctx.fillStyle = C.lime; ctx.fillRect(W / 2 - yw / 2, y, yw, 54);
    ctx.fillStyle = C.inchiostro; ctx.textAlign = 'center';
    ctx.fillText(yr, W / 2, y + 39);
    y += yearH;
  }

  // descrizione, centrata
  y += 36;
  ctx.fillStyle = C.inchiostro;
  ctx.textAlign = 'center';
  ctx.font = `700 ${descFont}px ${F}`;
  descL.forEach((l, i) => ctx.fillText(l, W / 2, y + i * descLH));

  // solo il nostro @, sempre in fondo e mai sovrapposto
  ctx.font = `900 42px ${F}`;
  ctx.textAlign = 'center';
  ctx.fillText(cfg.show.instagramHandle || '', W / 2, H - 70);
  ctx.textAlign = 'left';
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
