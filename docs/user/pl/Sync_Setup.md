# Konfiguracja synchronizacji

Stan na: 2026-07-30

Plainva opcjonalnie synchronizuje każdy vault z wybranym przez Ciebie magazynem — bezpośrednio z aplikacji, bez żadnej usługi pośredniczącej prowadzonej przez Plainva: Twoje dane przemieszczają się wyłącznie między Twoim komputerem a Twoim własnym kontem/serwerem. Ta strona prowadzi przez konfigurację dla każdego dostawcy.

To, które usługi działają ogólnie (także przez WebDAV lub klienta desktopowego dostawcy), opisuje strona [Zgodność synchronizacji](Sync_Compatibility.md).

## Podstawy

- Konfiguracja znajduje się w **Ustawienia → Twój vault → Konta w chmurze**: **Połącz konto…** otwiera asystenta — najpierw wybierz **dostawcę**, następnie zaznacz **usługi** (dla synchronizacji plików: **Pliki**), a na końcu się zaloguj. Widok kafelków wyświetla dostawców według realnej popularności; dzięki **Szukaj dostawców…** znajdziesz też dostawców poczty dostępnych jako gotowe ustawienie. Dokładnie **jedno** konto na vault obsługuje usługę **Pliki**. Obszar **Synchronizacja** pokazuje wtedy połączone konto wraz z **Folderem w chmurze** i reguluje zachowanie (**interwał synchronizacji**, kolejka); **Zarządzaj kontem** prowadzi z powrotem do kont w chmurze.
- Dla usługi **Pliki** oprócz **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Magazynu obiektowego (S3)** i ogólnego **WebDAV / CalDAV** dostępne są jako osobne kafelki także **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** i **pCloud**: tam wystarczy Twój adres e-mail wraz z **hasłem aplikacji** — adresy serwerów są już wypełnione (oparte na WebDAV; można je zmienić przez **Zaawansowane: ustaw punkty końcowe osobno**).
- **Otwórz istniejący vault online z ekranu powitalnego**: **Otwórz vault** → **Vault online** prowadzi Cię przez te same trzy kroki dla każdego dostawcy — **1. Połącz** (zaloguj się lub wpisz dane dostępowe), **2. Wybierz folder w chmurze** (tam też można od razu utworzyć nowy folder przez **Nowy folder**), **3. Wybierz lub utwórz folder lokalny**. Alternatywnie możesz w każdej chwili skonfigurować synchronizację dla już otwartego vaultu w Ustawieniach.
- **Utwórz nowy vault w chmurze**: **Nowy vault** → **W usłudze online** — najpierw wybierz strukturę początkową (pustą lub szablon, np. PARA), następnie połącz się i wybierz folder docelowy w chmurze lub utwórz go przez **Nowy folder**, na końcu folder lokalny. Struktura powstaje w folderze lokalnym i zostaje automatycznie przesłana podczas pierwszej synchronizacji.
- Lokalne zapisy są wysyłane od razu; Plainva sprawdza zdalne zmiany w skonfigurowanym **interwale synchronizacji (sekundy)**.
- Zmiany offline są kolejkowane i przesyłane przy najbliższym kontakcie; pasek stanu pokazuje **Online**/**Offline**, a wskaźnik synchronizacji stan (**Synchronizuj teraz** po kliknięciu). Podczas długiej lub pierwszej synchronizacji pasek stanu pokazuje postęp w postaci licznika (np. **Sync 123/540**), dzięki czemu widzisz, że przetwarza cały vault.
- Jeśli obie strony zmienią ten sam plik, Plainva scala je automatycznie (scalanie trójstronne). Jeśli nie jest to możliwe, Twoja wersja jest bezpiecznie zachowywana jako plik `.CONFLICT` — nic nigdy nie ginie (patrz [FAQ](FAQ.md)).
- **Rozwiązywanie konfliktów**: baner w dotkniętej notatce (oraz **Rozwiąż konflikt…** w menu kontekstowym pliku `.CONFLICT` w drzewie) otwiera okno porównania — bieżący stan pliku po lewej, Twoja zachowana wersja po prawej, edytowalne z przejmowaniem poszczególnych bloków. **Zapisz prawą wersję i rozwiąż** zapisuje wynik do pliku i usuwa kopię konfliktu; **Zachowaj drugą stronę** odrzuca Twoją kopię (pozostaje migawka wersji). Okno dialogowe błędu synchronizacji również wyświetla listę istniejących kopii konfliktów i jednym kliknięciem przenosi do tego samego porównania.
- **Ochrona przed masowym usuwaniem**: jeśli niezwykle duża część synchronizowanych plików ma zostać usunięta w chmurze naraz (np. dlatego, że lokalny folder vaultu został opróżniony lub przeniesiony), Plainva wstrzymuje usunięcia i najpierw pyta: **Usuń w chmurze** wykonuje je, **Nie usuwaj (przywróć)** odrzuca je i przywraca pliki z chmury przy następnej synchronizacji. Usunięcia potwierdzone samodzielnie w Plainva nie są wstrzymywane — przy dużych usunięciach (ponad 10 plików lub ponad 20% vaultu) Plainva zamiast tego prosi o drugie potwierdzenie przed usunięciem.
- Załączniki (obrazy itp.) są synchronizowane razem z notatkami.
- **Puste foldery** również są synchronizowane: folder utworzony w Plainva pojawia się w chmurze od razu, a puste foldery w chmurze pojawiają się na Twoich innych urządzeniach najpóźniej przy najbliższym pełnym listowaniu.
- Dane dostępowe i tokeny są przechowywane w pęku kluczy systemu operacyjnego (status: **Ustawienia → Aplikacja → Informacje i diagnostyka → Pęk kluczy systemu**), nigdy w plikach wewnątrz vaultu.
- **Rozłącz** zatrzymuje synchronizację vaultu; żadne pliki nie są przy tym nigdzie usuwane.

## WebDAV / Nextcloud

Najprostsza droga dla własnych serwerów i większości magazynów w chmurze:

1. W **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Nextcloud** (lub **WebDAV / CalDAV**).
2. Wpisz **Adres serwera**, **nazwę użytkownika** i **hasło lub token aplikacji** — używaj w miarę możliwości hasła aplikacji zamiast głównego hasła (w Nextcloud: Ustawienia → Bezpieczeństwo → Hasła aplikacji).
3. **Połącz** sprawdza dane dostępowe; następnie przez **Wybierz folder…** wybierz **Folder w chmurze**.

Szczególny przypadek **Nextcloud**: JEDEN formularz obsługuje pliki **i** kalendarz — Plainva samodzielnie wyprowadza punkty końcowe WebDAV i CalDAV z adresu serwera (wyprowadzone adresy są pokazywane w asystencie; **Zaawansowane: ustaw punkty końcowe osobno** pozwala na osobne adresy URL). Jeśli zaznaczysz obie usługi, jeden przebieg połączy obie.

Typowe adresy serwerów (Nextcloud, Koofr, MagentaCLOUD, Storage Box i wiele innych) znajdziesz w [Zgodności synchronizacji](Sync_Compatibility.md).

Jeśli hasło aplikacji zmieni się później, wpisz je **raz** w szczegółach konta w sekcji **Dane logowania**: Plainva sprawdzi je w każdej usłudze tego konta i zapisze dopiero wtedy, gdy wszystkie je zaakceptują — dzięki temu żadna usługa nie zostanie ze starym hasłem.

## Google Drive

Google Drive działa obecnie z własnymi danymi dostępowymi („Bring Your Own”): jednorazowo tworzysz darmowy własny projekt Google Cloud, który należy wyłącznie do Ciebie. Instrukcja krok po kroku: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Skrót: w **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Google**, zaznacz usługę **Pliki**, wpisz **Client ID** i **Client Secret** z Twojego projektu Google, a następnie **Zaloguj się przez Google…** — logowanie otwiera się w przeglądarce. Po połączeniu wybierz **Folder w chmurze** przez **Wybierz folder…** bezpośrednio z Twojego Dysku (łącznie z podfolderami, domyślnie „Plainva”). Uwaga: dopóki Twój projekt Google znajduje się w trybie **testowym**, logowanie wygasa po **7 dniach** — na stałe, ponieważ Google w tym trybie unieważnia też token odświeżający, więc Plainva nie może go odnowić w tle. Sync informuje Cię wtedy, że logowanie wygasło, a **Zaloguj się ponownie** w szczegółach konta przywraca je — jeden przebieg dla **wszystkich** usług tego konta. Jeśli nie chcesz robić tego co tydzień, ustaw projekt Google w konsoli na **W produkcji**: wtedy logowanie pozostaje ważne na stałe (przy niezweryfikowanej aplikacji Google pokazuje przy tym raz ekran ostrzeżenia, który możesz potwierdzić jako jej właściciel).

Jeśli podczas łączenia zaznaczysz **Pliki** i **Kalendarz** razem, Google poprosi o zgodę tylko **raz** — dokładnie o uprawnienia wybranych usług. Dodanie kolejnej usługi później oznacza drugą, uzupełniającą zgodę.

## OneDrive

Plainva dostarcza własną rejestrację aplikacji — **nie musisz już zakładać własnego identyfikatora**:

1. W **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Microsoft** i zaznacz usługę **Pliki** (OneDrive) — na życzenie od razu razem z **Kalendarz i zadania** oraz **E-mail** (jedno konto Microsoft może obsługiwać wszystkie trzy usługi).
2. Kliknij **Zaloguj się przez Microsoft…** i potwierdź logowanie w przeglądarce. Gotowe — Plainva utworzy folder (domyślnie „Plainva”) i zsynchronizuje całą jego zawartość, również pliki dodane z zewnątrz.
3. Opcjonalnie: po połączeniu wybierz **Folder w chmurze** przez **Wybierz folder…** bezpośrednio z Twojego OneDrive (łącznie z podfolderami).

Opcjonalnie: przez **Użyj własnego identyfikatora aplikacji** możesz zamiast tego podać samodzielnie zarejestrowany Client ID (np. przy ograniczeniach firmowych). Szczegółowa instrukcja: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Jeśli połączysz kilka usług jednego konta naraz — na przykład **Pliki** i **Kalendarz** — dostawca poprosi o Twoją zgodę tylko **raz**, a Plainva zapamięta jedno logowanie dla całego konta. Dotyczy to zarówno **Microsoft** (pliki, kalendarz, e-mail), jak i **Google** (pliki i kalendarz; skrzynka Gmail pozostaje poza tym, ponieważ działa przez IMAP z hasłem aplikacji i nie wymaga zgody).

Konta, które wciąż logują się osobno dla każdej usługi, oferują **Jedno logowanie dla wszystkich usług** — na liście kont i w szczegółach konta, zarówno na komputerze, jak i w [aplikacji mobilnej](Mobile_App.md). Jeden przebieg, a potem wszystkie usługi korzystają z tego samego logowania. To więcej niż wygoda: osobne logowania mogły rozjechać się w czasie, więc jedna usługa działała dalej, podczas gdy inna tego samego konta po cichu wygasła. Dla takich kont **Zaloguj się ponownie** odnawia teraz całe konto zamiast pojedynczej usługi.

## Dropbox

Plainva dostarcza własną aplikację Dropbox — **nie potrzebujesz własnej aplikacji**:

1. W **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Dropbox** (obsługuje tylko usługę **Pliki**).
2. Kliknij **Zaloguj się przez Dropbox…** i potwierdź w przeglądarce. Gotowe (domyślny folder `/Plainva`).
3. Opcjonalnie: po połączeniu wybierz **Folder w chmurze** przez **Wybierz folder…** bezpośrednio z Twojego Dropbox (łącznie z podfolderami).

Opcjonalnie: przez **Użyj własnego identyfikatora aplikacji** możesz zamiast tego podać samodzielnie zarejestrowany App Key. Szczegółowa instrukcja: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Magazyn zgodny z S3

Dla AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner i innych — w oparciu o klucze, całkowicie bez logowania w przeglądarce. W **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Magazyn obiektowy (S3)** i wypełnij pola:

| Pole | Znaczenie |
|---|---|
| **Endpoint** | Bazowy adres URL interfejsu S3 API, np. `https://s3.eu-central-1.amazonaws.com`, `https://<konto>.r2.cloudflarestorage.com` lub `http://127.0.0.1:9000` dla lokalnego MinIO |
| **Bucket** | Nazwa bucketa |
| **Region** | Region SigV4; `us-east-1` działa dla większości magazynów spoza AWS, Cloudflare R2 używa `auto` |
| **Access Key ID** / **Secret Access Key** | Para kluczy API od dostawcy |
| **Prefiks kluczy (opcjonalnie)** | Podfolder w buckecie dla vaultu; puste = katalog główny bucketa |
| **Adresy URL w stylu path-style** | Zalecane (MinIO, R2 i większość zgodnych magazynów); wyłącz tylko dla bucketów AWS typu virtual-hosted |

**Prefiks kluczy** (folder w chmurze) możesz wybrać przez **Wybierz folder…** bezpośrednio z bucketa po połączeniu.

Po **Połącz** synchronizacja startuje od razu.

## Zobacz też

- [Zgodność synchronizacji](Sync_Compatibility.md) — które usługi działają i jak, w tym droga przez klienta desktopowego
- [FAQ i rozwiązywanie problemów](FAQ.md) — pliki konfliktów, zachowanie offline

## Szyfrowanie synchronizacji (hasło)

> **Zastąpione w P3:** Poniższe instrukcje nie dotyczą już zawartości. Użyj [Bezpieczeństwo i udostępnianie](Security_and_Sharing.md). Pozostałe tu hasło chroni tylko opcjonalne ustawienia i sekrety.

Plainva może szyfrować to, co opuszcza Twoje urządzenie w kierunku serwera synchronizacji, podczas gdy Twój lokalny vault zawsze pozostaje zwykłym Markdownem, który potrafi odczytać Obsidian.

Otwórz **Ustawienia → Synchronizacja → Hasło synchronizacji i szyfrowanie**:

1. **Ustaw hasło.** Tworzy to klucz szyfrujący dla vaultu i pokazuje jednorazowy **kod odzyskiwania** — przechowuj go bezpiecznie; to jedyny sposób powrotu, jeśli zapomnisz hasła. Od tego momentu synchronizowane **ustawienia** vaultu przesyłane są w postaci zaszyfrowanej.
2. **Zaszyfruj zawartość vaultu** (opcjonalnie). Przycisk **Szyfruj** ponownie przesyła każdą notatkę do serwera synchronizacji jako zaszyfrowaną treść. Twoje lokalne pliki pozostają zwykłym Markdownem, więc lokalny vault nigdy nie jest zagrożony — wypróbuj to najpierw na vaulcie do wyrzucenia. Gdy przesyłanie się zakończy, użyj **Zakończ migrację**, aby od tej pory akceptować tylko zaszyfrowaną treść.
3. **Na innym urządzeniu** otwórz ten sam zsynchronizowany vault. Plainva wykrywa, że vault jest zaszyfrowany, i prosi o hasło (lub kod odzyskiwania). Po odblokowaniu notatki są odszyfrowywane i pojawiają się lokalnie.

Odblokowany klucz jest przechowywany w pamięci podręcznej na każdym urządzeniu. Włącz **Wymagaj hasła przy każdym uruchomieniu**, aby zamiast tego wpisywać je ponownie po każdym restarcie, oraz użyj **Zablokuj**, aby usunąć zapamiętany klucz z tego urządzenia.

**Konta na wszystkich Twoich urządzeniach** to trzy kroki. **1 · Ustawienia i konta**: zapisuje ustawienia sejfu *oraz Twoje konta* (kalendarze, skrzynki pocztowe, wybór kalendarzy) w małym pliku w sejfie — dopóki hasło nie jest ustawione, nie jest potrzebne **żadne**; gdy już istnieje, każde urządzenie musi je wprowadzić, zanim ustawienia zaczną z niego podróżować. **2 · Hasło synchronizacji** (opcjonalnie): potrzebne tylko wtedy, gdy mają wędrować także logowania; dodatkowo szyfruje ustawienia z kroku 1. **3 · Przenoszenie logowań**: dodatkowo przenosi statyczne hasła IMAP i CalDAV, zaszyfrowane, i można je włączyć dopiero, gdy działa krok 1 i hasło jest odblokowane — hasło może trafić tylko do konta, które urządzenie już zna. Nie są przenoszone: ścieżki specyficzne dla urządzenia oraz logowania OAuth (Microsoft, Google); ich tokeny są powiązane z urządzeniem, więc konto pojawia się na nowym urządzeniu i wymaga tam jednorazowego **Zaloguj się**.

Na **telefonie** ten sam łańcuch znajdziesz na stronie sejfu — te same trzy kroki i ta sama blokada. Konta przychodzące z innego urządzenia są tam zakładane; nie wpisujesz ich już ręcznie. Przycisk **Pobierz teraz z innego urządzenia** pobiera je od razu, zamiast czekać na kolejną rundę.

Jeśli Plainva ostrzega, że **starsza wersja nadal publikuje wycofane dane konta**, zaktualizuj Plainva na każdym urządzeniu korzystającym z tego sejfu. Bieżące urządzenie ignoruje stare dane klienta Google i zachowuje działające lokalne logowanie. Nie potwierdzaj usunięcia starych danych zdalnych, dopóki wszystkie uczestniczące urządzenia nie zostaną zaktualizowane.

## Co podróżuje, a co zostaje tutaj

Jeśli w sekcji **Konta w chmurze** pojawi się **Sprawdź zduplikowane konta**, Plainva celowo nie zgaduje na podstawie nazwy. Wybierz **Zachowaj to konto** przy właściwej karcie. Potwierdzenie pokazuje cel, źródła i usługi, a wcześniej tworzy kopię zapasową na tym urządzeniu. **Anuluj** niczego nie zmienia. Połączenie usuwa tylko osierocone lokalne konta, pamięci podręczne i dane logowania — u dostawcy nic nie jest usuwane.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Podróżuje z sejfem | Zostaje na tym urządzeniu |
| --- | --- |
| Konta — kalendarze, skrzynki pocztowe, konta w chmurze, zakładki | Ścieżki bezwzględne — lokalizacja sejfu, cel kopii zapasowych |
| Foldery i szablony — notatki dzienne, folder szablonów, folder skrzynki, folder załączników, baza zadań | Tokeny logowania Microsoft i Google |
| Ustawienia kalendarza — folder spotkań, kalendarz domyślny | Która skrzynka i który folder były ostatnio otwarte |
| Ustawienia poczty — folder zapisu, obrazy zdalne | Początkowy układ tego urządzenia dla nowych sejfów |
| Reguły kopii — odstęp migawek, przechowywanie, archiwa | Hasła statyczne — chyba że krok 3 jest włączony |
| Interwał synchronizacji |  |
| Układ pasków (komputer) |  |

Telefon przenosi tego mniej: nie ma układu pasków ani folderu spotkań. Jego własny łańcuch na stronie sejfu pokazuje, co przenosi, a oba urządzenia mówią pod spodem, co synchronizacja naprawdę zrobiła ostatnio — z nazwami ustawień, które podróżowały, a przy odbiorze tych, które się zmieniły. Komunikat „Ustawienia przejęte z innego urządzenia” pojawia się najwyżej raz na sesję i tylko przy prawdziwej zmianie — później mówią o tym te wiersze. Nowość w tej wersji: telefon przejmuje także format nazwy notatek dziennych, typ OKF nowych notatek i Twoje zakładki. Wcześniej sejf z innym formatem daty dostawał drugą notatkę dzienną dla tego samego dnia, gdy tylko dotknął go telefon.

Diagnostyka rozdziela teraz **ostatnio sprawdzono** (lokalne pola profilu), **ostatnio pobrano**, **ostatnio zastosowano** i **ostatnio faktycznie wysłano**. „Wysłano” zmienia się tylko po udanym zapisie w chmurze; niezmienione przebiegi aktualizują więc sprawdzenie i pobranie, ale nie czas wysłania. Wyniki sekretów są osobno podane jako liczby zaimportowanych, niezmienionych, odrzuconych, nieaktualnych, błędnych lub czekających na konto. Zawierają wyłącznie stabilne kody powodów — bez identyfikatora konta, hasła, tokenu i surowego błędu. Ostrzeżenie o starym kliencie oznacza, że Plainva trzeba zaktualizować na wszystkich uczestniczących urządzeniach; to urządzenie ignoruje wycofane dane klienta Google.

## Błędy i automatyczne ponawianie

Okno błędu zachowuje dokładny nieudany przebieg, nawet gdy automatyczna próba zmieniła już stan na żywo. Pokazuje, czy próba trwa lub się powiodła. Ponowne połączenie jest zalecane tylko przy błędzie uwierzytelniania; błędy sieci, limitu czasu i dostawcy zachowują szczegóły i są automatycznie ponawiane.
