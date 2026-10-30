# Configurare OneDrive e Dropbox (registrazione app personale)

Ultimo aggiornamento: 2026-10-30

**Normalmente non hai bisogno di questa pagina:** Plainva fornisce già un proprio ID app per OneDrive **e** Dropbox — scegli il provider, fai clic su **Accedi con Microsoft…** oppure **Accedi con Dropbox…** e accedi. Ti serve una registrazione app **personale** (gratuita) solo in due casi: quando una restrizione aziendale blocca l'accesso incluso, oppure quando vuoi mettere deliberatamente la connessione sotto il tuo controllo. Per **OneDrive** lo inserisci in **Accesso su questo dispositivo** → **Cambia** → **ID client personale** — nella pagina dell'account o nella procedura, sul desktop come sul telefono, solo per questo dispositivo. Per **Dropbox** vale lo stesso: nella procedura sotto **Altro accesso** → **Chiave dell'app personale**, oppure nella pagina dell'account sotto **Accesso su questo dispositivo** → **Accesso su questo dispositivo** → **Cambia**. La chiave dell'app vale per questo dispositivo, gli altri dispositivi mantengono la propria impostazione; una chiave dell'app che un account aveva già in precedenza viene ripresa automaticamente. In entrambi i casi inserisci un unico valore pubblico:

- **OneDrive** → un **ID client** (formato `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → una **App Key** (una breve stringa)

Entrambe le registrazioni sono gratuite, senza carta di credito e senza abbonamento a pagamento. Non ti serve **nessuna** password segreta (client secret) — i valori sopra sono pubblici e possono essere memorizzati senza rischi.

Questa pagina è l'approfondimento dettagliato delle versioni brevi in [Configurare la sincronizzazione](Sync_Setup.md).

> Per entrambi i provider l'ID incluso è già precompilato — ti serve la Parte A o la Parte B solo per una tua registrazione **personale**.

---

## Parte A — OneDrive (Microsoft Entra)

**Prerequisito:** un account Microsoft (lo stesso il cui OneDrive vuoi sincronizzare). Al primo accesso Microsoft crea automaticamente una directory gratuita per te — non serve alcun abbonamento Azure.

### 1. Apri il portale

1. Vai su **[entra.microsoft.com](https://entra.microsoft.com)** (funziona anche `portal.azure.com`).
2. Accedi con il tuo account Microsoft.

### 2. Crea una nuova registrazione app

1. Menu **Identità → Applicazioni → Registrazioni app**, poi **+ Nuova registrazione**.
2. **Nome:** scelta libera, ad es. `Plainva` (solo a scopo di visualizzazione).
3. **Tipi di account supportati:** scegli **"Account in qualsiasi directory organizzativa … e account Microsoft personali"**. Solo questa opzione corrisponde all'endpoint di accesso di Plainva; "solo questa directory" fa fallire gli account OneDrive personali.
4. **URI di reindirizzamento** — fai subito questo passaggio qui:
   - Piattaforma: **"Client pubblico/nativo (mobile e desktop)"**.
   - Valore: `http://localhost` (esattamente così — senza porta, senza barra finale).

   > ⚠️ Non scegliere "Web" o "SPA". "Web" richiede un client secret e l'accesso fallirà.
5. **Registra**.

### 3. Copia l'ID client

Nella **Panoramica** dell'app, copia il valore **"ID applicazione (client)"** — questo è il tuo valore per Plainva. (Non ti serve l'"ID directory (tenant)".)

### 4. Consenti i flussi client pubblici

1. Menu **Autenticazione**.
2. In fondo alla pagina, imposta **"Consenti flussi client pubblici"** su **Sì**.
3. **Salva**.

### 5. Imposta le autorizzazioni

1. Menu **Autorizzazioni API → + Aggiungi un'autorizzazione → Microsoft Graph → Autorizzazioni delegate**.
2. Spunta entrambe:
   - `Files.ReadWrite`
   - `offline_access` (fornisce il token di accesso di lunga durata — **senza** questo Plainva rifiuta di connettersi)
3. **Aggiungi**. Il consenso dell'amministratore non è necessario per gli account personali; lo dai tu stesso al momento dell'accesso.

### Inseriscilo in Plainva

1. **Impostazioni → il tuo vault → Account cloud**: apri l'account Microsoft, oppure avvia **Collega account…** con la scheda **Microsoft**.
2. In **Accesso su questo dispositivo** scegli **Cambia**, poi **ID client personale**.
3. Incolla l'ID applicazione copiato nel campo **ID client** e **Salva**.
4. **Riconnetti** (nella procedura: **Accedi con Microsoft…**) → accedi nel browser e conferma l'accesso. Il browser ti dirà poi che puoi chiudere la finestra.

---

## Parte B — Dropbox

**Prerequisito:** un account Dropbox.

### 1. Apri la console dell'app

1. Vai su **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** e accedi.
2. Clicca su **Create app**.

### 2. Scegli il tipo di app

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — non "App folder".

   > ⚠️ **Full Dropbox** è obbligatorio: "App folder" vede solo una sottocartella isolata e non troverà i vault esistenti altrove nel tuo Dropbox.
3. **Name:** un nome univoco a livello globale, ad es. `Plainva-Sync-<tuonome>` (solo tecnico, nessun altro lo vede).
4. **Create app**.

### 3. Registra l'URI di reindirizzamento

Scheda **Settings → OAuth 2 → Redirect URIs**: inserisci **esattamente** `http://127.0.0.1:41953` e clicca su **Add**.

> ⚠️ Deve corrispondere carattere per carattere: `127.0.0.1` (non `localhost`), porta `41953`, senza barra finale. Plainva si lega esattamente a questa porta; qualsiasi deviazione interrompe l'accesso.

### 4. Imposta le autorizzazioni

Scheda **Permissions** — spunta quanto segue e clicca su **Submit** in fondo:

- `account_info.read`
- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Se cambi le autorizzazioni in seguito, devi **Riconnettere** in Plainva, altrimenti restano valide le vecchie autorizzazioni.

### 5. Copia l'App key

Scheda **Settings**: copia il valore **App key** — questo è il tuo valore per Plainva. (Non ti serve l'"App secret".)

> La tua app resta nello stato "Development". Per l'uso privato è sufficiente; "Apply for production" serve solo se molte altre persone usano la stessa App key.

### Inseriscilo in Plainva

1. **Impostazioni → Vault → Account cloud**: apri l'account Dropbox oppure avvia **Collega account…** con la scheda **Dropbox**.
2. Nella procedura apri **Altro accesso** e scegli **Chiave dell'app personale**; nella pagina dell'account invece **Accesso su questo dispositivo** → **Accesso su questo dispositivo** → **Cambia**.
3. Incolla l'App key copiata e premi **Salva**.
4. **Accedi con Dropbox…** (nella pagina dell'account **Riconnetti**) → accedi nel browser e conferma l'accesso. La cartella cloud (predefinita `/Plainva`) la scegli poi tramite **Scegli cartella…**.

---

## Se qualcosa non funziona

| Sintomo | Causa | Soluzione |
|---|---|---|
| OneDrive: "Microsoft returned no refresh_token" | manca `offline_access` | Passaggio A5: aggiungi `offline_access`, poi **Riconnetti** |
| OneDrive: l'accesso richiede un secret / fallisce | Piattaforma "Web" invece di "Mobile e desktop" | Passaggio A2: piattaforma **Client pubblico/nativo**, reindirizzamento `http://localhost` |
| OneDrive: l'account personale viene rifiutato | Tipo di account errato | Passaggio A2: scegli "… e account Microsoft personali" |
| Dropbox: l'accesso resta bloccato / "redirect_uri mismatch" | Reindirizzamento non esatto | Passaggio B3: esattamente `http://127.0.0.1:41953` |
| Dropbox: "Port 41953 is in use" | Un altro programma blocca la porta | Chiudi l'applicazione che blocca, riprova |
| Dropbox: non trova il vault / mancano i permessi | "App folder" invece di "Full Dropbox", oppure permessi non inviati con **Submit** | Controlla il passaggio B2 / B4, poi **Riconnetti** |

## Vedi anche

- [Configurare la sincronizzazione](Sync_Setup.md) — versione breve e gli altri provider
- [Compatibilità di sincronizzazione](Sync_Compatibility.md) — quali servizi funzionano e come
- [FAQ e risoluzione dei problemi](FAQ.md)
