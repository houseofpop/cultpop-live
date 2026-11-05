// Card verticale 1080x1920 del profilo romcom, generata sul telefono (nessun carico sul server).
import { C, paper, brush, scribble, plus, badge, wrap, loadImage, fontsReady, rng } from './deco.js';

const F = 'Archivo, system-ui, sans-serif';

export async function makeCard({ profile, recap, fav, cfg, nick, gen }) {
  await fontsReady();
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const seed = [...profile.id].reduce((a, c) => a + c.charCodeAt(0), 11);

  paper(ctx, W, H, seed);
  const hero = await loadImage('/img/sigla-hero.webp');
  if (hero) {
    // striscia della sigla in alto con bordo strappato
    ctx.save();
    ctx.beginPath();
    const r = rng(seed + 1);
    ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, 560);
    for (let x = W; x >= 0; x -= 36) ctx.lineTo(x, 560 + (r() - 0.5) * 34);
    ctx.closePath();
    ctx.clip();
    const s = Math.max(W / hero.width, 600 / hero.height);
    ctx.drawImage(hero, (W - hero.width * s) / 2, -20, hero.width * s, hero.height * s);
    ctx.restore();
  }

  scribble(ctx, 60, 600, 320, 90, C.lime, 14, seed);
  plus(ctx, 960, 640, 26);
  plus(ctx, 110, 1700, 22);

  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 46px ${F}`;
  const who = nick ? `LA ROM-COM DI ${String(nick).toUpperCase()} È` : 'LA MIA ROM-COM È';
  ctx.fillText(who, 80, 760, 920);

  // titolo del profilo su pennellata col colore del profilo
  brush(ctx, 40, 800, 1000, 380, C.viola, seed + 2);
  ctx.fillStyle = '#fff';
  ctx.font = `900 104px ${F}`;
  const endY = wrap(ctx, profile.titolo.toUpperCase(), W / 2, 930, 900, 110, 'center');

  // etichetta colore
  ctx.fillStyle = profile.colore || C.lime;
  ctx.fillRect(80, Math.max(endY + 40, 1220), 160, 18);

  ctx.fillStyle = C.inchiostro;
  ctx.font = `700 44px ${F}`;
  let y = wrap(ctx, profile.descrizione, 80, Math.max(endY + 120, 1300), 920, 58);

  if (gen) {
    y += 24;
    ctx.font = `900 34px ${F}`;
    const gt = gen.nome.toUpperCase();
    const gw = ctx.measureText(gt).width;
    ctx.fillStyle = gen.colore || C.lime;
    ctx.fillRect(80, y, gw + 40, 60);
    ctx.strokeStyle = C.inchiostro; ctx.lineWidth = 4; ctx.strokeRect(80, y, gw + 40, 60);
    ctx.fillStyle = C.inchiostro;
    ctx.fillText(gt, 100, y + 42);
    y += 70;
  }
  if (recap?.taps || fav) {
    y += 30;
    ctx.font = `800 36px ${F}`;
    ctx.fillStyle = C.inchiostro;
    const bits = [];
    if (recap?.taps) bits.push(`${recap.taps} reazioni`);
    if (fav) bits.push(`tifo per ${fav.nome}`);
    ctx.fillStyle = '#fff';
    const txt = bits.join(' · ').toUpperCase();
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = C.inchiostro;
    ctx.fillRect(80, y, tw + 40, 64);
    ctx.fillStyle = C.lime;
    ctx.fillText(txt, 100, y + 45);
  }

  // piede
  const logo = await loadImage('/img/logo.webp');
  if (logo) ctx.drawImage(logo, 70, 1590, 210, 210 * logo.height / logo.width);
  else badge(ctx, 80, 1640, 54, F);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.inchiostro;
  ctx.font = `900 34px ${F}`;
  ctx.fillText(cfg.show.instagramHandle || '', W - 80, 1730);
  ctx.font = `700 28px ${F}`;
  ctx.fillText(cfg.show.titolo, W - 80, 1780);
  ctx.fillText(cfg.show.sottotitolo, W - 80, 1820);
  ctx.textAlign = 'left';

  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
