# Configurare la sincronizzazione con Google Drive (Bring Your Own Credentials)

Stand: 2026-07-04

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

*Importante: lascia lo stato su "Test". NON devi pubblicare l'app. In modalità test, i token scadono dopo 7 giorni — Plainva li rinnova automaticamente in background, ma dopo modifiche significative o cambi di ambito potrebbe servire un nuovo accesso.*

### 4. Crea le credenziali (ID client e Secret)
1. Apri **Credenziali** nel menu a sinistra.
2. Clicca su **Crea credenziali** in alto e scegli **ID client OAuth**.
3. Come "Tipo di applicazione" scegli **App desktop** (o "Altra interfaccia utente").
4. Nome: ad es. "Plainva Desktop Client".
5. Clicca su **Crea**.
6. Un popup mostra il tuo **ID client** e il **Secret client**.

### 5. Inseriscili in Plainva
1. Apri Plainva e vai alle impostazioni del vault (icona a forma di ingranaggio per il vault in questione).
2. Apri la sezione **Sincronizzazione cloud**.
3. Scegli **Google Drive** come provider.
4. Incolla l'**ID client** e il **Secret client** copiati nei campi corrispondenti.
5. Clicca su **Connetti a Google**.
6. Si apre una finestra del browser di Google. Accedi con l'account che hai aggiunto sotto "Utenti di test".
7. Google potrebbe avvisare che l'app non è verificata. Clicca su **Avanzate** e poi su **Vai a Plainva (non sicuro)**.
8. Conferma i permessi richiesti.

Il tuo vault ora si sincronizza in sicurezza con Google Drive tramite le tue credenziali.
