# Cult Pop LIVE

Web app interattiva per *Millennial spiegati alla Gen Z LIVE* (Milano Music Week, 20/11/2026).
Un solo server Node.js che fa da unica fonte di verità, più tre pagine: **Pubblico** (`/`), **Control Room** (`/regia`) e **LED** (`/schermo`).

## Avvio in locale
```bash
npm install
npm start            # http://localhost:3000
npm test             # test della logica (punteggi, rate limit, SOS, profili, persistenza)
npm run simulate -- --n=150 --show=prova   # 150 telefoni finti sullo show di PROVA
```

| Pagina | URL |
|---|---|
| Pubblico (show reale) | `/` (è questo che va nel QR) |
| Pubblico (prova) | `/?show=prova` |
| Regia | `/regia` (password: `ADMIN_PASSWORD`) |
| LED | `/schermo?key=SCREEN_KEY&show=live&w=1920&h=1080` (H aiuto, F schermo intero, P scarica PNG; `&trasparente=1` per lo sfondo trasparente; `&audio=0` toglie i suoni, `&volume=0.5` li abbassa) |

## Variabili d'ambiente (obbligatorie online)
| Nome | Uso |
|---|---|
| `ADMIN_PASSWORD` | password della regia |
| `SCREEN_KEY` | chiave del link LED |
| `PUBLIC_URL` | indirizzo pubblico del sito, usato per il QR code sul LED (es. `https://live.cultpop.it`) |
| `PORT` | porta (default 3000) |
| `DATA_DIR` | cartella dello stato salvato (default `./data`; serve un disco persistente) |
| `SHOW_CONFIG` | percorso del file contenuti (default `config/show.json`) |

## Contenuti
Tutto ciò che cambia tra uno show e l'altro sta in `config/show.json`: concorrenti, coppie, emoji e punti, rate limit, regole dei punteggi, domande A/B con i pesi sui profili, profili, SOS.
Il server valida il file all'avvio e, se c'è un errore, si rifiuta di partire dicendo cosa non va.
Le foto vanno in `public/img/concorrenti/` (formato quadrato o 3:4, webp, max ~150 KB ciascuna).

## Architettura in breve
- `server/engine.js`: tutta la logica dello show (puro, testato). Stato in memoria, salvato su disco ogni secondo. Dopo un riavvio lo stato viene ricaricato.
- `server/index.js`: HTTP + Socket.IO (WebSocket con fallback HTTP). Tre namespace: pubblico, `/regia` (password), `/schermo` (chiave).
- Gli show `live` e `prova` sono istanze separate: dati, telefoni e LED distinti.
- Timer SOS sul server (con 600 ms di tolleranza di rete), un voto per sessione.
- Reazioni: il telefono accumula i tap e li invia ogni 0,7 s; il server applica un "secchiello" per sessione (3 reazioni valide ogni 10 s, configurabile).
- Card del profilo e scoreboard sono disegnate su canvas: niente carico sul server, e il PNG è identico a ciò che si vede.
- **Una sola istanza del server.** Non scalare orizzontalmente: lo stato è in memoria. Per 150 persone basta e avanza.

## Deploy
Qualsiasi hosting Node con disco persistente e un solo processo (VPS UE, Render, Railway, Fly.io con volume).
Mettere `live.cultpop.it` (o simile) davanti con HTTPS. Il sito principale `cultpop.it` non va toccato.

## Flusso dello show (v0.2)
- **Telefono:** regole → nickname e anno di nascita (rotellina) → generazione con testo e immagine → reazioni per tutto lo show → SOS quando li lancia la regia → finale con classifica (solo dopo il verdetto) e quiz «Che Rom-Com sei?» facoltativo.
- **Suoni del LED:** escono dalla sorgente web come l'audio di un contributo video (il tecnico la porta nel mixer e ne regola il volume). SOS, tempo scaduto, risposta corretta, cambio scena, votazioni chiuse, verdetto (rullo, stacchi, fanfara). Sintetizzati da `scripts/suoni.py`, nessun diritto; si sostituiscono con file propri in `public/audio/` o da `config/show.json → show.suoni`. In un browser normale partono dopo il primo tasto o clic sulla pagina (lo stato è nella guida, tasto H); nei software di regia video di solito subito. L'anteprima in Control Room è muta.
- **LED:** la regia prepara una scena in anteprima e la pubblica sulla pagina LED; quando mandarla in onda lo decide il tecnico. Scene: promemoria con QR, classifica provvisoria, generazioni in sala, SOS (countdown, poi percentuali, poi risposta corretta), verdetto (rivelazione dal 3° al 1°).
- **Protezioni:** il verdetto si può preparare solo dopo aver confermato il voto Sugarfree, e si pubblica tenendo premuto il pulsante per 2 secondi. Punti quiz per domanda (D1, D2, D3), quindi niente doppie somme.
- **Immagini delle generazioni:** `public/img/generazioni/<id>.webp`, quadrate 1080×1080 px, max 300 KB, soggetto al centro. Poi si aggiorna il campo `immagine` in `config/show.json`.

Simulatore nel browser: `python3 demo/build.py` crea `demo/dist/simulatore.html`.
