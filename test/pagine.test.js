import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Un errore di sintassi in una pagina la spegne del tutto (es. il LED muto): si controllano tutte prima di pubblicare.
test('pagine: nessun errore di sintassi negli script del sito', () => {
  for (const f of readdirSync(new URL('../public/js/', import.meta.url))) if (f.endsWith('.js')) execFileSync(process.execPath, ['--check', new URL(`../public/js/${f}`, import.meta.url).pathname]);
  for (const page of ['schermo.html', 'index.html', 'regia.html']) {
    const html = readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    for (const [, body] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const code = body.replace(/^\s*import\s.+$/gm, '');
      assert.doesNotThrow(() => new Function(code), `${page}: script non valido`);
    }
  }
});
