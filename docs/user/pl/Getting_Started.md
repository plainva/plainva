# Pierwsze kroki

Stan na: 2026-07-29

Ta strona prowadzi od instalacji do pierwszej realnej pracy: otwarcie lub utworzenie vaultu, poznanie interfejsu i zrozumienie trzech trybów edytora.

## Czym jest vault?

Vault to zwykły folder na komputerze, w którym przechowywane są notatki Markdown. Plainva dodaje w nim ukryty podfolder `.plainva/` na indeks wyszukiwania i ustawienia — same notatki pozostają nietkniętymi plikami `.md`. Można mieć kilka vaultów (np. „Prywatne" i „Praca") i przełączać się między nimi.

## Otwieranie lub tworzenie vaultu

Przy **zupełnie pierwszym** uruchomieniu — zanim kiedykolwiek otworzysz jakiś vault — Plainva pokazuje jednorazowo krótki komunikat powitalny. W trzech zdaniach wyjaśnia, na czym opiera się Plainva, pokazuje obok niego mały podgląd interfejsu i od razu proponuje trzy sposoby na start: **Otwórz vault**, **Nowy vault** i **Import z innej aplikacji**. Opcja **Później** pomija go i przenosi na zwykły ekran powitalny; nie pojawia się ponownie — chyba że wywołasz go ponownie w **Ustawienia → Uruchamianie i zachowanie → Ekran powitalny**.

Po aktualizacji to samo miejsce pokazuje, co się zmieniło: największa zmiana w danej wersji z własnym nagłówkiem, a reszta jako pojedyncze linijki. Pojawia się to raz na wersję — możesz to ponownie wywołać w dowolnym momencie w **Ustawienia → Uruchamianie i zachowanie → Pokaż ponownie najnowsze funkcje**.

Po uruchomieniu wita ekran powitalny:

- **Otwórz vault** — Plainva najpierw pyta **„Gdzie znajduje się Twój vault?”**: **Folder lokalny** otwiera istniejący folder z plikami Markdown na tym komputerze (vaulty Obsidian działają od razu); **Vault online** synchronizuje istniejący vault z chmury do lokalnego folderu — te same trzy kroki dla każdego dostawcy (**Połącz**, **Wybierz folder w chmurze**, **Wybierz lub utwórz folder lokalny**; patrz [Konfiguracja synchronizacji](Sync_Setup.md)).
- **Nowy vault** — najpierw pojawia się pytanie **„Gdzie ma się znajdować Twój vault?”** (**Na tym komputerze** lub **W usłudze online**), a potem wybierasz strukturę początkową: zacznij od pustego vaultu lub od przygotowanej struktury folderów; oba warianty można zmienić w każdej chwili. **Pusty vault** zawiera tylko przegląd `index.md`. Dostępne szablony: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** i **Journal** — każdy tworzy foldery, notatkę powitalną z krótką instrukcją oraz automatycznie zarządzane przeglądy `index.md` w [formacie OKF](OKF.md) (nazwy folderów i plików są zgodne z językiem aplikacji). Szablon **Journal** dodatkowo od razu konfiguruje ustawienia notatek dziennych vaultu. Szablony **PARA**, **GTD**, **Zettelkasten** i **Journal** zawierają też gotowe, powiązane ze sobą [bazy danych](Databases_Base.md) wraz z pasującymi szablonami notatek — na przykład projekty z tablicą statusu i linkiem do obszaru albo zadania wskazujące na swój projekt. Przy ścieżce online po wyborze struktury następuje połączenie: wybierz dostawcę, połącz się, wybierz folder w chmurze lub utwórz nowy przez **Nowy folder**, wybierz folder lokalny — wybrana struktura powstaje w folderze lokalnym i zostaje przesłana do chmury podczas pierwszej synchronizacji.

**Ostatnie vaulty** pokazują wszystko, co było już wcześniej otwierane. **Usuń z listy** usuwa wpis wyłącznie z Plainva — pliki pozostają na dysku. Włącz opcję **Automatycznie otwieraj ostatni vault przy starcie**, aby w przyszłości pomijać ekran powitalny. Podczas usuwania Plainva pyta, czy dodatkowo zapomnieć wszystkie dane aplikacji vaultu (indeks wyszukiwania, ustawienia, układ okna, dane logowania synchronizacji; automatyczne kopie ZIP tylko przez dodatkowe pole wyboru) — folder vaultu pozostaje w każdym przypadku nietknięty.

## Interfejs

- **Lewy pasek boczny** — trzy widoki: **Pliki** (drzewo plików), **Tagi** (wszystkie `#tagi` w vaulcie) i **Bazy danych** (każda `.base` w vaulcie, pogrupowana według folderu — kliknij, aby ją otworzyć); Zakładki i Ostatnio otwarte to sekcje nad drzewem. Na samej górze znajduje się pole wyszukiwania, a obok niego **+** dla Nowa notatka, Nowy folder, Nowa baza i Notatka dzienna. Tekst zastępczy w polu wyszukiwania pokazuje, czego dotyczy wyszukiwanie, a karty pokazują swoje nazwy, dopóki panel jest wystarczająco szeroki — w miarę zwężania najpierw tylko aktywna karta zachowuje nazwę, a potem zostają same ikony. Na dole: przełącznik vaultów, **Otwórz notatkę dzienną** i **Ustawienia**. Przycisk z podwójną strzałką obok czterech widoków zwija lub rozwija wszystkie foldery naraz, a **Pokaż w drzewie plików** w menu ⋮ edytora pokazuje otwartą notatkę bezpośrednio w drzewie. W widoku **Pliki** nagłówek pokazuje nazwę i ikonę aktualnego vaultu, a pasek **Ostatnio otwarte** nad drzewem daje dostęp jednym kliknięciem do ostatnio otwieranych notatek.
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
- **Te same czynności w sekcjach nad drzewem:** kliknięcie prawym przyciskiem na wpis w **Ostatnio otwarte** lub **Zakładki** otwiera to samo menu — bez pozycji dla folderów, ale z dodatkową opcją **Usuń z listy** (to usuwa wpis tylko z listy, nigdy plik). Zmiana nazwy odbywa się tam przez okno dialogowe zamiast pola w wierszu. W **Ostatnio otwarte** mogą też znajdować się widoki kalendarza i zadań; można je otwierać i usuwać z listy, ale nie można ich zmieniać nazwy ani usuwać — to widoki, a nie pliki.
- **Zaznaczenie wielokrotne:** usuwanie z jednym potwierdzeniem, duplikowanie i przenoszenie przez przeciąganie działają na całym zaznaczeniu. Usunięte elementy trafiają do kosza systemu operacyjnego.
- Nowe notatki automatycznie zaczynają się od `# Nagłówka` wyprowadzonego z nazwy pliku.
- Własna `index.md` folderu (jego przegląd) sortuje się na **początek** tego folderu w drzewie, nad jego podfolderami i plikami — a nie alfabetycznie wśród pozostałych notatek.
- **Wczytaj ponownie:** okrągła strzałka w nagłówku drzewa (lub **F5**) wczytuje vault ponownie — Plainva uzgadnia indeks z folderem, a w przypadku vaultów online pobiera też pliki z chmury. Krótki raport pokazuje potem, co było nowe, zmienione, usunięte lub pominięte. Dla pojedynczego folderu jest **Wczytaj ten folder ponownie** w menu kontekstowym.

## Notatki dzienne

Przycisk **Notatka dzienna** na lewym pasku akcji otwiera lub tworzy dzisiejszą notatkę. Folder bazowy, format daty i opcjonalny szablon konfigurujesz w **Ustawienia → Vault → Treść i struktura** (**Wybierz folder…** obok pola pozwala wybrać folder bezpośrednio z vaulta).

Format daty używa tych samych znaczników co Obsidian: `YYYY` rok, `MM` miesiąc, `DD` dzień, `dddd` nazwa dnia tygodnia — `YYYY-MM-DD dddd` daje `2026-07-29 Wednesday`. Tekst, który ma pozostać bez zmian, umieszcza się w nawiasach kwadratowych: `[Dziennik] YYYY-MM-DD`. Nazwy miesięcy i dni są zawsze angielskie, dzięki czemu zmiana języka aplikacji nigdy nie sprawi, że istniejące notatki dzienne staną się nie do znalezienia.

**Kalendarz** po prawej to podgląd dnia: **kliknięcie** daty otwiera [kartę kalendarza](Calendar_and_Tasks.md) na ten dzień; **kliknięcie prawym przyciskiem** otwiera menu, które u góry nazywa dany dzień i oferuje **Otwórz kalendarz**, **Notatka dzienna** oraz wydarzenia i zadania z terminem tego dnia. Dni z notatką dzienną są oznaczone małym symbolem **słońca**, dni z wydarzeniami — kolorowymi kropkami dla każdego kalendarza. Przycisk **Dziś** przywraca bieżący miesiąc; kliknięcie etykiety miesiąca otwiera szybki wybór miesiąca i roku. Tam możesz też włączyć **Pokaż numery tygodni**, aby dodać kolumnę tygodnia ISO — ustawienie jest zapamiętywane.

## Ustawienia

**Ustawienia** (ikona zębatki na dole paska akcji przy lewej krawędzi lub `Ctrl+,`) zamykasz przyciskiem **X** w prawym górnym rogu, klawiszem `Esc` lub kliknięciem poza oknem. Zmiany zapisują się od razu i automatycznie — tylko dane dostępowe w chmurze stosujesz świadomie przez **Logowanie** w obszarze **Konta w chmurze** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)). Ustawienia dzielą się na dwie części; każdy obszar na lewym pasku otwiera własną stronę, na której ustawienia znajdują się w nazwanych kartach grup:

- **Aplikacja** — wszystko, co dotyczy całej aplikacji, w pięciu obszarach. **Wygląd**: wybór **motywu** jako kart podglądu — oprócz **Petrol** (domyślny) dostępne są **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (w stylu E-Ink, maksymalnie spokojny), **Sepia** (ciepły papier), **Las**, **Północ** (czerń OLED), **Wysoki kontrast** oraz **Fosfor zielony**/**Fosfor bursztynowy** (retro terminal z delikatnymi scanlines); do tego **Tryb** (**Jasny**/**Ciemny**/**Systemowy**; motywy jednotrybowe, takie jak **Północ**, ustalają tryb na stałe, a przełącznik jasny/ciemny na pasku tytułu jest wtedy nieaktywny), **Język**, **Początek tygodnia**, **Gęstość** i **Powiększenie interfejsu**. **Edytor i notatki**: **Widok domyślny**, **Rozmiar czcionki treści** i **Czcionka treści**. **Uruchamianie i zachowanie**: automatyczne otwieranie ostatniego vaultu, ostrzeżenia o zgodności. **Aktualizacje**: Plainva po cichu sprawdza dostępność nowych wersji przy starcie i pokazuje powiadomienie, gdy je znajdzie — kliknij je, aby od razu pobrać i zainstalować aktualizację (powiadomienie pozostaje widoczne do ponownego uruchomienia Plainva). Można to wyłączyć przez **Sprawdzaj aktualizacje przy starcie**. **Informacje i diagnostyka**: szczegóły wersji, status **pęku kluczy systemu**, **Pomiary wydajności**, **Eksportuj diagnostykę…** (bez treści notatek) i **Zgłoś problem**. Skróty klawiszowe są zawsze dostępne przez `F1` lub **Pokaż skróty klawiszowe** w lewym dolnym rogu.
- **Vault** — wybrany vault znajduje się jako mała karta na pasku (aktywny vault ma kropkę); przy kilku vaultach **Zmień** poniżej otwiera listę wyboru. Poniżej obszary dla każdego vaultu: **Konta w chmurze** to jedno miejsce na wszystkie logowania w chmurze — **Połącz konto…** wybiera dostawcę (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV lub skrzynkę e-mail) oraz usługi (**Pliki**, **Kalendarz i zadania**, **E-mail**), jakie ma obsługiwać to konto. Obszary usług **Synchronizacja** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)), **Kalendarz** (patrz [Kalendarz i zadania](Calendar_and_Tasks.md)) oraz **E-mail** (patrz [Przechwytywanie e-maili](Email_Capture.md)) pojawiają się dopiero, gdy połączone konto obsługuje daną usługę. Zawsze obecne: **Treść i struktura** (**Notatki dzienne**, **Szablony i zadania**, w tym **Folder szablonów**, **Folder skrzynki**, **Folder załączników**, **OKF (Open Knowledge Format)** — patrz [OKF](OKF.md) — i **Rozszerzone bazy danych**), **Backup i historia wersji** oraz **Konserwacja** (**Odbuduj indeks**, przywracanie usuniętych plików, statystyki vaultu).

## Karty

- **Kliknij prawym przyciskiem na kartę**, aby otworzyć jej menu: **Przypnij**, **Odśwież**, **Otwórz w podziale (po prawej)**, **Kopiuj ścieżkę**, **Pokaż w menedżerze plików** oraz grupę zamykania.
- **Przypnij** utrzymuje kartę na miejscu: przesuwa się na początek paska, zamiast krzyżyka zamykania pokazuje pinezkę i przetrwa każde **Zamknij pozostałe** / **Zamknij po lewej** / **Zamknij po prawej** / **Zamknij wszystkie**. Aby ją zamknąć, najpierw **Odepnij**.
- **Odśwież** odrzuca widok i wczytuje plik na nowo z dysku — przydatne, gdy zmienił go inny program. Jeśli karta ma niezapisane zmiany, Plainva odmawia odświeżenia, zamiast nadpisywać Twoją pracę.

## Paski i obszary

Pasek akcji zupełnie po lewej, karty lewego panelu, sekcje nad drzewem plików i sekcje prawego panelu — wszystkie działają tak samo.

Pasek akcji oferuje **Nowa notatka**, **Nowy folder** i **Nowa baza**. Wszystkie trzy tworzą nowy element w **wybranym folderze** drzewa plików; jeśli wybrany jest plik — w folderze tego pliku; jeśli nic nie jest wybrane — na najwyższym poziomie. **Notatka dzienna** nie stosuje się do tej zasady — zawsze trafia do folderu wskazanego dla niej w ustawieniach. Jeśli nie potrzebujesz jednej z tych trzech opcji, ukryj ją.

**Na miejscu:** naciśnij i przytrzymaj przycisk lub nagłówek sekcji i przeciągnij go w nowe miejsce — zwykłe kliknięcie nadal po prostu go uruchamia, a jeśli podczas przytrzymywania przewijasz, po prostu przewijasz (przeciąganie zostaje anulowane). `Esc` anuluje trwające przeciąganie. **Kliknięcie prawym przyciskiem** oferuje te same akcje bez przytrzymywania: **W górę**, **Ukryj** i **Dostosuj paski…**.

**W jednym miejscu:** w **Ustawienia → Vault → Paski i obszary** wszystkie cztery paski znajdują się jeden pod drugim. Każdy to **jedna** lista z linią podziału: wszystko powyżej jest widoczne, wszystko poniżej jest ukryte. Tutaj przenosisz wpisy za pomocą uchwytu przeciągania — na tej stronie porządkuje się listę, a dokładnie do tego służy uchwyt. Gdy przeciągniesz w stronę górnej lub dolnej krawędzi, strona przewija się razem z tym, dzięki czemu wpis może przejść z samego dołu na sam szczyt w jednym ruchu.

Dwóch rzeczy celowo nie można ukryć: **Pomoc** i **Ustawienia** na dole paska akcji oraz karta **Pliki** lewego panelu. Wszystko inne możesz ukryć; ukryte akcje paska pozostają dostępne z **palety poleceń** (`Ctrl+P`). Sekcje prawego panelu, które nie mają nic do pokazania dla otwartej notatki, w ogóle się nie pojawiają.

Układ należy do vaultu i przenosi się na inne urządzenia (patrz [Konfiguracja synchronizacji](Sync_Setup.md)). Vault, który nie został dostosowany, stosuje Twój **układ domyślny** — ustaw go przyciskiem **Zapisz jako domyślne**, a **Przywróć domyślne** przywraca do niego dostosowany vault.

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

## Pamięć prawego panelu

Sekcje, które nie mają nic do pokazania dla otwartej notatki — **Konspekt**, **Linki zwrotne**, **Właściwości**, **Bazy danych** — w ogóle się nie pojawiają, zamiast stać tam wyszarzone. Cały prawy panel pamięta jedną globalną preferencję dla notatek; widoki pełnoekranowe bez kontekstu notatki zamykają go tylko tymczasowo.

**Gdy przeciągniesz panel, zwężając go**, zmienia się on w trzech krokach, dzięki czemu nic się nie psuje:

- **280 px i więcej** — jak zwykle.
- **232–280 px** — właściwości umieszczają nazwę nad wartością zamiast obok niej, długie wartości zawijają się, sekcje stają się bardziej zwarte.
- **poniżej 232 px** — kalendarz pokazuje **jeden tydzień zamiast miesiąca** (siedem dni, numer tygodnia poniżej z prawej); siatka miesiąca miałaby tu komórki o szerokości 14 pikseli i przestałaby być kalendarzem. Graf robi się krótszy, a linki zwrotne pokazują nazwę pliku bez linii ze ścieżką.

Prawy panel nie może zejść poniżej **200 px** — poniżej tej wartości żadna sekcja nie jest użyteczna. Lewy panel wciąż schodzi do 150 px, bo nazwy plików po prostu są ucinane.
