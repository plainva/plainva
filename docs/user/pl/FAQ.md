# FAQ i rozwiązywanie problemów

Stan na: 2026-07-11

Odpowiedzi na najczęstsze pytania — od zgodności z Obsidian, przez pliki konfliktów, po kopie zapasowe.

## Podstawy

### Gdzie znajdują się moje dane?

Wyłącznie u Ciebie: vault to zwykły folder z plikami Markdown na Twoim komputerze. Plainva nie prowadzi własnego serwera i nie przechowuje kopii nigdzie indziej. Jeśli synchronizujesz, dane idą bezpośrednio między Twoim komputerem a *Twoim* magazynem (Twoim Nextcloud, Twoim OneDrive, Twoim bucketem…). Dane dostępowe znajdują się w pęku kluczy systemu operacyjnego.

### Czy mogę używać Plainva i Obsidian równolegle?

Tak — to jedna z podstawowych obietnic, z jednym uczciwym zastrzeżeniem. Plainva zapisuje zwykły Markdown ze standardowym frontmatter; wszystko specyficzne dla Plainva jest zgrupowane pod kluczami `plainva:` (w notatkach i plikach `.base`), które Obsidian przy otwieraniu plików po prostu ignoruje. Obsidian pokazuje klucz `plainva` jako nieedytowalny obiekt w swoich właściwościach — to nieszkodliwe. Widoki dostępne tylko w Plainva, jak Tablica lub Kalendarz, pojawiają się w Obsidian jako zwykła tabela.

Zastrzeżenie: **otwieranie jest zawsze bezpieczne, edytowanie nie zawsze.** Istniejący vault Obsidian można bez ryzyka otworzyć i edytować w Plainva — nic nie jest migrowane ani przeformatowywane. Ale gdy vault korzysta z funkcji Plainva (rozszerzeń baz danych, takich jak tablice, relacje czy kolumny odwrotne, oraz zarządzanych plików `index.md`), edytowanie właśnie tych plików w Obsidian może zepsuć funkcjonalność Plainva, ponieważ Obsidian nie zna rozszerzeń `plainva:`. Notatki bez rozszerzeń Plainva można edytować wszędzie i zawsze. Przy pierwszym użyciu takiego rozszerzenia wskazuje na to dialog przypominający (**Rozszerzenie Plainva**); można go wyłączyć w **Ustawienia → Aplikacja → Uruchamianie i zachowanie**.

### Czy Plainva modyfikuje mój istniejący vault?

Nie bez pytania. Istniejące pliki są dotykane tylko wtedy, gdy wyraźnie uruchomisz akcję (np. [konwersję OKF](OKF.md) — z podglądem i kopiami zapasowymi). Tylko nowo utworzone pliki automatycznie otrzymują mały nagłówek frontmatter OKF.

## Pliki i edycja

### Coś usunąłem/usunęłam — czy to zniknęło?

Nie, podwójnie: przed każdym usunięciem Plainva zapisuje plik jako migawkę — kliknięcie prawym przyciskiem myszy na nazwę vaultu → **Przywróć usunięte pliki…** przywraca go w aplikacji. Dodatkowo usunięte pliki i foldery trafiają do kosza systemu operacyjnego (w przypadku całych folderów kosz jest głównym sposobem odzyskania). Szczegóły: [Backup i historia wersji](Backups_and_Versioning.md).

### Czy istnieją starsze wersje moich notatek?

Tak: Plainva automatycznie tworzy wersje plików podczas edycji. Kliknięcie prawym przyciskiem myszy na plik → **Historia wersji…** pokazuje wszystkie migawki wraz z widokiem porównania i opcją **Przywróć**. Dodatkowo Plainva codziennie tworzy kopię zapasową całego vaultu jako plik ZIP poza folderem vaultu. Szczegóły: [Backup i historia wersji](Backups_and_Versioning.md).

### Dlaczego moja index.md jest tylko do odczytu?

Została wygenerowana przez Plainva i jest automatycznie aktualizowana (rozpoznawalne po banerze „Ten plik index.md jest zarządzany przez Plainva…”). **Edytuj mimo to** przekazuje ją na stałe pod Twoją ręczną opiekę — nie będzie już aktualizowana automatycznie. Szczegóły: [OKF](OKF.md).

### Co się dzieje przy zmianie nazwy właściwości w bazie danych?

Nowa nazwa jest zapisywana we frontmatter **każdej pasującej notatki** (po potwierdzeniu, ze wskaźnikiem postępu). Ta sama zasada dotyczy usuwania: checkbox **Usuń również z frontmatter notatek** czyści przy okazji notatki źródłowe. Obie operacje działają więc na Twoich plikach — dokładnie do tego służą.

### Czy mogę cofnąć konwersję OKF?

Przed każdą zmianą kreator tworzy kopię zapasową pliku w `.plainva/backups/okf-conversion-<znacznik-czasu>/`. Końcowy raport podaje dokładny folder; stamtąd możesz skopiować z powrotem pojedyncze pliki. Skorzystaj też z **Podglądu (bez zmian)** przed konwersją.

## Synchronizacja

### Czym jest plik .CONFLICT?

Jeśli ten sam plik został zmieniony jednocześnie tutaj i na innym urządzeniu, Plainva najpierw próbuje automatycznie scalić obie wersje. Jeśli nie jest to możliwe, **Twoja** wersja jest bezpiecznie zapisywana jako plik `.CONFLICT` obok oryginału — nic nigdy nie ginie. Pliki konfliktów są oznaczone w drzewie plików; kliknięciem prawym przyciskiem wybierasz **Zachowaj tę wersję** (wersja konfliktu zastępuje oryginał) lub **Odrzuć konflikt**.

### Moje logowanie do Google ciągle wygasa

Przy konfiguracji „Bring Your Own” Twój projekt Google pozostaje w trybie testowym; Google kończy wtedy sesję po 7 dniach. Plainva odnawia tokeny automatycznie w tle, ale po wygaśnięciu pomaga **Połącz ponownie** w ustawieniach synchronizacji. Szczegóły: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Mój vault znajduje się w folderze OneDrive/Dropbox/iCloud i Plainva zachowuje się dziwnie

Ustaw folder vaultu w kliencie synchronizacji dostawcy na „zawsze przechowuj na tym urządzeniu” / „dostępny offline”. Pliki zastępcze typu online-only (Files On-Demand, „online-only”) zakłócają indeksowanie i synchronizację. Szczegóły: [Zgodność synchronizacji](Sync_Compatibility.md).

### Jestem offline — co dzieje się z moimi zmianami?

Są zapisywane lokalnie jak zwykle i gromadzone w kolejce; gdy tylko połączenie wróci, Plainva przesyła je automatycznie. Pasek stanu pokazuje **Online**/**Offline**.

### Pasek stanu pokazuje Offline, mimo że mam internet

Wtedy sama synchronizacja jest zerwana — często dlatego, że logowanie wygasło lub zmieniły się dane dostępowe (np. w Google Drive). Kliknij **Offline** na pasku stanu lub trójkąt ostrzegawczy obok nazwy vaultu: okno dialogowe pokazuje dokładny komunikat błędu, a **Otwórz ustawienia synchronizacji** prowadzi bezpośrednio do właściwego formularza dostawcy, gdzie ponownie nawiązujesz połączenie (np. **Połącz ponownie**). Każde kliknięcie od razu uruchamia też nową próbę synchronizacji.

## Aplikacja

### Dlaczego F5 nie odświeża i gdzie jest menu kontekstowe przeglądarki?

Plainva to aplikacja desktopowa, a nie strona internetowa. Klawisze odświeżania (F5, Ctrl+R) są celowo wyłączone — odświeżenie odrzuciłoby otwarte karty i niezapisane zmiany. Wbudowane menu kontekstowe WebView jest również ukryte; kliknięcie prawym przyciskiem myszy na zaznaczonym tekście nadal oferuje **Kopiuj**, a drzewo plików, karty i tabele zachowują własne menu kontekstowe.

### Dlaczego nie widzę żadnych animacji?

Plainva respektuje ustawienie systemowe „ogranicz ruch”. Jeśli brakuje przejść i efektów (przyciski, menu i podświetlenia się nie poruszają), animacje są wyłączone w Twoim systemie operacyjnym. W systemie **Windows**: Ustawienia → Ułatwienia dostępu → Efekty wizualne → włącz **Efekty animacji**. W systemie **macOS**: Ustawienia systemowe → Dostępność → Ekran → wyłącz **Ogranicz ruch**.

### Jak zmienić język?

**Ustawienia → Aplikacja → Wygląd → Język** (obecnie niemiecki i angielski).

### „Sprawdź aktualizacje” niczego nie znajduje

Dopóki nie ma jeszcze publicznych wydań, sprawdzanie aktualizacji zgłasza: „Nie ma jeszcze publicznych aktualizacji (wydań).” To nie jest błąd.

### Czy są ukryte funkcje?

Gwiezdna Flota zasadniczo nie komentuje plotek. Ale podobno logo na pasku tytułu reaguje na uporczywe pukanie — a kto zna wtedy odpowiednie słowa, zobaczy potem Plainva w zupełnie nowym świetle. Niektórzy mówią: w czterech.

## Zobacz też

- [Konfiguracja synchronizacji](Sync_Setup.md) i [Zgodność synchronizacji](Sync_Compatibility.md)
- [OKF](OKF.md) — konwersja, index.md, pola systemowe
