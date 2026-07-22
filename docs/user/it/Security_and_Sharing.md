# Sicurezza e condivisione

Ultima verifica: 2026-07-22

Plainva mantiene il vault come file leggibili sul dispositivo e salva la copia cloud come oggetti cifrati opachi. Dopo aver collegato un account, apri **Impostazioni → vault → Sicurezza e condivisione**.

## Configurazione

1. Scegli i nomi di proprietario e dispositivo. Le chiavi restano nel portachiavi di sistema o, se non disponibile, sotto una passphrase locale.
2. Salva il file `.pvrecovery`, conserva il codice separatamente e inserisci i due gruppi richiesti. Servono entrambe le parti e nessuna contiene credenziali cloud.
3. Attiva il workspace. Plainva pubblica la policy firmata e cifra tutti i file in `.pvws/`. Il vault locale resta leggibile e la migrazione riprende dopo interruzioni.

Il vecchio contenuto in chiaro resta accanto a `.pvws/` durante la migrazione. Puoi rimuoverlo esplicitamente solo con stato **Protetto**; i file locali non vengono mai eliminati.

Le modifiche offline restano in una coda durevole. Le eliminazioni richiedono tombstone firmati e le modifiche parallele vengono conservate come copie `.CONFLICT-…`. Altri dispositivi, ripristino, team e slice arriveranno nelle fasi successive.
