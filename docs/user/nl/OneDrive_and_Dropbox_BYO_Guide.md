# OneDrive & Dropbox instellen (eigen app-registratie)

Laatst bijgewerkt: 2026-07-11

**Normaal gesproken heb je deze pagina niet nodig:** Plainva levert eigen app-ID's voor OneDrive en Dropbox mee — je kiest de provider, klikt op **Verbinden** en meldt je aan. Deze handleiding is alleen voor het **optionele** geval dat je een eigen (gratis) app-registratie wilt gebruiken (bijv. bij bedrijfsbeperkingen). In de sync-instellingen blend je de ID-velden in via **Eigen app-ID gebruiken** en voer je vervolgens precies één publieke waarde in:

- **OneDrive** → een **Client-ID** (formaat `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → een **App-key** (korte tekenreeks)

Beide registraties zijn gratis, zonder creditcard en zonder betaald abonnement. Een geheim wachtwoord (client secret) heb je **niet** nodig — de genoemde waarden zijn openbaar en mogen zonder risico worden opgeslagen.

Deze pagina is de uitgebreide aanvulling op de korte versies onder [Sync instellen](Sync_Setup.md).

> De meegeleverde ID's van Plainva zijn al vooraf ingevuld — de onderstaande Delen A/B heb je alleen nodig voor je **eigen** registratie.

---

## Deel A — OneDrive (Microsoft Entra)

**Voorwaarde:** een Microsoft-account (hetzelfde account waarvan je OneDrive wilt synchroniseren). Bij de eerste aanmelding maakt Microsoft automatisch een gratis directory voor je aan — een Azure-abonnement is niet nodig.

### 1. Portal openen

1. Ga naar **[entra.microsoft.com](https://entra.microsoft.com)** (`portal.azure.com` werkt ook).
2. Meld je aan met je Microsoft-account.

### 2. Nieuwe app-registratie aanmaken

1. Menu **Identiteit → Toepassingen → App-registraties**, dan **+ Nieuwe registratie**.
2. **Naam:** vrij te kiezen, bijv. `Plainva` (alleen ter weergave).
3. **Ondersteunde accounttypen:** kies **"Accounts in elke organisatiedirectory … en persoonlijke Microsoft-accounts"**. Alleen deze optie sluit aan op het aanmeldpunt van Plainva; "alleen deze directory" laat persoonlijke OneDrive-accounts mislukken.
4. **Redirect-URI** — regel dit meteen hier:
   - Platform: **"Openbare client/native (mobiel en desktop)"**.
   - Waarde: `http://localhost` (precies zo — geen poort, geen slash aan het eind).

   > ⚠️ Kies niet "Web" of "SPA". "Web" vereist een client secret en de aanmelding mislukt dan.
5. **Registreren**.

### 3. Client-ID kopiëren

Kopieer op het **Overzicht** van de app de waarde **"Toepassings-ID (client)"** — dat is jouw waarde voor Plainva. (De "Directory-ID (tenant)" heb je niet nodig.)

### 4. Openbare clientstromen toestaan

1. Menu **Verificatie**.
2. Zet helemaal onderaan **"Openbare clientstromen toestaan"** op **Ja**.
3. **Opslaan**.

### 5. Machtigingen instellen

1. Menu **API-machtigingen → + Een machtiging toevoegen → Microsoft Graph → Gedelegeerde machtigingen**.
2. Vink beide aan:
   - `Files.ReadWrite`
   - `offline_access` (levert het langdurige aanmeldtoken — **zonder** deze weigert Plainva de verbinding)
3. **Toevoegen**. Beheerderstoestemming is niet nodig bij persoonlijke accounts; je stemt zelf toe bij het aanmelden.

### In Plainva invoeren

1. **Instellingen → Vault → Synchronisatie**.
2. Zet de **Sync-provider** op **OneDrive**.
3. Plak de gekopieerde toepassings-ID in het veld **Client-ID**; stel optioneel de **OneDrive-map (naam)** in (standaard `Plainva`).
4. **Verbinden met Microsoft** → meld je aan in de browser en bevestig de toegang. De browser meldt daarna dat je het venster kunt sluiten.

---

## Deel B — Dropbox

**Voorwaarde:** een Dropbox-account.

### 1. App-console openen

1. Ga naar **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** en meld je aan.
2. Klik op **Create app**.

### 2. App-type kiezen

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — niet "App folder".

   > ⚠️ **Full Dropbox** is verplicht: "App folder" ziet alleen een geïsoleerde submap en vindt bestaande vaults elders in je Dropbox niet.
3. **Name:** een wereldwijd unieke naam, bijv. `Plainva-Sync-<jenaam>` (alleen technisch, niemand anders ziet dit).
4. **Create app**.

### 3. Redirect-URI registreren

Tabblad **Settings → OAuth 2 → Redirect URIs**: voer **exact** `http://127.0.0.1:41953` in en klik op **Add**.

> ⚠️ Moet tekstueel exact overeenkomen: `127.0.0.1` (niet `localhost`), poort `41953`, geen slash aan het eind. Plainva bindt precies deze poort; elke afwijking breekt de aanmelding af.

### 4. Machtigingen instellen

Tabblad **Permissions** — vink het volgende aan en klik onderaan op **Submit**:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Wijzig je de machtigingen later, dan moet je in Plainva **opnieuw verbinden**, anders blijven de oude rechten gelden.

### 5. App-key kopiëren

Tabblad **Settings**: kopieer de waarde **App key** — dat is jouw waarde voor Plainva. (Het "App secret" heb je niet nodig.)

> Je app blijft in de status "Development". Voor privégebruik is dat voldoende; "Apply for production" is alleen nodig als veel andere gebruikers dezelfde App-key gaan gebruiken.

### In Plainva invoeren

1. **Instellingen → Vault → Synchronisatie**.
2. Zet de **Sync-provider** op **Dropbox**.
3. Plak de gekopieerde App-key in het veld **App-key**; stel optioneel de **Dropbox-map (pad)** in (standaard `/Plainva`).
4. **Verbinden met Dropbox** → meld je aan in de browser en bevestig de toegang.

---

## Als er iets vastloopt

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| OneDrive: "Microsoft heeft geen refresh_token geleverd" | `offline_access` ontbreekt | Stap A5: `offline_access` toevoegen, dan **Opnieuw verbinden** |
| OneDrive: aanmelding vraagt om een secret / mislukt | Platform "Web" in plaats van "Mobiel en desktop" | Stap A2: platform **Openbare client/native**, redirect `http://localhost` |
| OneDrive: persoonlijk account wordt geweigerd | Verkeerd accounttype | Stap A2: kies "… en persoonlijke Microsoft-accounts" |
| Dropbox: aanmelding hangt / "redirect_uri mismatch" | Redirect niet exact | Stap B3: precies `http://127.0.0.1:41953` |
| Dropbox: "Port 41953 is in use" | Ander programma blokkeert de poort | Blokkerende toepassing sluiten, opnieuw proberen |
| Dropbox: vindt de vault niet / rechten ontbreken | "App folder" in plaats van "Full Dropbox", of machtigingen niet **Submit**ted | Stap B2 / B4 controleren, dan **Opnieuw verbinden** |

## Zie ook

- [Sync instellen](Sync_Setup.md) — korte versie en de overige providers
- [Sync-compatibiliteit](Sync_Compatibility.md) — welke diensten hoe werken
- [FAQ & probleemoplossing](FAQ.md)
