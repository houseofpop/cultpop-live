import { readFileSync } from 'node:fs';

/**
 * Carica e valida config/show.json.
 * Meglio un errore chiaro all'avvio che una sorpresa durante lo show.
 */
export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  validateConfig(raw);
  return raw;
}

export function validateConfig(c) {
  const errors = [];
  const err = (m) => errors.push(m);
  const ids = (arr) => new Set((arr || []).map((x) => x.id));

  if (!c.show?.titolo) err('show.titolo mancante');
  if (!Array.isArray(c.coppie) || c.coppie.length < 2) err('servono almeno 2 coppie');
  if (!Array.isArray(c.concorrenti) || c.concorrenti.length < 2) err('servono concorrenti');

  const teamIds = ids(c.coppie);
  if (teamIds.size !== (c.coppie || []).length) err('id coppie duplicati');
  const contIds = ids(c.concorrenti);
  if (contIds.size !== (c.concorrenti || []).length) err('id concorrenti duplicati');
  for (const k of c.concorrenti || []) {
    if (!teamIds.has(k.coppia)) err(`concorrente ${k.id}: coppia "${k.coppia}" inesistente`);
    if (!k.nome) err(`concorrente ${k.id}: nome mancante`);
  }
  for (const t of c.coppie || []) {
    const n = (c.concorrenti || []).filter((k) => k.coppia === t.id).length;
    if (n === 0) err(`coppia ${t.id} senza concorrenti`);
  }

  const em = c.reazioni?.emoji;
  if (!Array.isArray(em) || em.length === 0) err('reazioni.emoji mancanti');
  for (const e of em || []) if (typeof e.punti !== 'number') err(`emoji ${e.id}: punti non numerici`);
  const rl = c.reazioni?.rateLimit;
  if (!(rl?.reazioniValide > 0) || !(rl?.finestraSecondi > 0)) err('reazioni.rateLimit non valido');

  const p = c.punteggi;
  if (!p) err('punteggi mancanti');
  else {
    if (!Array.isArray(p.pubblico?.premi) || p.pubblico.premi.length !== (c.coppie || []).length)
      err('punteggi.pubblico.premi deve avere un valore per ogni coppia');
    if (!['media', 'alto'].includes(p.pubblico?.parita)) err('punteggi.pubblico.parita deve essere "media" o "alto"');
    if (!(p.quiz?.totale >= 0)) err('punteggi.quiz.totale non valido');
    if (!(p.sugarfree?.bonus >= 0)) err('punteggi.sugarfree.bonus non valido');
    for (const k of p.spareggioFinale || []) if (!['quiz', 'pubblico', 'sugarfree'].includes(k)) err(`spareggioFinale: "${k}" non valido`);
  }

  const profIds = ids(c.profili);
  if (profIds.size < 1) err('servono profili romcom');
  for (const q of c.domandeAB || []) {
    if (!Array.isArray(q.opzioni) || q.opzioni.length < 2 || q.opzioni.length > 8) err(`domanda ${q.id}: servono da 2 a 8 opzioni`);
    for (const [i, o] of (q.opzioni || []).entries()) {
      if (!o.testo) err(`domanda ${q.id}/${'ABCDEFGH'[i]}: testo mancante`);
      for (const k of ['principale', 'secondario']) if (o[k] && !profIds.has(o[k])) err(`domanda ${q.id}/${'ABCDEFGH'[i]}: film "${o[k]}" inesistente`);
      if (!o.principale) err(`domanda ${q.id}/${'ABCDEFGH'[i]}: manca il film principale`);
    }
  }
  if (ids(c.domandeAB).size !== (c.domandeAB || []).length) err('id domande A/B duplicati');

  for (const s of c.sos || []) {
    if (!Array.isArray(s.opzioni) || s.opzioni.length < 2) err(`sos ${s.id}: servono almeno 2 opzioni`);
    if (!(s.corretta >= 0 && s.corretta < (s.opzioni || []).length)) err(`sos ${s.id}: indice "corretta" fuori range`);
    if (!(s.durataSecondi > 0)) err(`sos ${s.id}: durataSecondi non valida`);
  }
  if (ids(c.sos).size !== (c.sos || []).length) err('id SOS duplicati');

  const qd = c.quiz?.domande || [];
  for (const q of qd) {
    if (!q.id || !q.testo) err(`quiz: domanda senza id o testo`);
    if (!Array.isArray(q.opzioni) || q.opzioni.length !== 4 || q.opzioni.some((o) => !String(o || '').trim())) err(`quiz ${q.id}: servono 4 risposte`);
    if (!(Number.isInteger(q.corretta) && q.corretta >= 0 && q.corretta < 4)) err(`quiz ${q.id}: "corretta" deve essere 0, 1, 2 o 3 (A, B, C, D)`);
  }
  if (ids(qd).size !== qd.length) err('id domande del quiz duplicati');
  if (c.quiz && !(c.quiz.timerSecondi > 0)) err('quiz.timerSecondi non valido');
  const gens = c.generazioni || [];
  if (!gens.length) err('servono le generazioni');
  for (const g of gens) {
    if (!g.id || !g.nome) err(`generazione senza id o nome`);
    if (!(Number.isInteger(g.da) && Number.isInteger(g.a) && g.da <= g.a)) err(`generazione ${g.id}: anni "da"/"a" non validi`);
    if (!g.testo) err(`generazione ${g.id}: testo mancante`);
  }
  if (ids(gens).size !== gens.length) err('id generazioni duplicati');
  const ymin = c.annoNascita?.min ?? 1928;
  const ymax = new Date().getFullYear();
  for (let y = ymin; y <= ymax; y++) if (!gens.some((g) => y >= g.da && y <= g.a)) { err(`l'anno ${y} non appartiene a nessuna generazione`); break; }

  if (errors.length) {
    const e = new Error('Configurazione show non valida:\n - ' + errors.join('\n - '));
    e.errors = errors;
    throw e;
  }
}

/** Parte della config che può vedere il pubblico (niente risposte corrette, niente pesi). */
export function publicConfig(c) {
  const teamById = Object.fromEntries(c.coppie.map((t) => [t.id, t]));
  return {
    show: c.show,
    coppie: c.coppie.map(({ id, nome, colore }) => ({ id, nome, colore })),
    concorrenti: c.concorrenti.map(({ id, nome, coppia, foto }) => ({
      id, nome, coppia, foto, colore: teamById[coppia]?.colore,
    })),
    emoji: c.reazioni.emoji.map(({ id, simbolo, punti }) => ({ id, simbolo, punti })),
    domandeAB: (c.domandeAB || []).map((q) => ({ id: q.id, testo: q.testo, opzioni: q.opzioni.map((o) => o.testo) })),
    generazioni: (c.generazioni || []).map(({ id, nome, nomeSingolare, da, a, testo, colore, immagine, timbro }) => ({ id, nome, nomeSingolare, da, a, testo, colore, immagine, timbro })),
    sosRitornoAutomaticoSecondi: c.sosRitornoAutomaticoSecondi ?? 10,
    annoNascita: { min: c.annoNascita?.min ?? 1928, max: new Date().getFullYear(), predefinito: c.annoNascita?.predefinito ?? 2000 },
  };
}
