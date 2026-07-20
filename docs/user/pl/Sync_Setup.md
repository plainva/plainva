# Konfiguracja synchronizacji

Stan na: 2026-07-20

Plainva opcjonalnie synchronizuje każdy vault z wybranym przez Ciebie magazynem — bezpośrednio z aplikacji, bez żadnej usługi pośredniczącej prowadzonej przez Plainva: Twoje dane przemieszczają się wyłącznie między Twoim komputerem a Twoim własnym kontem/serwerem. Ta strona prowadzi przez konfigurację dla każdego dostawcy.

To, które usługi działają ogólnie (także przez WebDAV lub klienta desktopowego dostawcy), opisuje strona [Zgodność synchronizacji](Sync_Compatibility.md).

## Podstawy

- Konfiguracja znajduje się w **Ustawienia → Twój vault → Konta w chmurze**: **Połącz konto…** otwiera asystenta — najpierw wybierz **dostawcę** (**Microsoft**, **Google**, **Nextcloud**, **Dropbox**, **Magazyn obiektowy (S3)** lub **WebDAV / CalDAV**), następnie zaznacz **usługi** (dla synchronizacji plików: **Pliki**), a na końcu się zaloguj. Dokładnie **jedno** konto na vault obsługuje usługę **Pliki**. Obszar **Synchronizacja** pokazuje wtedy połączone konto wraz z **Folderem w chmurze** i reguluje zachowanie (**interwał synchronizacji**, kolejka); **Zarządzaj kontem** prowadzi z powrotem do kont w chmurze.
- **Otwórz istniejący vault online z ekranu powitalnego**: **Otwórz vault** → **Vault online** prowadzi Cię przez te same trzy kroki dla każdego dostawcy — **1. Połącz** (zaloguj się lub wpisz dane dostępowe), **2. Wybierz folder w chmurze** (tam też można od razu utworzyć nowy folder przez **Nowy folder**), **3. Wybierz lub utwórz folder lokalny**. Alternatywnie możesz w każdej chwili skonfigurować synchronizację dla już otwartego vaultu w Ustawieniach.
- **Utwórz nowy vault w chmurze**: **Nowy vault** → **W usłudze online** — najpierw wybierz strukturę początkową (pustą lub szablon, np. PARA), następnie połącz się i wybierz folder docelowy w chmurze lub utwórz go przez **Nowy folder**, na końcu folder lokalny. Struktura powstaje w folderze lokalnym i zostaje automatycznie przesłana podczas pierwszej synchronizacji.
- Lokalne zapisy są wysyłane od razu; Plainva sprawdza zdalne zmiany w skonfigurowanym **interwale synchronizacji (sekundy)**.
- Zmiany offline są kolejkowane i przesyłane przy najbliższym kontakcie; pasek stanu pokazuje **Online**/**Offline**, a wskaźnik synchronizacji stan (**Synchronizuj teraz** po kliknięciu). Podczas długiej lub pierwszej synchronizacji pasek stanu pokazuje postęp w postaci licznika (np. **Sync 123/540**), dzięki czemu widzisz, że przetwarza cały vault.
- Gdy po raz pierwszy połączysz vault online, jednorazowy komunikat przypomina, że pierwsza synchronizacja może potrwać dłużej w zależności od rozmiaru vaultu — możesz w tym czasie normalnie pracować.
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
3. **Logowanie** sprawdza dane dostępowe; następnie przez **Wybierz folder…** wybierz **Folder w chmurze**.

Szczególny przypadek **Nextcloud**: JEDEN formularz obsługuje pliki **i** kalendarz — Plainva samodzielnie wyprowadza punkty końcowe WebDAV i CalDAV z adresu serwera (wyprowadzone adresy są pokazywane w asystencie; **Zaawansowane: ustaw punkty końcowe osobno** pozwala na osobne adresy URL). Jeśli zaznaczysz obie usługi, jeden przebieg połączy obie.

Typowe adresy serwerów (Nextcloud, Koofr, MagentaCLOUD, Storage Box i wiele innych) znajdziesz w [Zgodności synchronizacji](Sync_Compatibility.md).

## Google Drive

Google Drive działa obecnie z własnymi danymi dostępowymi („Bring Your Own”): jednorazowo tworzysz darmowy własny projekt Google Cloud, który należy wyłącznie do Ciebie. Instrukcja krok po kroku: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Skrót: w **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Google**, zaznacz usługę **Pliki**, wpisz **Client ID** i **Client Secret** z Twojego projektu Google, a następnie **Zaloguj się przez Google…** — logowanie otwiera się w przeglądarce. Po połączeniu wybierz **Folder w chmurze** przez **Wybierz folder…** bezpośrednio z Twojego Dysku (łącznie z podfolderami, domyślnie „Plainva”). Uwaga: w trybie testowym projektu Google logowanie wygasa po 7 dniach i musi zostać odnowione przez **Zaloguj się ponownie** w szczegółach konta.

## OneDrive

Plainva dostarcza własną rejestrację aplikacji — **nie musisz już zakładać własnego identyfikatora**:

1. W **Konta w chmurze** → **Połącz konto…** wybierz kafelek **Microsoft** i zaznacz usługę **Pliki** (OneDrive) — na życzenie od razu razem z **Kalendarz i zadania** oraz **E-mail** (jedno konto Microsoft może obsługiwać wszystkie trzy usługi).
2. Kliknij **Zaloguj się przez Microsoft…** i potwierdź logowanie w przeglądarce. Gotowe — Plainva utworzy folder (domyślnie „Plainva”) i zsynchronizuje całą jego zawartość, również pliki dodane z zewnątrz.
3. Opcjonalnie: po połączeniu wybierz **Folder w chmurze** przez **Wybierz folder…** bezpośrednio z Twojego OneDrive (łącznie z podfolderami).

Opcjonalnie: przez **Użyj własnego identyfikatora aplikacji** możesz zamiast tego podać samodzielnie zarejestrowany Client ID (np. przy ograniczeniach firmowych). Szczegółowa instrukcja: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

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

Po **Logowanie** synchronizacja startuje od razu.

## Zobacz też

- [Zgodność synchronizacji](Sync_Compatibility.md) — które usługi działają i jak, w tym droga przez klienta desktopowego
- [FAQ i rozwiązywanie problemów](FAQ.md) — pliki konfliktów, zachowanie offline
