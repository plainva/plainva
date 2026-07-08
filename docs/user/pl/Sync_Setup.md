# Konfiguracja synchronizacji

Stan na: 2026-07-08

Plainva opcjonalnie synchronizuje każdy vault z wybranym przez Ciebie magazynem — bezpośrednio z aplikacji, bez żadnej usługi pośredniczącej prowadzonej przez Plainva: Twoje dane przemieszczają się wyłącznie między Twoim komputerem a Twoim własnym kontem/serwerem. Ta strona prowadzi przez konfigurację dla każdego dostawcy.

To, które usługi działają ogólnie (także przez WebDAV lub klienta desktopowego dostawcy), opisuje strona [Zgodność synchronizacji](Sync_Compatibility.md).

## Podstawy

- Konfiguracja znajduje się w **Ustawienia → Ustawienia vaultu → Synchronizacja z chmurą**. **Dostawca synchronizacji** jest wybierany dla każdego vaultu osobno: **Brak (tylko lokalnie)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** lub **magazyn zgodny z S3** — zawsze dokładnie jeden na vault.
- Lokalne zapisy są wysyłane od razu; Plainva sprawdza zdalne zmiany w skonfigurowanym **interwale synchronizacji (sekundy)**.
- Zmiany offline są kolejkowane i przesyłane przy najbliższym kontakcie; pasek stanu pokazuje **Online**/**Offline**, a wskaźnik synchronizacji stan (**Synchronizuj teraz** po kliknięciu). Podczas długiej lub pierwszej synchronizacji pasek stanu pokazuje postęp w postaci licznika (np. **Sync 123/540**), dzięki czemu widzisz, że przetwarza cały vault.
- Gdy po raz pierwszy połączysz vault online, jednorazowy komunikat przypomina, że pierwsza synchronizacja może potrwać dłużej w zależności od rozmiaru vaultu — możesz w tym czasie normalnie pracować.
- Jeśli obie strony zmienią ten sam plik, Plainva scala je automatycznie (scalanie trójstronne). Jeśli nie jest to możliwe, Twoja wersja jest bezpiecznie zachowywana jako plik `.CONFLICT` — nic nigdy nie ginie (patrz [FAQ](FAQ.md)).
- **Rozwiązywanie konfliktów**: baner w dotkniętej notatce (oraz **Rozwiąż konflikt…** w menu kontekstowym pliku `.CONFLICT` w drzewie) otwiera okno porównania — bieżący stan pliku po lewej, Twoja zachowana wersja po prawej, edytowalne z przejmowaniem poszczególnych bloków. **Zapisz prawą wersję i rozwiąż** zapisuje wynik do pliku i usuwa kopię konfliktu; **Zachowaj drugą stronę** odrzuca Twoją kopię (pozostaje migawka wersji). Okno dialogowe błędu synchronizacji również wyświetla listę istniejących kopii konfliktów i jednym kliknięciem przenosi do tego samego porównania.
- Załączniki (obrazy itp.) są synchronizowane razem z notatkami.
- Dane dostępowe i tokeny są przechowywane w pęku kluczy systemu operacyjnego (status: **Ustawienia → Diagnostyka systemu → Pęk kluczy systemu**), nigdy w plikach wewnątrz vaultu.
- **Rozłącz** zatrzymuje synchronizację vaultu; żadne pliki nie są przy tym nigdzie usuwane.

## WebDAV / Nextcloud

Najprostsza droga dla własnych serwerów i większości magazynów w chmurze:

1. Ustaw **Dostawcę synchronizacji** na **WebDAV / Nextcloud**.
2. Wpisz **adres URL serwera**, **nazwę użytkownika** i **hasło lub token aplikacji** — używaj w miarę możliwości hasła aplikacji zamiast głównego hasła (w Nextcloud: Ustawienia → Bezpieczeństwo → Hasła aplikacji).
3. Wybierz folder docelowy przez **Przeglądaj serwer**, następnie **Zapisz**.

Typowe adresy serwerów (Nextcloud, Koofr, MagentaCLOUD, Storage Box i wiele innych) znajdziesz w [Zgodności synchronizacji](Sync_Compatibility.md).

## Google Drive

Google Drive działa obecnie z własnymi danymi dostępowymi („Bring Your Own”): jednorazowo tworzysz darmowy własny projekt Google Cloud, który należy wyłącznie do Ciebie. Instrukcja krok po kroku: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Skrót: wpisz **Client ID** i **Client Secret** z Twojego projektu Google, ustaw **folder Google Drive (nazwa)** (domyślnie „Plainva”), następnie **Połącz z Google** — logowanie otwiera się w przeglądarce. Po połączeniu możesz wybrać folder przez **Wybierz folder…** bezpośrednio z Twojego Dysku (łącznie z podfolderami), zamiast wpisywać nazwę. Uwaga: w trybie testowym projektu Google logowanie wygasa po 7 dniach i musi zostać odnowione przez **Połącz ponownie**.

## OneDrive

Plainva dostarcza własną rejestrację aplikacji — **nie musisz już zakładać własnego identyfikatora**:

1. Ustaw **Dostawcę synchronizacji** na **OneDrive**; opcjonalnie ustaw **folder OneDrive (nazwa)** (domyślnie „Plainva”).
2. Kliknij **Połącz z Microsoft** i potwierdź logowanie w przeglądarce. Gotowe — Plainva utworzy folder i zsynchronizuje całą jego zawartość, również pliki dodane z zewnątrz.
3. Opcjonalnie: po połączeniu możesz wybrać folder docelowy przez **Wybierz folder…** bezpośrednio z Twojego OneDrive (łącznie z podfolderami), zamiast wpisywać nazwę.

Opcjonalnie: przez **Użyj własnego identyfikatora aplikacji** możesz zamiast tego podać samodzielnie zarejestrowany Client ID (np. przy ograniczeniach firmowych). Szczegółowa instrukcja: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva dostarcza własną aplikację Dropbox — **nie potrzebujesz własnej aplikacji**:

1. Ustaw **Dostawcę synchronizacji** na **Dropbox**; opcjonalnie ustaw **folder Dropbox (ścieżka)** (domyślnie `/Plainva`).
2. Kliknij **Połącz z Dropbox** i potwierdź w przeglądarce. Gotowe.
3. Opcjonalnie: po połączeniu możesz wybrać folder docelowy przez **Wybierz folder…** bezpośrednio z Twojego Dropbox (łącznie z podfolderami), zamiast wpisywać ścieżkę.

Opcjonalnie: przez **Użyj własnego identyfikatora aplikacji** możesz zamiast tego podać samodzielnie zarejestrowany App Key. Szczegółowa instrukcja: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Magazyn zgodny z S3

Dla AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner i innych — w oparciu o klucze, całkowicie bez logowania w przeglądarce:

| Pole | Znaczenie |
|---|---|
| **Endpoint** | Bazowy adres URL interfejsu S3 API, np. `https://s3.eu-central-1.amazonaws.com`, `https://<konto>.r2.cloudflarestorage.com` lub `http://127.0.0.1:9000` dla lokalnego MinIO |
| **Bucket** | Nazwa bucketa |
| **Region** | Region SigV4; `us-east-1` działa dla większości magazynów spoza AWS, Cloudflare R2 używa `auto` |
| **Access Key ID** / **Secret Access Key** | Para kluczy API od dostawcy |
| **Prefiks kluczy (opcjonalnie)** | Podfolder w buckecie dla vaultu; puste = katalog główny bucketa |
| **Adresy URL w stylu path-style** | Zalecane (MinIO, R2 i większość zgodnych magazynów); wyłącz tylko dla bucketów AWS typu virtual-hosted |

Możesz też wybrać **Prefiks kluczy** przez **Wybierz folder…** bezpośrednio z bucketa — to działa już przed zapisaniem, gdy tylko wypełnione są endpoint, bucket i klucze.

Po **Zastosuj** synchronizacja startuje od razu.

## Zobacz też

- [Zgodność synchronizacji](Sync_Compatibility.md) — które usługi działają i jak, w tym droga przez klienta desktopowego
- [FAQ i rozwiązywanie problemów](FAQ.md) — pliki konfliktów, zachowanie offline
