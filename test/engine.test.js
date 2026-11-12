import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ShowEngine, audienceAwards, rankTeams } from '../server/engine.js';
import { validateConfig } from '../server/config.js';

const baseConfig = JSON.parse(readFileSync(new URL('../config/show.json', import.meta.url)));
function make() {
  let t = Date.parse('2026-11-20T21:00:00Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const e = new ShowEngine(structuredClone(baseConfig), 'test', { now: clock.now });
  e.setOpen(true);
  for (const sid of ['s1', 's2', 's3', 'a', 'b', 'c', 'd']) e.setProfile(sid, 'Test ' + sid, 2000);
  return { e, clock };
}

/** Gioca una domanda del quiz: risposte per squadra (indici), eventuale SOS. */
function play(e, qid, answers, { sos = null } = {}) {
  e.quizOpen(qid);
  for (let i = 0; i < 5; i++) e.quizNext();
  if (sos) {
    e.quizSos(sos);
    e.closeSos('test');
    for (const [t, i] of Object.entries(answers)) if (t !== sos) e.quizAnswer(t, i);
    e.quizShowSos();
    e.quizAnswer(sos, answers[sos]);
  } else for (const [t, i] of Object.entries(answers)) e.quizAnswer(t, i);
  e.quizRevealTeams();
  e.quizRevealCorrect();
}
const C = (qid) => baseConfig.quiz.domande.find((q) => q.id === qid).corretta; // indice della risposta giusta
const W = (qid) => (C(qid) + 1) % 4; // una risposta sbagliata

test('la config fittizia è valida', () => validateConfig(baseConfig));

test('config non valida: errori leggibili', () => {
  const bad = structuredClone(baseConfig);
  bad.concorrenti[0].coppia = 'tX';
  bad.sos[0].corretta = 9;
  assert.throws(() => validateConfig(bad), /coppia "tX" inesistente[\s\S]*fuori range/);
});

test('rate limit: max 3 reazioni valide ogni 10 secondi per sessione', () => {
  const { e, clock } = make();
  const r1 = e.react('s1', [['c1', 'ride', 10]]);
  assert.equal(r1.taps, 10);
  assert.equal(r1.valid, 3);
  assert.equal(e.s.reactions.c1.points, 6);
  assert.equal(e.react('s1', [['c1', 'ride', 5]]).valid, 0);
  clock.advance(3400); // ricarica 1 gettone ogni 3,33 s
  assert.equal(e.react('s1', [['c1', 'ride', 5]]).valid, 1);
  clock.advance(60_000); // il secchiello non supera la capacità
  assert.equal(e.react('s1', [['c1', 'cuore', 10]]).valid, 3);
  // un'altra sessione ha il suo secchiello
  assert.equal(e.react('s2', [['c2', 'rabbia', 2]]).valid, 2);
  assert.equal(e.s.reactions.c2.points, -4);
  assert.equal(e.s.reactions.c1.raw.ride, 20);
});

test('reazioni ignorate se bloccate, fuori modalità o input sporco', () => {
  const { e } = make();
  e.setReactionsLocked(true);
  assert.equal(e.react('s1', [['c1', 'ride', 1]]).ok, false);
  e.setReactionsLocked(false);
  e.startSos('sos1', 't1');
  assert.equal(e.react('s1', [['c1', 'ride', 1]]).ok, false);
  e.goReactions();
  const r = e.react('s1', [['cX', 'ride', 1], ['c1', 'boh', 1], ['c1', 'ride', 1e9], 'x', null]);
  assert.equal(r.taps, 40); // un pacchetto non può gonfiare i numeri
  assert.equal(r.valid, 3);
});

test('premi pubblico: ordine e parità "media" / "alto"', () => {
  assert.deepEqual(audienceAwards([5, 9, 1], [30, 20, 10], 'media'), [20, 30, 10]);
  assert.deepEqual(audienceAwards([9, 9, 1], [30, 20, 10], 'media'), [25, 25, 10]);
  assert.deepEqual(audienceAwards([9, 1, 1], [30, 20, 10], 'media'), [30, 15, 15]);
  assert.deepEqual(audienceAwards([4, 4, 4], [30, 20, 10], 'media'), [20, 20, 20]);
  assert.deepEqual(audienceAwards([9, 9, 1], [30, 20, 10], 'alto'), [30, 30, 10]);
  assert.deepEqual(audienceAwards([-3, -1, -2], [30, 20, 10], 'media'), [10, 30, 20]);
});

test('classifica: spareggio quiz poi pubblico, poi ex aequo', () => {
  const r = rankTeams([
    { id: 'a', totale: 50, quiz: 20, pubblico: 30 },
    { id: 'b', totale: 50, quiz: 30, pubblico: 20 },
    { id: 'c', totale: 40, quiz: 10, pubblico: 30 },
  ], ['quiz', 'pubblico']);
  assert.deepEqual(r.map((t) => [t.id, t.posizione]), [['b', 1], ['a', 2], ['c', 3]]);
  const r2 = rankTeams([{ id: 'a', totale: 50, quiz: 20, pubblico: 30 }, { id: 'b', totale: 50, quiz: 20, pubblico: 30 }], ['quiz', 'pubblico']);
  assert.deepEqual(r2.map((t) => t.posizione), [1, 1]);
  assert.ok(r2[0].exAequo);
});

test('punteggio completo: quiz per domanda, pubblico, Sugarfree, correzioni', () => {
  const { e } = make();
  e.react('s1', [['c1', 'ride', 3]]); // t1: +6
  e.react('s2', [['c3', 'cuore', 3]]); // t2: +3
  e.react('s3', [['c5', 'rabbia', 1]]); // t3: -2
  play(e, 'q1', { t1: C('q1'), t2: C('q1'), t3: W('q1') });
  play(e, 'q2', { t1: W('q2'), t2: C('q2'), t3: W('q2') });
  play(e, 'q3', { t1: W('q3'), t2: C('q3'), t3: W('q3') });
  assert.throws(() => e.quizOpen('q3'), /già giocata/); // una domanda non si assegna due volte
  e.setSugarfree('t3');
  e.addAdjustment('t1', -5, 'errore di lettura');
  const by = Object.fromEntries(e.computeStandings().coppie.map((t) => [t.id, t]));
  assert.equal(by.t1.totale, 10 + 30 + 0 - 5);
  assert.equal(by.t2.totale, 30 + 20);
  assert.equal(by.t3.totale, 0 + 10 + 25);
  assert.equal(e.addAdjustment('t1', 3).delta, 3); // la motivazione è facoltativa
  assert.throws(() => e.quizOpen('q9'), /inesistente/);
});

test('Sugarfree: un solo bonus, bloccabile, verdetto solo con voto confermato', () => {
  const { e } = make();
  assert.throws(() => e.ledPrepare('verdetto'), /Sugarfree/);
  e.setSugarfree('t1');
  e.setSugarfree('t2'); // sostituisce, non somma
  const st = e.computeStandings();
  assert.equal(st.coppie.reduce((s, t) => s + t.sugarfree, 0), 25);
  assert.throws(() => e.ledPrepare('verdetto'), /Conferma/);
  e.setSugarfreeLocked(true);
  assert.throws(() => e.setSugarfree('t3'), /bloccato/);
  e.goFinale();
  e.ledPrepare('verdetto');
  assert.equal(e.publicState().classifica, undefined); // preparato ma non pubblicato: niente spoiler
  assert.equal(e.screenState().program.type, 'promo'); // il LED non è cambiato
  e.ledPublish();
  assert.equal(e.screenState().program.type, 'verdetto');
  assert.equal(e.publicState().classifica[0].id, 't2');
});

test('LED: anteprima e pubblicazione separate, classifica congelata', () => {
  const { e } = make();
  e.react('s1', [['c1', 'ride', 3]]);
  e.ledPrepare('classifica');
  assert.equal(e.screenState().program.type, 'promo');
  e.ledPublish();
  const shown = e.screenState().program;
  assert.equal(shown.type, 'classifica');
  e.addAdjustment('t3', 10); // i punti cambiano…
  assert.deepEqual(e.screenState().program.standings, shown.standings); // …il LED no
  assert.throws(() => e.ledPrepare('sos'), /Nessun SOS/);
});

test('SOS: un voto per sessione, timer lato server, parità, LED collegato', () => {
  const { e, clock } = make();
  const run = e.startSos('sos1', 't1');
  assert.equal(e.s.mode, 'sos');
  assert.equal(e.screenState().program.type, 'sos'); // il cue SOS porta anche il LED
  assert.equal(e.screenState().program.sos.counts, null); // niente percentuali durante il voto
  assert.equal(e.voteSos('a', run.runId, 1).ok, true);
  assert.equal(e.voteSos('a', run.runId, 2).already, true);
  e.voteSos('b', run.runId, 2);
  assert.equal(e.screenState().program.sos.voters, 2);
  assert.throws(() => e.startSos('sos2', 't2'), /già un SOS/);
  assert.throws(() => e.revealSosAnswer(), /chiudi/);
  clock.advance(29_000); e.tick();
  assert.equal(e.s.sos.closed, false);
  clock.advance(1_700); e.tick();
  assert.equal(e.s.sos.closed, true);
  assert.deepEqual(e.s.sos.result.top, [1, 2]);
  assert.equal(e.s.sos.result.tie, true);
  assert.deepEqual(e.screenState().program.sos.counts, [0, 1, 1, 0]);
  assert.equal(e.screenState().program.sos.corretta, null);
  e.revealSosAnswer();
  assert.equal(e.screenState().program.sos.corretta, 1);
  assert.equal(e.voteSos('d', run.runId, 0).ok, false);
  const r2 = e.startSos('sos2', 't2', { alsoLed: false });
  assert.equal(e.screenState().program.runId, run.runId); // il LED resta sull'SOS precedente
  assert.ok(r2.runId);
});

test('generazioni: anno → generazione, vince l\'intervallo più stretto, statistiche', () => {
  const { e } = make();
  const g = (y) => e.generationOf(y)?.id;
  assert.equal(g(1930), 'silenziosa');
  assert.equal(g(1980), 'x');
  assert.equal(g(1985), 'millennial');
  assert.equal(g(1995), 'zillennial');
  assert.equal(g(1998), 'zillennial');
  assert.equal(g(2005), 'genz');
  assert.equal(g(2020), 'alpha');
  assert.equal(g(2026), 'beta');
  assert.equal(e.setProfile('u1', '  Giuli<b>  ', 2004).gen, 'genz');
  assert.equal(e.s.sessions.u1.nick, 'Giulib');
  assert.equal(e.setProfile('u2', 'Marco', 1990).gen, 'millennial');
  assert.equal(e.setProfile('u3', '', 1990).ok, false);
  assert.equal(e.setProfile('u4', 'X', 1800).ok, false);
  const st = e.genStats(); // + i 7 spettatori di prova creati da make(), tutti nati nel 2000
  assert.equal(st.total, 2 + 7);
  assert.equal(st.counts.genz, 1 + 7);
  assert.equal(st.counts.millennial, 1);
  e.ledPrepare('generazioni'); e.ledPublish();
  assert.equal(e.screenState().program.stats.total, 9);
});

test('quiz Rom-Com: solo nel finale, 4 risposte, una per domanda', () => {
  const { e } = make();
  assert.equal(e.answerAB('u', 'q1', 'A').ok, false); // durante lo show non c'è
  e.goFinale();
  assert.equal(e.answerAB('u', 'q1', 'E').ok, false); // solo A-D
  assert.equal(e.answerAB('u', 'q1', 'D').ok, true);
  assert.equal(e.answerAB('u', 'q1', 'A').choice, 'D'); // non modificabile
});

test('quiz Rom-Com: punteggi 2+1 e regole di spareggio', () => {
  const { e } = make();
  e.goFinale();
  const play = (sid, answers) => { answers.split('').forEach((c, i) => e.answerAB(sid, 'q' + (i + 1), c)); return e.computeProfile(sid).id; };
  assert.equal(play('tuttiA', 'AAAAAA'), 'bridget'); // Bridget 7 punti
  assert.equal(play('tuttiB', 'BBBBBB'), 'holiday'); // Holiday 6, Notting 5
  // 10 cose e Tre metri a 5 punti: vince chi ha più risposte principali (10 cose: 2 contro 1)
  assert.equal(play('pari', 'CDDDAC'), 'diecicose');
});

test('quiz Rom-Com: tutte le 4096 combinazioni danno un risultato, e tutti gli 8 film sono raggiungibili', () => {
  const { e } = make();
  e.goFinale();
  const seen = {};
  for (let n = 0; n < 4096; n++) {
    const sid = 'c' + n;
    for (let i = 0; i < 6; i++) e.answerAB(sid, 'q' + (i + 1), 'ABCD'[Math.floor(n / 4 ** i) % 4]);
    const id = e.computeProfile(sid)?.id;
    assert.ok(id, 'combinazione senza risultato: ' + n);
    seen[id] = (seen[id] || 0) + 1;
  }
  assert.equal(Object.keys(seen).length, 8);
});

test('SOS: dopo la chiusura i telefoni restano su «Guarda il LED» finché la regia non li riporta alle reazioni', () => {
  const { e, clock } = make();
  e.startSos('sos1', 't1');
  clock.advance(31_000); e.tick(); // chiuso
  clock.advance(10 * 60_000); e.tick();
  assert.equal(e.s.mode, 'sos');
  e.revealSosAnswer();
  e.goReactions();
  assert.equal(e.s.mode, 'reazioni');
});

test('SOS: il ritorno automatico funziona ancora se lo si riattiva da config', () => {
  const { e, clock } = make();
  e.config.sosRitornoAutomaticoSecondi = 10;
  e.startSos('sos1', 't1');
  clock.advance(31_000); e.tick();
  clock.advance(9_000); e.tick();
  assert.equal(e.s.mode, 'sos');
  clock.advance(1_500); e.tick();
  assert.equal(e.s.mode, 'reazioni');
});

test('parità di punteggio segnalata alla regia', () => {
  const { e } = make();
  assert.equal(e.adminState().parita.length, 1); // tutte a 20 punti all'inizio (premi pubblico divisi)
  play(e, 'q1', { t1: C('q1'), t2: C('q1'), t3: W('q1') });
  const p = e.adminState().parita;
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].squadre.sort(), ['Squadra Fucsia', 'Squadra Lime']);
  play(e, 'q2', { t1: W('q2'), t2: C('q2'), t3: W('q2') });
  assert.equal(e.adminState().parita.length, 0);
});

test('chiusura voti: reazioni ferme, telefoni e LED su «Votazioni chiuse»', () => {
  const { e } = make();
  e.setAudienceFrozen(true);
  assert.equal(e.publicState().votesClosed, true);
  assert.equal(e.react('s1', [['c1', 'ride', 1]]).ok, false);
  assert.equal(e.screenState().program.type, 'chiuse');
  e.setAudienceFrozen(false);
  e.setAudienceFrozen(true, { alsoLed: false });
  assert.equal(e.screenState().program.type, 'chiuse'); // resta quello di prima, non viene ripubblicato
});

test('senza nickname e anno non si vota né si reagisce', () => {
  const { e } = make();
  assert.equal(e.react('anonimo', [['c1', 'ride', 3]]).reason, 'profilo');
  assert.equal(e.s.reactions.c1.points, 0);
  const run = e.startSos('sos1', 't1');
  assert.equal(e.voteSos('anonimo', run.runId, 0).reason, 'profilo');
  e.setProfile('anonimo', 'Ora sì', 1999);
  assert.equal(e.voteSos('anonimo', run.runId, 0).ok, true);
});

test('persistenza: lo stato sopravvive a un riavvio', () => {
  const { e } = make();
  e.react('s1', [['c1', 'ride', 2]]);
  play(e, 'q1', { t1: C('q1'), t2: W('q1'), t3: W('q1') });
  e.setProfile('u', 'Ale', 1999);
  const copy = new ShowEngine(structuredClone(baseConfig), 'test');
  copy.load(JSON.parse(JSON.stringify(e.toJSON())));
  assert.equal(copy.s.reactions.c1.points, 4);
  assert.equal(copy.quizPoints('t1'), 10);
  assert.equal(copy.s.sessions.u.gen, 'genz');
});

test('quiz: domanda e risposte una alla volta, timer dalla D, lettere nascoste fino alla rivelazione', () => {
  const { e, clock } = make();
  e.quizOpen('q1');
  assert.equal(e.screenState().program.type, 'promo'); // preparare non tocca il LED
  e.quizNext();
  let q = e.screenState().program.quiz;
  assert.equal(e.screenState().program.type, 'quiz');
  assert.ok(q.testo.length > 0);
  assert.equal(q.opzioni.length, 0);
  e.quizNext(); e.quizNext();
  assert.equal(e.screenState().program.quiz.opzioni.length, 2);
  assert.equal(e.screenState().program.quiz.timer, null);
  e.quizNext(); e.quizNext();
  q = e.screenState().program.quiz;
  assert.equal(q.opzioni.length, 4);
  assert.equal(q.timer.running, true);
  assert.throws(() => e.quizNext(), /già tutte/);
  e.quizAnswer('t1', 2);
  q = e.screenState().program.quiz;
  assert.equal(q.squadre[0].risposto, true);
  assert.equal(q.squadre[0].idx, null); // la lettera non si vede ancora
  assert.throws(() => e.quizRevealTeams(), /Mancano/);
  e.quizAnswer('t2', 1); e.quizAnswer('t3', 0);
  e.quizAnswer('t1', 1); // correzione della regia
  clock.advance(120_000);
  assert.equal(e.screenState().program.quiz.timer.ended, true); // allo zero domanda e risposte restano
  assert.equal(e.screenState().program.quiz.opzioni.length, 4);
  assert.throws(() => e.quizRevealCorrect(), /prima le risposte delle squadre/);
  e.quizRevealTeams();
  assert.deepEqual(e.screenState().program.quiz.squadre.map((t) => t.idx), [1, 1, 0]);
  e.quizRevealCorrect();
  q = e.screenState().program.quiz;
  assert.equal(q.corretta, 1);
  assert.deepEqual(q.squadre.map((t) => t.esito), [true, true, false]);
  assert.throws(() => e.quizAnswer('t3', 1), /già rivelata/);
  const by = Object.fromEntries(e.computeStandings().coppie.map((t) => [t.id, t.quiz]));
  assert.deepEqual(by, { t1: 10, t2: 10, t3: 0 });
});

test('quiz con SOS: timer fermo, telefoni sulla stessa domanda, voti mostrati solo dopo le altre squadre, metà punti', () => {
  const { e, clock } = make();
  e.quizOpen('q1');
  for (let i = 0; i < 5; i++) e.quizNext();
  clock.advance(10_000);
  e.quizSos('t1');
  assert.equal(e.s.mode, 'sos');
  assert.equal(e.publicState().sos.domanda, baseConfig.quiz.domande[0].testo); // i telefoni votano la domanda del quiz
  const left = e.screenState().program.quiz.timer.left;
  clock.advance(20_000);
  assert.equal(e.screenState().program.quiz.timer.left, left); // timer fermo durante l'SOS
  assert.equal(e.screenState().program.type, 'quiz'); // il LED resta sulla domanda
  e.voteSos('a', e.s.sos.runId, C('q1')); e.voteSos('b', e.s.sos.runId, C('q1')); e.voteSos('c', e.s.sos.runId, 0);
  assert.equal(e.screenState().program.quiz.sos.counts, null);
  assert.throws(() => e.quizShowSos(), /non è ancora chiuso/);
  clock.advance(11_000); e.tick();
  assert.equal(e.s.sos.closed, true);
  assert.equal(e.screenState().program.quiz.corretta, null); // l'SOS NON rivela la risposta giusta
  e.quizAnswer('t2', C('q1'));
  assert.throws(() => e.quizShowSos(), /Squadra Turchese/); // le altre squadre rispondono prima
  e.quizAnswer('t3', W('q1'));
  e.quizShowSos();
  assert.ok(e.screenState().program.quiz.sos.counts);
  assert.equal(e.screenState().program.quiz.timer.running, true); // il timer riparte per la squadra dell'SOS
  assert.throws(() => e.quizSos('t2'), /già stato un SOS/);
  e.quizAnswer('t1', C('q1'));
  e.quizRevealTeams(); e.quizRevealCorrect();
  const by = Object.fromEntries(e.computeStandings().coppie.map((t) => [t.id, t.quiz]));
  assert.deepEqual(by, { t1: 5, t2: 10, t3: 0 });
  e.quizOpen('q2');
  for (let i = 0; i < 5; i++) e.quizNext();
  assert.throws(() => e.quizSos('t1'), /già usato/); // un SOS per squadra in tutto lo show
});

test('quiz: punti divisi per il numero di domande, sblocco d\'emergenza, rigioca', () => {
  const { e } = make();
  assert.deepEqual(e.quizPointsPer(), { per: 10, sos: 5 });
  e.quizList = [...e.quizList, { id: 'x', testo: 'x', opzioni: ['a', 'b', 'c', 'd'], corretta: 0 }, { id: 'y', testo: 'y', opzioni: ['a', 'b', 'c', 'd'], corretta: 0 }, { id: 'z', testo: 'z', opzioni: ['a', 'b', 'c', 'd'], corretta: 0 }];
  assert.deepEqual(e.quizPointsPer(), { per: 5, sos: 3 }); // 6 domande: 30 / 6
  e.quizList = e.quizList.slice(0, 3);
  e.quizOpen('q1');
  for (let i = 0; i < 5; i++) e.quizNext();
  e.quizSos('t3'); e.closeSos('test');
  assert.throws(() => e.quizShowSos(), /Prima devono rispondere/);
  e.quizShowSos({ force: true });
  e.quizAnswer('t1', 0);
  e.quizRevealTeams({ force: true }); // chi non ha risposto prende 0
  e.quizRevealCorrect();
  e.quizReset('q1');
  assert.equal(e.quizPoints('t1'), 0);
  e.quizOpen('q1'); // si può rigiocare
});
