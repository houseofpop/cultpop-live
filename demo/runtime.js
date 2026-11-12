// ===== Simulatore: sostituisce il server reale dentro la pagina =====
// Usa lo stesso ShowEngine del server (identica logica di punteggi, timer e limiti).
const { ShowEngine, publicConfig } = CP;
const CONFIG = window.__SHOW_CONFIG;
const PUB = publicConfig(CONFIG);
let engine = new ShowEngine(CONFIG, 'live');
const DEMO = { netDown: false, botsOn: true, phoneSocket: null };
window.DEMO = DEMO;
const sockets = new Set();

// le finestre di dialogo native sono bloccate nell'anteprima: qui si conferma sempre
window.confirm = () => true;
window.prompt = () => 'AZZERA LIVE';

class FakeSocket {
  constructor(ns, opts) {
    this.ns = ns;
    this.auth = (opts && opts.auth) || {};
    this.h = {};
    this.connected = false;
    this._t = null;
    this.io = { on: () => {} };
    if (ns === '/') DEMO.phoneSocket = this;
    setTimeout(() => this.connect(), 60);
  }
  on(e, f) { (this.h[e] ||= []).push(f); return this; }
  fire(e, ...a) { (this.h[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }); }
  connect() {
    if (this.connected || (this.ns === '/' && DEMO.netDown)) return;
    this.connected = true;
    sockets.add(this);
    this.fire('connect');
    server.onConnect(this);
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    sockets.delete(this);
    this.fire('disconnect');
  }
  timeout(ms) { this._t = ms; return this; }
  emit(e, data, ack) {
    const t = this._t; this._t = null;
    if (!this.connected) { if (ack && t != null) setTimeout(() => ack(new Error('timeout')), Math.min(t, 1500)); return; }
    setTimeout(() => {
      const res = server.onMessage(this, e, data);
      if (ack) t != null ? ack(null, res) : ack(res);
    }, 25 + Math.random() * 60); // latenza di rete simulata
  }
  push(e, d) { if (this.connected) setTimeout(() => this.connected && this.fire(e, d), 15 + Math.random() * 40); }
}
window.io = (a, b) => (typeof a === 'string' ? new FakeSocket(a, b) : new FakeSocket('/', a));

const connectedCount = () => bots.filter((b) => b.joined).length + (DEMO.phoneSocket?.connected ? 1 : 0);
const adminSnap = () => engine.adminState({ connected: connectedCount(), serverNow: Date.now() });

const server = {
  onConnect(s) {
    if (s.ns === '/') {
      if (!s.sid) s.sid = (String(s.auth.token || '').split('.')[0]) || 'tu' + Math.random().toString(36).slice(2, 8);
      engine.ensureSession(s.sid);
      s.push('welcome', { token: s.sid + '.demo', serverNow: Date.now(), config: PUB, state: engine.publicState(), me: engine.personal(s.sid), showId: 'live' });
    } else if (s.ns === '/regia') {
      s.push('admin:init', { config: CONFIG, pubConfig: PUB, screenKey: 'demo', shows: ['live'], qr: { live: window.__QR } });
      s.push('admin:state', adminSnap());
    }
  },
  onMessage(s, e, d) {
    if (s.ns === '/') {
      if (e === 'time') return Date.now();
      if (e === 'react') { engine.react(s.sid, d && d.b); return; }
      if (e === 'ab') return engine.answerAB(s.sid, d && d.qid, d && d.choice);
      if (e === 'profile') return engine.setProfile(s.sid, d && d.nick, d && d.year);
      if (e === 'sos') return engine.voteSos(s.sid, d && d.runId, d && d.idx);
      if (e === 'me') return engine.personal(s.sid);
    }
    if (s.ns === '/regia') {
      if (e === 'cmd') return runCmd(d || {});
      if (e === 'switchShow') return { ok: true };
    }
  },
};

const commands = {
  open: (e, a) => e.setOpen(a.open),
  reactions: (e) => e.goReactions(),
  lock: (e, a) => e.setReactionsLocked(a.locked),
  sosStart: (e, a) => e.startSos(a.sosId, a.teamId, { alsoLed: a.alsoLed !== false }),
  sosClose: (e) => e.closeSos('chiuso dalla regia'),
  sosReveal: (e) => e.revealSosAnswer(),
  finale: (e) => e.goFinale(),
  freeze: (e, a) => e.setAudienceFrozen(a.frozen, { alsoLed: a.alsoLed !== false }),
  quiz: (e, a) => e.setQuizAnswer(a.teamId, a.idx, a.correct),
  sugarfree: (e, a) => e.setSugarfree(a.teamId ?? null),
  sugarfreeLock: (e, a) => e.setSugarfreeLocked(a.locked),
  adjAdd: (e, a) => e.addAdjustment(a.target, a.delta, a.reason),
  adjDel: (e, a) => e.removeAdjustment(a.id),
  ledPrepare: (e, a) => e.ledPrepare(a.type),
  ledPublish: (e) => e.ledPublish(),
  reset: () => { resetAll(); },
};
function runCmd(msg) {
  const fn = commands[msg.type];
  if (!fn) return { ok: false, error: 'comando sconosciuto' };
  try { fn(engine, msg.args || {}); tickNow(true); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}
window.demoCmd = (type, args) => runCmd({ type, args });

// ---------- 150 spettatori virtuali ----------
const N = 150;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const birth = () => { const r = Math.random(); return Math.round(r < 0.45 ? rnd(1997, 2008) : r < 0.85 ? rnd(1981, 1996) : r < 0.95 ? rnd(1965, 1980) : rnd(1950, 1964)); };
const bots = Array.from({ length: N }, (_, i) => ({
  sid: 'bot' + i, joined: false, joinAt: 0, fav: pick(CONFIG.concorrenti).id,
  spammer: Math.random() < 0.15, done: new Set(), year: birth(), quiz: Math.random() < 0.7,
}));
function botsLoop() {
  if (!DEMO.botsOn) return;
  const st = engine.s;
  const now = Date.now();
  for (const b of bots) {
    if (!b.joined) {
      if (st.open && !b.joinAt) b.joinAt = now + rnd(0, 5000);
      if (b.joinAt && now >= b.joinAt) { b.joined = true; engine.setProfile(b.sid, 'Bot' + b.sid.slice(3), b.year); }
      continue;
    }
    if (st.mode === 'reazioni' && st.open && !st.reactionsLocked) {
      if (Math.random() < 0.08) b.fav = pick(CONFIG.concorrenti).id;
      if (!b.spammer && Math.random() < 0.6) continue;
      const e = CONFIG.reazioni.emoji[Math.floor(Math.random() ** 1.6 * CONFIG.reazioni.emoji.length)].id;
      engine.react(b.sid, [[b.fav, e, b.spammer ? Math.ceil(rnd(4, 12)) : Math.ceil(rnd(1, 3))]]);
    }
    if (st.mode === 'sos' && st.sos && !st.sos.closed && !b.done.has(st.sos.runId) && Math.random() < 0.9) {
      const run = st.sos.runId; b.done.add(run);
      const bias = [0.2, 0.45, 0.2, 0.15]; let x = Math.random(), idx = 0;
      while (x > bias[idx] && idx < 3) { x -= bias[idx]; idx++; }
      setTimeout(() => engine.voteSos(b.sid, run, idx), rnd(1500, 26000));
    }
    if (st.mode === 'finale' && b.quiz) for (const q of CONFIG.domandeAB) if (!b.done.has(q.id)) { b.done.add(q.id); engine.answerAB(b.sid, q.id, Math.random() < 0.5 ? 'A' : 'B'); }
  }
}
setInterval(botsLoop, 700);

// ---------- ciclo "server": timer SOS e trasmissione dello stato ----------
let lastV = -1;
function tickNow(force) {
  engine.tick();
  if (force || engine.version !== lastV) {
    lastV = engine.version;
    sockets.forEach((s) => s.ns === '/' && s.push('state', engine.publicState()));
    led.update();
  }
  if (force || engine.adminDirty) {
    engine.adminDirty = false;
    sockets.forEach((s) => s.ns === '/regia' && s.push('admin:state', adminSnap()));
  }
}
setInterval(() => tickNow(false), 250);
setInterval(() => sockets.forEach((s) => s.ns === '/regia' && s.push('admin:connected', connectedCount())), 2000);
setInterval(() => sockets.forEach((s) => s.ns === '/' && s.push('count', connectedCount())), 3000);

function resetAll() {
  engine = new ShowEngine(CONFIG, 'live');
  engine.log('Show azzerato');
  for (const b of bots) { b.joined = false; b.joinAt = 0; b.done = new Set(); }
  if (DEMO.phoneSocket) engine.ensureSession(DEMO.phoneSocket.sid);
  lastV = -1;
}

// ---------- LED wall (animato come la pagina vera) ----------
const led = {
  key: '', start: performance.now(), env: { config: PUB, qr: window.__QR, now: () => Date.now(), closedSeenAt: null },
  update() {
    const p = engine.screenState().program;
    const key = `${p.type}:${p.publishedAt || p.t}:${p.runId || ''}`;
    if (key !== this.key) { this.key = key; this.start = performance.now(); this.env.closedSeenAt = null; }
    const info = document.getElementById('ledInfo');
    if (info) info.textContent = `Sulla pagina LED: ${CP.SCENE_LABEL[p.type]}${p.publishedAt ? ', pubblicata alle ' + new Date(p.publishedAt).toLocaleTimeString('it-IT') : ''}. Nella realtà il tecnico la manda in onda quando serve.`;
  },
};
CP.prepareAssets(PUB, window.__QR).then(() => {
  let last = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const sc = engine.screenState().program;
    if (now - last < (sc.type === 'verdetto' || sc.type === 'chiuse' ? 16 : 40)) return;
    last = now;
    if (document.getElementById('stage').dataset.pane !== 'led' && window.matchMedia('(max-width: 1023px)').matches) return;
    CP.drawScene(document.getElementById('ledCanvas'), engine.screenState().program, led.env, { width: window.__SHOW_CONFIG.show.led?.larghezza || 1920, height: window.__SHOW_CONFIG.show.led?.altezza || 1080, el: now - led.start });
  };
  requestAnimationFrame(frame);
});

// il download di file è bloccato nell'anteprima: mostriamo il PNG in una finestra
CP.downloadPng = async (cv) => {
  const url = cv.toDataURL('image/png');
  const box = document.getElementById('pngOverlay');
  box.querySelector('img').src = url;
  box.hidden = false;
};

// ---------- interfaccia del simulatore ----------
function setPane(p) {
  document.querySelectorAll('[data-pane-btn]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.paneBtn === p)));
  document.getElementById('stage').dataset.pane = p;
  if (p === 'led') led.update();
}
document.querySelectorAll('[data-pane-btn]').forEach((b) => b.addEventListener('click', () => setPane(b.dataset.paneBtn)));

document.getElementById('netBtn').addEventListener('click', (ev) => {
  DEMO.netDown = !DEMO.netDown;
  ev.currentTarget.setAttribute('aria-pressed', String(DEMO.netDown));
  ev.currentTarget.textContent = DEMO.netDown ? 'Ridai la rete al telefono' : 'Togli la rete al telefono';
  if (DEMO.netDown) DEMO.phoneSocket?.disconnect();
  else setTimeout(() => DEMO.phoneSocket?.connect(), 900); // il vero client riprova da solo
});
document.getElementById('botsBtn').addEventListener('click', (ev) => {
  DEMO.botsOn = !DEMO.botsOn;
  ev.currentTarget.setAttribute('aria-pressed', String(DEMO.botsOn));
  ev.currentTarget.textContent = DEMO.botsOn ? 'Pubblico virtuale: 150 attivi' : 'Pubblico virtuale: in pausa';
});
document.getElementById('restartBtn').addEventListener('click', () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith('cp_')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
  location.reload();
});
document.getElementById('pngOverlay').addEventListener('click', (e) => { if (e.target.id === 'pngOverlay' || e.target.dataset.close) e.currentTarget.hidden = true; });

// ---------- demo guidata ----------
const phoneTap = (sel) => document.querySelector('#phoneScreen ' + sel)?.click();
const phoneDo = (fn) => { const ps = document.getElementById('phoneScreen'); if (ps) fn(ps); };
const steps = [
  { t: 'Lo spettatore legge le regole', d: 'Ha inquadrato il QR: legge le tre regole e tocca «Inizia». Nessuna app e nessuna registrazione.', run: () => phoneTap('#go'), pane: 'phone' },
  { t: 'Nickname e anno di nascita', d: 'Scrive un nickname e sceglie l\'anno con la rotellina. Questo passo inserisce «Giulia» e il 2003: puoi farlo anche tu a mano.', run: () => phoneDo((ps) => {
      const n = ps.querySelector('#nick'); if (n) { n.value = 'Giulia'; n.dispatchEvent(new Event('input')); }
      const w = ps.querySelector('#wheelScroll'); if (w) { w.scrollTop = (2003 - PUB.annoNascita.min) * 52; w.dispatchEvent(new Event('scroll')); }
      setTimeout(() => ps.querySelector('#saveProfile')?.click(), 250);
    }), pane: 'phone' },
  { t: 'La generazione', d: '«Congratulazioni, sei un/una Gen Z!», con il testo e l\'immagine della generazione. Da qui, prima dell\'inizio, si può creare la carta d\'identità generazionale con la foto. Poi «Inizia a votare».', run: () => phoneTap('#toShow'), pane: 'phone' },
  { t: 'La regia apre la sessione', d: 'I telefoni passano alle reazioni. Entrano anche i 150 spettatori virtuali, che inseriscono il loro anno di nascita.', run: () => demoCmd('open', { open: true }), pane: 'regia' },
  { t: 'Reazioni per tutto lo show', d: 'Tocca una foto e poi le emoji, anche a raffica. In regia vedi «validi / tap»: oltre 3 reazioni ogni 10 secondi si continua a giocare, ma i punti non salgono.', run: () => phoneTap('.kid[data-id="c3"]'), pane: 'phone' },
  { t: 'Generazioni in sala sul LED', d: 'La regia prepara la statistica in anteprima e la pubblica sulla pagina LED. Il tecnico la manda in onda quando serve.', run: () => { demoCmd('ledPrepare', { type: 'generazioni' }); setTimeout(() => demoCmd('ledPublish'), 400); }, pane: 'led' },
  { t: 'Punti quiz per domanda', d: 'Una casella per ogni risposta corretta (D1, D2, D3): niente doppi clic che sommano due volte.', run: () => { demoCmd('quiz', { teamId: 't2', idx: 0, correct: true }); demoCmd('quiz', { teamId: 't2', idx: 1, correct: true }); demoCmd('quiz', { teamId: 't1', idx: 0, correct: true }); }, pane: 'regia' },
  { t: 'SOS: telefoni e LED insieme', d: 'Un solo comando: domanda sui telefoni (lampo colorato e, su Android, vibrazione) e countdown sul LED. 30 secondi contati dal server, un voto a testa.', run: () => demoCmd('sosStart', { sosId: 'sos1', teamId: 't1', alsoLed: true }), pane: 'led' },
  { t: 'Risultati e risposta corretta', d: 'Allo scadere il LED mostra le percentuali e i telefoni dicono «Guarda il LED» e ci restano. Quando i conduttori lo decidono, la regia rivela la risposta corretta e poi preme «Telefoni su Reazioni».', run: () => { if (engine.s.sos && !engine.s.sos.closed) demoCmd('sosClose'); setTimeout(() => demoCmd('sosReveal'), 2500); }, pane: 'led' },
  { t: 'Classifica provvisoria', d: 'La regia riporta i telefoni alle reazioni. La classifica viene fotografata in anteprima e pubblicata: sul LED resta ferma mentre i conduttori la commentano.', run: () => { demoCmd('reactions'); demoCmd('ledPrepare', { type: 'classifica' }); setTimeout(() => demoCmd('ledPublish'), 400); }, pane: 'led' },
  { t: 'Promemoria per i ritardatari', d: '«Sei tu a decidere chi vincerà» con il QR code: il tecnico può mandarlo in onda dopo ogni clip per riempire i buchi.', run: () => { demoCmd('ledPrepare', { type: 'promo' }); setTimeout(() => demoCmd('ledPublish'), 400); }, pane: 'led' },
  { t: 'Chiudi votazioni', d: 'Tenendo premuto «Chiudi votazioni», telefoni e LED mostrano «Votazioni chiuse» e il rullo di tamburi. Le reazioni smettono di contare.', run: () => demoCmd('freeze', { frozen: true }), pane: 'led' },
  { t: 'Voto Sugarfree, confermato', d: 'Gli Sugarfree scelgono la Squadra Turchese. La regia conferma il voto, che resta bloccato: impossibile assegnare il bonus due volte.', run: () => { demoCmd('sugarfree', { teamId: 't3' }); demoCmd('sugarfreeLock', { locked: true }); }, pane: 'regia' },
  { t: 'Verdetto in anteprima privata', d: 'La regia prepara il verdetto e controlla il risultato in anteprima. Sul LED restano le «Votazioni chiuse».', run: () => demoCmd('ledPrepare', { type: 'verdetto' }), pane: 'regia' },
  { t: 'Pubblica il verdetto', d: 'Al segnale dei conduttori. In regia serve tenere premuto il pulsante per 2 secondi; qui lo fa la demo. Il LED rivela le coppie dal 3° al 1° posto.', run: () => demoCmd('ledPublish'), pane: 'led' },
  { t: 'Telefoni al finale', d: 'Il pubblico vede «Grazie!», il riepilogo del proprio show, il quiz «Scopri che Rom-Com sei» e l\'invito a seguire Cult Pop: i riquadri entrano uno alla volta.', run: () => demoCmd('finale'), pane: 'phone' },
];
let stepI = 0;
function renderStep() {
  const s = steps[stepI];
  document.getElementById('stepNum').textContent = `Passo ${stepI + 1} di ${steps.length}`;
  document.getElementById('stepTitle').textContent = s.t;
  document.getElementById('stepText').textContent = s.d;
  document.getElementById('prevStep').disabled = stepI === 0;
  document.getElementById('runStep').textContent = stepI === steps.length - 1 ? 'Esegui l\'ultimo passo' : 'Esegui e vai avanti';
}
document.getElementById('runStep').addEventListener('click', () => {
  const s = steps[stepI];
  s.run();
  setPane(s.pane);
  if (stepI < steps.length - 1) { stepI++; renderStep(); }
});
document.getElementById('prevStep').addEventListener('click', () => { if (stepI > 0) { stepI--; renderStep(); } });
renderStep();
setPane(window.matchMedia('(max-width: 1023px)').matches ? 'phone' : 'regia');
try { sessionStorage.setItem('cp_regia_pw', 'demo'); sessionStorage.setItem('cp_regia_show', 'live'); } catch { /* */ }
