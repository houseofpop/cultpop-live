// Simulatore di pubblico: N telefoni finti che reagiscono, rispondono alle A/B e votano gli SOS.
// Uso: npm run simulate -- --n=150 --url=http://localhost:3000 --show=prova
import { io } from 'socket.io-client';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const N = Number(arg('n', 150));
const URL = arg('url', 'http://localhost:3000');
const SHOW = arg('show', 'prova');
if (SHOW === 'live' && !process.argv.includes('--anche-live')) {
  console.error('Per sicurezza il simulatore non gira sullo show LIVE (aggiungi --anche-live se sei sicuro).');
  process.exit(1);
}

let connected = 0, sent = 0, abAnswers = 0, sosVotes = 0, errors = 0;
const rnd = (a, b) => a + Math.random() * (b - a);

for (let i = 0; i < N; i++) setTimeout(() => bot(i), rnd(0, 3000)); // ingresso scaglionato come al QR

function bot(i) {
  const s = io(URL, { auth: { show: SHOW }, transports: ['websocket', 'polling'] });
  let cfg = null, state = null, fav = null;
  const answered = new Set();
  // profilo di comportamento: alcuni spammano, altri sono tranquilli
  const spammer = Math.random() < 0.15;
  s.on('connect', () => connected++);
  s.on('disconnect', () => connected--);
  s.on('connect_error', () => errors++);
  s.on('welcome', (w) => {
    cfg = w.config; s.auth.token = w.token;
    fav = cfg.concorrenti[Math.floor(Math.random() * cfg.concorrenti.length)].id;
    // pubblico misto: tanti Gen Z e Millennial, qualche X e Boomer
    const r = Math.random();
    const year = r < 0.45 ? Math.round(rnd(1997, 2008)) : r < 0.85 ? Math.round(rnd(1981, 1996)) : r < 0.95 ? Math.round(rnd(1965, 1980)) : Math.round(rnd(1950, 1964));
    if (!w.me?.nick) setTimeout(() => s.emit('profile', { nick: 'Bot' + i, year }, () => {}), rnd(2000, 15000));
    onState(w.state);
  });
  s.on('state', onState);

  function onState(st) {
    state = st;
    if (st.mode === 'sos' && st.sos && !st.sos.closed && !answered.has(st.sos.runId) && Math.random() < 0.9) {
      answered.add(st.sos.runId);
      const bias = [0.2, 0.45, 0.2, 0.15];
      let x = Math.random(), idx = 0;
      while (x > bias[idx] && idx < 3) { x -= bias[idx]; idx++; }
      setTimeout(() => s.emit('sos', { runId: st.sos.runId, idx }, (r) => r?.ok && sosVotes++), rnd(1500, 26000));
    }
    if (st.mode === 'finale' && cfg && Math.random() < 0.7) { // non tutti fanno il quiz Rom-Com
      for (const q of cfg.domandeAB) if (!answered.has(q.id)) { answered.add(q.id); s.emit('ab', { qid: q.id, choice: Math.random() < 0.5 ? 'A' : 'B' }, (r) => r?.ok && abAnswers++); }
    }
  }

  setInterval(() => {
    if (!state || state.mode !== 'reazioni' || !state.open || state.reactionsLocked || !cfg) return;
    if (Math.random() < 0.1) fav = cfg.concorrenti[Math.floor(Math.random() * cfg.concorrenti.length)].id;
    if (!spammer && Math.random() < 0.6) return;
    const e = cfg.emoji[Math.floor(Math.random() ** 1.6 * cfg.emoji.length)].id; // più risate e cuori che rabbia
    const n = spammer ? Math.ceil(rnd(4, 12)) : Math.ceil(rnd(1, 3));
    s.emit('react', { b: [[fav, e, n]] });
    sent += n;
  }, 700);
}

setInterval(() => {
  console.log(`connessi ${connected}/${N} · tap inviati ${sent} · risposte quiz Rom-Com ${abAnswers} · voti SOS ${sosVotes} · errori ${errors}`);
}, 3000);
