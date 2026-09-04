# Pierwsze kroki

Stan na: 2026-09-04

Ta strona prowadzi od instalacji do pierwszej realnej pracy: otwarcie lub utworzenie vaultu, poznanie interfejsu i zrozumienie trzech trybów edytora.

## Wymagania systemowe

Plainva rysuje swoje okno silnikiem internetowym systemu — to silnik, a nie procesor, wyznacza dolną granicę:

- **Windows** 10 lub nowszy ze środowiskiem WebView2 (Windows 11 ma je wbudowane; w 10 dodaje je instalator)
- **macOS 13.3 (Ventura)** lub nowszy, Apple Silicon albo Intel
- **Linux** z WebKitGTK 2.40 lub nowszym (sprawdzisz poleceniem `pkg-config --modversion webkit2gtk-4.1`)

Granicą silnika jest **Safari 16.4**, a na macOS decyduje o niej wersja systemu: aplikacja rysuje swoje okno za pomocą systemowej WebView, która pojawia się wraz z aktualizacjami macOS, a nie z Safari. Na Macu, którego Apple już nie aktualizuje, Safari może więc być dużo nowsze niż silnik, jaki otrzymuje każda inna aplikacja — Monterey zatrzymuje się na Safari 15.6.1, niezależnie od tego, jak aktualne jest samo Safari. Ventura osiągnęła wersję 16.4 przy 13.3 i tam właśnie leży dolna granica; instalacja nowszego Safari jej nie przesuwa.

W systemie poniżej tej granicy Plainva powie to przy starcie, zamiast otworzyć puste okno.

## Czym jest vault?

Vault to zwykły folder na komputerze, w którym przechowywane są notatki Markdown. Plainva dodaje w nim ukryty podfolder `.plainva/` na indeks wyszukiwania i ustawienia — same notatki pozostają nietkniętymi plikami `.md`. Można mieć kilka vaultów (np. „Prywatne" i „Praca") i przełączać się między nimi.

## Otwieranie lub tworzenie vaultu

Przy **zupełnie pierwszym** uruchomieniu — zanim kiedykolwiek otworzysz jakiś vault — Plainva pokazuje jednorazowo krótki komunikat powitalny. W trzech zdaniach wyjaśnia, na czym opiera się Plainva, pokazuje obok niego mały podgląd interfejsu i od razu proponuje trzy sposoby na start: **Otwórz vault**, **Nowy vault** i **Import z innej aplikacji**. Opcja **Później** pomija go i przenosi na zwykły ekran powitalny; nie pojawia się ponownie — chyba że wywołasz go ponownie w **Ustawienia → Uruchamianie i zachowanie → Ekran powitalny**.

Po aktualizacji to samo miejsce pokazuje, co się zmieniło: największa zmiana w danej wersji z własnym nagłówkiem, a reszta jako pojedyncze linijki. Pojawia się to raz na wersję — możesz to ponownie wywołać w dowolnym momencie w **Ustawienia → Uruchamianie i zachowanie → Pokaż ponownie najnowsze funkcje**.

Po uruchomieniu wita ekran powitalny:

- **Otwórz vault** — Plainva najpierw pyta **„Gdzie znajduje się Twój vault?”**: **Folder lokalny** otwiera istniejący folder z plikami Markdown na tym komputerze (vaulty Obsidian działają od razu); **Vault online** synchronizuje istniejący vault z chmury do lokalnego folderu — te same trzy kroki dla każdego dostawcy (**Połącz**, **Wybierz folder w chmurze**, **Wybierz lub utwórz folder lokalny**; patrz [Konfiguracja synchronizacji](Sync_Setup.md)).
- **Nowy vault** — najpierw pojawia się pytanie **„Gdzie ma się znajdować Twój vault?”** (**Na tym komputerze** lub **W usłudze online**), a potem wybierasz strukturę początkową: zacznij od pustego vaultu lub od przygotowanej struktury folderów; oba warianty można zmienić w każdej chwili. **Pusty vault** zawiera tylko przegląd `index.md`. Dostępne szablony: **Wycieczka po Plainva**, **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD**, **Journal** i **Projekt** — każdy tworzy foldery, notatkę powitalną z krótką instrukcją oraz automatycznie zarządzane przeglądy `index.md` w [formacie OKF](OKF.md) (nazwy folderów i plików są zgodne z językiem aplikacji). **Wycieczka po Plainva** to zalecane miejsce na start: wypełnia dziewięć folderów i siedem baz danych przykładami, dzięki czemu raz zobaczysz w akcji każdy widok — Tablicę korkową, Kalendarz, Galerię, Tablicę, Oś czasu, Tabelę oraz widok Drzewo z elementami podrzędnymi — a do tego znajdziesz w niej szablony notatek, reguły folderów i ściągawkę Markdown. Nic w niej nie jest święte: usuń, czego nie potrzebujesz, i zmień nazwę reszty. Szablon **Journal** dodatkowo od razu konfiguruje ustawienia notatek dziennych vaultu. Szablony **Wycieczka po Plainva**, **PARA**, **GTD**, **Zettelkasten**, **Journal** i **Projekt** zawierają też gotowe, powiązane ze sobą [bazy danych](Databases_Base.md) wraz z pasującymi szablonami notatek — na przykład projekty z tablicą statusu i linkiem do obszaru albo zadania wskazujące na swój projekt. Szablon **Projekt** pokazuje narzędzia projektowe w działaniu: cztery powiązane ze sobą bazy danych, kolumnę liczącą otwarte zadania projektu, stopkę sumującą zaplanowany nakład pracy, zależności między zadaniami oraz kamienie milowe, które na osi czasu pojawiają się jako romb. Przy ścieżce online po wyborze struktury następuje połączenie: wybierz dostawcę, połącz się, wybierz folder w chmurze lub utwórz nowy przez **Nowy folder**, wybierz folder lokalny — wybrana struktura powstaje w folderze lokalnym i zostaje przesłana do chmury podczas pierwszej synchronizacji.

**Ostatnie vaulty** pokazują wszystko, co było już wcześniej otwierane. **Usuń z listy** usuwa wpis wyłącznie z Plainva — pliki pozostają na dysku. Włącz opcję **Automatycznie otwieraj ostatni vault przy starcie**, aby w przyszłości pomijać ekran powitalny. Podczas usuwania Plainva pyta, czy dodatkowo zapomnieć wszystkie dane aplikacji vaultu (indeks wyszukiwania, ustawienia, układ okna, dane logowania synchronizacji, kalendarza i skrzynek; automatyczne kopie ZIP tylko przez dodatkowe pole wyboru) — folder vaultu pozostaje w każdym przypadku nietknięty.

## Interfejs

- **Lewy pasek boczny** — trzy widoki: **Pliki** (drzewo plików), **Tagi** (wszystkie `#tagi` w vaulcie) i **Bazy danych** (każda `.base` w vaulcie, pogrupowana według folderu — kliknij, aby ją otworzyć); **Ostatnio otwarte** i **Zakładki** to sekcje nad przełącznikiem widoków, więc pozostają widoczne we wszystkich trzech widokach. Na samej górze znajduje się pole wyszukiwania, a obok niego **+** dla Nowa notatka, Nowy folder, Nowa baza i Notatka dzienna. Tekst zastępczy w polu wyszukiwania pokazuje, czego dotyczy wyszukiwanie, a karty pokazują swoje nazwy, dopóki panel jest wystarczająco szeroki — w miarę zwężania najpierw tylko aktywna karta zachowuje nazwę, a potem zostają same ikony. Na dole: przełącznik vaultów, **Otwórz notatkę dzienną** i **Ustawienia**. Przycisk z podwójną strzałką obok czterech widoków zwija lub rozwija wszystkie foldery naraz, a **Pokaż w drzewie plików** w menu ⋮ edytora pokazuje otwartą notatkę bezpośrednio w drzewie. W widoku **Pliki** nagłówek pokazuje nazwę i ikonę aktualnego vaultu.
- **Sortowanie** — przycisk obok pola wyszukiwania porządkuje drzewo plików według **Tytułu**, **Ostatniej zmiany** lub **Utworzenia**; ponowny wybór tego samego klucza odwraca kierunek. Podfoldery i `index.md` folderu zawsze zostają na początku; wybór jest zapamiętywany na tym urządzeniu.
- **Pasek tytułu** — otwarte karty. Karty można przeciągać, zmieniając ich kolejność, oraz przenosić między panelami edytora.
- **Obszar edytora** — tu czytasz i piszesz. Przez menu karty (**Podziel w prawo** / **Podziel w dół**) lub skróty `Ctrl+Alt+V` / `Ctrl+Alt+S` dzielisz edytor na dwa panele, np. notatkę obok bazy danych.
- **Kolejne okna** — notatka w osobnym oknie pokazuje po prawej ten sam pasek boczny kontekstu (konspekt, graf, bazy danych, backlinki, właściwości; kalendarz zostaje w oknie głównym), zwijany i rozwijany z paska tytułu.
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
- **Przenieś do…** w menu kontekstowym przenosi notatkę, folder lub cały zaznaczony zestaw do wybranego folderu — ta sama droga co przeciąganie, tylko bez przeciągania: otwarte karty, odwołania tablicy i indeks podążają za tym.
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

- **Aplikacja** — wszystko, co dotyczy całej aplikacji, w pięciu obszarach. **Wygląd**: wybór **motywu** jako kart podglądu — oprócz **Petrol** (domyślny) dostępne są **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (w stylu E-Ink, maksymalnie spokojny), **Sepia** (ciepły papier), **Las**, **Północ** (czerń OLED), **Wysoki kontrast** oraz **Fosfor zielony**/**Fosfor bursztynowy** (retro terminal z delikatnymi scanlines); do tego **Tryb** (**Jasny**/**Ciemny**/**Systemowy**; motywy jednotrybowe, takie jak **Północ**, ustalają tryb na stałe, a przełącznik jasny/ciemny na pasku tytułu jest wtedy nieaktywny), **Język**, **Początek tygodnia**, **Gęstość** i **Powiększenie interfejsu**. **Edytor i notatki**: **Widok domyślny**, **Rozmiar czcionki treści** i **Czcionka treści** — lista, w której każdy krój pokazuje się we własnej formie i mówi, czy to urządzenie go ma; czcionki niezainstalowanej nie da się wybrać, a pod spodem zostaje pole tekstowe na wszystko inne. **Uruchamianie i zachowanie**: automatyczne otwieranie ostatniego vaultu, ostrzeżenia o zgodności. **Aktualizacje**: Plainva po cichu sprawdza dostępność nowych wersji przy starcie i pokazuje powiadomienie, gdy je znajdzie — kliknij je, aby od razu pobrać i zainstalować aktualizację (powiadomienie pozostaje widoczne do ponownego uruchomienia Plainva). Można to wyłączyć przez **Sprawdzaj aktualizacje przy starcie**. **Informacje i diagnostyka**: szczegóły wersji, status **pęku kluczy systemu**, **Pomiary wydajności**, **Eksportuj diagnostykę…** (bez treści notatek) i **Zgłoś problem**. Skróty klawiszowe są zawsze dostępne przez `F1` lub **Pokaż skróty klawiszowe** w lewym dolnym rogu.
- **Vault** — wybrany vault znajduje się jako mała karta na pasku (aktywny vault ma kropkę); przy kilku vaultach **Zmień** poniżej otwiera listę wyboru. Poniżej obszary dla każdego vaultu: **Konta w chmurze** to jedno miejsce na wszystkie logowania w chmurze — **Połącz konto…** wybiera dostawcę (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV lub skrzynkę e-mail) oraz usługi (**Pliki**, **Kalendarz i zadania**, **E-mail**), jakie ma obsługiwać to konto. Obszary usług **Synchronizacja** (patrz [Konfiguracja synchronizacji](Sync_Setup.md)), **Kalendarz** (patrz [Kalendarz i zadania](Calendar_and_Tasks.md)) oraz **E-mail** (patrz [Przechwytywanie e-maili](Email_Capture.md)) pojawiają się dopiero, gdy połączone konto obsługuje daną usługę. Zawsze obecne: **Treść i struktura** (**Notatki dzienne**, **Szablony i zadania**, w tym **Folder szablonów** oraz reguły **folder → szablon** i **typ notatki → szablon** (obowiązujące też na telefonie), **Folder skrzynki**, **Folder załączników**, **OKF (Open Knowledge Format)** — patrz [OKF](OKF.md) — i **Rozszerzone bazy danych**), **Backup i historia wersji** oraz **Konserwacja** (**Odbuduj indeks**, przywracanie usuniętych plików, statystyki vaultu).

## Karty

- **Kliknij prawym przyciskiem na kartę**, aby otworzyć jej menu: **Przypnij**, **Odśwież**, **Otwórz w podziale (po prawej)**, **Kopiuj ścieżkę**, **Pokaż w menedżerze plików** oraz grupę zamykania.
- **Przypnij** utrzymuje kartę na miejscu: przesuwa się na początek paska, zamiast krzyżyka zamykania pokazuje pinezkę i przetrwa każde **Zamknij pozostałe** / **Zamknij po lewej** / **Zamknij po prawej** / **Zamknij wszystkie**. Aby ją zamknąć, najpierw **Odepnij**.
- **Odśwież** odrzuca widok i wczytuje plik na nowo z dysku — przydatne, gdy zmienił go inny program. Jeśli karta ma niezapisane zmiany, Plainva odmawia odświeżenia, zamiast nadpisywać Twoją pracę.

## Kilka okien

Plainva nie musi zostawać w jednym oknie. To, czego potrzebujesz akurat teraz, może stanąć obok Twojej pracy:

- **Kliknij prawym przyciskiem kartę → Otwórz w nowym oknie.** Karta opuszcza to okno i żyje dalej w nowym; kopia nie zostaje.
- **Kliknij prawym przyciskiem** na **Graf**, **Zadania**, **Kalendarz** lub **E-mail** na pasku akcji, aby dokonać tego samego wyboru. Kliknij ten sam wpis ponownie, a Plainva przywoła to okno na wierzch, zamiast otwierać widok po raz drugi.
- **Paleta poleceń → Otwórz okno komunikacji** uruchamia okno, które jest już podzielone: poczta po lewej, kalendarz po prawej.
- **Paleta poleceń → Otwórz drugie okno** ponownie otwiera całą powłokę — paski boczne, pasek akcji, karty, pasek stanu. To ten wybór na drugi monitor.
- Podczas **pisania wiadomości** ikona wysunięcia wynosi okno tworzenia wiadomości na zewnątrz — wraz ze wszystkim, co już wpisałeś.

Wysunięte okno to pełnoprawne Plainva: ma **karty**, można je **podzielić** i zapisuje przez ten sam łańcuch co okno główne. Czego celowo nie ma, to paski boczne i pasek akcji — ma pokazywać jedną rzecz.

**Drugie okno** rzeczywiście je ma — i ma **własny vault**. Otwiera vault okna głównego; przełącznik vaultów w lewym dolnym rogu przenosi je na inny, nie ciągnąc za sobą okna głównego. Ustawienia, kreator importu i **tworzenie** vaultu zostają przy oknie głównym — przyciski tam są, a kliknięcie jednego z nich przywołuje okno główne na wierzch i otwiera go **tam**. Wszystko, co dotyczy Twojej pracy, jest takie samo w obu: edycja, zapisywanie, wyszukiwanie i stan synchronizacji na pasku stanu. Szerokość pasków bocznych i to, co zwinąłeś, należą osobno do każdego okna.

**Dana treść jest zawsze otwarta tylko w JEDNYM oknie.** Otwórz notatkę, która jest już gdzieś wyświetlana, a to okno wysunie się na wierzch. To celowe: dwa edytory na tym samym pliku to najpewniejszy sposób na utratę pracy. Pisanie wiadomości jest wyjątkiem — pisanie dwóch wiadomości naraz jest normalne.

**Pinezka** w tytule okna trzyma je na wierzchu, podczas gdy pracujesz w drugim.

Przy następnym uruchomieniu wraca każdy vault, który miał okno, a jego okna dodatkowe wracają tam, gdzie były. Jeśli wolisz inaczej: **Ustawienia → Uruchamianie i zachowanie → Okna**. **Niewysłana wiadomość** nigdy nie jest przywracana — to, co znajduje się w oknie tworzenia wiadomości, żyje w pamięci, a okno twierdzące, że to zachowało, byłoby gorsze niż brak okna.

## Kilka vaultów naraz

Dwa vaulty obok siebie — praca i prywatne, projekt i archiwum — potrzebują dwóch okien: **jedno okno pokazuje dokładnie jeden vault**. Otwórz drugie okno (paleta poleceń → **Otwórz drugie okno**) i przełącz jego vault w lewym dolnym rogu. Od tej chwili oba działają: własne wyszukiwanie, własna synchronizacja, własne przypomnienia.

- **Każdy vault synchronizuje się osobno.** Stan na pasku stanu zawsze należy do vaultu okna, w którym właśnie jesteś.
- **To samo konto w obu vaultach jest w porządku.** Plainva odnawia logowanie raz i przekazuje je drugiemu vaultowi, zamiast pozwalać, by oba się nawzajem unieważniały.
- **Vault wewnątrz innego vaultu zostaje odrzucony.** Jeśli folder znajduje się **wewnątrz** vaultu, który jest już otwarty — albo odwrotnie — Plainva zgłasza to i wyjaśnia dlaczego: oba obserwowałyby i synchronizowały te same pliki.
- **Ten sam vault w dwóch oknach** jest dozwolony; okna go współdzielą, a notatka nadal otwiera się zawsze tylko w jednym z nich.
- **Ostatnie spojrzenie go zamyka.** Gdy żadne okno nie patrzy już na dany vault, Plainva go odkłada — to, co jest właśnie zapisywane, zostaje najpierw dokończone.

## Paski i obszary

Pasek akcji zupełnie po lewej, karty lewego panelu, sekcje nad drzewem plików i sekcje prawego panelu — wszystkie działają tak samo.

Pasek akcji oferuje **Nowa notatka**, **Nowy folder** i **Nowa baza**. Wszystkie trzy tworzą nowy element w **wybranym folderze** drzewa plików; jeśli wybrany jest plik — w folderze tego pliku; jeśli nic nie jest wybrane — na najwyższym poziomie. **Notatka dzienna** nie stosuje się do tej zasady — zawsze trafia do folderu wskazanego dla niej w ustawieniach. Jeśli nie potrzebujesz jednej z tych trzech opcji, ukryj ją.

**Na miejscu:** naciśnij i przytrzymaj przycisk lub nagłówek sekcji i przeciągnij go w nowe miejsce — zwykłe kliknięcie nadal po prostu go uruchamia, a jeśli podczas przytrzymywania przewijasz, po prostu przewijasz (przeciąganie zostaje anulowane). `Esc` anuluje trwające przeciąganie. **Kliknięcie prawym przyciskiem** oferuje te same akcje bez przytrzymywania: **W górę**, **Ukryj** i **Dostosuj paski…**.

**W jednym miejscu:** w **Ustawienia → Vault → Paski i obszary** wszystkie pięć pasków znajduje się jeden pod drugim — również pasek nawigacji telefonu, który dzięki temu ułożysz na dużym ekranie. Każdy to **jedna** lista z linią podziału: wszystko powyżej jest widoczne, wszystko poniżej jest ukryte. Tutaj przenosisz wpisy za pomocą uchwytu przeciągania — na tej stronie porządkuje się listę, a dokładnie do tego służy uchwyt. Gdy przeciągniesz w stronę górnej lub dolnej krawędzi, strona przewija się razem z tym, dzięki czemu wpis może przejść z samego dołu na sam szczyt w jednym ruchu.

Dwóch rzeczy celowo nie można ukryć: **Pomoc** i **Ustawienia** na dole paska akcji oraz karta **Pliki** lewego panelu. Wszystko inne możesz ukryć; ukryte akcje paska pozostają dostępne z **palety poleceń** (`Ctrl+P`). Sekcje prawego panelu, które nie mają nic do pokazania dla otwartej notatki, w ogóle się nie pojawiają.

Układ należy do vaultu i przenosi się na inne urządzenia (patrz [Konfiguracja synchronizacji](Sync_Setup.md)). Vault, który nie został dostosowany, stosuje Twój **układ domyślny** — ustaw go przyciskiem **Zapisz jako domyślne**, a **Przywróć domyślne** przywraca do niego dostosowany vault.

## Dostosowywanie interfejsu

- **Przełączanie pasków bocznych** za pomocą dwóch przycisków na pasku tytułu lub `Ctrl+Alt+B` (lewy) / `Ctrl+Alt+R` (prawy) — świetne do skupionego pisania. Plainva zapamiętuje ten stan.
- **Paleta poleceń**: `Ctrl+P` otwiera **Polecenia** — wpisz i naciśnij `Enter`, aby uruchomić (nowa notatka, notatka dzienna, podział, paski boczne, **Utwórz kopię zapasową teraz** i wiele więcej).
- **Gęstość**: w **Ustawienia → Aplikacja → Wygląd** wybierz między **Komfortowy** a **Kompaktowy** — Kompaktowy zagęszcza listy, menu i wiersze tabel; treść notatek pozostaje bez zmian.
- **Własny motyw**: karta **Mój motyw** w **Ustawienia → Aplikacja → Wygląd** otwiera mały edytor: nastrój (jasny/ciemny), tło z ograniczonego zakresu jasności, dowolny akcent, czcionka interfejsu, zaokrąglenie. Kolory tekstu Plainva wyprowadza sama, więc tekst nigdy nie znika w tle; zbyt blady akcent jest poprawiany do co najmniej 3:1, a edytor o tym informuje. W telefonie te same ustawienia są na ekranie **Wygląd**.
- **Czcionka treści**: w **Ustawienia → Aplikacja → Edytor i notatki** ustaw **Rozmiar czcionki treści** (12–24 px) oraz krój czcionki (**Domyślna motywu**, **Szeryfowa**, **Bezszeryfowa**, **O stałej szerokości** lub **Niestandardowa…** z nazwą dowolnej zainstalowanej czcionki) — skaluje to tylko edytor i widok czytania; interfejs pozostaje bez zmian.
- **Lista czcionek**: pod **Niestandardowa…** znajduje się lista czcionek Twojego systemu, każdy wiersz w swojej czcionce; niezainstalowana czcionka informuje o tym i nie da się jej wybrać. Pole nazwy poniżej przyjmuje każdą inną zainstalowaną czcionkę.
- **Powiększenie interfejsu**: skaluje CAŁY interfejs między 80 % a 150 % — w **Ustawienia → Aplikacja → Wygląd** lub przez `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` przywraca wartość domyślną).
- **Okna dialogowe i powiadomienia bez natywnych okienek**: potwierdzenia pojawiają się jako okna dialogowe Plainva w stylu Twojego motywu (destrukcyjne akcje mają czerwony przycisk), krótkie komunikaty jako dyskretne powiadomienia w prawym dolnym rogu — koniec z systemowymi wyskakującymi okienkami.

## Graf

Przez **Ctrl/Cmd+Shift+G** (lub sekcję **Graf** w prawym pasku bocznym) widzisz swój sejf jako mapę: foldery jako bąbelki, notatki jako węzły, relacje jako oznaczone etykietami krawędzie — łącznie z trybem porządkowania i podróżą w czasie. Szczegóły: [Graf](Graph.md).

## Pamięć prawego panelu

Sekcje, które nie mają nic do pokazania dla otwartej notatki — **Konspekt**, **Linki zwrotne**, **Właściwości**, **Bazy danych** — w ogóle się nie pojawiają, zamiast stać tam wyszarzone. Cały prawy panel pamięta jedną globalną preferencję dla notatek; widoki pełnoekranowe bez kontekstu notatki zamykają go tylko tymczasowo.

**Gdy przeciągniesz panel, zwężając go**, zmienia się on w trzech krokach, dzięki czemu nic się nie psuje:

- **280 px i więcej** — jak zwykle.
- **232–280 px** — właściwości umieszczają nazwę nad wartością zamiast obok niej, długie wartości zawijają się, sekcje stają się bardziej zwarte.
- **poniżej 232 px** — kalendarz pokazuje **jeden tydzień zamiast miesiąca** (siedem dni, numer tygodnia poniżej z prawej); siatka miesiąca miałaby tu komórki o szerokości 14 pikseli i przestałaby być kalendarzem. Graf robi się krótszy, a linki zwrotne pokazują nazwę pliku bez linii ze ścieżką.

Prawy panel nie może zejść poniżej **200 px** — poniżej tej wartości żadna sekcja nie jest użyteczna. Lewy panel wciąż schodzi do 150 px, bo nazwy plików po prostu są ucinane.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — wszystko o pisaniu
- [Skróty klawiszowe](Keyboard_Shortcuts.md)
- [FAQ i rozwiązywanie problemów](FAQ.md)
