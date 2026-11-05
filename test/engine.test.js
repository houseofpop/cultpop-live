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
  return { e, clock };
}

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
  e.setQuizAnswer('t1', 0, true);
  e.setQuizAnswer('t2', 0, true); e.setQuizAnswer('t2', 1, true); e.setQuizAnswer('t2', 2, true);
  e.setQuizAnswer('t2', 2, true); // ripetere la stessa casella non somma due volte
  e.setSugarfree('t3');
  e.addAdjustment('t1', -5, 'errore di lettura');
  const by = Object.fromEntries(e.computeStandings().coppie.map((t) => [t.id, t]));
  assert.equal(by.t1.totale, 10 + 30 + 0 - 5);
  assert.equal(by.t2.totale, 30 + 20);
  assert.equal(by.t3.totale, 0 + 10 + 25);
  assert.equal(e.addAdjustment('t1', 3).delta, 3); // la motivazione è facoltativa
  assert.throws(() => e.setQuizAnswer('t1', 5, true), /inesistente/);
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
  e.setQuizAnswer('t3', 0, true); // i punti cambiano…
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
  const st = e.genStats();
  assert.equal(st.total, 2);
  assert.equal(st.counts.genz, 1);
  e.ledPrepare('generazioni'); e.ledPublish();
  assert.equal(e.screenState().program.stats.total, 2);
});

test('quiz Rom-Com: solo nel finale, una risposta, profilo deterministico', () => {
  const { e } = make();
  assert.equal(e.answerAB('u', 'ab1', 'A').ok, false); // durante lo show non c'è
  e.goFinale();
  assert.equal(e.answerAB('u', 'ab1', 'A').ok, true);
  assert.equal(e.answerAB('u', 'ab1', 'B').choice, 'A');
  for (const q of ['ab2', 'ab3', 'ab4']) e.answerAB('u', q, 'A');
  assert.equal(e.personal('u').profilo.id, 'romantica');
  e.answerAB('v', 'ab1', 'B'); e.answerAB('v', 'ab2', 'B'); e.answerAB('v', 'ab3', 'B'); e.answerAB('v', 'ab4', 'A');
  assert.equal(e.computeProfile('v').id, 'gesto'); // parità bestie/gesto: decide l'ultima risposta
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

test('persistenza: lo stato sopravvive a un riavvio', () => {
  const { e } = make();
  e.react('s1', [['c1', 'ride', 2]]);
  e.setQuizAnswer('t1', 1, true);
  e.setProfile('u', 'Ale', 1999);
  const copy = new ShowEngine(structuredClone(baseConfig), 'test');
  copy.load(JSON.parse(JSON.stringify(e.toJSON())));
  assert.equal(copy.s.reactions.c1.points, 4);
  assert.equal(copy.quizPoints('t1'), 10);
  assert.equal(copy.s.sessions.u.gen, 'genz');
});
