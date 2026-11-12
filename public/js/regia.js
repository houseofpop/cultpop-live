// Control Room. Ogni pulsante invia un comando al server; lo stato mostrato è sempre quello del server.
// Tre zone: TELEFONI (cosa vede il pubblico), LIVE + PUNTI, LED (anteprima → pubblica).
import { drawScene, prepareAssets, downloadPng, SCENE_LABEL } from './led.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = 'ABCDEFGH';
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const hhmm = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// Aggiorna il DOM sul posto: un clic dell'operatore non va mai perso perché il pulsante è stato ricreato.
function morph(el, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  syncChildren(el, t.content);
}
function syncChildren(a, b) {
  const an = [...a.childNodes], bn = [...b.childNodes];
  bn.forEach((y, i) => {
    const x = an[i];
    if (!x) return a.appendChild(y);
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) return a.replaceChild(y, x);
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if ('disabled' in x) x.disabled = y.hasAttribute('disabled');
    syncChildren(x, y);
  });
  for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i]);
}

let socket = null, cfg = null, pub = null, qrs = {}, A = null, screenKey = '', offset = 0;
const ledSize = () => ({ width: cfg?.show?.led?.larghezza || 1920, height: cfg?.show?.led?.altezza || 1080 }); // stesso formato del LED wall
let show = ss.get('cp_regia_show') || 'prova'; // per sicurezza si parte dalla PROVA
const envFor = () => ({ config: pub, qr: qrs[A?.showId || show], now: () => Date.now() + offset });

$('loginForm').onsubmit = (e) => { e.preventDefault(); connect($('pw').value); };
if (ss.get('cp_regia_pw')) connect(ss.get('cp_regia_pw'));

function connect(password) {
  socket?.disconnect();
  socket = io('/regia', { auth: { password, show }, reconnectionDelayMax: 3000 });
  socket.on('connect_error', (e) => {
    if (/password|tentativi/.test(e.message)) { $('loginErr').textContent = e.message; $('login').classList.remove('hidden'); $('room').classList.add('hidden'); socket.disconnect(); }
    $('connDot').classList.add('off');
  });
  socket.on('connect', () => { ss.set('cp_regia_pw', password); $('login').classList.add('hidden'); $('room').classList.remove('hidden'); $('connDot').classList.remove('off'); });
  socket.on('disconnect', () => { $('connDot').classList.add('off'); toast('Regia disconnessa dal server: riconnessione…', true); });
  socket.on('admin:init', async (m) => {
    cfg = m.config; pub = m.pubConfig; screenKey = m.screenKey; qrs = m.qr || {};
    buildStatic();
    await prepareAssets(pub, qrs.live);
    await prepareAssets(pub, qrs.prova);
    lastPrev = lastProg = '';
    if (A) render();
  });
  socket.on('admin:state', (s) => { A = s; offset = s.serverNow - Date.now(); render(); });
  socket.on('admin:connected', (n) => { if (A) { A.connected = n; $('connected').textContent = n; } });
}

function cmd(type, args = {}, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  socket.timeout(5000).emit('cmd', { type, args }, (err, res) => {
    if (err) toast('Nessuna risposta dal server!', true);
    else if (!res.ok) toast(res.error, true);
  });
}

let toastT;
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------- pressione prolungata per le azioni delicate (niente popup) ----------
const HOLD_ACTIONS = {
  finale: { ms: 1200, run: () => cmd('finale') },
  freeze: { ms: 1200, run: () => cmd('freeze', { frozen: !A.audienceFrozen }) },
  publish: { ms: () => (A?.led?.preview?.type === 'verdetto' ? 2000 : 0), run: () => cmd('ledPublish') },
  qForceSos: { ms: 1500, run: () => cmd('quizShowSos', { force: true }) },
  qForceTeams: { ms: 1500, run: () => cmd('quizRevealTeams', { force: true }) },
};
function setupHold() {
  let timer = null, btn = null, firedAt = 0;
  const cancel = () => { clearTimeout(timer); timer = null; btn?.classList.remove('holding'); btn = null; };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-hold]');
    if (!b || b.disabled) return;
    const a = HOLD_ACTIONS[b.dataset.hold];
    const ms = typeof a.ms === 'function' ? a.ms() : a.ms;
    if (!ms) return; // nessuna attesa: gestito dal click
    e.preventDefault();
    btn = b;
    b.style.setProperty('--hold-ms', `${ms}ms`);
    b.classList.add('holding');
    timer = setTimeout(() => { a.run(); firedAt = Date.now(); cancel(); }, ms);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => document.addEventListener(ev, (e) => { if (btn && (ev !== 'pointerleave' || e.target === btn)) cancel(); }, true));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hold]');
    if (!b || b.disabled) return;
    const a = HOLD_ACTIONS[b.dataset.hold];
    const ms = typeof a.ms === 'function' ? a.ms() : a.ms;
    if (!ms) a.run();
    else if (!b.classList.contains('holding') && Date.now() - firedAt > 600) toast('Tieni premuto per confermare');
  });
}

// ---------- parti statiche ----------
function buildStatic() {
  document.querySelectorAll('.sw').forEach((b) => (b.onclick = () => {
    if (b.dataset.show === show) return;
    if (b.dataset.show === 'live' && !confirm('Passare allo show LIVE (quello reale)?')) return;
    show = b.dataset.show; ss.set('cp_regia_show', show);
    lastPrev = lastProg = '';
    socket.emit('switchShow', show);
  }));
  $('openBtn').onclick = () => cmd('open', { open: !A.open }, A.open ? 'Chiudere la sessione? I telefoni torneranno in attesa.' : null);
  $('lockBtn').onclick = () => cmd('lock', { locked: !A.reactionsLocked });
  $('backBtn').onclick = () => cmd('reactions');
  $('pngBtn').onclick = () => downloadPng($('programCv'), `cultpop-led-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`);
  $('resetBtn').onclick = () => {
    if (show === 'live') { const c = prompt('Stai per AZZERARE LO SHOW LIVE. Scrivi: AZZERA LIVE'); if (c) cmd('reset', { confirm: c }); }
    else cmd('reset', {}, 'Azzerare lo show di PROVA?');
  };
  $('sfBonus').textContent = cfg.punteggi.sugarfree.bonus;
  $('adjTarget').innerHTML = cfg.coppie.map((t) => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join('')
    + cfg.concorrenti.map((c) => `<option value="${esc(c.id)}">Gen Z: ${esc(c.nome)}</option>`).join('');
  $('adjForm').onsubmit = (e) => {
    e.preventDefault();
    cmd('adjAdd', { target: $('adjTarget').value, delta: Number($('adjDelta').value) });
    $('adjDelta').value = '';
  };
  if (!window.__regiaDelegated) {
    window.__regiaDelegated = true;
    // barra spaziatrice: domanda e risposte del quiz una alla volta (mai mentre si scrive in un campo)
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (!A?.qz || A.qz.step >= 5) return;
      e.preventDefault();
      cmd('quizNext');
    });
    setupHold();
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sos],button[data-q],button[data-sf],button[data-del],button[data-act],button[data-scene],button[data-qopen],button[data-qreset],button[data-qa],button[data-qsos]');
      if (!b || b.disabled || !A) return;
      const d = b.dataset;
      if (d.sos) {
        const used = A.sosUsed[d.team];
        const def = cfg.sos.find((s) => s.id === d.sos);
        cmd('sosStart', { sosId: d.sos, teamId: d.team, alsoLed: $('sosLed').checked }, used ? `⚠️ ${teamName(d.team)} ha GIÀ usato il suo SOS. Avviarlo comunque?` : `Avviare SOS (${def.durataSecondi}s) per ${teamName(d.team)}${$('sosLed').checked ? ' — anche sul LED' : ''}?`);
      } else if (d.qopen) {
        const busy = A.qz && !A.qz.correctRevealed && A.qz.step > 0;
        cmd('quizOpen', { qid: d.qopen }, busy ? 'La domanda in corso non è finita. Passare comunque a un\'altra?' : null);
      } else if (d.qreset) cmd('quizReset', { qid: d.qreset }, 'Rigiocare questa domanda? Il risultato e i punti assegnati vengono cancellati.');
      else if (d.qa) cmd('quizAnswer', { teamId: d.qa, idx: d.i === '' ? null : Number(d.i) });
      else if (d.qsos) cmd('quizSos', { teamId: d.qsos }, `SOS per ${teamName(d.qsos)}? Il timer si ferma e il pubblico vota dal telefono.`);
      else if (d.act === 'qNext') cmd('quizNext');
      else if (d.act === 'qClose') cmd('quizClose');
      else if (d.act === 'qShowSos') cmd('quizShowSos');
      else if (d.act === 'qTeams') cmd('quizRevealTeams');
      else if (d.act === 'qCorrect') cmd('quizRevealCorrect', {}, 'Rivelare la risposta giusta? I punti vengono assegnati.');
      else if (d.sf !== undefined) cmd('sugarfree', { teamId: d.sf || null });
      else if (d.del) cmd('adjDel', { id: d.del }, 'Annullare questa correzione?');
      else if (d.scene) cmd('ledPrepare', { type: d.scene });
      else if (d.act === 'back') cmd('reactions');
      else if (d.act === 'sosClose') cmd('sosClose', {}, 'Chiudere subito il voto SOS?');
      else if (d.act === 'sosReveal') cmd('sosReveal');
      else if (d.act === 'sosToLed') { cmd('ledPrepare', { type: 'sos' }); }
      else if (d.act === 'sfLock') cmd('sugarfreeLock', { locked: true }, `Confermare il voto Sugarfree per ${teamName(A.sugarfree)}? Dopo non si potrà cambiare senza sbloccarlo.`);
      else if (d.act === 'sfUnlock') cmd('sugarfreeLock', { locked: false }, 'Sbloccare il voto Sugarfree?');
    });
  }
}

// ---------- render ----------
const teamName = (id) => cfg.coppie.find((t) => t.id === id)?.nome || id;
const contName = (id) => cfg.concorrenti.find((c) => c.id === id)?.nome || id;
const modeLabel = { attesa: 'In attesa', reazioni: 'Reazioni', sos: 'SOS', finale: 'Finale' };

function render() {
  if (!cfg || !A) return;
  document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b.dataset.show === A.showId));
  $('topbar').classList.toggle('prova', A.showId === 'prova');
  $('connected').textContent = A.connected;
  $('modePill').textContent = A.open || A.mode === 'finale' ? modeLabel[A.mode] : 'Sessione chiusa';
  const prog = A.led.program;
  $('ledPill').textContent = prog ? `${SCENE_LABEL[prog.type]}${prog.publishedAt ? ' · ' + hhmm(prog.publishedAt) : ''}` : '—';
  $('openBtn').textContent = A.open ? '⏹ Chiudi sessione' : '▶︎ Apri sessione';
  $('openBtn').className = 'tbtn ' + (A.open ? '' : 'warn');
  $('lockBtn').textContent = A.reactionsLocked ? '🔓 Sblocca reazioni' : '🔒 Blocca reazioni';
  $('lockBtn').className = 'tbtn ' + (A.reactionsLocked ? 'warn' : '');
  $('freezeBtn').querySelector('.hold-label').textContent = A.audienceFrozen ? '🔓 Riapri voti pubblico (tieni premuto)' : '🔒 CHIUDI VOTAZIONI (tieni premuto)';

  // domande del quiz
  const qs = cfg.quiz?.domande || [];
  morph($('quizList'), qs.map((q, i) => {
    const res = A.quizResults[q.id], cur = A.qz?.qid === q.id;
    const state = res ? `✓ giocata · ${cfg.coppie.map((t) => `${esc(t.nome.replace('Squadra ', ''))} ${res[t.id]?.punti ?? 0}`).join(' · ')}` : cur ? '▶ in corso' : 'da giocare';
    return `<div class="quiz-item ${cur ? 'cur' : ''} ${res ? 'done' : ''}">
      <p><b>${i + 1}.</b> ${esc(q.testo)}</p><span class="muted">${state}</span>
      <div class="row">${res ? `<button class="tbtn small" data-qreset="${esc(q.id)}">Rigioca</button>` : cur ? '' : `<button class="tbtn small" data-qopen="${esc(q.id)}">Prepara</button>`}</div>
    </div>`;
  }).join('') || '<p class="muted">Nessuna domanda in config/show.json → quiz.domande.</p>');
  const usedSos = cfg.coppie.filter((t) => A.sosUsed[t.id]).map((t) => t.nome.replace('Squadra ', ''));
  if (usedSos.length) $('quizList').insertAdjacentHTML('beforeend', `<p class="muted">SOS già usato: ${esc(usedSos.join(', '))}</p>`);

  // generazioni dal vivo
  const gs = A.genStats;
  morph($('genList'), (cfg.generazioni || []).filter((g) => gs.counts[g.id]).map((g) => `<div><span><i style="background:${esc(g.colore)}"></i>${esc(g.nome)}</span><b>${gs.counts[g.id]} · ${Math.round((gs.counts[g.id] / gs.total) * 100)}%</b></div>`).join('') || '<p class="muted">Ancora nessuno ha inserito l\'anno.</p>');

  renderLive();
  renderScores();
  renderLed();
  morph($('log'), A.log.map((l) => `<li><time>${new Date(l.t).toLocaleTimeString('it-IT')}</time>${esc(l.msg)}</li>`).join(''));
}

let timerInt = null;
function renderLive() {
  clearInterval(timerInt);
  const P = $('livePanel');
  if (A.qz && A.mode !== 'finale') return renderQuizPanel(P);
  if (A.mode === 'sos' && A.sos && !A.sos.quizQid) return renderSosPanel(P);
  $('liveTitle').textContent = A.mode === 'finale' ? 'Finale in corso' : 'Reazioni del pubblico';
  const em = cfg.reazioni.emoji;
  const rows = cfg.concorrenti.map((c) => {
    const r = A.reactions[c.id];
    const team = cfg.coppie.find((t) => t.id === c.coppia);
    return `<tr><td><span class="sw-chip" style="background:${esc(team.colore)}"></span>${esc(c.nome)}</td>
      ${em.map((e) => `<td title="validi / tap totali">${r.valid[e.id]}<small style="opacity:.5"> /${r.raw[e.id]}</small></td>`).join('')}
      <td class="pts">${r.points}</td></tr>`;
  }).join('');
  const taps = cfg.concorrenti.reduce((s, c) => s + A.reactions[c.id].taps, 0);
  morph(P, `
    <div class="kpis">
      <div class="kpi">Connessi<b>${A.connected}</b></div>
      <div class="kpi">Hanno inserito l'anno<b>${A.genStats.total}</b></div>
      <div class="kpi">Tap totali<b>${taps}</b></div>
    </div>
    ${sosAfterBox()}
    ${A.reactionsLocked ? '<p class="result tie">Reazioni BLOCCATE</p>' : ''}
    ${A.audienceFrozen ? '<p class="result tie">Voti del pubblico CHIUSI: punti congelati</p>' : ''}
    <table class="rx-table"><thead><tr><th>Gen Z</th>${em.map((e) => `<th>${e.simbolo} ${e.punti > 0 ? '+' : ''}${e.punti}</th>`).join('')}<th>Punti</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Reazioni valide / tap totali. Limite: ${cfg.reazioni.rateLimit.reazioniValide} reazioni valide ogni ${cfg.reazioni.rateLimit.finestraSecondi}s per persona.</p>`);
}

// Dopo il ritorno automatico alle reazioni, l'ultimo SOS resta gestibile: percentuali e risposta giusta sul LED quando vuoi tu.
function sosAfterBox() {
  const s = A.sos;
  if (!s || !s.closed || s.revealed || s.quizQid || A.mode === 'finale') return '';
  const def = cfg.sos.find((x) => x.id === s.sosId);
  if (!def) return '';
  const onLed = A.led.program?.type === 'sos' && A.led.program.runId === s.runId;
  const top = s.result?.top || [];
  const tot = s.voters || 1;
  return `<div class="sos-after">
    <b>🆘 Ultimo SOS · ${esc(teamName(s.teamId))}</b>
    <span class="muted">${!top.length ? 'Nessun voto' : s.result.tie ? `Pubblico diviso tra ${top.map((i) => L[i]).join(' e ')}` : `Il pubblico ha scelto ${L[top[0]]} (${Math.round((s.result.max / tot) * 100)}%)`} · risposta giusta: ${L[def.corretta]}. ${esc(def.opzioni[def.corretta])}</span>
    <div class="row wrap">
      ${onLed ? '<span class="muted">🖥 Sul LED ci sono le percentuali</span>' : '<button class="tbtn" data-act="sosToLed">Prepara le percentuali per il LED</button>'}
      <button class="tbtn warn" data-act="sosReveal">Rivela risposta corretta (${L[def.corretta]}) sul LED</button>
    </div>
    ${onLed ? '' : '<span class="muted">La risposta giusta compare sulla scena SOS del LED: se sul LED c\'è altro, prima prepara e pubblica le percentuali.</span>'}
  </div>`;
}

// ---------- QUIZ: un pannello con i comandi nell'ordine in cui servono ----------
function renderQuizPanel(P) {
  const z = A.qz;
  const qs = cfg.quiz.domande;
  const q = qs.find((x) => x.id === z.qid);
  const n = qs.indexOf(q) + 1;
  const sos = A.sos && A.sos.runId === z.sosRunId ? A.sos : null;
  const per = A.quizPerRisposta || { per: 10, sos: 5 };
  $('liveTitle').textContent = `Quiz · domanda ${n} di ${qs.length}`;
  const nextLabel = z.step === 0 ? '⎵ Mostra la DOMANDA sul LED' : z.step < 5 ? `⎵ Mostra la risposta ${L[z.step - 1]}` : 'Domanda e risposte sono sul LED';
  const missingOthers = cfg.coppie.filter((t) => t.id !== z.sosTeam && z.answers[t.id] == null);
  const missingAll = cfg.coppie.filter((t) => z.answers[t.id] == null);
  const timer = z.timer ? `<div class="big-timer small" id="qTimer">${qTimerText(z.timer)}</div>` : '';
  const rows = cfg.coppie.map((t) => {
    const a = z.answers[t.id], isSos = z.sosTeam === t.id, used = A.sosUsed[t.id];
    const lockLetters = z.correctRevealed || z.step < 1;
    const sosBtn = z.correctRevealed || z.teamsRevealed ? '' : isSos ? '<span class="qp-sos on">🆘 SOS</span>'
      : `<button class="tbtn small" data-qsos="${esc(t.id)}" ${z.step < 5 || z.sosTeam || used || (A.sos && !A.sos.closed) ? 'disabled' : ''} title="${used ? 'SOS già usato' : z.sosTeam ? 'Su questa domanda c\'è già stato un SOS' : 'La squadra chiede aiuto al pubblico'}">🆘${used ? ' usato' : ''}</button>`;
    const res = A.quizResults[z.qid]?.[t.id];
    const state = res ? (res.corretta ? `✓ giusta +${res.punti}` : '✗ sbagliata') : a == null ? 'pensa…' : z.teamsRevealed ? `sul LED: ${L[a]}` : `✓ ${L[a]} (nascosta)`;
    return `<tr class="${isSos ? 'sos-row' : ''}"><td><span class="sw-chip" style="background:${esc(t.colore)}"></span><b>${esc(t.nome.replace('Squadra ', ''))}</b></td>
      <td><span class="qp-letters">${q.opzioni.map((_, i) => `<button data-qa="${esc(t.id)}" data-i="${i}" aria-pressed="${a === i}" ${lockLetters ? 'disabled' : ''}>${L[i]}</button>`).join('')}${a != null && !lockLetters ? `<button data-qa="${esc(t.id)}" data-i="" title="Togli">✕</button>` : ''}</span></td>
      <td class="qp-state">${state}</td><td>${sosBtn}</td></tr>`;
  }).join('');
  let sosBox = '';
  if (sos) {
    const tot = sos.voters || 1, top = sos.result?.top || [];
    sosBox = `<div class="qp-box">
      <div class="row" style="justify-content:space-between"><b>🆘 SOS · ${esc(teamName(sos.teamId))}</b><span><b id="qSosTimer">${sos.closed ? 'voto chiuso' : Math.ceil(Math.max(0, sos.endsAt - (Date.now() + offset)) / 1000) + ' s'}</b> · ${sos.voters} voti</span></div>
      <div class="bars">${q.opzioni.map((o, i) => `<div class="bar ${top.includes(i) ? 'top' : ''}"><i style="width:${(sos.counts[i] / tot) * 100}%"></i><span><span>${L[i]}. ${esc(o)}</span><span>${sos.counts[i]} · ${Math.round((sos.counts[i] / tot) * 100)}%</span></span></div>`).join('')}</div>
      ${!sos.closed ? '<button class="tbtn danger" data-act="sosClose">Chiudi ora il voto</button>'
        : z.sosShown ? '<p class="muted">Voti del pubblico sul LED. Il timer è ripartito per la squadra dell\'SOS.</p>'
        : missingOthers.length ? `<p class="qp-warn">Prima di mostrare i voti devono rispondere: <b>${missingOthers.map((t) => esc(t.nome)).join(', ')}</b></p>
            <button class="tbtn" disabled>Mostra i voti del pubblico</button>
            <button class="cue hold dark-hold qp-force" data-hold="qForceSos"><span class="hold-fill"></span><span class="hold-label">Mostrali comunque (tieni premuto)</span></button>`
        : '<button class="tbtn big warn" data-act="qShowSos">📊 Mostra i voti del pubblico sul LED</button>'}
      ${sos.closed && A.mode === 'sos' ? '<p class="muted">I telefoni sono su «Guarda il LED»: riportali alle reazioni con il pulsante in alto quando vuoi.</p>' : ''}
    </div>`;
  }
  let reveal = '';
  if (z.step >= 5 && !z.teamsRevealed) {
    const blocked = (z.sosTeam && !z.sosShown) ? 'Prima mostra i voti del pubblico' : missingAll.length ? `Mancano: ${missingAll.map((t) => esc(t.nome)).join(', ')}` : '';
    reveal = blocked ? `<p class="qp-warn">${blocked}</p><button class="tbtn" disabled>🪧 Mostra le risposte delle squadre</button>${missingAll.length && !(z.sosTeam && !z.sosShown) ? '<button class="cue hold dark-hold qp-force" data-hold="qForceTeams"><span class="hold-fill"></span><span class="hold-label">Mostrale comunque, chi manca ha 0 (tieni premuto)</span></button>' : ''}`
      : '<button class="tbtn big warn" data-act="qTeams">🪧 Mostra le risposte delle squadre sul LED</button>';
  } else if (z.teamsRevealed && !z.correctRevealed) reveal = `<button class="tbtn big confirm" data-act="qCorrect">✅ Rivela la risposta giusta (${L[q.corretta]}) e assegna i punti</button>`;
  else if (z.correctRevealed) reveal = `<p class="result">Fatto. Scegli la prossima domanda a sinistra, oppure prepara un'altra scena per il LED.</p><button class="tbtn" data-act="qClose">Chiudi la domanda (torna alle reazioni in regia)</button>`;
  morph(P, `
    <div class="quiz-panel">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><p class="q-big">${esc(q.testo)}</p>${timer}</div>
      <div class="qp-answers">${q.opzioni.map((o, i) => `<span class="${i === q.corretta ? 'ok' : ''} ${z.step >= i + 2 ? 'on' : ''}">${L[i]}. ${esc(o)}${i === q.corretta ? ' ✅' : ''}</span>`).join('')}</div>
      <button class="tbtn big qp-next" data-act="qNext" ${z.step >= 5 ? 'disabled' : ''}>${nextLabel}</button>
      <table class="qp-teams"><thead><tr><th>Squadra</th><th>Lavagnetta</th><th>Stato</th><th>SOS</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Segna la lettera di ogni squadra quando girano le lavagnette: sul LED compare solo «ha risposto» finché non mostri le risposte. Giusta = ${per.per} punti, con l'SOS ${per.sos}. ✅ = risposta giusta (solo in regia).</p>
      ${sosBox}
      ${reveal}
    </div>`);
  timerInt = setInterval(() => {
    const t = $('qTimer'); if (t && A.qz?.timer) t.textContent = qTimerText(A.qz.timer);
    const st = $('qSosTimer'); if (st && A.sos && !A.sos.closed) st.textContent = Math.ceil(Math.max(0, A.sos.endsAt - (Date.now() + offset)) / 1000) + ' s';
  }, 250);
}
function qTimerText(T) {
  const left = T.running ? T.endsAt - (Date.now() + offset) : T.left;
  return left <= 0 ? 'TEMPO!' : `${Math.ceil(left / 1000)} s${T.running ? '' : ' ⏸'}`;
}

function renderSosPanel(P) {
  const s = A.sos;
  const def = cfg.sos.find((x) => x.id === s.sosId);
  const tot = s.voters || 1;
  const top = s.result?.top || [];
  const onLed = A.led.program?.type === 'sos' && A.led.program.runId === s.runId;
  $('liveTitle').textContent = `SOS · ${teamName(s.teamId)}`;
  morph(P, `
    <div class="row" style="justify-content:space-between"><div class="big-timer" id="sosTimer">${s.closed ? 'CHIUSO' : Math.ceil(Math.max(0, s.endsAt - (Date.now() + offset)) / 1000) + 's'}</div><div><b>${s.voters}</b> voti · ${A.connected} connessi<br><span class="muted">${onLed ? '🖥 Sul LED: countdown e poi percentuali' : '🖥 NON è sul LED'}</span></div></div>
    <p class="q-big">${esc(def.domanda)}</p>
    <div class="bars">${def.opzioni.map((o, i) => `<div class="bar ${i === def.corretta ? 'correct' : ''} ${top.includes(i) ? 'top' : ''}"><i style="width:${(s.counts[i] / tot) * 100}%"></i><span><span>${L[i]}. ${esc(o)} ${i === def.corretta ? '✅' : ''}</span><span>${s.counts[i]} · ${Math.round((s.counts[i] / tot) * 100)}%</span></span></div>`).join('')}</div>
    <p class="muted">✅ = risposta corretta (visibile solo in regia). Sul LED le percentuali compaiono solo a voto chiuso.</p>
    ${s.closed ? `<div class="result ${s.result.tie ? 'tie' : ''}">${!top.length ? 'Nessun voto ricevuto' : s.result.tie ? `PARITÀ tra ${top.map((i) => L[i]).join(' e ')} (${s.result.max} voti ciascuna): il pubblico è diviso` : `Il pubblico suggerisce: ${L[top[0]]}. ${esc(def.opzioni[top[0]])} (${Math.round((s.result.max / tot) * 100)}%)`}</div>
      <div class="row wrap" style="margin-top:10px">
        ${!onLed ? '<button class="tbtn" data-act="sosToLed">Prepara i risultati per il LED</button>' : ''}
        ${s.revealed ? '<span class="muted">Risposta corretta già rivelata sul LED</span>' : `<button class="tbtn warn" data-act="sosReveal">Rivela risposta corretta (${L[def.corretta]}) sul LED</button>`}
        <button class="tbtn big" data-act="back">↩ Telefoni su Reazioni ora</button>
      </div>
      <p class="muted" id="autoBack">${autoBackText(s)}</p>`
      : `<button class="tbtn danger" data-act="sosClose">Chiudi ora il voto</button>`}`);
  const tick = () => {
    const el = $('sosTimer');
    if (!el) return clearInterval(timerInt);
    el.textContent = s.closed ? 'CHIUSO' : `${Math.ceil(Math.max(0, s.endsAt - (Date.now() + offset)) / 1000)}s`;
  };
  if (!s.closed) timerInt = setInterval(tick, 200);
  else timerInt = setInterval(() => { const el = $('autoBack'); if (!el) return clearInterval(timerInt); el.textContent = autoBackText(s); }, 500);
}

function tiesIn(teams) {
  const by = {};
  for (const t of teams) (by[t.totale] ||= []).push(t.nome);
  return Object.entries(by).filter(([, n]) => n.length > 1).map(([tot, squadre]) => ({ totale: Number(tot), squadre }));
}

function autoBackText(s) {
  const sec = cfg.sosRitornoAutomaticoSecondi ?? 0;
  if (!s.closed || !s.closedAt || A.mode !== 'sos') return '';
  if (sec <= 0) return 'I telefoni restano su «Guarda il LED» finché non premi «Telefoni su Reazioni ora».';
  const left = Math.max(0, Math.ceil((s.closedAt + sec * 1000 - (Date.now() + offset)) / 1000));
  return `I telefoni tornano da soli alle reazioni tra ${left} s (sul LED restano i risultati).`;
}

function renderScores() {
  const st = A.standings;
  const Q = cfg.punteggi.quiz;
  const byId = Object.fromEntries(st.coppie.map((t) => [t.id, t]));
  // la parità conta solo a fine puntata: l'avviso compare dopo «Chiudi votazioni»
  const ties = (A.audienceFrozen ? A.parita || [] : []).map((p) => `<div class="tie-alert">⚠️ <b>PARITÀ</b>: ${p.squadre.map(esc).join(' e ')} a <b>${p.totale}</b> punti. Se non intervieni decide lo spareggio (prima i punti quiz, poi quelli del pubblico). Per decidere voi: <i>Correzione manuale</i>, +1 alla squadra scelta.</div>`).join('');
  morph($('tieBox'), ties);
  morph($('scoreTable'), `<table class="score-table"><thead><tr><th>Squadra</th><th>Quiz (domande)</th><th>Reaz.</th><th>Pubbl.</th><th>SF</th><th>Corr.</th><th>Tot</th></tr></thead><tbody>
    ${cfg.coppie.map((t) => {
      const s = byId[t.id];
      const ind = st.individui.filter((i) => i.coppia === t.id).map((i) => `${esc(i.nome)} ${i.punti}`).join(' · ');
      const qres = (cfg.quiz?.domande || []).map((q, i) => { const r = A.quizResults[q.id]?.[t.id]; return r ? `<span class="qr ${r.corretta ? 'ok' : 'ko'}" title="Domanda ${i + 1}${r.sos ? ' con SOS' : ''}">${i + 1}${r.sos ? '🆘' : ''}</span>` : `<span class="qr" title="Domanda ${i + 1} da giocare">${i + 1}</span>`; }).join('');
      return `<tr><td><span class="sw-chip" style="background:${esc(t.colore)}"></span><b>${esc(t.nome)}</b><div class="indiv">${ind}</div></td>
        <td><span class="qbtns">${qres}</span> <b>${s.quiz}</b></td>
        <td>${s.reazioniTotali}</td><td>${s.pubblico}</td><td>${s.sugarfree || ''}</td><td>${s.correzioni || ''}</td><td class="tot">${s.totale}</td></tr>`;
    }).join('')}
    </tbody></table>
    <p class="muted">Classifica privata in tempo reale: ${st.coppie.map((t) => `${t.posizione}°${t.exAequo ? '=' : ''} ${esc(t.nome)}`).join(' · ')}. Quiz: ${A.quizPerRisposta?.per ?? 10} punti per risposta giusta, ${A.quizPerRisposta?.sos ?? 5} con l'SOS (totale ${Q.totale ?? 30}). Errori: «Rigioca» la domanda oppure Correzione manuale.</p>`);

  const locked = A.sugarfreeLocked;
  morph($('sfBox'), `
    <div class="sf-row">${cfg.coppie.map((t) => `<button class="sf-btn ${A.sugarfree === t.id ? 'on' : ''}" style="--team:${esc(t.colore)}" data-sf="${esc(t.id)}" ${locked ? 'disabled' : ''} aria-pressed="${A.sugarfree === t.id}"><i></i>${A.sugarfree === t.id ? '★ ' : ''}${esc(t.nome)}</button>`).join('')}</div>
    ${A.sugarfree && !locked ? '<button class="sf-clear" data-sf="">Annulla scelta</button>' : ''}
    <p class="sf-state ${locked ? 'ok' : ''}">${!A.sugarfree ? 'Seleziona la squadra scelta dagli Sugarfree.' : locked ? `✔ Confermato: ${esc(teamName(A.sugarfree))}. Ora puoi preparare il verdetto nella zona LED.` : `Scelta: ${esc(teamName(A.sugarfree))} (non ancora confermata)`}</p>
    ${A.sugarfree && !locked ? '<button class="tbtn confirm" data-act="sfLock">✔ Conferma voto Sugarfree</button>' : ''}
    ${locked ? `<button class="tbtn" data-act="sfUnlock" ${A.verdictPublished ? 'disabled' : ''}>Sblocca</button>` : ''}`);

  morph($('adjList'), A.adjustments.map((a) => `<li><span><b>${a.delta > 0 ? '+' : ''}${a.delta}</b> ${esc(a.kind === 'team' ? teamName(a.target) : contName(a.target))}${a.reason ? ': ' + esc(a.reason) : ''} <span class="muted">${hhmm(a.t)}</span></span><button data-del="${esc(a.id)}" title="Annulla">✕</button></li>`).join(''));
}

let lastPrev = '', lastProg = '', ledTimer = null;
function sceneSig(sc) { return sc ? JSON.stringify([sc.type, sc.t, sc.publishedAt, sc.runId, sc.sos && [sc.sos.closed, sc.sos.voters, sc.sos.corretta], sc.quiz && { ...sc.quiz, timer: sc.quiz.timer && { ...sc.quiz.timer, left: undefined, ended: undefined } }]) : ''; }
function renderLed() {
  const { preview, program } = A.led;
  const hasSos = !!(A.sos);
  const scenes = [
    ['promo', '📣 Promemoria QR'],
    ['classifica', '🏆 Classifica provvisoria'],
    ['generazioni', '👶 Generazioni in sala'],
    ['chiuse', '🔒 Votazioni chiuse'],
    ['verdetto', '👑 Verdetto finale'],
  ];
  morph($('sceneBtns'), scenes.map(([k, label]) => {
    const dis = (k === 'sos' && !hasSos) || (k === 'verdetto' && !A.sugarfreeLocked);
    const cls = [preview?.type === k ? 'is-preview' : '', program?.type === k ? 'is-program' : ''].join(' ');
    return `<button data-scene="${k}" class="${cls}" ${dis ? 'disabled' : ''} title="${k === 'verdetto' && !A.sugarfreeLocked ? 'Prima conferma il voto Sugarfree' : 'Prepara in anteprima'}">${label}</button>`;
  }).join(''));
  const pubBtn = $('publishBtn');
  const same = preview && program && sceneSig({ ...preview, publishedAt: undefined }) === sceneSig({ ...program, publishedAt: undefined });
  pubBtn.disabled = !preview || same;
  pubBtn.classList.toggle('danger-hold', preview?.type === 'verdetto');
  pubBtn.querySelector('.hold-label').textContent = !preview ? 'Prepara prima una scena' : same ? 'Già sulla pagina LED ✓' : preview.type === 'verdetto' ? 'PUBBLICA IL VERDETTO (tieni premuto 2 secondi)' : `PUBBLICA SUL LED ▶ ${SCENE_LABEL[preview.type]}`;
  $('previewInfo').textContent = preview ? `${SCENE_LABEL[preview.type]}, preparata alle ${hhmm(preview.t)}${preview.type === 'classifica' || preview.type === 'generazioni' || preview.type === 'verdetto' ? ' (dati fotografati in quel momento: ripremi per aggiornarli)' : ''}` : 'Nessuna anteprima.';
  if (preview?.type === 'verdetto') {
    const vt = tiesIn(preview.standings?.coppie || []);
    if (vt.length) $('previewInfo').textContent += ` ⚠️ PARITÀ nel verdetto: ${vt.map((p) => p.squadre.join(' e ') + ' a ' + p.totale).join('; ')}. Decide lo spareggio (quiz, poi pubblico) oppure fate una correzione manuale e ripreparate il verdetto.`;
  }
  $('programInfo').textContent = program ? `${SCENE_LABEL[program.type]}${program.publishedAt ? ', pubblicata alle ' + hhmm(program.publishedAt) : ''}. Il tecnico la manda in onda quando serve.` : '';
  $('screenLink').href = `/schermo?key=${encodeURIComponent(screenKey)}&show=${A.showId}`;
  const sp = sceneSig(preview), sg = sceneSig(program);
  if (sp !== lastPrev) { lastPrev = sp; if (preview) drawScene($('previewCv'), preview, envFor(), ledSize()); else clearCv($('previewCv')); }
  if (sg !== lastProg) { lastProg = sg; drawScene($('programCv'), program, envFor(), ledSize()); }
  clearInterval(ledTimer);
  const isLive = (sc) => (sc?.type === 'sos' && sc.sos && !sc.sos.closed) || (sc?.type === 'quiz' && sc.quiz && (sc.quiz.timer?.running || (sc.quiz.sos && !sc.quiz.sos.closed)));
  if ([preview, program].some(isLive)) ledTimer = setInterval(() => {
    if (isLive(preview)) drawScene($('previewCv'), preview, envFor(), ledSize());
    if (isLive(program)) drawScene($('programCv'), program, envFor(), ledSize());
  }, 500);
}
function clearCv(cv) { const c = cv.getContext('2d'); c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height); }
