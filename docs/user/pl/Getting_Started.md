# Pierwsze kroki

Stan na: 2026-07-10

Ta strona prowadzi od instalacji do pierwszej realnej pracy: otwarcie lub utworzenie vaultu, poznanie interfejsu i zrozumienie trzech trybów edytora.

## Czym jest vault?

Vault to zwykły folder na komputerze, w którym przechowywane są notatki Markdown. Plainva dodaje w nim ukryty podfolder `.plainva/` na indeks wyszukiwania i ustawienia — same notatki pozostają nietkniętymi plikami `.md`. Można mieć kilka vaultów (np. „Prywatne" i „Praca") i przełączać się między nimi.

## Otwieranie lub tworzenie vaultu

Po uruchomieniu wita ekran powitalny:

- **Otwórz lokalny vault** — wybierz istniejący folder z plikami Markdown (vaulty Obsidian działają od razu).
- **Utwórz nowy vault** — zacznij od pustego vaultu lub od przygotowanej struktury folderów; oba warianty można zmienić w każdej chwili. **Pusty vault** zawiera tylko przegląd `index.md`. Dostępne szablony: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** i **Journal** — każdy tworzy foldery, notatkę powitalną z krótką instrukcją oraz automatycznie zarządzane przeglądy `index.md` w [formacie OKF](OKF.md) (nazwy folderów i plików są zgodne z językiem aplikacji). Szablon **Journal** dodatkowo od razu konfiguruje ustawienia notatek dziennych vaultu. Szablony **PARA**, **GTD**, **Zettelkasten** i **Journal** zawierają też gotowe, powiązane ze sobą [bazy danych](Databases_Base.md) wraz z pasującymi szablonami notatek — na przykład projekty z tablicą statusu i linkiem do obszaru albo zadania wskazujące na swój projekt.
- **Otwórz vault online** — wybierz dostawcę chmury: **WebDAV / Nextcloud** łączy się bezpośrednio (wpisz adres URL serwera, nazwę użytkownika i hasło lub token aplikacji, następnie **Przeglądaj serwer**); dla **Google Drive**, **OneDrive**, **Dropbox** i **magazynu zgodnego z S3** najpierw wybierasz lokalny folder synchronizacji — konfiguracja otwiera się następnie automatycznie w ustawieniach (patrz [Konfiguracja synchronizacji](Sync_Setup.md)).

**Ostatnie vaulty** pokazują wszystko, co było już wcześniej otwierane. **Usuń z listy** usuwa wpis wyłącznie z Plainva — pliki pozostają na dysku. Włącz opcję **Automatycznie otwieraj ostatni vault przy starcie**, aby w przyszłości pomijać ekran powitalny. Podczas usuwania Plainva pyta, czy dodatkowo zapomnieć wszystkie dane aplikacji vaultu (indeks wyszukiwania, ustawienia, układ okna, dane logowania synchronizacji; automatyczne kopie ZIP tylko przez dodatkowe pole wyboru) — folder vaultu pozostaje w każdym przypadku nietknięty.

## Interfejs

- **Lewy pasek boczny** — trzy widoki: **Pliki** (drzewo plików), **Tagi** (wszystkie `#tagi` w vaulcie) i **Zakładki**. Na górze znajduje się duży przycisk **Nowy** (Nowa notatka, obok **Więcej opcji** dla Nowy folder, Nowa baza, Notatka dzienna). Na dole: przełącznik vaultów, **Otwórz notatkę dzienną** i **Ustawienia**. Przycisk z podwójną strzałką obok trzech widoków zwija lub rozwija wszystkie foldery naraz, a **Pokaż w drzewie plików** w menu ⋮ edytora pokazuje otwartą notatkę bezpośrednio w drzewie.
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

Tryb, w jakim otwierają się notatki, zależy od Ciebie: wybierz **Widok domyślny** w **Ustawienia → Ogólne** (czytanie, na żywo lub źródło). Ręczna zmiana trybu w edytorze obowiązuje dla tego pliku w bieżącej sesji.

Dodatkowo można przełączać się między **Szerokością czytelną** a **Pełną szerokością**.

## Podstawy drzewa plików

- **Tworzenie:** kliknij prawym przyciskiem na folder → **Nowa notatka tutaj**, **Nowy folder** lub **Nowa baza danych (.base)**. Duży przycisk **Nowy** tworzy element w aktualnie wybranym folderze (lub w folderze nadrzędnym wybranego pliku).
- **Zaznaczanie:** kliknięcie zaznacza, `Ctrl`+klik dodaje/usuwa pojedynczo, `Shift`+klik zaznacza zakres, kliknięcie środkowym przyciskiem otwiera w nowej karcie.
- **Menu kontekstowe:** m.in. **Zmień nazwę** (aktualizuje linki w całym vaulcie), **Duplikuj**, **Otwórz w podziale (po prawej)** / **Otwórz w podziale (na dole)**, **Dodaj zakładkę**, **Kopiuj ścieżkę**, **Pokaż w menedżerze plików**, **Usuń**.
- **Zaznaczenie wielokrotne:** usuwanie z jednym potwierdzeniem, duplikowanie i przenoszenie przez przeciąganie działają na całym zaznaczeniu. Usunięte elementy trafiają do kosza systemu operacyjnego.
- Nowe notatki automatycznie zaczynają się od `# Nagłówka` wyprowadzonego z nazwy pliku.

## Notatki dzienne

**Otwórz notatkę dzienną** (lub kliknięcie daty w **Kalendarzu** po prawej) otwiera lub tworzy dzisiejszą notatkę. Folder bazowy, format daty i opcjonalny szablon konfigurujesz w **Ustawienia → Ustawienia vaultu → Notatki dzienne i szablony**.

W kalendarzu przycisk **Dziś** przywraca bieżący miesiąc; kliknięcie etykiety miesiąca otwiera szybki wybór miesiąca i roku. Tam możesz też włączyć **Pokaż numery tygodni**, aby dodać kolumnę tygodnia ISO — ustawienie jest zapamiętywane.

## Ustawienia

**Ustawienia** (ikona zębatki na dole paska akcji przy lewej krawędzi lub `Ctrl+,`) zamykasz przyciskiem **X** w prawym górnym rogu, klawiszem `Esc` lub kliknięciem poza oknem. Zmiany zapisują się od razu i automatycznie — tylko dane dostępowe synchronizacji stosujesz świadomie przez **Zapisz**/**Połącz** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)). Ustawienia dzielą się na dwie części:

- **Ogólne** — wybór **motywu** jako kart podglądu: oprócz **Petrol** (domyślny) dostępne są **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (w stylu E-Ink, maksymalnie spokojny), **Sepia** (ciepły papier), **Las**, **Północ** (czerń OLED), **Wysoki kontrast** oraz **Fosfor zielony**/**Fosfor bursztynowy** (retro terminal z delikatnymi scanlines). Do tego **Tryb** (**Jasny**/**Ciemny**/**Systemowy**) — motywy jednotrybowe, takie jak **Północ** (tylko ciemny), ustalają tryb na stałe, a przełącznik jasny/ciemny na pasku tytułu jest wtedy nieaktywny. Dalej: **Język**, aktualizacje (Plainva po cichu sprawdza dostępność nowych wersji przy starcie i pokazuje powiadomienie, gdy je znajdzie — można to wyłączyć przez **Sprawdzaj aktualizacje przy starcie**), **Pokaż skróty klawiszowe** (także przez `F1`), **Ostrzeżenia**, **Diagnostyka systemu** (np. status **pęku kluczy systemu**) oraz **Informacje i diagnostyka** (szczegóły wersji, **Eksportuj diagnostykę…** — bez treści notatek — i **Zgłoś problem**).
- **Ustawienia vaultu** — dla każdego vaultu osobno: **Synchronizacja z chmurą** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)), **Notatki dzienne i szablony** (w tym **Folder szablonów**), **OKF (Open Knowledge Format)** (patrz [OKF](OKF.md)) i **Rozszerzone bazy danych**.

## Dostosowywanie interfejsu

- **Przełączanie pasków bocznych** za pomocą dwóch przycisków na pasku tytułu lub `Ctrl+Alt+B` (lewy) / `Ctrl+Alt+R` (prawy) — świetne do skupionego pisania. Plainva zapamiętuje ten stan.
- **Paleta poleceń**: `Ctrl+P` otwiera **Polecenia** — wpisz i naciśnij `Enter`, aby uruchomić (nowa notatka, notatka dzienna, podział, paski boczne, **Utwórz kopię zapasową teraz** i wiele więcej).
- **Gęstość**: w **Ustawienia → Ogólne** wybierz między **Komfortowy** a **Kompaktowy** — Kompaktowy zagęszcza listy, menu i wiersze tabel; treść notatek pozostaje bez zmian.
- **Czcionka treści**: w **Ustawienia → Ogólne** ustaw **Rozmiar czcionki treści** (12–24 px) oraz krój czcionki (**Domyślna motywu**, **Szeryfowa**, **Bezszeryfowa**, **O stałej szerokości** lub **Niestandardowa…** z nazwą dowolnej zainstalowanej czcionki) — skaluje to tylko edytor i widok czytania; interfejs pozostaje bez zmian.
- **Powiększenie interfejsu**: skaluje CAŁY interfejs między 80 % a 150 % — w **Ustawienia → Ogólne** lub przez `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` przywraca wartość domyślną).
- **Okna dialogowe i powiadomienia bez natywnych okienek**: potwierdzenia pojawiają się jako okna dialogowe Plainva w stylu Twojego motywu (destrukcyjne akcje mają czerwony przycisk), krótkie komunikaty jako dyskretne powiadomienia w prawym dolnym rogu — koniec z systemowymi wyskakującymi okienkami.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — wszystko o pisaniu
- [Skróty klawiszowe](Keyboard_Shortcuts.md)
- [FAQ i rozwiązywanie problemów](FAQ.md)

## Graf

Przez **Ctrl/Cmd+Shift+G** (lub sekcję **Graf** w prawym pasku bocznym) widzisz swój sejf jako mapę: foldery jako bąbelki, notatki jako węzły, relacje jako oznaczone etykietami krawędzie — łącznie z trybem porządkowania i podróżą w czasie. Szczegóły: [Graf](Graph.md).
