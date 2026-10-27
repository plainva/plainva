# Konfiguracja synchronizacji Google Drive (własne dane dostępowe)

Stan na: 2026-10-26

Plainva loguje się do Google przez **Logowanie na tym urządzeniu**. Jeśli Twoja kompilacja zawiera **Logowanie standardowe** dla Google, niczego nie wpisujesz i ta strona nie jest Ci potrzebna. W przeciwnym razie — albo jeśli wolisz własny projekt — używasz własnych danych dostępowych Google API: podejście **Bring Your Own Credentials (BYO)** oferuje bezpieczny sposób na synchronizację Twoich prywatnych plików.

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

*Ważne: nie musisz publikować aplikacji — w statusie „Testing" działa ona w pełni. Licz się jednak z tym, że Google unieważni logowanie po **7 dniach** — i to na stałe: w tym trybie wygasa też token odświeżający, więc Plainva nie może go odnowić w tle. Plainva mówi o tym wprost („logowanie wygasło"), a **Zaloguj się ponownie** w szczegółach konta przywraca je jednym przebiegiem dla każdej usługi tego konta.*

**W produkcji** usuwa stały termin wygaśnięcia trybu testowego. Nie gwarantuje stałego logowania: Google nadal może wygasić lub cofnąć dostęp. Wymagania dotyczące publikacji i weryfikacji zależą od zastosowania i żądanych uprawnień. [Google: wygasanie tokenów odświeżania](https://developers.google.com/identity/protocols/oauth2#expiration).

### 4. Utwórz dane dostępowe (Client ID i Secret)
1. Otwórz **Dane dostępowe** (Credentials) w lewym menu.
2. Kliknij **Utwórz dane dostępowe** u góry i wybierz **Identyfikator klienta OAuth**.
3. Jako „Typ aplikacji" wybierz **Aplikacja komputerowa** dla Plainva na komputerze. Dla telefonu (Android i iPhone) utwórz zamiast tego klienta typu **iOS** — patrz koniec tej strony.
4. Nazwa: np. „Plainva Desktop Client".
5. Kliknij **Utwórz**.
6. Wyskakujące okienko pokaże Twój **Client ID** i **Client Secret**.

### 5. Wprowadź je w Plainva
1. Otwórz **Ustawienia → Twój vault → Konta w chmurze**.
2. Dla nowego konta wybierz **Połącz konto…** → kafelek **Google** i zaznacz usługi; dla konta, które już masz, otwórz je i wybierz **Zmień** przy **Logowanie na tym urządzeniu**.
3. Wybierz **Własny identyfikator klienta** i wklej skopiowane **Client ID** i **Client Secret** — na telefonie tylko **Client ID** klienta iOS; nie ma on sekretu. Następnie **Zapisz**.
4. Kliknij **Zaloguj się przez Google…** (dla konta, które już masz: **Zaloguj się ponownie**).
5. Otworzy się okno przeglądarki Google. Zaloguj się kontem, które dodałeś w sekcji „Użytkownicy testowi".
6. Google może ostrzec, że aplikacja jest niezweryfikowana. Kliknij **Zaawansowane**, a następnie **Przejdź do Plainva (niebezpieczne)**.
7. Potwierdź żądane uprawnienia — jedna zgoda obejmuje wszystkie zaznaczone usługi.
8. Własny identyfikator klienta dotyczy tylko tego urządzenia; inne urządzenia zachowują swoje ustawienie. Wpisz go na każdym urządzeniu, które ma używać Twojego projektu.

Twój vault synchronizuje się teraz bezpiecznie z Google Drive za pomocą Twoich własnych danych dostępowych.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

Powyższa instrukcja dla komputera wymaga klienta typu komputerowego z identyfikatorem klienta i odpowiadającym mu sekretem. Na telefonie, zarówno na Androidzie, jak i na iOS, Plainva loguje się do Google w przeglądarce: utwórz w swoim projekcie Google klienta OAuth typu **iOS**, także dla Androida, z identyfikatorem pakietu `com.plainva.app`. Plainva wraca przez `com.plainva.app:/oauth2redirect`; sekretu klienta nie ma. Wpisz identyfikator klienta na telefonie w **Logowanie na tym urządzeniu** → **Własny identyfikator klienta**. Nie twórz klienta typu Android: Google dopuszcza nazwę pakietu i odcisk certyfikatu wersji z Play w dokładnie jednym projekcie na świecie i odrzuca każdy kolejny („nazwa pakietu Androida i odcisk cyfrowy są już używane”). Klient Android skonfigurowany dla Plainva 0.8.3 lub 0.8.4 nie działa przy nowym logowaniu; konta już zalogowane działają dalej. Klient komputerowy nie zastępuje rejestracji mobilnej. Dla kalendarzy włącz dodatkowo Google Calendar API i Google Tasks API. Jeśli Google pokazuje na telefonie „Błąd 400: redirect_uri_mismatch”, identyfikator klienta jest typu „Aplikacja komputerowa”: utwórz klienta typu **iOS** zgodnie z opisem tutaj i wpisz zamiast tego jego identyfikator. Pod polem identyfikatora klienta **Otwórz instrukcję dla Google** prowadzi do tej sekcji.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Dodawaj pliki, kalendarz lub pocztę bezpośrednio do konta, które ma je obsługiwać. W przypadku Google i Microsoft to jedna zgoda dla wszystkiego, co konto obsługuje, plus nowa usługa.

Rejestracja Google nie pasuje do ścieżki powrotu tego urządzenia. Sprawdź typ klienta i konfigurację mobilną w instrukcji Google.

<!-- account-grants-destination-2026-09-14 -->
Ogólny błąd logowania nie ujawnia stanu publikacji ani listy użytkowników testowych projektu Google. Sprawdź je w Google Cloud oraz przeczytaj konkretny komunikat dostawcy. Klient komputerowy wymaga ID i odpowiedniego klucza; rejestracja mobilna zależy od platformy i zainstalowanej kompilacji.
