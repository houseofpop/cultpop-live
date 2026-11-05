# Messa online di Cult Pop LIVE

Architettura: il sito WordPress su SiteGround **non si tocca**. La piattaforma gira su **Render** (un solo server con disco) e il sottodominio `live.cultpop.it` punta lì con un record DNS.

Nessuna password va mai scritta in chat, email o gruppi WhatsApp. Si tengono in un gestore di password.

## A. GitHub (codice)
1. Crea un account su github.com (se non c'è) e attiva la verifica in due passaggi: *Settings → Password and authentication*.
2. Crea un repository **privato** e **vuoto** di nome `cultpop-live` (niente README, niente .gitignore).
3. Vai su https://claude.ai/connect-github, collega l'account GitHub e installa la Claude GitHub App **solo sul repository `cultpop-live`**.
4. Comunica a Claude il nome completo (es. `tuonome/cultpop-live`): Claude ci carica il codice.

## B. Render (piattaforma online)
1. Registrati su https://dashboard.render.com con **«Sign up with GitHub»**. Attiva la verifica in due passaggi (*Account Settings → Security*).
2. Aggiungi una carta: *Workspace Settings → Billing*. Piano Starter: circa 7 $/mese più circa 0,25 $/mese di disco.
3. **New + → Blueprint**. Quando chiede l'accesso a GitHub, consenti solo il repository `cultpop-live`.
4. Seleziona `cultpop-live`: Render legge `render.yaml` e propone il servizio `cultpop-live` con il disco `dati-show`. Premi **Deploy Blueprint**.
5. Attendi lo stato **Live** (3-5 minuti). Apri `https://<nome>.onrender.com/healthz` (l'indirizzo esatto lo mostra Render): deve comparire `{"ok":true,…}`.
6. Password: servizio → **Environment** → copia `ADMIN_PASSWORD` (regia) e `SCREEN_KEY` (pagina LED) nel gestore di password. Puoi sostituire `ADMIN_PASSWORD` con una frase lunga, di almeno 12 caratteri, più facile da digitare.

## C. Sottodominio (SiteGround)
1. Render: servizio → **Settings → Custom Domains → Add** → `live.cultpop.it`. Render mostra la destinazione (es. `cultpop-live.onrender.com`).
2. SiteGround: **Site Tools** di cultpop.it → **Domain → DNS Zone Editor** → scheda **CNAME** → Nome: `live` · Punta a: la destinazione mostrata da Render → **Create**.
   - Se il DNS di cultpop.it non è gestito da SiteGround, il record va aggiunto dove è gestito.
3. Torna su Render → **Verify**. Il certificato HTTPS si crea da solo, in pochi minuti fino a qualche ora.

## D. Verifiche
- `https://live.cultpop.it/healthz` → `{"ok":true,…}`
- `https://live.cultpop.it/?show=prova` dal telefono (modalità prova)
- `https://live.cultpop.it/regia` → password `ADMIN_PASSWORD` (la regia parte sempre dalla PROVA)
- `https://live.cultpop.it/schermo?key=SCREEN_KEY&show=prova` → pagina LED

## Sicurezza e regole per lo show
- Verifica in due passaggi su GitHub, Render e SiteGround.
- Password della regia: solo all'operatore Cult Pop (e a una persona di riserva). Link LED con chiave: solo al tecnico.
- **Dopo la prova generale (18/11): Render → Settings → Auto-Deploy → No.** Da lì nessun aggiornamento automatico.
- Il 19/11 si azzera lo show LIVE dalla regia (Zona pericolosa). Il 20/11 nessuna modifica.
- Mai aggiornare durante lo show: ogni aggiornamento riavvia il server per qualche secondo.
- Non aumentare il numero di istanze su Render: deve esistere un solo server.
- Dopo l'evento: eliminare il servizio su Render (i costi si fermano) e il record `live` su SiteGround.
