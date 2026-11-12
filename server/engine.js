import { randomUUID } from 'node:crypto';

/**
 * ShowEngine: tutta la logica dello show, senza rete né file.
 * È l'unica fonte di verità: punteggi, timer e limiti si decidono qui.
 *
 * Due stati di visualizzazione INDIPENDENTI:
 *  - telefoni: s.mode  (attesa | reazioni | sos | finale)
 *  - LED:      s.led   ({ preview, program }) — la regia prepara una scena in anteprima
 *              e solo "Pubblica" la porta sulla pagina LED. Il tecnico decide quando mandarla in onda.
 * Unico collegamento voluto: avviare un SOS può pubblicare anche la scena SOS sul LED (opzione).
 */

export const MODES = ['attesa', 'reazioni', 'sos', 'finale'];
export const LED_SCENES = ['promo', 'classifica', 'generazioni', 'sos', 'chiuse', 'verdetto'];
/** Passi di una domanda del quiz: 0 preparata, 1 domanda sul LED, 2..5 risposte A..D visibili (con la D parte il timer). */
export const QUIZ_LAST_STEP = 5;
const SOS_GRACE_MS = 600; // tolleranza di rete per i voti arrivati a ridosso dello scadere
const MAX_TAPS_PER_ITEM = 40;
const LOG_MAX = 200;

export class ShowEngine {
  constructor(config, showId, { now = () => Date.now() } = {}) {
    this.config = config;
    this.showId = showId;
    this.now = now;
    this.emojiById = Object.fromEntries(config.reazioni.emoji.map((e) => [e.id, e]));
    this.contById = Object.fromEntries(config.concorrenti.map((c) => [c.id, c]));
    this.teamById = Object.fromEntries(config.coppie.map((t) => [t.id, t]));
    this.abById = Object.fromEntries((config.domandeAB || []).map((q) => [q.id, q]));
    this.sosById = Object.fromEntries((config.sos || []).map((s) => [s.id, s]));
    this.quizList = config.quiz?.domande || [];
    this.quizById = Object.fromEntries(this.quizList.map((q) => [q.id, q]));
    this.teamIds = config.coppie.map((t) => t.id);
    this.s = this.freshState();
    this.version = 0; // cambia quando cambia ciò che vedono telefoni o LED
    this.dirty = false; // da salvare su disco
    this.adminDirty = true; // da ritrasmettere alla regia
    this.screenDirty = true; // da ritrasmettere alla pagina LED
  }

  freshState() {
    const reactions = {};
    for (const c of this.config.concorrenti) reactions[c.id] = blankReaction(this.config);
    return {
      open: false,
      mode: 'attesa',
      reactionsLocked: false,
      audienceFrozen: false,
      sos: null,
      sosHistory: [],
      sosUsed: {},
      reactions,
      sessions: {},
      qz: null, // domanda del quiz in corso (vedi quizOpen)
      quizResults: {}, // per domanda: { [squadra]: { idx, corretta, sos } } dopo «Rivela la risposta giusta»
      quizHistory: {}, // stato finale di ogni domanda, per ridisegnarla sul LED
      sugarfree: null,
      sugarfreeLocked: false,
      adjustments: [],
      led: { preview: null, program: { type: 'promo', t: this.now() } },
      verdictPublished: false,
      verdict: null,
      log: [],
      createdAt: this.now(),
    };
  }

  // ---------- persistenza ----------
  toJSON() { return { showId: this.showId, version: this.version, s: this.s }; }
  load(data) {
    if (!data?.s) return;
    const fresh = this.freshState();
    this.s = { ...fresh, ...data.s };
    for (const c of this.config.concorrenti) if (!this.s.reactions[c.id]) this.s.reactions[c.id] = blankReaction(this.config);
    for (const k of ['quizResults', 'quizHistory']) if (!this.s[k] || typeof this.s[k] !== 'object') this.s[k] = {};
    if (!this.s.led?.program) this.s.led = fresh.led;
    this.version = (data.version || 0) + 1;
    this.touch();
  }

  touch(publicChange = true) {
    if (publicChange) this.version++;
    this.dirty = true;
    this.adminDirty = true;
    this.screenDirty = true;
  }

  log(msg) {
    this.s.log.unshift({ t: this.now(), msg });
    if (this.s.log.length > LOG_MAX) this.s.log.length = LOG_MAX;
  }

  // ---------- sessioni del pubblico ----------
  ensureSession(sid) {
    let ses = this.s.sessions[sid];
    if (!ses) {
      ses = this.s.sessions[sid] = {
        createdAt: this.now(),
        bucket: { tokens: this.config.reazioni.rateLimit.reazioniValide, last: this.now() },
        taps: 0, validTaps: 0, tapsBy: {}, ab: {}, sosVotes: {},
        nick: null, year: null, gen: null,
      };
      this.dirty = true;
      this.adminDirty = true;
    }
    return ses;
  }

  /** Generazione per anno: se l'anno ricade in più intervalli vince il più stretto (es. Zillennial). */
  generationOf(year) {
    const hits = (this.config.generazioni || []).filter((g) => year >= g.da && year <= g.a);
    hits.sort((a, b) => (a.a - a.da) - (b.a - b.da));
    return hits[0] || null;
  }

  setProfile(sid, nick, year) {
    const n = String(nick ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
    if (n.length < 1) return { ok: false, reason: 'nickname' };
    const y = Math.floor(Number(year));
    const min = this.config.annoNascita?.min ?? 1928;
    const max = new Date(this.now()).getFullYear();
    if (!(y >= min && y <= max)) return { ok: false, reason: 'anno' };
    const g = this.generationOf(y);
    const ses = this.ensureSession(sid);
    ses.nick = n; ses.year = y; ses.gen = g?.id || null;
    this.dirty = true;
    this.adminDirty = true;
    return { ok: true, nick: n, year: y, gen: ses.gen };
  }

  genStats() {
    const counts = Object.fromEntries((this.config.generazioni || []).map((g) => [g.id, 0]));
    let total = 0;
    for (const ses of Object.values(this.s.sessions)) if (ses.gen && counts[ses.gen] != null) { counts[ses.gen]++; total++; }
    return { total, counts };
  }

  // ---------- comandi regia: TELEFONI ----------
  setOpen(open) {
    this.s.open = !!open;
    if (open && this.s.mode === 'attesa') this.s.mode = 'reazioni';
    this.log(open ? 'Sessione APERTA' : 'Sessione CHIUSA');
    this.touch();
  }

  goReactions() {
    if (this.s.mode === 'sos' && this.s.sos && !this.s.sos.closed) this.closeSos('chiuso dalla regia');
    this.s.mode = 'reazioni';
    this.log('Telefoni → Reazioni');
    this.touch();
  }

  setReactionsLocked(locked) {
    this.s.reactionsLocked = !!locked;
    this.log(locked ? 'Reazioni BLOCCATE' : 'Reazioni SBLOCCATE');
    this.touch();
  }

  startSos(sosId, teamId, { alsoLed = true, def: given = null, quizQid = null } = {}) {
    const def = given || this.sosById[sosId];
    if (!def) throw new Error('SOS inesistente');
    if (!this.teamIds.includes(teamId)) throw new Error('Squadra inesistente');
    if (this.s.sos && !this.s.sos.closed) throw new Error('C\'è già un SOS in corso');
    const t = this.now();
    this.s.sos = {
      runId: randomUUID().slice(0, 8), sosId, teamId, quizQid,
      def: given ? { domanda: def.domanda, opzioni: def.opzioni, corretta: def.corretta } : undefined,
      startedAt: t, endsAt: t + def.durataSecondi * 1000,
      closed: false, revealed: false,
      counts: def.opzioni.map(() => 0), voters: 0, result: null,
    };
    this.s.sosUsed[teamId] = sosId;
    this.s.mode = 'sos';
    this.log(`SOS avviato${quizQid ? ' sulla domanda del quiz' : ': ' + sosId} per ${this.teamById[teamId].nome}`);
    if (alsoLed) {
      this.s.led.preview = { type: 'sos', runId: this.s.sos.runId, t };
      this.s.led.program = { ...this.s.led.preview };
      this.log('LED → SOS (countdown)');
    }
    this.touch();
    return this.s.sos;
  }

  tick() {
    const z = this.s.qz;
    if (z?.timer && !z.timer.endedLogged && this.quizTimer(z).ended) { z.timer.endedLogged = true; this.log('Quiz: TEMPO scaduto'); this.touch(false); }
    const r = this.s.sos;
    if (r && !r.closed && this.now() >= r.endsAt + SOS_GRACE_MS) this.closeSos('tempo scaduto');
    // dopo «Guarda il LED» i telefoni tornano da soli alle reazioni (la regia può farlo prima)
    const back = (this.config.sosRitornoAutomaticoSecondi ?? 10) * 1000;
    if (back > 0 && this.s.mode === 'sos' && r?.closed && r.closedAt && this.now() >= r.closedAt + back) {
      this.s.mode = 'reazioni';
      this.log('Telefoni → Reazioni (automatico dopo l\'SOS)');
      this.touch();
    }
  }

  closeSos(reason = 'chiuso') {
    const r = this.s.sos;
    if (!r || r.closed) return;
    r.closed = true;
    r.closedAt = this.now();
    const max = Math.max(...r.counts);
    const top = max > 0 ? r.counts.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0) : [];
    r.result = { top, tie: top.length > 1, max, total: r.voters, reason };
    this.archiveSos();
    this.log(`SOS chiuso (${reason}): ${top.length ? (top.length > 1 ? 'PARITÀ ' : 'più votata ') + top.map(letter).join(' / ') : 'nessun voto'}`);
    this.touch();
  }

  revealSosAnswer() {
    const r = this.s.sos;
    if (!r || !r.closed) throw new Error('Prima chiudi il voto SOS');
    r.revealed = true;
    this.archiveSos();
    this.log('LED: risposta corretta SOS rivelata');
    this.touch();
  }

  archiveSos() {
    const r = this.s.sos;
    const i = this.s.sosHistory.findIndex((h) => h.runId === r.runId);
    if (i >= 0) this.s.sosHistory[i] = { ...r }; else this.s.sosHistory.push({ ...r });
  }

  goFinale() {
    if (this.s.sos && !this.s.sos.closed) this.closeSos('finale');
    this.s.mode = 'finale';
    this.log('Telefoni → FINALE');
    this.touch();
  }

  /** Chiude (o riapre) il voto del pubblico. Chiudendo, telefoni e LED mostrano «Votazioni chiuse». */
  setAudienceFrozen(frozen, { alsoLed = true } = {}) {
    this.s.audienceFrozen = !!frozen;
    this.log(frozen ? 'Voti del pubblico CHIUSI (punti reazioni congelati)' : 'Voti del pubblico RIAPERTI');
    if (frozen && alsoLed) {
      const t = this.now();
      this.s.led.preview = { type: 'chiuse', t };
      this.s.led.program = { type: 'chiuse', t, publishedAt: t };
      this.log('LED → Votazioni chiuse');
    }
    this.touch();
  }

  // ---------- comandi regia: QUIZ ----------
  // Tutte le squadre rispondono alla stessa domanda. Sul LED: domanda, poi A-B-C-D una alla volta (barra spaziatrice),
  // con la D parte il timer; le lettere delle squadre restano nascoste («ha risposto») finché la regia non le mostra tutte insieme.
  quizDef(qid) { const q = this.quizById[qid]; if (!q) throw new Error('Domanda del quiz inesistente'); return q; }
  quizPointsPer() {
    const P = this.config.punteggi.quiz || {};
    const per = Math.round((P.totale ?? 30) / Math.max(1, this.quizList.length));
    return { per, sos: P.sosMeta === false ? per : Math.round(per / 2) };
  }

  /** Stato del timer: durata, fine (se corre), rimanente (se fermo), scaduto. */
  quizTimer(z = this.s.qz) {
    const T = z?.timer;
    if (!T) return null;
    const left = T.runStart != null ? T.dur - T.used - (this.now() - T.runStart) : T.dur - T.used;
    return { dur: T.dur, running: T.runStart != null && left > 0, endsAt: T.runStart != null ? T.runStart + T.dur - T.used : null, left: Math.max(0, left), ended: left <= 0 };
  }
  quizTimerPause(z) { const T = z.timer; if (T && T.runStart != null) { T.used = Math.min(T.dur, T.used + this.now() - T.runStart); T.runStart = null; } }
  quizTimerResume(z) { const T = z.timer; if (T && T.runStart == null && T.used < T.dur && !z.teamsRevealed) T.runStart = this.now(); }

  /** Prepara una domanda (il LED non cambia finché non premi «Mostra domanda»). */
  quizOpen(qid) {
    const q = this.quizDef(qid);
    if (this.s.sos && !this.s.sos.closed) throw new Error('C\'è un SOS in corso: chiudilo prima');
    if (this.s.qz && this.s.qz.qid !== qid) this.quizArchive();
    if (this.s.quizResults[qid]) throw new Error('Domanda già giocata: per rifarla usa «Rigioca»');
    this.s.qz = {
      qid, step: 0, shownAt: [], answers: Object.fromEntries(this.teamIds.map((t) => [t, null])),
      timer: null, teamsRevealed: false, correctRevealed: false, sosTeam: null, sosRunId: null, sosShown: false,
    };
    this.log(`Quiz: domanda ${this.quizList.indexOf(q) + 1} preparata`);
    this.touch(false);
  }

  /** Barra spaziatrice: mostra la domanda, poi una risposta alla volta. Con l'ultima parte il timer. */
  quizNext() {
    const z = this.s.qz;
    if (!z) throw new Error('Scegli prima una domanda');
    if (z.step >= QUIZ_LAST_STEP) throw new Error('Domanda e risposte sono già tutte sul LED');
    z.step++;
    z.shownAt[z.step] = this.now();
    if (z.step === 1) {
      const t = this.now();
      this.s.led.preview = { type: 'quiz', qid: z.qid, t };
      this.s.led.program = { type: 'quiz', qid: z.qid, t, publishedAt: t };
      this.log('LED → Quiz: domanda');
    } else this.log(`LED → Quiz: risposta ${letter(z.step - 2)}`);
    if (z.step === QUIZ_LAST_STEP) {
      const dur = Math.max(1, Number(this.config.quiz?.timerSecondi) || 60) * 1000;
      z.timer = { dur, used: 0, runStart: this.now() };
      this.log(`Quiz: timer avviato (${dur / 1000} s)`);
    }
    this.touch();
  }

  /** La lettera scritta sulla lavagnetta di una squadra (null = toglie). Si può correggere fino alla risposta giusta. */
  quizAnswer(teamId, idx) {
    const z = this.s.qz;
    if (!z) throw new Error('Nessuna domanda in corso');
    if (!this.teamIds.includes(teamId)) throw new Error('Squadra inesistente');
    if (z.correctRevealed) throw new Error('Risposta giusta già rivelata');
    if (z.step < 1) throw new Error('Mostra prima la domanda');
    const q = this.quizDef(z.qid);
    const i = idx == null ? null : Math.floor(Number(idx));
    if (i != null && !(i >= 0 && i < q.opzioni.length)) throw new Error('Risposta inesistente');
    z.answers[teamId] = i;
    this.log(`Quiz: ${this.teamById[teamId].nome} → ${i == null ? 'tolta' : letter(i)}`);
    this.touch();
  }

  /** SOS sulla domanda in corso: il timer si ferma, il pubblico vota la stessa domanda dal telefono. */
  quizSos(teamId) {
    const z = this.s.qz;
    if (!z) throw new Error('Nessuna domanda in corso');
    if (!this.teamIds.includes(teamId)) throw new Error('Squadra inesistente');
    if (z.step < QUIZ_LAST_STEP) throw new Error('Mostra prima tutte le risposte');
    if (z.sosTeam) throw new Error('Su questa domanda c\'è già stato un SOS');
    if (this.s.sosUsed[teamId]) throw new Error(`${this.teamById[teamId].nome} ha già usato il suo SOS`);
    if (z.teamsRevealed) throw new Error('Risposte delle squadre già mostrate');
    const q = this.quizDef(z.qid);
    const run = this.startSos(`quiz:${z.qid}`, teamId, {
      alsoLed: false, quizQid: z.qid,
      def: { domanda: q.testo, opzioni: q.opzioni, corretta: q.corretta, durataSecondi: Number(this.config.quiz?.sosDurataSecondi) || 30 },
    });
    z.sosTeam = teamId; z.sosRunId = run.runId; z.sosShown = false;
    this.quizTimerPause(z);
    this.touch();
  }

  /** Mostra sul LED i voti del pubblico. Solo a voto chiuso e dopo che le ALTRE squadre hanno risposto (force = sblocco d'emergenza). */
  quizShowSos({ force = false } = {}) {
    const z = this.s.qz;
    if (!z?.sosTeam) throw new Error('Nessun SOS su questa domanda');
    const r = this.sosRun(z);
    if (!r?.closed) throw new Error('Il voto del pubblico non è ancora chiuso');
    const missing = this.teamIds.filter((t) => t !== z.sosTeam && z.answers[t] == null);
    if (missing.length && !force) throw new Error(`Prima devono rispondere: ${missing.map((t) => this.teamById[t].nome).join(', ')}`);
    z.sosShown = true;
    z.sosShownAt = this.now();
    this.quizTimerResume(z);
    this.log(`LED → Quiz: voti del pubblico${missing.length ? ' (sblocco d\'emergenza)' : ''}; timer ripartito`);
    this.touch();
  }

  /** Le lettere di tutte le squadre insieme (le lavagnette girate). force = anche se qualcuna non ha risposto. */
  quizRevealTeams({ force = false } = {}) {
    const z = this.s.qz;
    if (!z) throw new Error('Nessuna domanda in corso');
    if (z.step < QUIZ_LAST_STEP) throw new Error('Mostra prima tutte le risposte');
    if (z.sosTeam && !z.sosShown) throw new Error('Mostra prima i voti del pubblico');
    const missing = this.teamIds.filter((t) => z.answers[t] == null);
    if (missing.length && !force) throw new Error(`Mancano le risposte di: ${missing.map((t) => this.teamById[t].nome).join(', ')}`);
    this.quizTimerPause(z);
    z.teamsRevealed = true;
    this.log('LED → Quiz: risposte delle squadre');
    this.touch();
  }

  /** Risposta giusta: verde sul LED e punti assegnati. */
  quizRevealCorrect() {
    const z = this.s.qz;
    if (!z?.teamsRevealed) throw new Error('Mostra prima le risposte delle squadre');
    const q = this.quizDef(z.qid);
    z.correctRevealed = true;
    const { per, sos } = this.quizPointsPer();
    const res = {};
    for (const t of this.teamIds) {
      const ok = z.answers[t] === q.corretta;
      res[t] = { idx: z.answers[t], corretta: ok, sos: z.sosTeam === t, punti: ok ? (z.sosTeam === t ? sos : per) : 0 };
    }
    this.s.quizResults[z.qid] = res;
    this.quizArchive(false);
    this.log(`Quiz: risposta giusta ${letter(q.corretta)} · ${this.teamIds.map((t) => `${this.teamById[t].nome} ${res[t].punti}`).join(', ')}`);
    this.touch();
  }

  /** Chiude la domanda in corso (la regia torna al pannello delle reazioni; il LED resta com'è). */
  quizClose() {
    if (!this.s.qz) return;
    if (this.s.sos && !this.s.sos.closed && this.s.sos.runId === this.s.qz.sosRunId) throw new Error('C\'è un SOS in corso su questa domanda');
    this.quizArchive();
    this.log('Quiz: domanda chiusa');
    this.touch(false);
  }

  /** Rigioca una domanda (errori in prova): cancella risultato e stato. */
  quizReset(qid) {
    this.quizDef(qid);
    delete this.s.quizResults[qid];
    delete this.s.quizHistory[qid];
    if (this.s.qz?.qid === qid) this.s.qz = null;
    this.log(`Quiz: domanda ${this.quizList.findIndex((q) => q.id === qid) + 1} azzerata`);
    this.touch();
  }

  quizArchive(clear = true) {
    const z = this.s.qz;
    if (!z) return;
    this.quizTimerPause(z);
    this.s.quizHistory[z.qid] = JSON.parse(JSON.stringify(z));
    if (clear) this.s.qz = null;
  }

  sosRun(z) { return z?.sosRunId ? (this.s.sos?.runId === z.sosRunId ? this.s.sos : this.s.sosHistory.find((h) => h.runId === z.sosRunId)) : null; }

  quizPoints(teamId) {
    return Object.values(this.s.quizResults).reduce((sum, r) => sum + (r[teamId]?.punti || 0), 0);
  }

  // ---------- comandi regia: PUNTI ----------
  setSugarfree(teamId) {
    if (this.s.sugarfreeLocked) throw new Error('Voto Sugarfree bloccato: sbloccalo per cambiarlo');
    if (teamId != null && !this.teamIds.includes(teamId)) throw new Error('Squadra inesistente');
    this.s.sugarfree = teamId;
    this.log(teamId ? `Voto Sugarfree → ${this.teamById[teamId].nome}` : 'Voto Sugarfree annullato');
    this.touch(false);
  }

  setSugarfreeLocked(locked) {
    if (locked && !this.s.sugarfree) throw new Error('Scegli prima la coppia degli Sugarfree');
    this.s.sugarfreeLocked = !!locked;
    this.log(locked ? 'Voto Sugarfree CONFERMATO e bloccato' : 'Voto Sugarfree sbloccato');
    this.touch(false);
  }

  addAdjustment(target, delta, reason) {
    const d = Math.round(Number(delta));
    if (!d) throw new Error('Correzione nulla');
    const isTeam = this.teamIds.includes(target);
    if (!isTeam && !this.contById[target]) throw new Error('Destinatario inesistente');
    const adj = { id: randomUUID().slice(0, 8), target, kind: isTeam ? 'team' : 'concorrente', delta: d, reason: String(reason ?? '').trim().slice(0, 140), t: this.now() };
    this.s.adjustments.push(adj);
    this.log(`Correzione ${d > 0 ? '+' : ''}${d} a ${target}${adj.reason ? ': ' + adj.reason : ''}`);
    this.touch(false);
    return adj;
  }

  removeAdjustment(id) {
    const i = this.s.adjustments.findIndex((a) => a.id === id);
    if (i < 0) throw new Error('Correzione inesistente');
    const [a] = this.s.adjustments.splice(i, 1);
    this.log(`Correzione annullata: ${a.delta} a ${a.target}`);
    this.touch(false);
  }

  // ---------- comandi regia: LED (anteprima → pubblica) ----------
  /** Prepara una scena in ANTEPRIMA. I dati (classifica, generazioni) vengono fotografati adesso. */
  ledPrepare(type) {
    if (!LED_SCENES.includes(type)) throw new Error('Scena LED sconosciuta');
    const t = this.now();
    let scene = { type, t };
    if (type === 'classifica') scene.standings = this.computeStandings();
    if (type === 'generazioni') scene.stats = this.genStats();
    if (type === 'sos') {
      const r = this.s.sos || this.s.sosHistory[this.s.sosHistory.length - 1];
      if (!r) throw new Error('Nessun SOS da mostrare');
      scene.runId = r.runId;
    }
    if (type === 'verdetto') {
      if (!this.s.sugarfree) throw new Error('Manca il voto degli Sugarfree');
      if (!this.s.sugarfreeLocked) throw new Error('Conferma (blocca) prima il voto degli Sugarfree');
      scene.standings = this.computeStandings();
    }
    this.s.led.preview = scene;
    this.log(`LED: anteprima pronta (${type})`);
    this.touch(false);
    this.adminDirty = true;
    return scene;
  }

  /** Porta l'anteprima sulla pagina LED. Il tecnico decide quando mandarla fisicamente in onda. */
  ledPublish() {
    const p = this.s.led.preview;
    if (!p) throw new Error('Nessuna anteprima da pubblicare');
    this.s.led.program = { ...p, publishedAt: this.now() };
    if (p.type === 'verdetto') { this.s.verdictPublished = true; this.s.verdict = p.standings; }
    this.log(`LED: PUBBLICATO (${p.type})`);
    this.touch();
  }

  // ---------- azioni del pubblico ----------
  react(sid, batch) {
    if (!this.s.open || this.s.mode !== 'reazioni' || this.s.reactionsLocked || this.s.audienceFrozen) return { ok: false, reason: 'chiuso' };
    if (!Array.isArray(batch)) return { ok: false, reason: 'formato' };
    const ses = this.ensureSession(sid);
    if (!ses.nick) return { ok: false, reason: 'profilo' }; // prima nickname e anno, poi si vota
    const { reazioniValide: cap, finestraSecondi: win } = this.config.reazioni.rateLimit;
    const t = this.now();
    const b = ses.bucket;
    b.tokens = Math.min(cap, b.tokens + ((t - b.last) / 1000) * (cap / win));
    b.last = t;
    let valid = 0, taps = 0;
    for (const item of batch.slice(0, 32)) {
      if (!Array.isArray(item)) continue;
      const [cid, eid, nRaw] = item;
      const emoji = this.emojiById[eid];
      const r = this.s.reactions[cid];
      if (!emoji || !r) continue;
      const n = Math.max(0, Math.min(MAX_TAPS_PER_ITEM, Math.floor(Number(nRaw) || 0)));
      if (!n) continue;
      taps += n;
      r.raw[eid] += n;
      r.taps += n;
      const by = (ses.tapsBy[cid] ||= {});
      by[eid] = (by[eid] || 0) + n;
      const v = Math.min(n, Math.floor(b.tokens));
      if (v > 0) {
        b.tokens -= v;
        valid += v;
        r.valid[eid] += v;
        r.points += v * emoji.punti;
      }
    }
    ses.taps += taps;
    ses.validTaps += valid;
    if (taps) { this.dirty = true; this.adminDirty = true; }
    return { ok: true, taps, valid };
  }

  /** Quiz «Che Rom-Com sei?»: solo nel finale, ognuno in autonomia. */
  answerAB(sid, qid, choice) {
    const q = this.abById[qid];
    if (!q) return { ok: false, reason: 'domanda' };
    const idx = 'ABCDEFGH'.indexOf(choice);
    if (typeof choice !== 'string' || choice.length !== 1 || idx < 0 || idx >= q.opzioni.length) return { ok: false, reason: 'scelta' };
    if (this.s.mode !== 'finale') return { ok: false, reason: 'chiusa' };
    const ses = this.ensureSession(sid);
    if (ses.ab[qid]) return { ok: true, already: true, choice: ses.ab[qid] };
    ses.ab[qid] = choice;
    this.dirty = true;
    this.adminDirty = true;
    return { ok: true, choice };
  }

  voteSos(sid, runId, idx) {
    const r = this.s.sos;
    if (!r || r.runId !== runId) return { ok: false, reason: 'sos' };
    if (r.closed || this.now() > r.endsAt + SOS_GRACE_MS) return { ok: false, reason: 'scaduto' };
    const i = Math.floor(Number(idx));
    if (!(i >= 0 && i < r.counts.length)) return { ok: false, reason: 'opzione' };
    const ses = this.ensureSession(sid);
    if (!ses.nick) return { ok: false, reason: 'profilo' };
    if (ses.sosVotes[runId] != null) return { ok: true, already: true, choice: ses.sosVotes[runId] };
    ses.sosVotes[runId] = i;
    r.counts[i]++;
    r.voters++;
    this.dirty = true;
    this.adminDirty = true;
    this.screenDirty = true; // il LED mostra il numero di voti in diretta
    return { ok: true, choice: i };
  }

  // ---------- calcoli ----------
  /**
   * Quiz «Che Rom-Com sei?»: ogni risposta dà punti al film principale e a quello affine.
   * Vince il film con più punti; in parità quello con più associazioni principali;
   * poi il film principale delle domande in ordine di priorità (es. 5, 3, 1, 2, 4, 6); infine l'ordine dei profili.
   */
  computeProfile(sid) {
    const ses = this.s.sessions[sid];
    if (!ses) return null;
    const qs = this.config.domandeAB || [];
    const answered = qs.filter((q) => ses.ab[q.id]);
    if (!answered.length) return null;
    const P = this.config.quizPunteggi || { principale: 2, secondario: 1 };
    const ids = this.config.profili.map((p) => p.id);
    const score = Object.fromEntries(ids.map((id) => [id, 0]));
    const primary = Object.fromEntries(ids.map((id) => [id, 0]));
    const pick = (q) => q.opzioni['ABCDEFGH'.indexOf(ses.ab[q.id])];
    for (const q of answered) {
      const o = pick(q);
      if (!o) continue;
      if (score[o.principale] != null) { score[o.principale] += P.principale; primary[o.principale]++; }
      if (score[o.secondario] != null) score[o.secondario] += P.secondario;
    }
    const max = Math.max(...Object.values(score));
    let tied = ids.filter((id) => score[id] === max);
    if (tied.length > 1) { const m = Math.max(...tied.map((id) => primary[id])); tied = tied.filter((id) => primary[id] === m); }
    for (const qid of (P.spareggio || qs.map((q) => q.id))) {
      if (tied.length <= 1) break;
      const q = this.abById[qid];
      const o = q && ses.ab[qid] && pick(q);
      if (o && tied.includes(o.principale)) tied = [o.principale];
    }
    const prof = this.config.profili.find((p) => p.id === tied[0]);
    return { ...prof, score, answered: answered.length, total: qs.length };
  }

  personal(sid) {
    const ses = this.s.sessions[sid];
    if (!ses) return { ab: {}, sosVotes: {}, taps: 0, nick: null, year: null, gen: null };
    const out = { ab: ses.ab, sosVotes: ses.sosVotes, taps: ses.taps, nick: ses.nick, year: ses.year, gen: ses.gen };
    if (this.s.mode === 'finale') {
      let fav = null, favN = 0;
      const emojiTot = {};
      for (const [cid, by] of Object.entries(ses.tapsBy)) {
        let n = 0;
        for (const [eid, k] of Object.entries(by)) { n += k; emojiTot[eid] = (emojiTot[eid] || 0) + k; }
        if (n > favN) { favN = n; fav = cid; }
      }
      const topEmoji = Object.entries(emojiTot).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      out.recap = { taps: ses.taps, favorito: fav, favoritoTaps: favN, topEmoji };
      out.profilo = this.computeProfile(sid);
    }
    return out;
  }

  computeStandings() {
    const P = this.config.punteggi;
    const adjFor = (id) => this.s.adjustments.filter((a) => a.target === id).reduce((s, a) => s + a.delta, 0);
    const individui = this.config.concorrenti.map((c) => {
      const r = this.s.reactions[c.id];
      return { id: c.id, nome: c.nome, coppia: c.coppia, reazioni: r.points, correzioni: adjFor(c.id), punti: r.points + adjFor(c.id) };
    });
    const teams = this.config.coppie.map((t) => {
      const membri = individui.filter((i) => i.coppia === t.id);
      return {
        id: t.id, nome: t.nome, colore: t.colore,
        membri: membri.map((m) => m.id),
        reazioniTotali: membri.reduce((s, m) => s + m.punti, 0),
        quiz: this.quizPoints(t.id),
        sugarfree: this.s.sugarfree === t.id ? P.sugarfree.bonus : 0,
        correzioni: adjFor(t.id),
      };
    });
    const awards = audienceAwards(teams.map((t) => t.reazioniTotali), P.pubblico.premi, P.pubblico.parita);
    teams.forEach((t, i) => {
      t.pubblico = awards[i];
      t.totale = t.quiz + t.pubblico + t.sugarfree + t.correzioni;
    });
    return { t: this.now(), individui, coppie: rankTeams(teams, P.spareggioFinale || []) };
  }

  /** Scena LED completa di dati: per l'SOS usa i dati in diretta (voti, chiusura, rivelazione). */
  resolveScene(scene) {
    if (!scene) return null;
    if (scene.type === 'quiz') return this.resolveQuiz(scene);
    if (scene.type !== 'sos') return scene;
    const r = (this.s.sos?.runId === scene.runId ? this.s.sos : null) || this.s.sosHistory.find((h) => h.runId === scene.runId);
    if (!r) return { type: 'promo', t: scene.t };
    const def = r.def || this.sosById[r.sosId];
    return {
      ...scene,
      sos: {
        coppia: this.teamById[r.teamId]?.nome, colore: this.teamById[r.teamId]?.colore,
        domanda: def.domanda, opzioni: def.opzioni,
        startedAt: r.startedAt, endsAt: r.endsAt, closed: r.closed, voters: r.voters,
        // le percentuali si vedono solo a voto chiuso, per non influenzare chi sta votando
        counts: r.closed ? r.counts : null, top: r.closed ? r.result?.top : null, tie: r.closed ? r.result?.tie : null,
        corretta: r.revealed ? def.corretta : null,
      },
    };
  }

  /** Scena «quiz» per il LED: solo quello che il pubblico deve vedere in questo momento. */
  resolveQuiz(scene) {
    const q = this.quizById[scene.qid];
    const z = this.s.qz?.qid === scene.qid ? this.s.qz : this.s.quizHistory[scene.qid];
    if (!q || !z) return { type: 'promo', t: scene.t };
    const visibili = Math.max(0, Math.min(4, z.step - 1));
    const r = this.sosRun(z);
    const corretta = z.correctRevealed ? q.corretta : null;
    return {
      ...scene,
      quiz: {
        n: this.quizList.indexOf(q) + 1, tot: this.quizList.length,
        testo: z.step >= 1 ? q.testo : '', opzioni: q.opzioni.slice(0, visibili), totOpzioni: q.opzioni.length,
        shownAt: z.shownAt, timer: this.quizTimer(z), teamsRevealed: z.teamsRevealed, corretta,
        squadre: this.teamIds.map((t) => ({
          id: t, nome: this.teamById[t].nome, colore: this.teamById[t].colore,
          risposto: z.answers[t] != null, idx: z.teamsRevealed ? z.answers[t] : null, sos: z.sosTeam === t,
          esito: corretta == null ? null : z.answers[t] === corretta,
          punti: corretta == null ? null : this.s.quizResults[scene.qid]?.[t]?.punti ?? null,
        })),
        sos: r ? {
          coppia: this.teamById[r.teamId]?.nome, colore: this.teamById[r.teamId]?.colore,
          startedAt: r.startedAt, endsAt: r.endsAt, closed: r.closed, voters: r.voters, mostrato: z.sosShown, shownAt: z.sosShownAt || null,
          counts: z.sosShown ? r.counts : null, top: z.sosShown ? r.result?.top : null, tie: z.sosShown ? r.result?.tie : null,
        } : null,
      },
    };
  }

  // ---------- viste ----------
  publicState() {
    const s = this.s;
    const out = { v: this.version, open: s.open, mode: s.mode, reactionsLocked: s.reactionsLocked || s.audienceFrozen, votesClosed: s.audienceFrozen };
    if (s.mode === 'sos' && s.sos) {
      const def = s.sos.def || this.sosById[s.sos.sosId];
      out.sos = { runId: s.sos.runId, domanda: def.domanda, opzioni: def.opzioni, startedAt: s.sos.startedAt, endsAt: s.sos.endsAt, closed: s.sos.closed };
    }
    // la classifica arriva sui telefoni SOLO dopo la pubblicazione del verdetto
    if (s.mode === 'finale' && s.verdictPublished && s.verdict) {
      out.classifica = s.verdict.coppie.map(({ id, nome, colore, totale, posizione }) => ({ id, nome, colore, totale, posizione }));
    }
    return out;
  }

  screenState() {
    return { v: this.version, showId: this.showId, program: this.resolveScene(this.s.led.program) };
  }

  adminState(extra = {}) {
    const s = this.s;
    return {
      showId: this.showId,
      v: this.version,
      open: s.open,
      mode: s.mode,
      reactionsLocked: s.reactionsLocked,
      audienceFrozen: s.audienceFrozen,
      sos: s.sos,
      sosUsed: s.sosUsed,
      reactions: s.reactions,
      qz: s.qz ? { ...s.qz, timer: this.quizTimer(s.qz) } : null,
      quizResults: s.quizResults,
      quizPerRisposta: this.quizPointsPer(),
      sugarfree: s.sugarfree,
      sugarfreeLocked: s.sugarfreeLocked,
      adjustments: s.adjustments,
      standings: this.computeStandings(),
      parita: tiesOf(this.computeStandings().coppie),
      genStats: this.genStats(),
      led: { preview: this.resolveScene(s.led.preview), program: this.resolveScene(s.led.program) },
      verdictPublished: s.verdictPublished,
      sessionsTotal: Object.keys(s.sessions).length,
      log: s.log.slice(0, 60),
      ...extra,
    };
  }
}

function blankReaction(config) {
  const z = () => Object.fromEntries(config.reazioni.emoji.map((e) => [e.id, 0]));
  return { points: 0, taps: 0, raw: z(), valid: z() };
}

/** Gruppi di squadre con lo stesso totale (prima di qualsiasi spareggio). */
export function tiesOf(teams) {
  const by = {};
  for (const t of teams) (by[t.totale] ||= []).push(t.nome);
  return Object.entries(by).filter(([, n]) => n.length > 1).map(([tot, nomi]) => ({ totale: Number(tot), squadre: nomi })).sort((a, b) => b.totale - a.totale);
}

export function letter(i) { return 'ABCDEFGH'[i] || String(i); }

export function audienceAwards(values, premi, parita = 'media') {
  const idx = values.map((v, i) => i).sort((a, b) => values[b] - values[a]);
  const out = new Array(values.length).fill(0);
  let pos = 0;
  while (pos < idx.length) {
    let end = pos;
    while (end + 1 < idx.length && values[idx[end + 1]] === values[idx[pos]]) end++;
    const slice = premi.slice(pos, end + 1).map((x) => x ?? 0);
    const prize = parita === 'alto' ? slice[0] : slice.reduce((a, b) => a + b, 0) / slice.length;
    for (let k = pos; k <= end; k++) out[idx[k]] = Math.round(prize * 100) / 100;
    pos = end + 1;
  }
  return out;
}

export function rankTeams(teams, tiebreak) {
  const cmp = (a, b) => {
    if (b.totale !== a.totale) return b.totale - a.totale;
    for (const k of tiebreak) if (b[k] !== a[k]) return b[k] - a[k];
    return 0;
  };
  const sorted = [...teams].sort(cmp);
  sorted.forEach((t, i) => { t.posizione = i > 0 && cmp(sorted[i - 1], t) === 0 ? sorted[i - 1].posizione : i + 1; });
  for (const t of sorted) t.exAequo = sorted.filter((o) => o.posizione === t.posizione).length > 1;
  return sorted;
}
