// Decorazioni Cult Pop disegnate su canvas (card profilo e scoreboard LED).
// Generatore pseudo-casuale con seme: stessa immagine a ogni rendering.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const C = {
  viola: '#8a2bf8', lime: '#d2fd3a', fucsia: '#fd7dff', turchese: '#3cbf9e', giallo: '#fbcf2c',
  ardesia: '#2c4a55', carta: '#d8d6d3', cartaBlu: '#c6d3dc', cartaGrigia: '#a9a8a5', inchiostro: '#17121f',
};

/** Fondo collage di carta strappata */
export function paper(ctx, w, h, seed = 7) {
  const r = rng(seed);
  ctx.fillStyle = C.carta;
  ctx.fillRect(0, 0, w, h);
  const tones = [C.cartaBlu, '#e4e2de', C.cartaGrigia, '#cfcdc9', C.cartaBlu, '#bfbdb9'];
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.globalAlpha = 0.65 + r() * 0.35;
    tornPoly(ctx, r() * w - w * 0.2, r() * h - h * 0.15, w * (0.4 + r() * 0.6), h * (0.12 + r() * 0.25), r() * 0.5 - 0.25, r);
  }
  ctx.globalAlpha = 1;
  // grana
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < (w * h) / 900; i++) {
    ctx.fillStyle = r() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(r() * w, r() * h, 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function tornPoly(ctx, x, y, w, h, rot, r) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rot);
  ctx.beginPath();
  const step = Math.max(10, w / 40);
  ctx.moveTo(-w / 2, -h / 2);
  for (let px = -w / 2; px <= w / 2; px += step) ctx.lineTo(px, -h / 2 + (r() - 0.5) * step * 1.4);
  for (let py = -h / 2; py <= h / 2; py += step) ctx.lineTo(w / 2 + (r() - 0.5) * step, py);
  for (let px = w / 2; px >= -w / 2; px -= step) ctx.lineTo(px, h / 2 + (r() - 0.5) * step * 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Pennellata viola come nella sigla */
export function brush(ctx, x, y, w, h, color = C.viola, seed = 3) {
  const r = rng(seed);
  ctx.fillStyle = color;
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const yy = y + (h / rows) * i;
    const off = (r() - 0.5) * w * 0.06;
    ctx.beginPath();
    ctx.moveTo(x + off, yy);
    for (let k = 0; k <= 30; k++) ctx.lineTo(x + off + (w / 30) * k, yy + (r() - 0.5) * 6);
    for (let k = 30; k >= 0; k--) ctx.lineTo(x + off + (w / 30) * k + (r() - 0.5) * 4, yy + h / rows + 4 + (r() - 0.5) * 8);
    ctx.closePath();
    ctx.fill();
  }
  // sfilacciature
  for (let i = 0; i < 18; i++) {
    const yy = y + r() * h;
    const len = 20 + r() * w * 0.12;
    const left = r() > 0.5;
    ctx.fillRect(left ? x - len * 0.6 : x + w - len * 0.4, yy, len, 2 + r() * 4);
  }
}

/** Scarabocchio a zig-zag */
export function scribble(ctx, x, y, w, h, color = C.lime, lw = 10, seed = 5) {
  const r = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = 9;
  ctx.moveTo(x, y + h * (0.5 + (r() - 0.5) * 0.6));
  for (let i = 1; i <= n; i++) ctx.lineTo(x + (w / n) * i, i % 2 ? y + r() * h * 0.3 : y + h * (0.7 + r() * 0.3));
  ctx.stroke();
}

export function plus(ctx, x, y, s, color = C.fucsia, lw = 5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
  ctx.stroke();
}

/** Badge stile logo (SEGNAPOSTO finché non arriva il logo ufficiale) */
export function badge(ctx, x, y, size, F) {
  const words = ['CULT', 'POP'];
  ctx.font = `900 ${size}px ${F}`;
  words.forEach((wd, i) => {
    const tw = ctx.measureText(wd).width;
    const bx = x + i * size * 0.7, by = y + i * size * 1.25;
    const bw = tw + size * 0.6, bh = size * 1.1;
    ctx.fillStyle = C.giallo; ctx.fillRect(bx + size * 0.18, by + size * 0.18, bw, bh);
    ctx.fillStyle = C.ardesia; ctx.fillRect(bx + size * 0.09, by + size * 0.09, bw, bh);
    ctx.fillStyle = '#fff'; ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
    ctx.fillStyle = C.turchese; ctx.fillRect(bx, by, bw, bh);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ardesia; ctx.fillText(wd, bx + size * 0.32, by + bh / 2 + size * 0.07);
    ctx.fillStyle = C.giallo; ctx.fillText(wd, bx + size * 0.28, by + bh / 2 + size * 0.03);
  });
}

/** Testo a capo automatico; restituisce la y finale */
export function wrap(ctx, text, x, y, maxW, lh, align = 'left') {
  const words = String(text).split(/\s+/);
  let line = '';
  const lines = [];
  for (const wd of words) {
    const t = line ? `${line} ${wd}` : wd;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = wd; } else line = t;
  }
  if (line) lines.push(line);
  ctx.textAlign = align;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  ctx.textAlign = 'left';
  return y + lines.length * lh;
}

export function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function fontsReady(F = 'Archivo') {
  try {
    await Promise.all([document.fonts.load(`900 64px ${F}`), document.fonts.load(`700 32px ${F}`), document.fonts.load(`800 32px ${F}`)]);
  } catch { /* fallback ai font di sistema */ }
}
