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
    const nq = this.config.punteggi.quiz.domandePerCoppia || 3;
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
      quiz: Object.fromEntries(this.teamIds.map((t) => [t, new Array(nq).fill(false)])),
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
    for (const t of this.teamIds) if (!Array.isArray(this.s.quiz[t])) this.s.quiz[t] = fresh.quiz[t];
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

  startSos(sosId, teamId, { alsoLed = true } = {}) {
    const def = this.sosById[sosId];
    if (!def) throw new Error('SOS inesistente');
    if (!this.teamIds.includes(teamId)) throw new Error('Coppia inesistente');
    if (this.s.sos && !this.s.sos.closed) throw new Error('C\'è già un SOS in corso');
    const t = this.now();
    this.s.sos = {
      runId: randomUUID().slice(0, 8), sosId, teamId,
      startedAt: t, endsAt: t + def.durataSecondi * 1000,
      closed: false, revealed: false,
      counts: def.opzioni.map(() => 0), voters: 0, result: null,
    };
    this.s.sosUsed[teamId] = sosId;
    this.s.mode = 'sos';
    this.log(`SOS avviato: ${sosId} per ${this.teamById[teamId].nome}`);
    if (alsoLed) {
      this.s.led.preview = { type: 'sos', runId: this.s.sos.runId, t };
      this.s.led.program = { ...this.s.led.preview };
      this.log('LED → SOS (countdown)');
    }
    this.touch();
    return this.s.sos;
  }

  tick() {
    const r = this.s.sos;
    if (r && !r.closed && this.now() >= r.endsAt + SOS_GRACE_MS) this.closeSos('tempo scaduto');
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

  // ---------- comandi regia: PUNTI ----------
  /** Punti quiz per domanda: ogni casella è una risposta corretta (niente doppi clic che sommano due volte). */
  setQuizAnswer(teamId, idx, correct) {
    const arr = this.s.quiz[teamId];
    if (!arr) throw new Error('Coppia inesistente');
    const i = Math.floor(Number(idx));
    if (!(i >= 0 && i < arr.length)) throw new Error('Domanda inesistente');
    arr[i] = !!correct;
    this.log(`Quiz ${this.teamById[teamId].nome}: domanda ${i + 1} ${correct ? 'CORRETTA' : 'annullata'}`);
    this.touch(false);
  }

  quizPoints(teamId) {
    const q = this.config.punteggi.quiz;
    return Math.min(q.maxPerCoppia, (this.s.quiz[teamId] || []).filter(Boolean).length * q.puntiPerRisposta);
  }

  setSugarfree(teamId) {
    if (this.s.sugarfreeLocked) throw new Error('Voto Sugarfree bloccato: sbloccalo per cambiarlo');
    if (teamId != null && !this.teamIds.includes(teamId)) throw new Error('Coppia inesistente');
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
    if (!this.abById[qid]) return { ok: false, reason: 'domanda' };
    if (choice !== 'A' && choice !== 'B') return { ok: false, reason: 'scelta' };
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
  computeProfile(sid) {
    const ses = this.s.sessions[sid];
    if (!ses) return null;
    const order = (this.config.domandeAB || []).map((q) => q.id).filter((q) => ses.ab[q]);
    if (!order.length) return null;
    const score = Object.fromEntries(this.config.profili.map((p) => [p.id, 0]));
    for (const q of order) for (const [pid, w] of Object.entries(this.abById[q][ses.ab[q]].profili || {})) score[pid] += w;
    const max = Math.max(...Object.values(score));
    let tied = Object.keys(score).filter((p) => score[p] === max);
    for (let k = order.length - 1; k >= 0 && tied.length > 1; k--) {
      const w = this.abById[order[k]][ses.ab[order[k]]].profili || {};
      const best = Math.max(...tied.map((p) => w[p] || 0));
      tied = tied.filter((p) => (w[p] || 0) === best);
    }
    const prof = this.config.profili.find((p) => p.id === tied[0]);
    return { ...prof, score, answered: order.length, total: this.config.domandeAB.length };
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
        quizRisposte: [...(this.s.quiz[t.id] || [])],
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
    if (scene.type !== 'sos') return scene;
    const r = (this.s.sos?.runId === scene.runId ? this.s.sos : null) || this.s.sosHistory.find((h) => h.runId === scene.runId);
    if (!r) return { type: 'promo', t: scene.t };
    const def = this.sosById[r.sosId];
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

  // ---------- viste ----------
  publicState() {
    const s = this.s;
    const out = { v: this.version, open: s.open, mode: s.mode, reactionsLocked: s.reactionsLocked || s.audienceFrozen, votesClosed: s.audienceFrozen };
    if (s.mode === 'sos' && s.sos) {
      const def = this.sosById[s.sos.sosId];
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
      quiz: s.quiz,
      sugarfree: s.sugarfree,
      sugarfreeLocked: s.sugarfreeLocked,
      adjustments: s.adjustments,
      standings: this.computeStandings(),
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
