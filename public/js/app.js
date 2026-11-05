// Sito del pubblico. Il server è l'unica fonte di verità: qui si disegna lo stato ricevuto.
// Percorso: regole → nickname e anno → generazione → reazioni (tutto lo show) → SOS quando li lancia la regia → finale.
import { makeCard } from './card.js';

const params = new URLSearchParams(location.search);
const SHOW = params.get('show') === 'prova' ? 'prova' : 'live';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modalità privata */ } },
};
const K = (k) => `cp_${SHOW}_${k}`;

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
  if (store.get(K('intro')) !== '1') v = 'intro';
  else if (!me.nick) v = 'profilo';
  else if (state.mode === 'sos' && state.sos) v = `sos:${state.sos.runId}${sosOver() ? ':chiuso' : ''}`;
  else if (store.get(K('reveal')) !== '1') v = 'generazione';
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
    else if (v === 'attesa') renderWaiting();
    else if (v === 'reazioni') renderReactions();
    else if (v === 'chiuse') renderVotesClosed();
    else if (v.endsWith(':chiuso')) renderSosClosed();
    else if (v.startsWith('sos:')) { renderSos(); if (!prev.startsWith(v)) alertSos(); }
    else if (v.startsWith('finale:')) renderFinal();
  } else {
    if (v === 'reazioni') updateReactionBar();
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
  document.getElementById('go').onclick = () => { store.set(K('intro'), '1'); keepAwake(); render(true); };
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
      <p class="tip">Scorri per scegliere l'anno · nickname e anno restano solo sul tuo telefono e nelle statistiche anonime della serata</p>
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
      <h1 class="gen-name"><span class="brush">${esc(g?.nome || 'Generazione misteriosa')}</span></h1>
      <img class="gen-img" src="${esc(g?.immagine || '')}" alt="" style="background:${esc(g?.colore || '#fff')}">
      <p class="gen-quote">${esc(g?.testo || '')}</p>
      <button class="btn viola" id="toShow">Inizia a votare</button>
      <button class="link-btn" id="changeYear">Ho sbagliato anno</button>
    </section>`;
  document.getElementById('toShow').onclick = () => { store.set(K('reveal'), '1'); keepAwake(); render(true); };
  document.getElementById('changeYear').onclick = () => { me.nick = null; render(true); };
}

function genChip() {
  const g = gen();
  return g ? `<span class="gen-chip" style="background:${esc(g.colore)}">${esc(g.nome)}</span>` : '';
}

function renderWaiting() {
  $app.innerHTML = `${header()}
    <div class="center-screen">
      <div class="hero" style="margin:0 -16px"></div>
      <p class="hello">Ciao ${esc(me.nick)} ${genChip()}</p>
      <h1 class="big-title">Lo show sta per iniziare</h1>
      <p class="plain">Tieni aperta questa pagina: si attiverà da sola.</p>
    </div>`;
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
      <p class="plain">Grazie ${esc(me.nick)}! ${genChip()}</p>
    </section>`;
}

const sosOver = () => !!state?.sos && (state.sos.closed || state.sos.endsAt - serverNow() <= 0);
function renderSosClosed() {
  const mine = me.sosVotes?.[state.sos.runId];
  $app.innerHTML = `${header()}
    <section class="closed-screen">
      <h1 class="closed-title"><span class="brush">Voti chiusi! Guarda il LED 👀</span></h1>
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
function renderSos() {
  const s = state.sos;
  const mine = me.sosVotes?.[s.runId];
  $app.innerHTML = `${header()}
    <section class="q-screen">
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
      if (!err && res?.ok) { me.sosVotes = { ...me.sosVotes, [s.runId]: res.choice }; buzz(30); renderSos(); }
      else if (!err && res?.reason === 'scaduto') renderSos();
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
        <span class="q-kicker brush">Che Rom-Com sei?</span>
        <p class="progress">Domanda ${n} di ${cfg.domandeAB.length}</p>
        <h2 class="q-text">${esc(q.testo)}</h2>
        <div class="ab-opts">${['A', 'B'].map((k) => `<button class="opt ${k}" data-k="${k}"><b>${k}</b>${esc(q[k])}</button>`).join('')}</div>
        <button class="link-btn" id="back">← Torna indietro</button>
      </section>`;
    $app.querySelectorAll('.opt').forEach((b) => (b.onclick = () => answerAB(q.id, b.dataset.k, () => render(true))));
    document.getElementById('back').onclick = () => setFinal('home');
    return;
  }
  if (finalView === 'card') {
    const p = me.profilo;
    if (!p) {
      $app.innerHTML = `${header()}<div class="center-screen"><p class="loading">Stiamo calcolando la tua Rom-Com…</p></div>`;
      setTimeout(refreshMe, 1200);
      return;
    }
    const fav = cfg.concorrenti.find((c) => c.id === me.recap?.favorito);
    $app.innerHTML = `${header()}
      <section class="final">
        <h2>La tua Rom-Com è…</h2>
        <img class="card-img" id="card" alt="${esc(p.titolo)}: ${esc(p.descrizione)}">
        <div class="actions">
          <button class="btn viola" id="share">Condividi</button>
          <a class="btn bianco" id="save" download="cultpop-romcom.png">Salva</a>
          <a class="btn fucsia wide" href="${esc(cfg.show.instagramUrl)}" target="_blank" rel="noopener">Seguici su Instagram</a>
        </div>
        <p class="tip">Se il salvataggio non parte, tieni premuto sull'immagine</p>
        <button class="link-btn" id="back">← Torna al finale</button>
      </section>`;
    document.getElementById('back').onclick = () => setFinal('home');
    const img = document.getElementById('card');
    try {
      if (!cardUrl) {
        const blob = await makeCard({ profile: p, recap: me.recap, fav, cfg, nick: me.nick, gen: gen() });
        window.__cardBlob = blob;
        cardUrl = URL.createObjectURL(blob);
      }
      img.src = cardUrl;
      document.getElementById('save').href = cardUrl;
    } catch (e) { console.error(e); }
    document.getElementById('share').onclick = async () => {
      const blob = window.__cardBlob;
      const file = blob && new File([blob], 'cultpop-romcom.png', { type: 'image/png' });
      try {
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'La mia Rom-Com', text: `Sono "${p.titolo}" ${cfg.show.instagramHandle || ''}` });
        else if (navigator.share) await navigator.share({ title: 'Cult Pop LIVE', text: `Sono "${p.titolo}"`, url: cfg.show.instagramUrl });
        else document.getElementById('save').click();
      } catch { /* annullato */ }
    };
    return;
  }
  // home del finale
  const r = me.recap || {};
  const fav = cfg.concorrenti.find((c) => c.id === r.favorito);
  const emo = cfg.emoji.find((e) => e.id === r.topEmoji);
  const done = !missing.length;
  $app.innerHTML = `${header()}
    <section class="final">
      <h1 class="big-title">Grazie, ${esc(me.nick)}!</h1>
      <button class="cta" id="quiz">
        <span class="cta-t">${done ? 'Rivedi la tua Rom-Com' : 'Scopri che Rom-Com sei'}</span>
        <span class="cta-s">${done ? 'Salvala e condividila' : 'Nessuna risposta sbagliata'}</span>
      </button>
      <div class="recap">
        <strong>Il tuo show in breve</strong> ${genChip()}<br>
        ${r.taps ? `Hai reagito <strong>${r.taps}</strong> volte.` : 'Stasera hai fatto il tifo in silenzio.'}
        ${fav ? `<br>Il tuo Gen Z preferito: <strong>${esc(fav.nome)}</strong>.` : ''}
        ${emo ? `<br>La tua emoji del cuore: ${esc(emo.simbolo)}` : ''}
      </div>
      <p class="follow">${esc(cfg.show.seguici || '')}</p>
      <a class="btn fucsia" href="${esc(cfg.show.instagramUrl)}" target="_blank" rel="noopener">Seguici su Instagram ${esc(cfg.show.instagramHandle || '')}</a>
    </section>`;
  document.getElementById('quiz').onclick = () => setFinal(done ? 'card' : 'quiz');
}

showConn(null);
