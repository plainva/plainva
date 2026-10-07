# Configurare la sincronizzazione con Google Drive (Bring Your Own Credentials)

Ultimo aggiornamento: 2026-10-07

Per sincronizzare un vault locale con il tuo Google Drive in Plainva, puoi usare le tue credenziali API di Google. Poiché Plainva non è (ancora) passata attraverso la verifica CASA centrale di Google, questo approccio **Bring Your Own Credentials (BYO)** offre un modo sicuro per sincronizzare i tuoi file privati.

In sostanza configuri un tuo piccolo "progetto sviluppatore" presso Google, che appartiene solo a te e a cui solo tu puoi accedere.

## Guida passo dopo passo

### 1. Crea un progetto nella Google Cloud Console
1. Vai alla [Google Cloud Console](https://console.cloud.google.com/).
2. Accedi con il tuo account Google.
3. In alto a sinistra (accanto al logo di Google Cloud), apri il menu a tendina dei progetti e scegli **Nuovo progetto**.
4. Inserisci un nome (ad es. "Plainva Sync") e clicca su **Crea**.

### 2. Abilita l'API di Google Drive
1. Seleziona il progetto appena creato nel menu a tendina in alto.
2. Cerca **Google Drive API** nella barra di ricerca in alto e scegli la voce sotto "Marketplace".
3. Clicca su **Abilita**.

### 3. Configura la schermata di consenso OAuth
Perché Plainva usi le tue credenziali, deve essere configurata una schermata di consenso ("OAuth Consent Screen"). Poiché solo tu usi l'app, può restare in modalità "test".

1. Nel menu laterale sinistro, sotto **API e servizi**, apri **Schermata consenso OAuth**.
2. Sotto "Tipo di utente" scegli **Esterno** (a meno che tu non usi Google Workspace) e clicca su **Crea**.
3. **Informazioni sull'app:**
   - Nome dell'app: ad es. "Plainva"
   - Email di assistenza utenti: la tua email
   - Informazioni di contatto dello sviluppatore: la tua email
   - Clicca su **Salva e continua**.
4. **Ambiti:**
   - Clicca su **Aggiungi o rimuovi ambiti**.
   - Cerca `.../auth/drive` (Google Drive API, accesso completo) e seleziona la casella.
   - *Contesto: l'accesso completo è necessario perché Plainva possa sincronizzare anche i file che trascini nella tua cartella di sincronizzazione tramite l'interfaccia web di Google Drive.*
   - Clicca su Aggiorna, poi **Salva e continua**.
5. **Utenti di test:**
   - Clicca su **Aggiungi utenti**.
   - Inserisci esattamente l'indirizzo email di Google che userai in seguito per la sincronizzazione in Plainva.
   - Clicca su **Salva e continua**, poi torna alla dashboard.

*Importante: NON devi pubblicare l'app — nello stato "Test" funziona già pienamente. Aspettati però che Google faccia scadere l'accesso dopo **7 giorni** in questo caso, e in modo definitivo: in questa modalità scade anche il refresh token, quindi Plainva non può rinnovarlo in background. Plainva te lo dice in chiaro ("accesso scaduto"), e **Riconnetti** nei dettagli dell'account lo ripristina in un unico passaggio per ogni servizio di quell'account.*

**In produzione** elimina la scadenza fissa della modalità di test. Non garantisce un accesso permanente: Google può comunque far scadere o revocare l’accesso. I requisiti di pubblicazione e verifica dipendono dall’uso e dai permessi richiesti. [Google: scadenza dei token di aggiornamento](https://developers.google.com/identity/protocols/oauth2#expiration).

### 4. Crea le credenziali (ID client e Secret)
1. Apri **Credenziali** nel menu a sinistra.
2. Clicca su **Crea credenziali** in alto e scegli **ID client OAuth**.
3. Come "Tipo di applicazione" scegli **App desktop** (o "Altra interfaccia utente").
4. Nome: ad es. "Plainva Desktop Client".
5. Clicca su **Crea**.
6. Un popup mostra il tuo **ID client** e il **Secret client**.

### 5. Inseriscili in Plainva
1. Apri Plainva e vai alle impostazioni del vault (icona a forma di ingranaggio per il vault in questione).
2. Apri la sezione **Sincronizzazione**.
3. Scegli **Google Drive** come provider.
4. Incolla l'**ID client** e il **Secret client** copiati nei campi corrispondenti.
5. Clicca su **Connetti a Google**.
6. Si apre una finestra del browser di Google. Accedi con l'account che hai aggiunto sotto "Utenti di test".
7. Google potrebbe avvisare che l'app non è verificata. Clicca su **Avanzate** e poi su **Vai a Plainva (non sicuro)**.
8. Conferma i permessi richiesti.

Il tuo vault ora si sincronizza in sicurezza con Google Drive tramite le tue credenziali.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

Le istruzioni desktop richiedono un client desktop con ID e relativo secret. Android usa Google Identity Services: registra il pacchetto `com.plainva.app` con il certificato SHA-1 della build installata. Le versioni Play usano il certificato di firma dell’app; una build locale può usarne un altro. Android non usa un reindirizzamento del browser né un client secret. Su iOS, usa un client iOS con bundle ID `com.plainva.app` e URI di ritorno `com.plainva.app:/oauth2redirect`. Un client desktop non sostituisce la registrazione mobile. Per il calendario, abilita anche Google Calendar API e Google Tasks API.

**Android da Plainva 0.8.3:** le versioni precedenti accedevano a Google nel browser con un ID client. Un progetto Google predisposto per questo non ha un client Android, e ora l’accesso fallisce subito dopo la scelta dell’account. Dove aggiungi un account Google, Plainva mostra il **Nome del pacchetto** e l’**Impronta SHA-1 del certificato** della versione installata, ciascuno con **Copia**. Crea nello stesso progetto Google un client OAuth di tipo Android con esattamente questi due valori. Se manca, Plainva segnala che Google non accetta questa installazione; «**Accesso annullato.**» compare solo quando chiudi tu la finestra di Google. Una versione da Google Play e un file di installazione da GitHub possono essere firmati con certificati diversi; in tal caso ognuno ha bisogno del proprio client Android.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Aggiungi file, calendario o email all’account appropriato. Plainva verifica l’accesso scelto e richiede le autorizzazioni mancanti.

La registrazione Google non corrisponde al ritorno su questo dispositivo. Controlla il tipo di client e la configurazione mobile nella guida Google.

<!-- account-grants-destination-2026-09-14 -->
Un errore generico non rivela lo stato di pubblicazione o l’elenco degli utenti di prova del progetto Google. Controllali in Google Cloud e leggi il messaggio specifico del fornitore. Il client desktop richiede ID e relativo secret; la registrazione mobile dipende dalla piattaforma e dalla build installata.
