// Sito del pubblico. Il server è l'unica fonte di verità: qui si disegna lo stato ricevuto.
// Percorso: regole → nickname e anno → generazione → reazioni (tutto lo show) → SOS quando li lancia la regia → finale.
import { makeCard } from './card.js';
import { makeIdCard, loadPhoto } from './idcard.js';
import { paper, scribble, plus, C } from './deco.js';

const params = new URLSearchParams(location.search);
const SHOW = params.get('show') === 'prova' ? 'prova' : 'live';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modalità privata */ } },
};
const K = (k) => `cp_${SHOW}_${k}`;

// Solo per le prove: ?show=prova&ricomincia=1 riporta questo telefono all'inizio (nuovo spettatore).
if (SHOW === 'prova' && params.get('ricomincia') === '1') {
  try { Object.keys(localStorage).filter((k) => k.startsWith('cp_prova_')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
  history.replaceState(null, '', location.pathname + '?show=prova');
}

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const scroller = () => document.getElementById('phoneScreen') || document.scrollingElement;
const asset = (p) => (/^(data:|https?:|\/)/.test(p) ? p : '/' + p);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cfg = null;
let state = null;
let me = { ab: {}, sosVotes: {} };
let offset = 0;
let selected = store.get(K('sel'));
let view = '';
let everConnected = false;
let finalView = 'home';
let idMode = false; // carta d'identità generazionale aperta
let introDone = false; // regole lette in questa visita (si rivedono se il server non ci conosce)
const profileKey = () => `${me.nick}|${me.year}`;
const pending = new Map();

// ---------- connessione ----------
const socket = io({ auth: { token: store.get(K('token')), show: SHOW }, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 8000 });

socket.on('welcome', (w) => {
  everConnected = true;
  store.set(K('token'), w.token);
  socket.auth.token = w.token;
  cfg = w.config;
  me = { ...me, ...w.me };
  if (cfg.show.gifVotiChiusi) { const g = new Image(); g.src = asset(cfg.show.gifVotiChiusi); } // caricata subito, non al momento della chiusura
  offset = w.serverNow - Date.now();
  syncClock();
  setState(w.state, true);
  showConn(null);
});
socket.on('state', (s) => setState(s));
let crowd = 0;
socket.on('count', (n) => { crowd = n; updateCrowd(); });
socket.on('disconnect', () => showConn('Connessione persa: ci stiamo riconnettendo…'));
socket.on('connect_error', () => showConn(everConnected ? 'Connessione persa: ci stiamo riconnettendo…' : 'Non riesco a collegarmi. Controlla Wi-Fi o rete dati.', !everConnected));
socket.io.on('reconnect_attempt', (n) => { if (n > 6) showConn('Ancora nessuna connessione… non chiudere la pagina, riproviamo da soli.', true); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepAwake();
  if (!socket.connected) socket.connect();
  else socket.emit('me', null, (m) => { me = { ...me, ...m }; render(true); });
});

function syncClock() {
  const t0 = Date.now();
  socket.timeout(4000).emit('time', null, (err, serverNow) => {
    if (err) return;
    offset = serverNow - (t0 + Date.now()) / 2;
  });
}
const serverNow = () => Date.now() + offset;

function showConn(msg, bad = false) {
  if (!msg && SHOW === 'prova') { $conn.textContent = 'MODALITÀ PROVA: non è lo show reale'; $conn.className = 'conn prova'; return; }
  $conn.textContent = msg || '';
  $conn.className = 'conn' + (msg ? '' : ' hidden') + (bad ? ' bad' : '');
}

function setState(s, force = false) {
  const prevMode = state?.mode;
  // il verdetto è arrivato: ridisegna il finale con la classifica
  if (s.mode === 'finale' && !!s.classifica !== !!state?.classifica) force = true;
  state = s;
  if (s.mode === 'finale' && prevMode !== 'finale') refreshMe();
  render(force);
}

function refreshMe() {
  socket.timeout(5000).emit('me', null, (err, m) => { if (!err && m) { me = { ...me, ...m }; render(true); } });
}

// ---------- schermo sempre acceso (dove il telefono lo permette) ----------
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } }
  catch { /* non supportato o rifiutato: pazienza */ }
}
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* iPhone: non supportato */ } };

// ---------- reazioni: accumulo e invio a pacchetti ----------
setInterval(() => {
  if (!pending.size || !socket.connected) return;
  const b = [...pending].map(([k, n]) => { const [c, e] = k.split('|'); return [c, e, n]; });
  pending.clear();
  socket.emit('react', { b });
}, 700);

let recentTaps = [];
function tap(eid, btn) {
  if (!selected) return;
  const k = `${selected}|${eid}`;
  pending.set(k, (pending.get(k) || 0) + 1);
  const t = Date.now();
  recentTaps = recentTaps.filter((x) => t - x < 3000);
  recentTaps.push(t);
  document.body.classList.toggle('tired', recentTaps.length > 12);
  const r = btn.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'fly';
  f.textContent = btn.querySelector('.emo-s')?.textContent || btn.textContent;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top}px`;
  f.style.setProperty('--dx', `${Math.round(Math.random() * 120 - 60)}px`);
  f.style.setProperty('--rot', `${Math.round(Math.random() * 60 - 30)}deg`);
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 950);
  const card = document.querySelector(`.kid[data-id="${selected}"]`);
  if (card) { card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump'); }
  buzz(8);
}

// ---------- rendering ----------
function render(force = false) {
  if (!cfg || !state) return;
  let v;
  if (!me.nick && !introDone) v = 'intro';
  else if (!me.nick) v = 'profilo';
  else if (state.mode === 'sos' && state.sos) v = `sos:${state.sos.runId}${sosOver() ? ':chiuso' : ''}`;
  else if (store.get(K('reveal')) !== profileKey()) v = 'generazione'; // ogni nuovo profilo rivede la sua generazione
  else if (idMode) v = 'carta';
  else if (state.mode === 'finale') v = `finale:${finalView}`;
  else if (state.votesClosed) v = 'chiuse';
  else if (!state.open) v = 'attesa';
  else v = 'reazioni';

  if (v !== view || force) {
    const prev = view;
    view = v;
    scroller().scrollTop = 0;
    if (v === 'intro') renderIntro();
    else if (v === 'profilo') renderProfile();
    else if (v === 'generazione') renderGeneration();
    else if (v === 'carta') renderIdCard();
    else if (v === 'attesa') renderWaiting();
    else if (v === 'reazioni') renderReactions();
    else if (v === 'chiuse') renderVotesClosed();
    else if (v.endsWith(':chiuso')) renderSosClosed();
    else if (v.startsWith('sos:')) { const fresh = !prev.startsWith(v); renderSos(fresh); if (fresh) alertSos(); }
    else if (v.startsWith('finale:')) renderFinal();
  } else {
    if (v === 'reazioni') updateReactionBar();
    if (v === 'carta') updateIdBanner();
    if (v.startsWith('sos:') && !v.endsWith(':chiuso')) updateSos();
  }
}

const gen = () => cfg.generazioni.find((g) => g.id === me.gen);
function header() {
  return `<header class="top"><img class="logo" src="/img/logo.webp" alt="Cult Pop"><div class="live-pill ${SHOW === 'prova' ? 'prova' : ''}">${SHOW === 'prova' ? 'PROVA' : 'LIVE'}</div></header>`;
}

function renderIntro() {
  $app.innerHTML = `
    <section class="intro">
      <div class="hero" role="img" aria-label="Cult Pop presenta"></div>
      <h1>${esc(cfg.show.titolo)}</h1>
      <p class="sub">${esc(cfg.show.sottotitolo)}</p>
      <ol class="rules">${cfg.show.regole.map((r, i) => `<li><b>${i + 1}</b>${esc(r)}</li>`).join('')}</ol>
      <button class="btn viola" id="go">Inizia</button>
    </section>`;
  document.getElementById('go').onclick = () => { introDone = true; keepAwake(); render(true); };
}

// ---------- nickname + anno di nascita (rotellina) ----------
const ROW = 52;
function renderProfile() {
  const { min, max, predefinito } = cfg.annoNascita;
  const years = [];
  for (let y = min; y <= max; y++) years.push(y);
  $app.innerHTML = `${header()}
    <section class="q-screen profile">
      <span class="q-kicker brush">Prima di iniziare</span>
      <label class="field-label" for="nick">Come ti chiami stasera?</label>
      <input id="nick" class="nick" maxlength="20" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Il tuo nickname" value="${esc(store.get(K('nickDraft')) || '')}">
      <span class="field-label" id="yearLabel">In che anno sei nato?</span>
      <div class="wheel" role="listbox" aria-labelledby="yearLabel" tabindex="0" id="wheel">
        <div class="wheel-band" aria-hidden="true"></div>
        <div class="wheel-scroll" id="wheelScroll">
          <div class="wheel-pad"></div>
          ${years.map((y) => `<div class="wheel-item" role="option" data-y="${y}">${y}</div>`).join('')}
          <div class="wheel-pad"></div>
        </div>
      </div>
      <p class="tip">Scorri per scegliere l'anno · i tuoi dati restano anonimi</p>
      <button class="btn viola" id="saveProfile" disabled>Scopri la tua generazione</button>
    </section>`;
  const nick = document.getElementById('nick');
  const btn = document.getElementById('saveProfile');
  const sc = document.getElementById('wheelScroll');
  const items = [...sc.querySelectorAll('.wheel-item')];
  let year = Number(store.get(K('yearDraft'))) || predefinito;
  const idxOf = (y) => Math.max(0, Math.min(items.length - 1, y - min));
  const mark = () => {
    const i = Math.round(sc.scrollTop / ROW);
    year = min + Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, k) => { el.classList.toggle('sel', k === i); el.setAttribute('aria-selected', String(k === i)); });
  };
  requestAnimationFrame(() => { sc.scrollTop = idxOf(year) * ROW; mark(); });
  let t;
  sc.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { mark(); store.set(K('yearDraft'), year); buzz(5); }, 70); }, { passive: true });
  items.forEach((el, k) => (el.onclick = () => sc.scrollTo({ top: k * ROW, behavior: 'smooth' })));
  document.getElementById('wheel').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); sc.scrollTop += (e.key === 'ArrowDown' ? 1 : -1) * ROW; }
  });
  const check = () => { btn.disabled = !nick.value.trim(); store.set(K('nickDraft'), nick.value); };
  nick.addEventListener('input', check);
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') nick.blur(); });
  check();
  btn.onclick = () => {
    mark();
    btn.disabled = true;
    socket.timeout(5000).emit('profile', { nick: nick.value, year }, (err, res) => {
      if (!err && res?.ok) { me = { ...me, nick: res.nick, year: res.year, gen: res.gen }; buzz([30, 40, 60]); render(true); }
      else { btn.disabled = false; showConn(err ? 'Invio non riuscito, riprova' : 'Controlla nickname e anno', true); setTimeout(() => showConn(socket.connected ? null : 'Riconnessione…'), 2500); }
    });
  };
}

function renderGeneration() {
  const g = gen();
  $app.innerHTML = `${header()}
    <section class="reveal">
      <p class="congrats">Congratulazioni, <strong>${esc(me.nick)}</strong>!</p>
      <p class="sei">Sei un/una</p>
      <h1 class="gen-name"><span class="brush">${esc(g?.nomeSingolare || g?.nome || 'Generazione misteriosa')}</span></h1>
      <img class="gen-img" src="${esc(g?.immagine || '')}" alt="" style="background:${esc(g?.colore || '#fff')}">
      <p class="gen-quote">${esc(g?.testo || '')}</p>
      <button class="btn viola" id="toShow">Inizia a votare</button>
      ${idOffer() ? '<button class="btn bianco small-btn" id="toId">📸 Crea la tua carta d\'identità</button>' : ''}
      <button class="link-btn" id="changeYear">Ho sbagliato anno</button>
    </section>`;
  document.getElementById('toShow').onclick = () => { store.set(K('reveal'), profileKey()); keepAwake(); render(true); };
  document.getElementById('toId')?.addEventListener('click', () => { store.set(K('reveal'), profileKey()); idMode = true; render(true); });
  document.getElementById('changeYear').onclick = () => { me.nick = null; render(true); };
}

function genChip() {
  const g = gen();
  return g ? `<span class="gen-chip" style="background:${esc(g.colore)}">${esc(g.nome)}</span>` : '';
}

function renderWaiting() {
  $app.innerHTML = `${header()}
    <div class="center-screen waiting">
      <img class="wait-logo" src="/img/logo.webp" alt="Cult Pop">
      <p class="hello">Ciao ${esc(me.nick)}!</p>
      <h1 class="big-title">Lo show sta per iniziare</h1>
      <p class="plain">Tieni aperta questa pagina: si attiverà da sola.</p>
      <p class="crowd hidden" id="crowd" aria-live="polite"></p>
      ${idOffer() ? `<button class="id-cta" id="toId"><span class="id-cta-k">Mentre aspetti</span><span class="id-cta-t">📸 Crea la tua carta d'identità generazionale</span><span class="id-cta-s">Una foto, la tua generazione e un timbro: pronta per le storie</span></button>` : ''}
    </div>`;
  document.getElementById('toId')?.addEventListener('click', () => { idMode = true; render(true); });
  updateCrowd();
}
// mostrato solo quando i numeri sono già belli: sotto la soglia non compare niente
function updateCrowd() {
  const el = document.getElementById('crowd');
  if (!el) return;
  const min = cfg?.show?.contatoreMinimo ?? 10;
  el.classList.toggle('hidden', crowd < min);
  el.innerHTML = `Siete già in <strong>${crowd}</strong>! 🎉`;
}

function renderReactions() {
  const kids = cfg.concorrenti.map((c) => `
    <button class="kid ${c.id === selected ? 'sel' : ''}" data-id="${esc(c.id)}" aria-pressed="${c.id === selected}">
      <img src="${esc(c.foto)}" alt="" decoding="async">
      <span class="tag" style="background:${esc(c.colore)}"></span>
      <span class="name">${esc(c.nome)}</span>
    </button>`).join('');
  $app.innerHTML = `${header()}
    <p class="hint">Tocca un <em>Gen Z</em> e reagisci!</p>
    <div class="grid">${kids}</div>
    <div class="selected-line" id="selLine"></div>
    <div class="emoji-bar" id="bar">
      ${cfg.emoji.map((e) => `<button class="emo" data-e="${esc(e.id)}" aria-label="${esc(e.id)}, ${e.punti > 0 ? 'più' : 'meno'} ${Math.abs(e.punti)} punti"><span class="emo-s">${esc(e.simbolo)}</span><span class="emo-p">${e.punti > 0 ? '+' : '−'}${Math.abs(e.punti)}</span></button>`).join('')}
      <div class="bar-msg" id="barMsg"></div>
    </div>
    <p class="tip rx-tip">Ogni emoji dà o toglie punti al Gen Z che hai scelto</p>`;
  $app.querySelectorAll('.kid').forEach((b) => (b.onclick = () => {
    selected = b.dataset.id;
    store.set(K('sel'), selected);
    $app.querySelectorAll('.kid').forEach((x) => { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', x === b); });
    updateReactionBar();
  }));
  $app.querySelectorAll('.emo').forEach((b) => b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); if (!b.disabled) tap(b.dataset.e, b); }));
  updateReactionBar();
}

function updateReactionBar() {
  const locked = state.reactionsLocked;
  const c = cfg.concorrenti.find((x) => x.id === selected);
  const line = document.getElementById('selLine');
  if (line) line.innerHTML = c ? `Stai reagendo a <span class="brush">${esc(c.nome)}</span>` : '';
  const msg = locked ? 'Reazioni in pausa ⏸' : c ? '' : '👆 Prima scegli un Gen Z';
  $app.querySelectorAll('.emo').forEach((b) => (b.disabled = locked || !c));
  const m = document.getElementById('barMsg');
  if (m) { m.textContent = msg; m.classList.toggle('hidden', !msg); }
}

function renderVotesClosed() {
  const vc = cfg.show.votazioniChiuse || { titolo: 'Votazioni chiuse', testo: 'Grazie per aver votato!' };
  $app.innerHTML = `${header()}
    <section class="closed-screen">
      <h1 class="closed-title"><span class="brush">${esc(vc.titolo)}</span></h1>
      <p class="closed-text">${esc(vc.testo)}</p>
      <div class="drum" aria-hidden="true">🥁</div>
      <p class="plain">Grazie ${esc(me.nick)}!</p>
    </section>`;
}

const sosOver = () => !!state?.sos && (state.sos.closed || state.sos.endsAt - serverNow() <= 0);
function renderSosClosed() {
  const mine = me.sosVotes?.[state.sos.runId];
  $app.innerHTML = `${header()}
    <section class="closed-screen">
      <h1 class="closed-title"><span class="brush">Guarda il LED 👀</span></h1>
      ${cfg.show.gifVotiChiusi ? `<img class="closed-gif" src="${esc(asset(cfg.show.gifVotiChiusi))}" alt="">` : ''}
      <p class="plain">${mine != null ? '✓ Il tuo voto è stato contato' : 'Stavolta non hai votato: al prossimo SOS!'}</p>
    </section>`;
}

// ---------- SOS ----------
function alertSos() {
  // lampo a tutto schermo per tutti, vibrazione dove possibile (Android)
  const f = document.createElement('div');
  f.className = 'sos-flash';
  f.innerHTML = '<span>🆘 SOS!</span>';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1700);
  buzz([180, 80, 180, 80, 320]);
}

let sosTimer = null;
function renderSos(fresh = false) {
  const s = state.sos;
  const mine = me.sosVotes?.[s.runId];
  $app.innerHTML = `${header()}
    <section class="q-screen sos-screen ${fresh ? 'enter' : ''}">
      <div class="row-between">
        <span class="q-kicker brush">🆘 SOS pubblico</span>
        <div class="timer" id="timer"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#17121f" stroke-opacity=".15" stroke-width="5"/><circle id="ring" cx="20" cy="20" r="17" fill="none" stroke="#8a2bf8" stroke-width="5" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="0"/></svg><span class="num" id="num"></span></div>
      </div>
      <h2 class="q-text">${esc(s.domanda)}</h2>
      <div class="ab-opts sos-opts">
        ${s.opzioni.map((o, i) => `<button class="opt ${mine === i ? 'chosen' : mine != null ? 'dim' : ''}" data-i="${i}" ${mine != null ? 'disabled' : ''}><b>${'ABCD'[i]}</b>${esc(o)}</button>`).join('')}
      </div>
      <div class="done-msg ${mine != null || s.closed ? '' : 'hidden'}" id="sosMsg">${mine != null ? 'Voto inviato ✓ Guarda il LED!' : ''}</div>
    </section>`;
  $app.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    const idx = Number(b.dataset.i);
    $app.querySelectorAll('.opt').forEach((x) => (x.disabled = true));
    socket.timeout(5000).emit('sos', { runId: s.runId, idx }, (err, res) => {
      if (!err && res?.ok) { me.sosVotes = { ...me.sosVotes, [s.runId]: res.choice }; buzz(30); renderSos(false); }
      else if (!err && res?.reason === 'scaduto') renderSos(false);
      else { $app.querySelectorAll('.opt').forEach((x) => (x.disabled = false)); showConn('Voto non inviato, riprova!', true); setTimeout(() => showConn(socket.connected ? null : 'Riconnessione…'), 2000); }
    });
  }));
  clearInterval(sosTimer);
  sosTimer = setInterval(updateSos, 200);
  updateSos();
}

function updateSos() {
  if (!view.startsWith('sos:') || !state.sos) { clearInterval(sosTimer); return; }
  const s = state.sos;
  const total = Math.max(1000, s.endsAt - s.startedAt);
  const left = Math.max(0, s.endsAt - serverNow());
  const closed = s.closed || left <= 0;
  const num = document.getElementById('num');
  const ring = document.getElementById('ring');
  if (num) num.textContent = closed ? '0' : Math.ceil(left / 1000);
  if (ring) ring.setAttribute('stroke-dashoffset', String(106.8 * (1 - Math.min(1, left / total))));
  document.getElementById('timer')?.classList.toggle('urgent', left < 6000);
  if (closed) { clearInterval(sosTimer); render(); }
}

// ---------- FINALE ----------
let cardUrl = null;
function setFinal(v) { finalView = v; render(true); }

function answerAB(qid, choice, done) {
  $app.querySelectorAll('.opt').forEach((b) => (b.disabled = true));
  socket.timeout(5000).emit('ab', { qid, choice }, (err, res) => {
    if (!err && res?.ok) me.ab = { ...me.ab, [qid]: res.choice };
    else if (err) { $app.querySelectorAll('.opt').forEach((b) => (b.disabled = false)); showConn('Invio non riuscito, riprova', true); setTimeout(() => showConn(socket.connected ? null : 'Riconnessione…'), 2500); return; }
    done();
  });
}

async function renderFinal() {
  const missing = cfg.domandeAB.filter((q) => !me.ab?.[q.id]);
  if (finalView === 'quiz') {
    if (!missing.length) { refreshMe(); return setFinal('card'); }
    const q = missing[0];
    const n = cfg.domandeAB.length - missing.length + 1;
    $app.innerHTML = `${header()}
      <section class="q-screen">
        <span class="q-kicker brush">Che Rom&#8209;Com sei?</span>
        <p class="progress">Domanda ${n} di ${cfg.domandeAB.length}</p>
        <h2 class="q-text quiz-q">${esc(q.testo)}</h2>
        <div class="ab-opts quiz-opts">${q.opzioni.map((t, i) => { const k = 'ABCDEFGH'[i]; return `<button class="opt q${k}" data-k="${k}"><b>${k}</b>${esc(t)}</button>`; }).join('')}</div>
        <button class="link-btn" id="back">← Torna indietro</button>
      </section>`;
    $app.querySelectorAll('.opt').forEach((b) => (b.onclick = () => answerAB(q.id, b.dataset.k, () => render(true))));
    document.getElementById('back').onclick = () => setFinal('home');
    return;
  }
  if (finalView === 'card') {
    const p = me.profilo;
    if (!p) {
      $app.innerHTML = `${header()}<div class="center-screen"><p class="loading">Stiamo calcolando la tua Rom&#8209;Com…</p></div>`;
      setTimeout(refreshMe, 1200);
      return;
    }
    $app.innerHTML = `${header()}
      <section class="final romcom">
        <h2 class="rc-k">La tua Rom&#8209;Com del cuore è:</h2>
        <img class="rc-poster" src="${esc(asset(p.locandina))}" alt="Locandina di ${esc(p.titolo)}">
        <h1 class="rc-title"><span class="brush">${esc(p.titolo)}</span>${p.anno ? ` <small>(${p.anno})</small>` : ''}</h1>
        <p class="rc-desc">${esc(p.descrizione)}</p>
        <p class="rc-handle">${esc(cfg.show.instagramHandle || '')}</p>
        <div class="actions">
          <button class="btn viola" id="share">Condividi</button>
          <a class="btn bianco" id="save" download="cultpop-romcom.png">Salva</a>
          <a class="btn fucsia wide" href="${esc(cfg.show.instagramUrl)}" target="_blank" rel="noopener">Seguici su Instagram</a>
        </div>
        <button class="link-btn" id="back">← Torna al finale</button>
      </section>`;
    document.getElementById('back').onclick = () => setFinal('home');
    try {
      if (!cardUrl) {
        const blob = await makeCard({ profile: p, cfg, nick: me.nick });
        window.__cardBlob = blob;
        cardUrl = URL.createObjectURL(blob);
      }
      document.getElementById('save').href = cardUrl;
    } catch (e) { console.error(e); }
    document.getElementById('share').onclick = () => shareBlob(window.__cardBlob, 'cultpop-romcom.png', `La mia Rom-Com del cuore è "${p.titolo}" ${cfg.show.instagramHandle || ''}`, 'save');
    return;
  }
  // home del finale: i riquadri entrano uno dopo l'altro
  const r = me.recap || {};
  const fav = cfg.concorrenti.find((c) => c.id === r.favorito);
  const emo = cfg.emoji.find((e) => e.id === r.topEmoji);
  const g = gen();
  const done = !missing.length;
  $app.innerHTML = `${header()}
    <section class="final final-home">
      <h1 class="big-title seq" style="--d:0s">Grazie, ${esc(me.nick)}!</h1>
      <div class="recap seq" style="--d:.25s">
        <strong class="recap-t">Il tuo show in breve</strong>
        ${g ? `<span>La tua generazione: <strong>${esc(g.nome)}</strong></span>` : ''}
        <span>${r.taps ? `Hai reagito <strong>${r.taps}</strong> volte.` : 'Stasera hai fatto il tifo in silenzio.'}</span>
        ${fav ? `<span>Il tuo Gen Z preferito: <strong>${esc(fav.nome)}</strong></span>` : ''}
        ${emo ? `<span>La tua emoji preferita: ${esc(emo.simbolo)}</span>` : ''}
      </div>
      <button class="cta seq" id="quiz" style="--d:.9s">
        <span class="cta-t">${done ? 'Rivedi la tua Rom&#8209;Com' : 'Scopri che Rom&#8209;Com sei'}</span>
        <span class="cta-s">${done ? 'Salvala e condividila' : 'Se ti mancavano i test del Cioè'}</span>
      </button>
      <div class="follow-box seq" style="--d:1.55s">
        <p class="follow">${esc(cfg.show.seguici || '')}</p>
        <a class="btn fucsia follow-btn" href="${esc(cfg.show.instagramUrl)}" target="_blank" rel="noopener">Seguici ${esc(cfg.show.instagramHandle || '')}</a>
      </div>
    </section>`;
  document.getElementById('quiz').onclick = () => setFinal(done ? 'card' : 'quiz');
}

// ---------- sfondo: lo stesso collage di carta strappata del LED, a tutto schermo ----------
function applyPaper() {
  const host = document.getElementById('phoneScreen') || document.body;
  const w = Math.min(host.clientWidth || innerWidth, 1600), h = Math.max(innerHeight, 760) * 2.2;
  const k = Math.min(2, devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const ctx = cv.getContext('2d');
  paper(ctx, cv.width, cv.height, 21);
  const u = Math.min(cv.width, 500 * k) / 400; // decorazioni della stessa misura su telefono e computer
  scribble(ctx, cv.width * 0.8, cv.height * 0.33, 120 * u, 34 * u, C.lime, 6 * u, 8);
  scribble(ctx, -10 * u, cv.height * 0.42, 110 * u, 32 * u, C.lime, 6 * u, 3);
  plus(ctx, cv.width * 0.9, cv.height * 0.3, 9 * u, C.fucsia, 3 * u);
  plus(ctx, cv.width * 0.08, cv.height * 0.12, 7 * u, C.fucsia, 3 * u);
  Object.assign(host.style, { backgroundImage: `url(${cv.toDataURL('image/jpeg', 0.82)})`, backgroundSize: '100% auto', backgroundRepeat: 'no-repeat', backgroundPosition: 'top center', backgroundColor: '#d8d6d3', backgroundAttachment: 'scroll' });
}
applyPaper();
let paperT;
let paperW = innerWidth;
addEventListener('resize', () => { if (Math.abs(innerWidth - paperW) < 40) return; paperW = innerWidth; clearTimeout(paperT); paperT = setTimeout(applyPaper, 400); }); // solo se cambia la larghezza (rotazione), non per la barra degli indirizzi

// ---------- condivisione ----------
async function shareBlob(blob, name, text, saveId) {
  const file = blob && new File([blob], name, { type: 'image/png' });
  try {
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
    else if (navigator.share) await navigator.share({ title: 'Cult Pop LIVE', text, url: cfg.show.instagramUrl });
    else document.getElementById(saveId)?.click();
  } catch { /* annullato dall'utente */ }
}

// ---------- carta d'identità generazionale (attività dell'attesa) ----------
const idOffer = () => !state?.open && state?.mode !== 'finale';
let idPhoto = null, idUrl = null, idBlob = null;
async function renderIdCard() {
  $app.innerHTML = `${header()}
    <section class="final idcard">
      <div class="id-banner hidden" id="idBanner">Lo show è iniziato! <button class="link-btn" id="idBack2">Torna a votare →</button></div>
      <h2 class="rc-k">La tua carta d'identità generazionale</h2>
      <img class="card-img" id="idImg" alt="Carta d'identità generazionale di ${esc(me.nick)}">
      <input type="file" id="idFile" accept="image/*" capture="user" hidden>
      <div class="actions">
        <button class="btn viola wide" id="idShot">📸 ${idPhoto ? 'Rifai la foto' : 'Fatti una foto'}</button>
        <button class="btn fucsia" id="idShare">Condividi</button>
        <a class="btn bianco" id="idSave" download="cultpop-carta-identita.png">Salva</a>
      </div>
      <p class="tip">La foto resta sul tuo telefono: non viene inviata a nessuno.</p>
      <button class="link-btn" id="idBack">← Torna indietro</button>
    </section>`;
  const back = () => { idMode = false; render(true); };
  document.getElementById('idBack').onclick = back;
  document.getElementById('idBack2').onclick = back;
  const input = document.getElementById('idFile');
  document.getElementById('idShot').onclick = () => input.click();
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try { idPhoto = await loadPhoto(f); idUrl = null; renderIdCard(); }
    catch { showConn('Non riesco a leggere la foto, riprova', true); setTimeout(() => showConn(null), 2500); }
  };
  document.getElementById('idShare').onclick = () => shareBlob(idBlob, 'cultpop-carta-identita.png', `Sono un/una ${gen()?.nomeSingolare || gen()?.nome || ''} ${cfg.show.instagramHandle || ''}`, 'idSave');
  updateIdBanner();
  try {
    if (!idUrl) {
      idBlob = await makeIdCard({ nick: me.nick, year: me.year, gen: gen(), photo: idPhoto, cfg });
      idUrl = URL.createObjectURL(idBlob);
    }
    document.getElementById('idImg').src = idUrl;
    document.getElementById('idSave').href = idUrl;
  } catch (e) { console.error(e); }
}
function updateIdBanner() { document.getElementById('idBanner')?.classList.toggle('hidden', !state?.open); }

showConn(null);
