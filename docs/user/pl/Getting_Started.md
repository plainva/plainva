# Pierwsze kroki

Stan na: 2026-07-18

Ta strona prowadzi od instalacji do pierwszej realnej pracy: otwarcie lub utworzenie vaultu, poznanie interfejsu i zrozumienie trzech trybów edytora.

## Czym jest vault?

Vault to zwykły folder na komputerze, w którym przechowywane są notatki Markdown. Plainva dodaje w nim ukryty podfolder `.plainva/` na indeks wyszukiwania i ustawienia — same notatki pozostają nietkniętymi plikami `.md`. Można mieć kilka vaultów (np. „Prywatne" i „Praca") i przełączać się między nimi.

## Otwieranie lub tworzenie vaultu

Po uruchomieniu wita ekran powitalny:

- **Otwórz vault** — Plainva najpierw pyta **„Gdzie znajduje się Twój vault?”**: **Folder lokalny** otwiera istniejący folder z plikami Markdown na tym komputerze (vaulty Obsidian działają od razu); **Vault online** synchronizuje istniejący vault z chmury do lokalnego folderu — te same trzy kroki dla każdego dostawcy (**Połącz**, **Wybierz folder w chmurze**, **Wybierz lub utwórz folder lokalny**; patrz [Konfiguracja synchronizacji](Sync_Setup.md)).
- **Nowy vault** — najpierw pojawia się pytanie **„Gdzie ma się znajdować Twój vault?”** (**Na tym komputerze** lub **W usłudze online**), a potem wybierasz strukturę początkową: zacznij od pustego vaultu lub od przygotowanej struktury folderów; oba warianty można zmienić w każdej chwili. **Pusty vault** zawiera tylko przegląd `index.md`. Dostępne szablony: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** i **Journal** — każdy tworzy foldery, notatkę powitalną z krótką instrukcją oraz automatycznie zarządzane przeglądy `index.md` w [formacie OKF](OKF.md) (nazwy folderów i plików są zgodne z językiem aplikacji). Szablon **Journal** dodatkowo od razu konfiguruje ustawienia notatek dziennych vaultu. Szablony **PARA**, **GTD**, **Zettelkasten** i **Journal** zawierają też gotowe, powiązane ze sobą [bazy danych](Databases_Base.md) wraz z pasującymi szablonami notatek — na przykład projekty z tablicą statusu i linkiem do obszaru albo zadania wskazujące na swój projekt. Przy ścieżce online po wyborze struktury następuje połączenie: wybierz dostawcę, połącz się, wybierz folder w chmurze lub utwórz nowy przez **Nowy folder**, wybierz folder lokalny — wybrana struktura powstaje w folderze lokalnym i zostaje przesłana do chmury podczas pierwszej synchronizacji.

**Ostatnie vaulty** pokazują wszystko, co było już wcześniej otwierane. **Usuń z listy** usuwa wpis wyłącznie z Plainva — pliki pozostają na dysku. Włącz opcję **Automatycznie otwieraj ostatni vault przy starcie**, aby w przyszłości pomijać ekran powitalny. Podczas usuwania Plainva pyta, czy dodatkowo zapomnieć wszystkie dane aplikacji vaultu (indeks wyszukiwania, ustawienia, układ okna, dane logowania synchronizacji; automatyczne kopie ZIP tylko przez dodatkowe pole wyboru) — folder vaultu pozostaje w każdym przypadku nietknięty.

## Interfejs

- **Lewy pasek boczny** — cztery widoki: **Pliki** (drzewo plików), **Tagi** (wszystkie `#tagi` w vaulcie), **Zakładki** i **Bazy danych** (każda `.base` w vaulcie, pogrupowana według folderu — kliknij, aby ją otworzyć). Na górze znajduje się duży przycisk **Nowy** (Nowa notatka, obok **Więcej opcji** dla Nowy folder, Nowa baza, Notatka dzienna). Na dole: przełącznik vaultów, **Otwórz notatkę dzienną** i **Ustawienia**. Przycisk z podwójną strzałką obok czterech widoków zwija lub rozwija wszystkie foldery naraz, a **Pokaż w drzewie plików** w menu ⋮ edytora pokazuje otwartą notatkę bezpośrednio w drzewie. W widoku **Pliki** nagłówek pokazuje nazwę i ikonę aktualnego vaultu, a pasek **Ostatnio otwarte** nad drzewem daje dostęp jednym kliknięciem do ostatnio otwieranych notatek.
- **Pasek tytułu** — otwarte karty. Karty można przeciągać, zmieniając ich kolejność, oraz przenosić między panelami edytora.
- **Obszar edytora** — tu czytasz i piszesz. Przez menu karty (**Podziel w prawo** / **Podziel w dół**) lub skróty `Ctrl+Alt+V` / `Ctrl+Alt+S` dzielisz edytor na dwa panele, np. notatkę obok bazy danych.
- **Prawy pasek boczny** — cztery sekcje, których kolejność można zmieniać przez przeciąganie: **Kalendarz** (notatki dzienne), **Konspekt** (nagłówki aktywnej notatki), **Linki zwrotne** (kto tu linkuje) i **Właściwości** (frontmatter notatki).
- **Pasek stanu** — liczba słów/znaków, status synchronizacji (Lokalnie/Online/Offline) i status zapisu (**Zapisywanie...** / **Zapisano**).

## Trzy tryby edytora

Tryb zmieniasz w prawym górnym rogu edytora:

| Tryb | Do czego służy |
|---|---|
| **Tryb czytania** | W pełni wyrenderowany widok do czytania i nawigacji. Linki otwierają się bezpośrednio w Plainva. |
| **Podgląd na żywo** | Domyślny tryb do pisania: Markdown renderuje się w trakcie pisania, znaki formatowania pojawiają się tylko tam, gdzie właśnie pracujesz. |
| **Źródło Markdown** | Surowy tekst bez renderowania — dla pełnej kontroli. |

Tryb, w jakim otwierają się notatki, zależy od Ciebie: wybierz **Widok domyślny** w **Ustawienia → Aplikacja → Edytor i notatki** (czytanie, na żywo lub źródło). Ręczna zmiana trybu w edytorze obowiązuje dla tego pliku w bieżącej sesji.

Dodatkowo można przełączać się między **Szerokością czytelną** a **Pełną szerokością**.

## Podstawy drzewa plików

- **Tworzenie:** kliknij prawym przyciskiem na folder → **Nowa notatka tutaj**, **Nowy folder** lub **Nowa baza danych (.base)**. Duży przycisk **Nowy** tworzy element w aktualnie wybranym folderze (lub w folderze nadrzędnym wybranego pliku).
- **Zaznaczanie:** kliknięcie zaznacza, `Ctrl`+klik dodaje/usuwa pojedynczo, `Shift`+klik zaznacza zakres, kliknięcie środkowym przyciskiem otwiera w nowej karcie.
- **Menu kontekstowe:** m.in. **Zmień nazwę** (aktualizuje linki w całym vaulcie), **Duplikuj**, **Otwórz w podziale (po prawej)** / **Otwórz w podziale (na dole)**, **Dodaj zakładkę**, **Kopiuj ścieżkę**, **Pokaż w menedżerze plików**, **Usuń**.
- **Zaznaczenie wielokrotne:** usuwanie z jednym potwierdzeniem, duplikowanie i przenoszenie przez przeciąganie działają na całym zaznaczeniu. Usunięte elementy trafiają do kosza systemu operacyjnego.
- Nowe notatki automatycznie zaczynają się od `# Nagłówka` wyprowadzonego z nazwy pliku.
- Własna `index.md` folderu (jego przegląd) sortuje się na **początek** tego folderu w drzewie, nad jego podfolderami i plikami — a nie alfabetycznie wśród pozostałych notatek.

## Notatki dzienne

Przycisk **Notatka dzienna** na lewym pasku akcji otwiera lub tworzy dzisiejszą notatkę. Folder bazowy, format daty i opcjonalny szablon konfigurujesz w **Ustawienia → Vault → Treść i struktura** (**Wybierz folder…** obok pola pozwala wybrać folder bezpośrednio z vaulta).

**Kalendarz** po prawej to podgląd dnia: kliknięcie daty otwiera mały podgląd z wydarzeniami i terminami zadań tego dnia oraz akcją **Notatka dzienna**; kliknięcie prawym przyciskiem oferuje to samo w postaci menu. Dni z notatką dzienną są oznaczone małym symbolem wschodzącego słońca, dni z wydarzeniami — kolorowymi kropkami dla każdego kalendarza. Przycisk **Dziś** przywraca bieżący miesiąc; kliknięcie etykiety miesiąca otwiera szybki wybór miesiąca i roku. Tam możesz też włączyć **Pokaż numery tygodni**, aby dodać kolumnę tygodnia ISO — ustawienie jest zapamiętywane.

## Ustawienia

**Ustawienia** (ikona zębatki na dole paska akcji przy lewej krawędzi lub `Ctrl+,`) zamykasz przyciskiem **X** w prawym górnym rogu, klawiszem `Esc` lub kliknięciem poza oknem. Zmiany zapisują się od razu i automatycznie — tylko dane dostępowe synchronizacji stosujesz świadomie przez **Zapisz**/**Połącz** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)). Ustawienia dzielą się na dwie części; każdy obszar na lewym pasku otwiera własną stronę, na której ustawienia znajdują się w nazwanych kartach grup:

- **Aplikacja** — wszystko, co dotyczy całej aplikacji, w pięciu obszarach. **Wygląd**: wybór **motywu** jako kart podglądu — oprócz **Petrol** (domyślny) dostępne są **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (w stylu E-Ink, maksymalnie spokojny), **Sepia** (ciepły papier), **Las**, **Północ** (czerń OLED), **Wysoki kontrast** oraz **Fosfor zielony**/**Fosfor bursztynowy** (retro terminal z delikatnymi scanlines); do tego **Tryb** (**Jasny**/**Ciemny**/**Systemowy**; motywy jednotrybowe, takie jak **Północ**, ustalają tryb na stałe, a przełącznik jasny/ciemny na pasku tytułu jest wtedy nieaktywny), **Język**, **Początek tygodnia**, **Gęstość** i **Powiększenie interfejsu**. **Edytor i notatki**: **Widok domyślny**, **Rozmiar czcionki treści** i **Czcionka treści**. **Uruchamianie i zachowanie**: automatyczne otwieranie ostatniego vaultu, ostrzeżenia o zgodności. **Aktualizacje**: Plainva po cichu sprawdza dostępność nowych wersji przy starcie i pokazuje powiadomienie, gdy je znajdzie — kliknij je, aby od razu pobrać i zainstalować aktualizację (powiadomienie pozostaje widoczne do ponownego uruchomienia Plainva). Można to wyłączyć przez **Sprawdzaj aktualizacje przy starcie**. **Informacje i diagnostyka**: szczegóły wersji, status **pęku kluczy systemu**, **Pomiary wydajności**, **Eksportuj diagnostykę…** (bez treści notatek) i **Zgłoś problem**. Skróty klawiszowe są zawsze dostępne przez `F1` lub **Pokaż skróty klawiszowe** w lewym dolnym rogu.
- **Vault** — wybrany vault znajduje się jako mała karta na pasku (aktywny vault ma kropkę); przy kilku vaultach **Zmień** poniżej otwiera listę wyboru. Poniżej pięć obszarów dla każdego vaultu: **Synchronizacja** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)), **Kalendarz i konta** (kalendarz i konta e-mail, patrz [Kalendarz i zadania](Calendar_and_Tasks.md) i [Przechwytywanie e-maili](Email_Capture.md)), **Treść i struktura** (**Notatki dzienne**, **Szablony i zadania**, w tym **Folder szablonów**, **OKF (Open Knowledge Format)** — patrz [OKF](OKF.md) — i **Rozszerzone bazy danych**), **Backup i historia wersji** oraz **Konserwacja** (**Odbuduj indeks**, przywracanie usuniętych plików, statystyki vaultu).

## Dostosowywanie interfejsu

- **Przełączanie pasków bocznych** za pomocą dwóch przycisków na pasku tytułu lub `Ctrl+Alt+B` (lewy) / `Ctrl+Alt+R` (prawy) — świetne do skupionego pisania. Plainva zapamiętuje ten stan.
- **Paleta poleceń**: `Ctrl+P` otwiera **Polecenia** — wpisz i naciśnij `Enter`, aby uruchomić (nowa notatka, notatka dzienna, podział, paski boczne, **Utwórz kopię zapasową teraz** i wiele więcej).
- **Gęstość**: w **Ustawienia → Aplikacja → Wygląd** wybierz między **Komfortowy** a **Kompaktowy** — Kompaktowy zagęszcza listy, menu i wiersze tabel; treść notatek pozostaje bez zmian.
- **Czcionka treści**: w **Ustawienia → Aplikacja → Edytor i notatki** ustaw **Rozmiar czcionki treści** (12–24 px) oraz krój czcionki (**Domyślna motywu**, **Szeryfowa**, **Bezszeryfowa**, **O stałej szerokości** lub **Niestandardowa…** z nazwą dowolnej zainstalowanej czcionki) — skaluje to tylko edytor i widok czytania; interfejs pozostaje bez zmian.
- **Powiększenie interfejsu**: skaluje CAŁY interfejs między 80 % a 150 % — w **Ustawienia → Aplikacja → Wygląd** lub przez `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` przywraca wartość domyślną).
- **Okna dialogowe i powiadomienia bez natywnych okienek**: potwierdzenia pojawiają się jako okna dialogowe Plainva w stylu Twojego motywu (destrukcyjne akcje mają czerwony przycisk), krótkie komunikaty jako dyskretne powiadomienia w prawym dolnym rogu — koniec z systemowymi wyskakującymi okienkami.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — wszystko o pisaniu
- [Skróty klawiszowe](Keyboard_Shortcuts.md)
- [FAQ i rozwiązywanie problemów](FAQ.md)

## Graf

Przez **Ctrl/Cmd+Shift+G** (lub sekcję **Graf** w prawym pasku bocznym) widzisz swój sejf jako mapę: foldery jako bąbelki, notatki jako węzły, relacje jako oznaczone etykietami krawędzie — łącznie z trybem porządkowania i podróżą w czasie. Szczegóły: [Graf](Graph.md).
