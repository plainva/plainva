# Backup i historia wersji

Stan na: 2026-07-05

Plainva chroni Twoją pracę na dwóch poziomach: **wersje plików** (automatyczne migawki każdego pojedynczego pliku podczas edycji i usuwania) oraz **kopie zapasowe vaultu** (regularne archiwa ZIP całego vaultu, przechowywane poza folderem vaultu). Obie funkcje działają w tle bez żadnej konfiguracji i można je dostosować w ustawieniach, w sekcji **Backup i historia wersji**.

## Wersje plików (migawki)

Przed każdym zapisem Plainva zapisuje migawkę poprzedniego stanu — jako zwykłą kopię tekstową w `.plainva/backups/` wewnątrz vaultu (ten folder jest ukryty w drzewie plików, wyszukiwaniu i synchronizacji). Aby uniknąć setek kopii podczas pisania, obowiązuje **Interwał migawek** (domyślnie: najwyżej jedna nowa wersja co 2 minuty). **Usunięcie zawsze tworzy migawkę**, niezależnie od interwału.

Przechowywanie (konfigurowalne dla każdego vaultu):

- **Interwał migawek**: Przy każdej zmianie / 30 s / 2 min / 5 min / 10 min
- **Wersje na plik**: domyślnie 100 — powyżej tej liczby najstarsze są usuwane
- **Maksymalny wiek**: domyślnie 90 dni — starsze wersje są usuwane **trwale** podczas codziennego czyszczenia („Bez ograniczeń” wyłącza tę funkcję)

Podczas zmiany nazwy lub przenoszenia pliku jego historia wersji przenosi się razem z nim.

## Przeglądanie i przywracanie wersji

Kliknij prawym przyciskiem myszy plik w drzewie plików (lub jego kartę) albo użyj menu **⋮** w prawym górnym rogu edytora → **Historia wersji…** otwiera listę wersji:

- Po lewej stronie znajduje się lista wszystkich migawek pogrupowanych według dnia, z godziną i rozmiarem.
- Po prawej stronie widoczny jest podgląd; dla plików tekstowych **Porównaj z bieżącą wersją** pokazuje wybraną wersję obok bieżącej treści (stara wersja po lewej, bieżący stan po prawej).
- **Przywróć** zastępuje bieżącą treść wybraną wersją. Bez obaw: bieżący stan sam jest najpierw zapisywany jako migawka — więc przywrócenie zawsze można cofnąć.
- **Przywróć jako kopię** tworzy wersję jako nowy plik obok oryginału (`Name (Version 2026-07-05 14-30).md`), nie dotykając go.

Obrazy również mają wersje (z podglądem); pozostałe pliki binarne można przywrócić bez podglądu.

## Przywracanie usuniętych plików

Ponieważ każde usunięcie najpierw tworzy migawkę pliku, Plainva może przywrócić usunięte pliki: kliknij prawym przyciskiem myszy nazwę vaultu na górze drzewa plików → **Przywróć usunięte pliki…** (dostępne też z ustawień). Lista pokazuje wszystkie pliki, których migawki nadal istnieją, mimo że oryginał zniknął — **Przywróć** odtwarza najnowszy stan w pierwotnej lokalizacji (foldery są odtwarzane w razie potrzeby), **Wersje…** otwiera pełną historię usuniętego pliku.

Uwaga: usunięcie **całego folderu** przenosi go do kosza systemu operacyjnego — w tym przypadku kosz systemowy jest głównym sposobem odzyskania; w Plainva mogą znajdować się co najwyżej starsze migawki zawartych w nim plików.

## Automatyczne kopie zapasowe vaultu (ZIP)

Dodatkowo Plainva tworzy kopię zapasową całego vaultu jako plik ZIP — domyślnie **codziennie** w tle (przy otwieraniu vaultu, jeśli ostatnia kopia zapasowa jest starsza niż 24 godziny). Chroni to nawet w przypadku utraty lub uszkodzenia samego folderu vaultu, ponieważ pliki ZIP znajdują się **poza** vaultem:

- Domyślnym miejscem docelowym jest folder danych aplikacji (widoczny w ustawieniach pod **Folder docelowy**; **Otwórz folder** prowadzi tam bezpośrednio).
- Za pomocą **Wybierz folder…** możesz zamiast tego wskazać dysk zewnętrzny lub NAS; **Domyślny** przełącza z powrotem na folder danych aplikacji. Jeśli miejsce docelowe jest obecnie niedostępne (NAS wyłączony), pasek stanu dyskretnie o tym wspomina, a Plainva ponawia próbę później.
- **Liczba przechowywanych kopii zapasowych** (domyślnie: 7) ogranicza ich liczbę; starsze pliki ZIP tego samego vaultu są usuwane automatycznie. Obce pliki w folderze docelowym nigdy nie są dotykane.
- **Utwórz kopię zapasową teraz** uruchamia kopię zapasową ręcznie w dowolnym momencie; pasek stanu pokazuje przebieg i wynik.

Pliki ZIP mają nazwę `VaultName_2026-07-05_14-30-00.zip` i zawierają wszystkie notatki, załączniki oraz konfigurację `.obsidian` — **nie** zawierają wewnętrznego folderu `.plainva` (indeks wyszukiwania jest odbudowywany przy następnym otwarciu; wersje plików celowo nie są częścią pliku ZIP).

**Przywracanie z pliku ZIP:** plik ZIP jest zupełnie zwykłym archiwum. Rozpakuj go w dowolnym miejscu i otwórz rozpakowany folder w Plainva jako vault — gotowe.

## Ustawienia w skrócie

Ustawienia → Twój vault → **Backup i historia wersji**:

| Ustawienie | Domyślnie | Znaczenie |
|---|---|---|
| **Automatyczna kopia zapasowa vaultu (ZIP)** | Włączone | Codzienny plik ZIP w tle |
| **Folder docelowy** | Folder danych aplikacji | Gdzie przechowywane są pliki ZIP, do wyboru |
| **Liczba przechowywanych kopii zapasowych** | 7 | Tyle plików ZIP jest zachowywanych |
| **Interwał migawek** | 2 min | Najwyżej z taką częstotliwością tworzona jest nowa wersja pliku podczas pisania |
| **Wersje na plik** | 100 | Górna granica na plik |
| **Maksymalny wiek** | 90 dni | Starsze wersje są usuwane trwale |

## Warto wiedzieć

- Wersje plików to zwykłe kopie w `.plainva/backups/` — w razie potrzeby można je otworzyć bez Plainva w dowolnym menedżerze plików.
- Własna synchronizacja Plainva nigdy nie przesyła `.plainva`. Jeśli synchronizujesz folder vaultu zewnętrznym klientem (np. aplikacją Nextcloud), migawki są przesyłane razem z nim — kosztuje to trochę miejsca, ale nie szkodzi.
- Konflikty synchronizacji są dodatkowo chronione za pomocą plików `.CONFLICT` (patrz [FAQ](FAQ.md)); historia wersji uzupełnia to o oś czasu każdego pliku.
