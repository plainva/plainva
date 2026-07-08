# Konfiguracja synchronizacji Google Drive (własne dane dostępowe)

Aby zsynchronizować lokalny vault z Google Drive w Plainva, możesz użyć własnych danych dostępowych Google API. Ponieważ Plainva nie przeszła (jeszcze) przez centralną weryfikację CASA Google, podejście **Bring Your Own Credentials (BYO)** oferuje bezpieczny sposób na synchronizację Twoich prywatnych plików.

Zasadniczo tworzysz sobie mały własny „projekt deweloperski” u Google, który należy wyłącznie do Ciebie i do którego dostęp masz tylko Ty.

## Instrukcja krok po kroku

### 1. Utwórz projekt w Google Cloud Console
1. Przejdź do [Google Cloud Console](https://console.cloud.google.com/).
2. Zaloguj się na swoje konto Google.
3. W lewym górnym rogu (obok logo Google Cloud) otwórz menu rozwijane projektu i wybierz **Nowy projekt**.
4. Wpisz nazwę (np. „Plainva Sync") i kliknij **Utwórz**.

### 2. Włącz Google Drive API
1. Wybierz swój nowo utworzony projekt w menu rozwijanym u góry.
2. Wyszukaj **Google Drive API** w górnym pasku wyszukiwania i wybierz wpis w sekcji „Marketplace".
3. Kliknij **Włącz**.

### 3. Skonfiguruj ekran zgody OAuth
Aby Plainva mogła używać Twoich danych dostępowych, musi zostać skonfigurowany ekran zgody („OAuth Consent Screen"). Ponieważ tylko Ty korzystasz z aplikacji, pozostaje ona w trybie „testowym".

1. W lewym menu bocznym pod **APIs & Services** otwórz **OAuth consent screen**.
2. W sekcji „User Type" wybierz **Zewnętrzny** (chyba że korzystasz z Google Workspace) i kliknij **Utwórz**.
3. **Informacje o aplikacji:**
   - Nazwa aplikacji: np. „Plainva"
   - E-mail wsparcia użytkownika: Twój własny adres e-mail
   - Dane kontaktowe programisty: Twój własny adres e-mail
   - Kliknij **Zapisz i kontynuuj**.
4. **Zakresy (Scopes):**
   - Kliknij **Dodaj lub usuń zakresy**.
   - Wyszukaj `.../auth/drive` (Google Drive API, pełny dostęp) i zaznacz pole.
   - *Kontekst: pełny dostęp jest potrzebny, aby Plainva mogła synchronizować także pliki, które umieścisz bezpośrednio w folderze synchronizacji przez interfejs webowy Google Drive.*
   - Kliknij Aktualizuj, następnie **Zapisz i kontynuuj**.
5. **Użytkownicy testowi:**
   - Kliknij **Dodaj użytkowników**.
   - Wpisz dokładnie ten adres e-mail Google, którego później użyjesz do synchronizacji w Plainva.
   - Kliknij **Zapisz i kontynuuj**, następnie wróć do panelu.

*Ważne: pozostaw status na „Testing" (tryb testowy). NIE musisz publikować aplikacji. W trybie testowym tokeny wygasają po 7 dniach — Plainva odnawia je automatycznie w tle, ale po istotnych zmianach lub zmianie zakresów może być konieczne ponowne zalogowanie.*

### 4. Utwórz dane dostępowe (Client ID i Secret)
1. Otwórz **Dane dostępowe** (Credentials) w lewym menu.
2. Kliknij **Utwórz dane dostępowe** u góry i wybierz **Identyfikator klienta OAuth**.
3. Jako „Typ aplikacji" wybierz **Aplikacja komputerowa** (lub „Other UI").
4. Nazwa: np. „Plainva Desktop Client".
5. Kliknij **Utwórz**.
6. Wyskakujące okienko pokaże Twój **Client ID** i **Client Secret**.

### 5. Wprowadź je w Plainva
1. Otwórz Plainva i przejdź do ustawień vaultu (ikona zębatki przy danym vaulcie).
2. Otwórz sekcję **Synchronizacja z chmurą**.
3. Wybierz **Google Drive** jako dostawcę.
4. Wklej skopiowane **Client ID** i **Client Secret** w odpowiednie pola.
5. Kliknij **Połącz z Google**.
6. Otworzy się okno przeglądarki Google. Zaloguj się kontem, które dodałeś w sekcji „Użytkownicy testowi".
7. Google może ostrzec, że aplikacja jest niezweryfikowana. Kliknij **Zaawansowane**, a następnie **Przejdź do Plainva (niebezpieczne)**.
8. Potwierdź żądane uprawnienia.

Twój vault synchronizuje się teraz bezpiecznie z Google Drive za pomocą Twoich własnych danych dostępowych.
