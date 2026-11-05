import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig } from './config.js';
import { ShowEngine } from './engine.js';
import QRCode from 'qrcode';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const CONFIG_PATH = process.env.SHOW_CONFIG || join(ROOT, 'config', 'show.json');
mkdirSync(DATA_DIR, { recursive: true });

// ---------- segreti ----------
const PROD = process.env.NODE_ENV === 'production';
// online le password sono obbligatorie: meglio non partire che partire con quelle di prova
if (PROD && (!process.env.ADMIN_PASSWORD || !process.env.SCREEN_KEY || process.env.ADMIN_PASSWORD.length < 12)) {
  console.error('❌ In produzione servono ADMIN_PASSWORD (almeno 12 caratteri) e SCREEN_KEY. Il server non parte.');
  process.exit(1);
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cultpop-dev';
const SCREEN_KEY = process.env.SCREEN_KEY || 'schermo-dev';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD non impostata: uso "cultpop-dev" (solo per sviluppo!)');
if (!process.env.SCREEN_KEY) console.warn('⚠️  SCREEN_KEY non impostata: uso "schermo-dev" (solo per sviluppo!)');
// il segreto che firma le sessioni del pubblico deve sopravvivere ai riavvii
const secretFile = join(DATA_DIR, 'session-secret.txt');
const SESSION_SECRET = process.env.SESSION_SECRET || (existsSync(secretFile)
  ? readFileSync(secretFile, 'utf8').trim()
  : (() => { const s = randomBytes(32).toString('hex'); writeFileSync(secretFile, s); return s; })());

const sign = (sid) => createHmac('sha256', SESSION_SECRET).update(sid).digest('base64url').slice(0, 22);
const makeToken = (sid) => `${sid}.${sign(sid)}`;
function readToken(token) {
  if (typeof token !== 'string') return null;
  const [sid, sig] = token.split('.');
  if (!sid || !sig || sid.length > 40) return null;
  const good = sign(sid);
  return sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? sid : null;
}
const safeEq = (a, b) => {
  const A = Buffer.from(String(a ?? '')), B = Buffer.from(String(b ?? ''));
  return A.length === B.length && timingSafeEqual(A, B);
};

// ---------- show: live e prova, separati ----------
const config = loadConfig(CONFIG_PATH);
const pubConfig = publicConfig(config);
const SHOW_IDS = ['live', 'prova'];
// indirizzo pubblico del sito (quello del QR code). Esempio: https://live.cultpop.it
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const QR = {};
for (const id of SHOW_IDS) {
  const url = id === 'live' ? `${PUBLIC_URL}/` : `${PUBLIC_URL}/?show=prova`;
  QR[id] = { url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#17121f', light: '#ffffff' } }) };
}
const engines = {};
for (const id of SHOW_IDS) {
  const e = new ShowEngine(config, id);
  const file = join(DATA_DIR, `${id}.json`);
  if (existsSync(file)) {
    try { e.load(JSON.parse(readFileSync(file, 'utf8'))); console.log(`↺ stato "${id}" ripristinato da disco`); }
    catch (err) { console.error(`Impossibile leggere ${file}:`, err.message); }
  }
  engines[id] = e;
}
const showOf = (v) => (SHOW_IDS.includes(v) ? v : 'live');

function persist(e) {
  if (!e.dirty) return;
  e.dirty = false;
  const file = join(DATA_DIR, `${e.showId}.json`);
  const tmp = `${file}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(e.toJSON())); renameSync(tmp, file); }
  catch (err) { e.dirty = true; console.error('Salvataggio fallito:', err.message); }
}

function resetShow(id) {
  const e = new ShowEngine(config, id);
  e.log('Show azzerato');
  e.touch();
  engines[id] = e;
  persist(e);
  return e;
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // dietro il proxy di Render
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  // regia e pagina LED non vanno indicizzate né incorporate in altri siti
  if (/^\/(regia|schermo)/.test(req.path)) { res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); }
  next();
});
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /regia\nDisallow: /schermo\n'));
app.use('/fonts/archivo', express.static(join(ROOT, 'node_modules/@fontsource/archivo'), { maxAge: '30d', immutable: true }));
app.use(express.static(join(ROOT, 'public'), {
  extensions: ['html'],
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=300');
  },
}));
app.get('/api/config', (_req, res) => res.json(pubConfig));
app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime(), shows: Object.fromEntries(SHOW_IDS.map((id) => [id, { mode: engines[id].s.mode, open: engines[id].s.open }])) }));

const http = createServer(app);
const io = new Server(http, {
  pingInterval: 10000,
  pingTimeout: 8000,
  maxHttpBufferSize: 16 * 1024,
  cors: { origin: false },
});

// ---------- PUBBLICO ----------
io.on('connection', (socket) => {
  const showId = showOf(socket.handshake.auth?.show);
  const engine = () => engines[showId];
  let sid = readToken(socket.handshake.auth?.token);
  if (!sid) sid = randomUUID().replace(/-/g, '').slice(0, 20);
  socket.data.sid = sid;
  socket.join(`pub:${showId}`);
  engine().ensureSession(sid);

  socket.emit('welcome', { token: makeToken(sid), serverNow: Date.now(), config: pubConfig, state: engine().publicState(), me: engine().personal(sid), showId });

  // anti-flood per socket: max ~8 messaggi/secondo, il resto viene ignorato in silenzio
  let win = Date.now(), count = 0;
  const flood = () => {
    const t = Date.now();
    if (t - win > 1000) { win = t; count = 0; }
    return ++count > 8;
  };

  socket.on('time', (_x, ack) => typeof ack === 'function' && ack(Date.now()));
  socket.on('react', (msg) => { if (!flood()) engine().react(sid, msg?.b); });
  socket.on('ab', (msg, ack) => {
    if (flood() || typeof ack !== 'function') return;
    ack(engine().answerAB(sid, msg?.qid, msg?.choice));
  });
  socket.on('profile', (msg, ack) => {
    if (flood() || typeof ack !== 'function') return;
    ack(engine().setProfile(sid, msg?.nick, msg?.year));
  });
  socket.on('sos', (msg, ack) => {
    if (flood() || typeof ack !== 'function') return;
    ack(engine().voteSos(sid, msg?.runId, msg?.idx));
  });
  socket.on('me', (_x, ack) => typeof ack === 'function' && ack(engine().personal(sid)));
});

// ---------- SCHERMO (LED) ----------
const screenNs = io.of('/schermo');
screenNs.use((socket, next) => (safeEq(socket.handshake.auth?.key, SCREEN_KEY) ? next() : next(new Error('chiave schermo errata'))));
screenNs.on('connection', (socket) => {
  const showId = showOf(socket.handshake.auth?.show);
  socket.join(showId);
  socket.emit('screen', { config: pubConfig, qr: QR[showId], serverNow: Date.now(), state: engines[showId].screenState() });
});

// ---------- REGIA ----------
const adminNs = io.of('/regia');
const failed = new Map(); // ip -> {n, until}
adminNs.use((socket, next) => {
  // indirizzo reale del visitatore (dietro Render tutti arrivano dallo stesso proxy)
  const ip = String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address).split(',')[0].trim();
  const f = failed.get(ip);
  if (f && f.until > Date.now()) return next(new Error('troppi tentativi, riprova tra un minuto'));
  if (safeEq(socket.handshake.auth?.password, ADMIN_PASSWORD)) { failed.delete(ip); return next(); }
  const n = (f?.n || 0) + 1;
  failed.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
  next(new Error('password errata'));
});

adminNs.on('connection', (socket) => {
  let showId = showOf(socket.handshake.auth?.show);
  socket.join(showId);
  socket.emit('admin:init', { config, pubConfig, screenKey: SCREEN_KEY, shows: SHOW_IDS, qr: QR });
  socket.emit('admin:state', adminSnapshot(showId));

  const commands = {
    open: (e, a) => e.setOpen(a.open),
    reactions: (e) => e.goReactions(),
    lock: (e, a) => e.setReactionsLocked(a.locked),
    sosStart: (e, a) => e.startSos(a.sosId, a.teamId, { alsoLed: a.alsoLed !== false }),
    sosReveal: (e) => e.revealSosAnswer(),
    sosClose: (e) => e.closeSos('chiuso dalla regia'),
    finale: (e) => e.goFinale(),
    freeze: (e, a) => e.setAudienceFrozen(a.frozen, { alsoLed: a.alsoLed !== false }),
    quiz: (e, a) => e.setQuizAnswer(a.teamId, a.idx, a.correct),
    sugarfree: (e, a) => e.setSugarfree(a.teamId ?? null),
    sugarfreeLock: (e, a) => e.setSugarfreeLocked(a.locked),
    adjAdd: (e, a) => e.addAdjustment(a.target, a.delta, a.reason),
    adjDel: (e, a) => e.removeAdjustment(a.id),
    ledPrepare: (e, a) => e.ledPrepare(a.type),
    ledPublish: (e) => e.ledPublish(),
    reset: (_e, a) => {
      if (showId === 'live' && a.confirm !== 'AZZERA LIVE') throw new Error('Per azzerare il LIVE scrivi esattamente: AZZERA LIVE');
      resetShow(showId);
    },
  };

  socket.on('cmd', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const fn = commands[msg?.type];
    if (!fn) return reply({ ok: false, error: 'comando sconosciuto' });
    try {
      fn(engines[showId], msg.args || {});
      broadcast(showId, true);
      reply({ ok: true });
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
  });

  socket.on('switchShow', (id, ack) => {
    socket.leave(showId);
    showId = showOf(id);
    socket.join(showId);
    socket.emit('admin:state', adminSnapshot(showId));
    typeof ack === 'function' && ack({ ok: true, showId });
  });
});

function connectedCount(showId) {
  return io.sockets.adapter.rooms.get(`pub:${showId}`)?.size || 0;
}
function adminSnapshot(showId) {
  return engines[showId].adminState({ connected: connectedCount(showId), serverNow: Date.now() });
}

const lastPublicV = {};
function broadcast(showId, force = false) {
  const e = engines[showId];
  if (force || lastPublicV[showId] !== e.version) {
    lastPublicV[showId] = e.version;
    io.to(`pub:${showId}`).emit('state', e.publicState());
  }
  if (force || e.screenDirty) {
    e.screenDirty = false;
    screenNs.to(showId).emit('screen', { state: e.screenState() });
  }
  if (force || e.adminDirty) {
    e.adminDirty = false;
    adminNs.to(showId).emit('admin:state', adminSnapshot(showId));
  }
}

// ciclo principale: timer SOS, broadcast, salvataggio
setInterval(() => { for (const id of SHOW_IDS) { engines[id].tick(); broadcast(id); } }, 250);
setInterval(() => { for (const id of SHOW_IDS) adminNs.to(id).emit('admin:connected', connectedCount(id)); }, 2000);
setInterval(() => { for (const id of SHOW_IDS) persist(engines[id]); }, 1000);

function shutdown() {
  for (const id of SHOW_IDS) { engines[id].dirty = true; persist(engines[id]); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.listen(PORT, () => {
  console.log(`\n🎬 Cult Pop LIVE in ascolto su http://localhost:${PORT}`);
  console.log(`   Pubblico:  http://localhost:${PORT}/            (prova: /?show=prova)`);
  console.log(`   Regia:     http://localhost:${PORT}/regia`);
  console.log(`   LED:       http://localhost:${PORT}/schermo?key=${PROD ? '(vedi SCREEN_KEY)' : SCREEN_KEY}&show=live`);
  console.log(`   QR code →  ${QR.live.url}${process.env.PUBLIC_URL ? '' : '   (imposta PUBLIC_URL online!)'}\n`);
});
