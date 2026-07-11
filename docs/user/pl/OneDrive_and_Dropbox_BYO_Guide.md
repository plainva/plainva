# Konfiguracja OneDrive i Dropbox (własna rejestracja aplikacji)

Stan na: 2026-07-11

**Zwykle nie potrzebujesz tej strony:** Plainva dostarcza własne identyfikatory aplikacji dla OneDrive i Dropbox — wybierasz dostawcę, klikasz **Połącz** i logujesz się. Ta instrukcja dotyczy tylko **opcjonalnego** przypadku, gdy chcesz użyć własnej (darmowej) rejestracji aplikacji (np. przy ograniczeniach firmowych). W ustawieniach synchronizacji odsłaniasz pola identyfikatora przez **Użyj własnego identyfikatora aplikacji**, a następnie wpisujesz dokładnie jedną publiczną wartość:

- **OneDrive** → **Client ID** (format `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → **App Key** (krótki ciąg znaków)

Obie rejestracje są bezpłatne, nie wymagają karty kredytowej ani płatnej subskrypcji. Sekretnego hasła (client secret) **nie potrzebujesz** — powyższe wartości są publiczne i można je bezpiecznie przechowywać.

Ta strona to szczegółowe uzupełnienie skróconych wersji pod [Konfiguracja synchronizacji](Sync_Setup.md).

> Identyfikatory dostarczone przez Plainva są już wstępnie wypełnione — poniższe Części A/B potrzebujesz tylko do **własnej** rejestracji.

---

## Część A — OneDrive (Microsoft Entra)

**Wymaganie wstępne:** konto Microsoft (to samo, którego OneDrive ma być synchronizowany). Przy pierwszym logowaniu Microsoft automatycznie tworzy dla Ciebie darmowy katalog — subskrypcja Azure nie jest potrzebna.

### 1. Otwórz portal

1. Przejdź na **[entra.microsoft.com](https://entra.microsoft.com)** (działa też `portal.azure.com`).
2. Zaloguj się kontem Microsoft.

### 2. Utwórz nową rejestrację aplikacji

1. Menu **Tożsamość → Aplikacje → Rejestracje aplikacji**, następnie **+ Nowa rejestracja**.
2. **Nazwa:** dowolna, np. `Plainva` (tylko do wyświetlania).
3. **Obsługiwane typy kont:** wybierz **„Konta w dowolnym katalogu organizacyjnym … oraz konta osobiste Microsoft"**. Tylko ta opcja pasuje do punktu logowania Plainva; „tylko ten katalog" powoduje, że osobiste konta OneDrive nie działają.
4. **Identyfikator URI przekierowania (Redirect URI)** — załatw od razu w tym miejscu:
   - Platforma: **„Klient publiczny/natywny (aplikacje mobilne i klasyczne)"**.
   - Wartość: `http://localhost` (dokładnie tak — bez portu, bez ukośnika na końcu).

   > ⚠️ Nie wybieraj „Web" ani „SPA". „Web" wymaga client secret i logowanie się nie powiedzie.
5. **Zarejestruj**.

### 3. Skopiuj Client ID

Na stronie **Przegląd** aplikacji skopiuj wartość **„Identyfikator aplikacji (klienta)"** — to jest Twoja wartość dla Plainva. („Identyfikator katalogu (dzierżawy)" nie jest potrzebny.)

### 4. Zezwól na przepływy klienta publicznego

1. Menu **Uwierzytelnianie**.
2. Na samym dole ustaw **„Zezwalaj na przepływy klienta publicznego"** na **Tak**.
3. **Zapisz**.

### 5. Ustaw uprawnienia

1. Menu **Uprawnienia interfejsu API → + Dodaj uprawnienie → Microsoft Graph → Uprawnienia delegowane**.
2. Zaznacz oba:
   - `Files.ReadWrite`
   - `offline_access` (dostarcza długotrwały token logowania — **bez niego** Plainva odmawia połączenia)
3. **Dodaj**. Zgoda administratora nie jest potrzebna dla kont osobistych; wyrażasz ją sam/sama podczas logowania.

### Wpisz to w Plainva

1. **Ustawienia → Vault → Synchronizacja**.
2. Ustaw **Dostawcę synchronizacji** na **OneDrive**.
3. Wklej skopiowany identyfikator aplikacji do pola **Client ID**; opcjonalnie ustaw **Folder OneDrive (nazwa)** (domyślnie `Plainva`).
4. **Połącz z Microsoft** → zaloguj się w przeglądarce i potwierdź dostęp. Przeglądarka poinformuje Cię potem, że możesz zamknąć okno.

---

## Część B — Dropbox

**Wymaganie wstępne:** konto Dropbox.

### 1. Otwórz konsolę aplikacji

1. Przejdź na **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** i zaloguj się.
2. Kliknij **Create app**.

### 2. Wybierz typ aplikacji

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — nie „App folder".

   > ⚠️ **Full Dropbox** jest wymagany: „App folder" widzi tylko odizolowany podfolder i nie znajdzie istniejących vaultów gdzie indziej w Twoim Dropbox.
3. **Name:** globalnie unikatowa nazwa, np. `Plainva-Sync-<twojenazwisko>` (czysto techniczna, nikt inny jej nie zobaczy).
4. **Create app**.

### 3. Zarejestruj redirect URI

Zakładka **Settings → OAuth 2 → Redirect URIs**: wpisz **dokładnie** `http://127.0.0.1:41953` i kliknij **Add**.

> ⚠️ Musi się zgadzać znak w znak: `127.0.0.1` (nie `localhost`), port `41953`, bez ukośnika na końcu. Plainva wiąże się z dokładnie tym portem; każde odstępstwo przerywa logowanie.

### 4. Ustaw uprawnienia

Zakładka **Permissions** — zaznacz poniższe i kliknij **Submit** na dole:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Jeśli zmienisz uprawnienia później, musisz w Plainva kliknąć **Połącz ponownie**, inaczej nadal obowiązują stare prawa dostępu.

### 5. Skopiuj App key

Zakładka **Settings**: skopiuj wartość **App key** — to jest Twoja wartość dla Plainva. („App secret" nie jest potrzebny.)

> Twoja aplikacja pozostaje w statusie „Development". To wystarcza do prywatnego użytku; „Apply for production" jest potrzebne tylko wtedy, gdy z tego samego App key ma korzystać wielu innych użytkowników.

### Wpisz to w Plainva

1. **Ustawienia → Vault → Synchronizacja**.
2. Ustaw **Dostawcę synchronizacji** na **Dropbox**.
3. Wklej skopiowany App key do pola **App Key**; opcjonalnie ustaw **Folder Dropbox (ścieżka)** (domyślnie `/Plainva`).
4. **Połącz z Dropbox** → zaloguj się w przeglądarce i potwierdź dostęp.

---

## Jeśli coś nie działa

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| OneDrive: „Microsoft nie zwrócił refresh_token" | brak `offline_access` | Krok A5: dodaj `offline_access`, następnie **Połącz ponownie** |
| OneDrive: logowanie żąda secretu / kończy się niepowodzeniem | platforma „Web" zamiast „Aplikacje mobilne i klasyczne" | Krok A2: platforma **Klient publiczny/natywny**, redirect `http://localhost` |
| OneDrive: konto osobiste jest odrzucane | zły typ konta | Krok A2: wybierz „… oraz konta osobiste Microsoft" |
| Dropbox: logowanie się zawiesza / „redirect_uri mismatch" | redirect niedokładny | Krok B3: dokładnie `http://127.0.0.1:41953` |
| Dropbox: „Port 41953 is in use" | inny program blokuje port | zamknij blokującą aplikację, spróbuj ponownie |
| Dropbox: nie znajduje vaultu / brak uprawnień | „App folder" zamiast „Full Dropbox" lub uprawnienia bez **Submit** | sprawdź krok B2 / B4, następnie **Połącz ponownie** |

## Zobacz też

- [Konfiguracja synchronizacji](Sync_Setup.md) — skrócona wersja i pozostali dostawcy
- [Zgodność synchronizacji](Sync_Compatibility.md) — które usługi działają i jak
- [FAQ i rozwiązywanie problemów](FAQ.md)
