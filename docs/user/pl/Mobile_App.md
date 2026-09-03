# Aplikacja mobilna

Stan na: 2026-09-03

Plainva jest też dostępna jako aplikacja na Androida i iOS. Działa na tych samych plikach Markdown, tym samym formacie **OKF** i tym samym mechanizmie synchronizacji co aplikacja desktopowa — Twój sejf pozostaje identyczny w obu światach.

## Instalacja aplikacji

Aplikacja mobilna działa jako **test otwarty** w Google Play. Na **Androidzie** wchodzisz od razu: otwórz link testu przez [plainva.com/android-beta](https://plainva.com/android-beta), dotknij **Zostań testerem** i zainstaluj aplikację z Google Play — bez zaproszenia i bez dołączania do grupy. Plainva jest też dostępna w Sklepie Play. Na **iPhonie** dystrybucja idzie przez TestFlight; lista oczekujących jest na [plainva.com](https://plainva.com).

**Wymagania systemowe:** na iPhonie i iPadzie Plainva wymaga **iOS 16.4** lub nowszego — silnik rysujący interfejs jest tam częścią systemu, a nowszy Safari tego nie zmienia. Na Androidzie wystarczy Android 7, ale **Android System WebView** musi być aktualny; jeśli jest za stary, Plainva powie o tym przy starcie i wskaże drogę przez Sklep Play.

To wczesna wersja: miej kopię zapasową swojego sejfu i daj znać, co nie działa.

## Układ

- **Dolny pasek:** **od dwóch do czterech** powierzchni roboczych według wyboru oraz stały wpis **Obszary** na końcu — razem od trzech do pięciu miejsc, jakie powinien mieć pasek. **Notatki** pozostają zawsze widoczne: to dzięki nim docierasz do swoich plików.
- **Każdy obszar** (Notatki, Dzisiaj, Zadania, Kalendarz, E-mail, Graf, Otwarte komentarze) jest zawsze o jedno dotknięcie – przez **arkusz obszarów**: **Obszary** na pasku albo **długie przytrzymanie paska**. Arkusz zaznacza bieżący obszar i prowadzi na dole prosto do **Dostosuj pasek nawigacji…**. Tagi, zakładki i ostatnio otwierane elementy nie są już osobnymi obszarami — znajdziesz je teraz pod **Notatkami**.
- **Konfigurowanie paska:** **Ustawienia** → **Pasek nawigacji**. Przyciskami **−**/**+** ustalasz, ile powierzchni roboczych pokazuje pasek (2–4, z podglądem na żywo), a **uchwytem do przeciągania** porządkujesz listę: górne pozycje tworzą pasek (oznaczone ramką), przeciągnięcie pozycji w górę przenosi ją na pasek. Gdy przeciągniesz w stronę górnej lub dolnej krawędzi, lista przewija się razem z tym, dzięki czemu jeden ruch obejmuje całą listę. Nic nie jest ukrywane — to, czego nie ma na pasku, pozostaje dostępne przez **Obszary**. Jeśli obszar, w którym akurat jesteś, opuści pasek, aplikacja przechodzi do pierwszego widocznego. Ten sam pasek możesz też uporządkować **na komputerze** (Ustawienia → Vault → Paski i obszary); przy włączonej synchronizacji ustawień układ przenosi się między Twoimi urządzeniami.
- **Wiersz folderu liczy wszystko, co znajduje się poniżej**, nie tylko notatki leżące bezpośrednio w nim — folder pełen podfolderów nie pokazuje już „0 notatek” obok strzałki prowadzącej do setek.
- **＋** unosi się jako okrągły przycisk nad paskiem i otwiera szybkie tworzenie: notatka, notatka dzienna, folder, baza danych, „Z szablonu…”.
- **Przytrzymanie wiersza pokazuje, co ten wiersz potrafi** — notatka, folder, baza danych i zadanie odpowiadają tak samo, a **Zaznacz kilka** jest pierwszą pozycją tego arkusza. Przesunięcie w lewo wykonuje od razu dwie najczęstsze akcje; arkusz i gest oferują to samo w tej samej kolejności.
- **Nagłówek:** wszędzie taki sam — po lewej Wstecz (na powierzchni roboczej brak), pośrodku tytuł i jedna linia kontekstu, po prawej wyszukiwanie i ⋮. Podczas przewijania odrywa się od treści, a pasek nawigacji zwija się do samych ikon; gdy przewiniesz w górę, otwiera się on ponownie.
- **Przycisk ⋮ zawsze oznacza to samo:** działania na otwartym obiekcie. Ustawienia aplikacji nie kryją się za nim.
- **Ustawienia:** na samym dole **Notatek**, tak samo jak na komputerze. Otwierają najpierw listę obszarów (jak lewa strona ustawień na komputerze) — dotknięcie otwiera daną stronę. Na górze **Aktywny vault** prowadzi do zarządzania vaultami: przełączanie vaultów (znacznik = aktywny), **Utwórz vault** i **Połącz sejf w chmurze**. Lista pokazuje **te same obszary co na komputerze** — w tym **Uruchamianie i zachowanie** (ponowne wyświetlenie powitania i nowości), **Paski i obszary** (pasek nawigacji) oraz **Konserwacja** (Statystyki vaulta, przebudowa indeksu, przywracanie usuniętych plików). Brakuje tylko **Aktualizacje**: aplikacja nie aktualizuje się sama, robią to Google Play i TestFlight. **Konserwacja** zawiera także **import z innych aplikacji** — w telefonie zapisuje zawsze do podfolderu otwartego vaulta, pokazuje wcześniej, co utworzy, można go przerwać w trakcie i na koniec zostawia raport.

## Czytanie i edycja notatek

Notatki otwierają się **wyrenderowane i tylko do odczytu**; ikona pióra w prawym górnym rogu przełącza na edycję (z paskiem narzędzi nad klawiaturą: formatowanie, listy, link wiki, polecenia slash, wstawianie zdjęcia). Osadzenia `![[Notatka]]` pojawiają się jako klikalne karty podglądu.

Foldery można **przeszukiwać** i **sortować** z paska narzędzi nad listą — według **Tytułu**, **Ostatniej zmiany** lub **Utworzenia**; ponowny wybór odwraca kierunek, a sortowanie jest zapamiętywane na urządzeniu. Przy zimnym starcie ponownie otwiera się ostatnio otwarta notatka, a każda notatka otwiera się tam, gdzie ją zostawiono. Listy z podelementami zwija się i rozwija dotknięciem ich punktora.

Przycisk **Szczegóły notatki** w nagłówku (między zakładką a menu ⋮) otwiera arkusz kontekstowy notatki: właściwości (bezpośrednio edytowalne), linki zwrotne, konspekt, graf oraz **historię wersji** — każda edycja automatycznie tworzy migawki, które możesz przeglądać, porównywać i przywracać. Źródło Markdown i wyszukiwanie w notatce znajdziesz w menu ⋮.

Na szerokim ekranie (tablet od 1024 px) ten arkusz może pozostawać otwarty jako **trzecia kolumna** obok notatki, zamiast otwierać się i zamykać za każdym razem. Przełącznik nazywa się **Przypnij panel kontekstu** i znajduje się w **Ustawienia → Wygląd → Układ**; dotyczy tylko tego urządzenia. Gdy jest wyłączony — albo w węższym oknie — ten sam przycisk otwiera arkusz jak dotychczas.

## Szablony

Szablony na telefonie zachowują się dokładnie tak samo jak na komputerze: symbole zastępcze (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) są wypełniane w chwili tworzenia notatki, **wszystkie** pytania szablonu pojawiają się razem w **jednym** arkuszu — anulujesz go i nic nie powstaje — a `{{cursor}}` ustawia kursor, gdy notatka się otwiera.

Reguły **folder → szablon** i **typ notatki → szablon** ustala się na komputerze; podróżują one wraz z synchronizacją ustawień i obowiązują też tutaj — notatka w `Projekte/` zaczyna się więc tak samo na obu urządzeniach, także przy szybkich notatkach z `＋` i przy **+ Wpis** w bazie danych. Dwa szczegóły: `{{weekday:…}}` na telefonie zawsze liczy od poniedziałku (ustawienie początku tygodnia jeszcze tam nie istnieje), a `{{clipboard}}` pyta o zawartość schowka w tym samym arkuszu, zamiast odczytywać ją bez pytania. Pełny wykaz symboli zastępczych zawiera [Notatki i Markdown](Notes_and_Markdown.md).

## Bazy danych (`.base`)

Bazy danych `.base` działają jak na komputerze: każdy widok (tabela, lista, galeria, tablica, kalendarz, oś czasu), edycja komórek zgodna z typem pola, karty na tablicy przenosisz, przytrzymując je. **Konfiguruj** zarządza widokami, kolumnami, filtrami (w tym grupami), sortowaniem i właściwościami.

**Widok kalendarza** ma trzy zakresy: **miesiąc**, **tydzień**, **dzień**. Miesiąc pozostaje punktem wejścia — jako jedyny wciąż pokazuje kształt na ekranie telefonu; tydzień i dzień są listami, bo siedem kolumn treści przestaje być czytelne przy tej szerokości. Wpis obejmujący kilka dni pojawia się jako **pasek**, zamiast powtarzać się każdego dnia, a godziny stoją przed tytułem. **Oś czasu** pokazuje **wiersz na wpis** z paskiem od początku do końca: oba końce można **przeciągnąć palcem**, co zapisuje pole daty w notatce. W **Konfiguruj** wybierasz pole daty i daty końcowej oraz **kolor według** — to samo ustawienie, ten sam plik co na komputerze. Schematy relacji (cele, liczność) nadal są utrzymywane na komputerze.

**Kilka wpisów naraz**: przytrzymaj wiersz i wybierz **Zaznacz kilka** — pierwszą pozycję tego arkusza. Odtąd dotknięcie zaznacza zamiast otwierać, a pasek na dole pokazuje, ile ich jest. Stamtąd możesz **usunąć** zaznaczenie (jedno pytanie, nie dwanaście — z takim samym przeglądem powiązań, jaki daje pojedyncze usuwanie) albo użyć **Ustaw wartość…**, aby ustawić jedną właściwość dla wszystkich naraz: najpierw wybierz właściwość, potem wartość. Tam, gdzie przy właściwości widnieje **obecnie różne**, zaznaczone wpisy mają różne wartości. Pusta wartość usuwa właściwość. Podczas działania widzisz postęp i możesz anulować; to, co już zostało zapisane, pozostaje. Tagi, listy, wielokrotny wybór i relacje celowo nie są uwzględnione — tam „ustaw wszystkim X” oznaczałoby, że każda istniejąca wartość znika.

Widok **Tablica korkowa** pokazuje notatki jako dwukolumnową tablicę karteczek samoprzylepnych: dotknięcie otwiera notatkę, przytrzymanie pokazuje akcje (przypnij, etykiety, kolor, usuń), przeciąganie po przytrzymaniu zmienia kolejność, a pola wyboru odhaczasz bezpośrednio na karcie. Pole wprowadzania na górze tworzy nową notatkę. Wskazówka: skieruj bazę danych na folder skrzynki (**Ustawienia** → **Treść i struktura**), a szybkie notatki z ＋ oraz teksty udostępnione z innych aplikacji trafią prosto na tablicę.

## Zadania

Obszar **Zadania** zbiera każde pole wyboru w Twoim vaulcie — wszystkie linie `- [ ]` i `- [x]` ze wszystkich notatek, pogrupowane według notatki. To przegląd na poziomie linii, którego nie może dać baza danych, ponieważ baza danych pracuje na całych notatkach.

Dotknięcie zadania otwiera notatkę **w tej linii**; pole wyboru odhacza je i zapisuje z powrotem dokładnie ten jeden znak `[ ]`/`[x]`. Terminy (`📅`) i `#tags` pojawiają się jako plakietki, dzięki czemu nie powtarzają się w tekście.

Jeśli Twój vault ma **bazę zadań** (**Ustawienia** → **Treść i struktura**), obszar pokazuje ją nad nim jako osobną sekcję: odznaczanie, zmiana statusu, **+ Nowe zadanie** i **Otwórz jako bazę**. Jeśli baza wskazuje listę zadań u dostawcy (**Konfiguruj** → **Źródło danych** → **Twórz też nowe zadania w** — ustawiane tu tak samo jak na komputerze), arkusz tworzenia niesie też przełącznik **Twórz też w „…”**: włączony, bo wybór listy jest już decyzją, a wyłączony dla tego jednego zadania, które ma zostać w vaulcie. Przeniesione pole wyboru i wiadomość przechwycona jako zadanie idą tą samą drogą. Każdy wiersz zadania ma wtedy też **Do bazy** w swoim wierszu meta — linia zostaje jako link wiki, a zadanie żyje dalej jako osobna notatka.

**Listy zadań**, które wybrałeś dla swoich kont, telefon sam odzwierciedla w tej bazie — importuje nowe zadania, rozpoznaje istniejącą notatkę po jej kotwicy (zamiast tworzyć drugą) i wysyła Twoje zmiany do dostawcy. Usuń notatkę zadania świadomie, a zadanie zostanie usunięte także u dostawcy — z ośmioma sekundami na **Cofnij**; wyślij aplikację w tym czasie w tło, a zadanie zostanie. Sam brak pliku natomiast nigdy niczego nie usuwa. Szczegółowe zasady znajdziesz w [Kalendarz i zadania](Calendar_and_Tasks.md). Kiedy się to dzieje, opisuje [Kalendarz i wydarzenia](#kalendarz-i-wydarzenia): telefon nie utrzymuje synchronizacji w tle, więc Plainva nadrabia ją po powrocie do aplikacji i przy otwarciu tego obszaru.

Nad listą znajdziesz te same filtry co na komputerze: **Folder**, **Tag**, **Z terminem** i **Pokaż ukryte**. Ukrywanie jest właściwością **notatki**, a nie pojedynczego zadania — ikona oka na nagłówku notatki zapisuje `plainva.tasks: false` we frontmatterze tej notatki i usuwa ją z przeglądu; **Ukryj szablony** robi to samo jednocześnie dla całego folderu szablonów. Plik zachowuje swoje zadania, po prostu przestają się liczyć. Długie przytrzymanie **Do bazy** wybiera **docelową bazę danych**, gdy Twój vault ma więcej niż jedną.

Wiersz zadania pokazuje tytuł na całą szerokość; status, termin, powtarzanie i tagi znajdują się poniżej, a dokładnie jedna akcja znajduje się po prawej. **Zablokuj czas** (ikona kalendarza po prawej) tworzy wydarzenie w kalendarzu dla zadania, gdy podłączony jest kalendarz (data, początek, czas trwania, a przy kilku zapisywalnych kalendarzach także ich wybór); **Powtarzanie** w wierszu meta tworzy kolejne zadanie z nowym terminem, gdy je odhaczysz. Oba opisano w [Zadaniach](Tasks.md).

## Dzisiaj

**Dzisiaj** to powierzchnia dnia. Pasek na górze wybiera dzień — biegnie **w obu kierunkach**, dwa tygodnie wstecz i dwa tygodnie do przodu, a kropka oznacza każdy dzień, który ma już notatkę dzienną. Poniżej znajduje się **notatka dzienna** wybranego dnia (z jej szablonem i folderem, do otwarcia lub utworzenia), następnie **terminy i zadania** tego dnia, a na końcu to, co edytowałeś tego dnia.

Środkowa sekcja łączy to, co inaczej znajdowałoby się w dwóch obszarach: najpierw wydarzenia całodniowe, potem te z konkretną godziną w porządku chronologicznym, a na końcu zadania z terminem tego dnia. Dotknięcie zadania otwiera jego notatkę. Bez podłączonego kalendarza i bez bazy zadań ta sekcja po prostu nie istnieje.

## Tagi

Lista tagów znajduje się pod **Notatkami**. Dotknięcie otwiera notatki danego tagu; strzałka rozwija zagnieżdżone tagi. **Długie przytrzymanie** tagu oferuje **Zmień nazwę tagu** — w całym vaulcie, tak jak na komputerze: Plainva przepisuje każdą notatkę, która go zawiera (we frontmatterze i jako `#tag` w tekście, wraz z jego dziećmi `tag/child`), a potem informuje, w ilu notatkach nazwa została zmieniona. Notatka, której nie da się odczytać ani zapisać, zostaje pominięta — pozostałe i tak zostają przemianowane.

## Znajdź i zamień w całym vault

Droga do niego to lupa w nagłówku, następnie `>` i **Znajdź i zamień w całym vault**. Ekran przeszukuje wszystkie notatki naraz. Wpisz szukany tekst, dotknij **Znajdź** — trafienia pojawią się zgrupowane według notatek wraz z ich liczbą; dotknięcie otwiera wiersze jednej notatki i naraz otwarta pozostaje tylko jedna. Odznacz notatki, które chcesz pominąć — per notatka, nigdy per wiersz, bo notatkę zamienia się w całości albo wcale. **Zamień w N notatkach** przepisuje resztę, z paskiem postępu i przyciskiem **Anuluj**, który zatrzymuje pracę przy kolejnej notatce. Każda notatka jest odczytywana ponownie tuż przed zapisem, więc nieaktualny podgląd nigdy nie nadpisze nowszej treści; notatka zmieniona w międzyczasie zostaje pominięta i mówimy Ci o tym. Wielkość liter, całe słowo i wyrażenia regularne działają również tutaj.

Każde trafienie pokazuje dwa wiersze — **przed** z miejscem trafienia, **po** z wynikiem, z rozwiniętymi odwołaniami `$1` przy wyrażeniu regularnym — abyś mógł sprawdzić zmianę, zanim cokolwiek zostanie zapisane.
## Przeglądy (index.md)

W sejfie OKF `index.md` to spis treści folderu. Telefon oferuje dwa wejścia, pomyślane na dwie różne sytuacje.

**Na moment, w którym rzuca się to w oczy:** przytrzymaj folder na liście — arkusz proponuje **Utwórz przegląd**, gdy żadnego nie ma, i **Odśwież przegląd**, gdy Plainva prowadzi istniejący. Wiersz nazywa więc swój skutek, zamiast kazać ci wybierać. Jeśli `index.md` tego folderu napisałeś sam, wiersz w ogóle się nie pojawia: twój plik należy do ciebie.

**Na porządki:** **Ustawienia → Vault → Konserwacja → Przeglądy** wymienia każdy folder z liczbą notatek i stanem — posortowany według tego, *gdzie czegoś brakuje*, a nie alfabetycznie, żeby te kilka folderów wymagających uwagi nie zginęło wśród gotowych. Na górze **Utwórz index.md w N folderach bez niego** tworzy brakujące za jednym razem. Jeśli w folderze bez `index.md` leży już notatka przeglądowa (MOC, przegląd, README…), możesz ją tutaj **przejąć** — to zmienia nazwę pliku i przenosi odnośniki w całym sejfie, dlatego pyta wcześniej.

**Zawsze aktualne.** Przeglądy utworzone przez Plainvę noszą niewidoczne oznaczenie. Tylko takie pliki są utrzymywane — i od teraz utrzymuje je także telefon: gdy tworzysz, przenosisz lub usuwasz tam notatki, Plainva chwilę później zapisuje na nowo objęte tym przeglądy. Wcześniej robił to tylko komputer, więc sejf pielęgnowany na telefonie po cichu się starzał.

**Tylko do odczytu, z wyjściem.** Prowadzony przegląd otwiera się w trybie odczytu z paskiem nad nim: **Odśwież** zapisuje go na nowo, **Edytuj mimo to** usuwa oznaczenie — od tej chwili plik należy w całości do ciebie i nie jest już automatycznie nadpisywany. Bez tej ochrony następny przebieg po cichu zapisałby wszystko, co tam wpisałeś.


## Konwersja do formatu OKF

Przeniesienie całego vaulta do [formatu OKF](OKF.md) działa teraz także z telefonu: **Ustawienia → Vault → Konserwacja → Konwertuj do formatu OKF**. Kreator skanuje, pozwala wybrać domyślny `type`, **wymienia z nazwy notatki, których to dotyczy**, i dopiero wtedy zapisuje — każdy plik trafia przed zmianą do folderu kopii zapasowej.

Ponieważ telefon może w każdej chwili zakończyć działającą aplikację, tutaj przebieg zatrzymuje się dodatkowo przy następnym pliku, gdy dotkniesz **Wstrzymaj** albo aplikacja przejdzie w tło. To, że Plainva przy następnym otwarciu vaulta pyta, czy przerwany przebieg **kontynuować**, czy **wycofać**, dotyczy obu urządzeń; **Później** to poprawna odpowiedź, pytanie wróci i nie przepada.

Przerwany przebieg zostawia vault przekonwertowany częściowo, a nie uszkodzony: dodawane są wyłącznie pola frontmattera, każda notatka pozostaje poprawnym Markdownem i każdy inny edytor nadal ją odczyta.

### OKF 0.2 na telefonie

Pola [OKF 0.2](OKF.md) — pochodzenie, sprawdzenie, status, nieaktualność — są na telefonie odczytywane i pokazywane dokładnie tak samo jak na komputerze: odznaka **Szkic**/**Wycofana** w nagłówku notatki, komunikat **Oznaczona jako nieaktualna (od …)** nad notatką oraz sekcja **Zaufanie i pochodzenie** w karcie kontekstowej notatki wraz z poziomem zaufania. Tam też znajduje się **Oznacz jako sprawdzoną**: dopisuje `human:<Twoje imię>` do listy sprawdzeń; Plainva pyta o imię raz na vault, zostawia je na urządzeniu i pozwala je zmienić pod **Ustawienia → Vault → Treść i struktura → Nazwa sprawdzającego**. Wersja pakietu vaultu jest podnoszona do 0.2 pod **Ustawienia → Vault → Konserwacja → Wersja pakietu** — z podglądem, kopią zapasową i polem wyboru, które usuwa z notatek przestarzałe pole `okf_version`.

## Graf

**Mapa sejfu** pokazuje Twój sejf jako węzły i krawędzie. Dotknięcie bąbelka folderu rozwija go, dotknięcie notatki ją otwiera; plakietki powyżej filtrują według typu notatki, tagu i rodzaju krawędzi. Przeciągnij węzeł, a **mapa zapamięta jego położenie** — zapamiętany układ znajduje się w `.plainva/graph.json` i celowo pozostaje na tym urządzeniu, tak jak indeks wyszukiwania.

**Długie przytrzymanie** węzła otwiera jego menu: otwórz (albo rozwiń/zwiń w przypadku folderu), **Skup na zaznaczeniu** oraz, jeśli węzeł jest przypięty, **Odepnij**. Długie przytrzymanie **krawędzi** wymienia oba jej końce i otwiera jedną lub drugą notatkę. Przeciągnij jedną notatkę **na drugą**, a Plainva zaproponuje, by je **połączyć** — jako link tekstowy na końcu notatki albo przez relację odpowiedniej bazy danych; relacja dopuszczająca dokładnie jeden wpis pyta wcześniej, ponieważ zastępuje bieżącą wartość. Plakietka **Zaznacz** zamienia przeciągnięcie po pustym miejscu w prostokąt zaznaczenia (telefon nie ma klawisza modyfikującego); zaznaczone notatki można usunąć razem, przez to samo potwierdzenie co pojedynczą. **Eksportuj jako SVG…** przekazuje mapę do arkusza udostępniania Twojego urządzenia.

To samo porządkowanie w mniejszej skali wykonuje **graf w arkuszu kontekstowym notatki**: pokazuje sąsiedztwo otwartej notatki, a poniżej sugestie, co jeszcze mogłoby do niej należeć. **Połącz** umieszcza link w miejscu wystąpienia w tekście — nie na końcu notatki — a odrzucona sugestia pozostaje odrzucona, nawet po zamknięciu notatki.

Chip **Porządki** otwiera listę porządkowania: **sieroty** (notatki, na które nic nie wskazuje), **uszkodzone linki** (odwołania donikąd) i **wzmianki** — miejsca, w których notatka jest wymieniona, ale nie połączona. Sierotę usuwasz przez to samo potwierdzenie co wszędzie indziej, dla uszkodzonego linku tworzysz brakującą notatkę, a wzmiankę łączysz dokładnie **w miejscu wystąpienia**, a nie na końcu notatki. To, co odrzucisz, pozostaje odrzucone: nie pojawia się ponownie przy kolejnym przebiegu. Skanowanie wzmianek odczytuje każdą notatkę, dlatego uruchamia się dopiero na Twoje polecenie — można je przerwać w każdej chwili.

**Fokus** można też ustawić z menu węzła: mapa pokazuje wtedy tylko jego sąsiedztwo do głębokości, którą wybierzesz (1–3). Plakietka z głębokością znów usuwa fokus. Kolejne dwie plakietki pokazują mapę według wieku: **Mapa ciepła** zabarwia każdy węzeł według tego, jak niedawno się zmienił, a **Podróż w czasie** ukrywa wszystko, co jest nowsze niż suwak — dzięki temu możesz obserwować, jak Twój sejf rośnie.

## Kalendarz i wydarzenia

**Kalendarz** pokazuje Twoje połączone kalendarze w widokach **Dzień**, **3 dni** i **Agenda** — ten sam model kont co na komputerze. Docierasz do niego z paska nawigacji lub przez **Obszary**. Każda kolumna dnia niesie u góry swój **dzień tygodnia i datę**, a pod nią pasek dla **wydarzeń całodniowych** tego dnia; oba przewijają się razem z siatką, zamiast zajmować miejsce na stałe. Dotknięcie wydarzenia otwiera **podgląd wydarzenia** jako arkusz — tę samą powierzchnię co pływające okno na komputerze: przedział czasu, miejsce, opis, uczestników wraz z ich odpowiedziami, a przy serii jej rytm oraz najbliższy termin. Przy zaproszeniu są tam **Zaakceptuj**, **Wstępnie** i **Odrzuć**, a poniżej **Edytuj wydarzenie**, **Notatka ze spotkania** i **Usuń wydarzenie**. Przeciągnięcie w dół zamyka arkusz. Notatki dzienne nie znajdują się tutaj — są w **Dzisiaj**.

Dotknięcie przypomnienia o wydarzeniu otwiera samo wydarzenie — widok dnia w jego dacie, z otwartym wydarzeniem. Ostatnio używany widok (dzień, 3 dni, agenda) jest zapamiętywany na urządzeniu, jak na komputerze.

**Kiedy telefon sprawdza.** W tle na telefonie nie chodzi żaden zegar — regularna synchronizacja stoi więc tak długo, jak długo aplikacja jest odłożona. Dlatego Plainva sprawdza sama z siebie, gdy tylko **wracasz do aplikacji** i gdy otwierasz **Kalendarze**, **Zadania** albo **Konta kalendarza**; najwyżej raz na minutę, żeby częste przełączanie nie wyzwalało łańcucha synchronizacji. Powrót **planuje też na nowo przypomnienia**, nawet jeśli nic nowego nie doszło — zegar i tak szedł dalej. Jeśli nie chcesz czekać, nadal są **Odśwież teraz** i ściągnięcie listy w dół.

Kontami zarządzasz z poziomu ikony koła zębatego w kalendarzu wydarzeń: **CalDAV** łączysz bezpośrednio na urządzeniu za pomocą hasła aplikacji (np. Fastmail, Nextcloud, iCloud); Google i Microsoft łączysz przez logowanie w przeglądarce. Dla każdego konta możesz pokazywać lub ukrywać poszczególne kalendarze.

Z poziomu wydarzenia opcja **Notatka ze spotkania** tworzy przypisaną do niego notatkę — tę samą, którą znajduje też komputer: pozostaje powiązana z wydarzeniem, więc ponowne jej wywołanie otwiera ją ponownie zamiast tworzyć drugą, a trafia do **Folderu spotkań**. Ten folder wybierasz w obszarze kont, pod **Ustawieniami kalendarza**, za pomocą **przeglądarki folderów** zamiast wpisywać jego ścieżkę; tam też znajduje się **Domyślny kalendarz** (ten, w którym zaczyna się nowe wydarzenie); oba należą do sejfu i podróżują wraz z synchronizacją ustawień. W tym samym miejscu wybierasz, dla każdego konta osobno, które **Listy zadań** są odzwierciedlane w Twojej bazie zadań.

**Logowanie dotyczy każdego urządzenia osobno.** Synchronizowane są *ustawienia* Twojego konta, nigdy samo logowanie — to celowe: dane logowania nie powinny opuszczać urządzenia. Konto, które pojawiło się dzięki synchronizacji ustawień, widnieje więc na liście, ale nosi oznaczenie **zaloguj się**, a pod nim znajduje się wskazówka, co zrobić. Dopóki na tym urządzeniu żadne konto nie jest zalogowane, kalendarz i skrzynka pocztowa wyjaśniają to w tym miejscu zamiast po prostu pozostawać puste, a **Zaloguj się na tym urządzeniu** prowadzi do kont. Zalogowane konta pokazują **aktywne**. Jeśli logowanie później wygaśnie lub zostanie odwołane, w wierszu widnieje **logowanie wygasło** wraz z powodem — a **Zaloguj się ponownie** przywraca je do działania bez usuwania konta: to samo konto, te same kalendarze. W przypadku Google i Microsoft Plainva szuka potrzebnej rejestracji aplikacji na samym urządzeniu — przy tym koncie, przy synchronizacji plików tego samego konta albo przy innym koncie tego samego dostawcy. Dotyczy to zarówno **Zaloguj się ponownie**, jak i **dodawania** konta: jeśli Plainva go znajdzie, w formularzu pojawia się **Identyfikator klienta pobrany z tego urządzenia** oraz **Edytuj** obok. Dopiero gdy naprawdę żadnej nie ma, otwiera się formularz i o nią pyta.

**Jedno logowanie dla wszystkich usług — także tutaj.** Jeśli konto Microsoft lub Google obejmuje kilka usług (na przykład pliki i kalendarz), ekran **Konta w chmurze** oferuje ich scalenie w jedno logowanie. Potem jedno logowanie utrzymuje przy życiu każdą usługę zamiast tylko jednej — wcześniej jedna usługa mogła działać dalej, podczas gdy inna tego samego konta po cichu wygasła. Skrzynka Gmail pozostaje poza tym: działa przez IMAP z hasłem aplikacji i nie wymaga zgody. Oferta pozostaje widoczna, dopóki wspólne logowanie nie obejmuje wszystkich usług konta. Jeśli brakuje jednej z nich, szczegóły konta oferują dwa wyjścia: **Zresetuj wspólne logowanie** pozwala każdej usłudze znów logować się osobno, a **Zakończ kreatora** usuwa próbę połączenia, która nigdy się nie dokończyła.

**Przypomnienia.** W **Ustawieniach kalendarza → Przypomnienia** włączasz **Przypominaj o spotkaniach**; telefon prosi wtedy jednorazowo o zgodę na powiadomienia. Liczy się przypomnienie, które niesie samo spotkanie — dopiero gdy nic nie mówi, Plainva przypomina 15 minut wcześniej, a spotkania całodniowe poprzedniego wieczoru o 19:00. Spotkanie, które wyraźnie nie chce przypomnienia, żadnego nie dostaje. Planowane jest najbliższe 14 dni, najwyżej 64 przypomnienia z wyprzedzeniem — na tyle pozwala iOS; Plainva uzupełnia to okno przy każdym otwarciu aplikacji i po każdej aktualizacji kalendarza oraz mówi, od kiedy jakiś okres już się nie mieści, zamiast po cichu połykać spotkania. **Granica, która pozostaje:** telefon może zapowiedzieć tylko to, co zobaczył podczas ostatniej synchronizacji — zaproszenie, które przychodzi dziesięć minut przed początkiem, nie trafi już do żadnego powiadomienia.

**Co ustawiasz przy okazji.** **Wyprzedzenie** dotyczy spotkań bez własnego przypomnienia; **Spotkania całodniowe** decydują, którego wieczoru lub poranka się odezwą. **Zadania z terminem** dokładają zadania z Twojej bazy zadań — z godziną jak spotkanie, bez godziny według wiersza **Zadania bez godziny** tuż poniżej, który domyślnie przypomina **w dniu terminu o 09:00**. **Tylko te kalendarze** zawężają, skąd w ogóle przychodzą przypomnienia; jeśli nic nie wybierzesz, widnieje **Wszystkie**, a kalendarz dodany później dołącza sam z siebie; arkusz pozostaje otwarty, dopóki nie skończysz, więc zaznaczasz kilka kalendarzy za jednym razem. Na powiadomieniu są dwa ruchy: przy spotkaniu **Notatka ze spotkania** (tworzy ją albo otwiera istniejącą), przy zadaniu **Odhacz** — co kończy je na miejscu, a przy zadaniu cyklicznym tworzy następne, bez otwierania aplikacji. Pod ustawieniami wiersz mówi też, **co faktycznie zaplanowano** — na przykład „Zaplanowano: 12 terminów · 3 zadania" — albo dlaczego nic nie zaplanowano, na przykład dlatego, że na tym urządzeniu nie ustawiono bazy zadań. Gdy nie ma jeszcze czego wybierać, wiersz mówi to wprost, zamiast twierdzić **Wszystkie**: **Jeszcze bez kalendarzy**, gdy konto jest połączone, ale nie dotarł jeszcze żaden kalendarz — dotknięcie proponuje tam **Odśwież teraz** — oraz **Nie połączono żadnego konta**, dopóki nie skonfigurowano żadnego konta kalendarza.

## Poczta e-mail

W **Ustawieniach → Poczta e-mail** połączysz **skrzynkę Microsoft** (Outlook.com, Microsoft 365) bezpośrednio przez logowanie w przeglądarce — bez hasła aplikacji. Tak jak przy kalendarzu, logowanie obowiązuje osobno na każdym urządzeniu.

Potem otworzysz **Pocztę e-mail** jako osobny obszar przez **arkusz obszarów** i umieścisz ją w pasku nawigacji. Wiersz pod tytułem pokazuje folder, liczbę nieprzeczytanych i konto oraz otwiera wybór folderów. Dotknij wiadomości, aby ją przeczytać; **Zapisz jako notatkę** umieści ją w folderze **Mail** Twojego sejfu (dwukrotne zapisanie otworzy tę samą notatkę). Zdalne obrazy pozostają zablokowane, dopóki ich nie zezwolisz dla tej wiadomości — wczytany obraz zdradza nadawcy, kiedy i gdzie czytałeś. Cztery akcje — **Odpowiedz**, **Odpowiedz wszystkim**, **Przekaż dalej** i **Zapisz jako notatkę** — znajdują się w zadokowanym rzędzie przy dolnej krawędzi; dopóki wiadomość jest otwarta, pasek nawigacji ustępuje i robi jej miejsce.

**Skrzynki IMAP działają też na telefonie.** Dodaj jedną w **Ustawieniach → Poczta e-mail**: wybierz dostawcę, wpisz adres i hasło aplikacji, a Plainva uzupełni serwery. Jeśli Twojego dostawcy nie ma na liście, przycisk **Zaawansowane** pozwoli Ci samodzielnie wpisać serwery IMAP i SMTP, porty oraz inną nazwę użytkownika, a istniejące konto można później edytować. Wybór kilku wiadomości działa przez przytrzymanie jednej z nich; potem kolejne dodaje zwykłe dotknięcie. W widoku konwersacji przytrzymanie lub dotknięcie wiersza konwersacji wybiera całą wymianę — a każda wiadomość zachowuje własny folder, więc odpowiedź z folderu **Wysłane** zostanie oznaczona właśnie tam.

Otwarta wiadomość oferuje **Odpowiedz**, **Odpowiedz wszystkim** i **Przekaż dalej**. Odpowiedź cytuje oryginał pod Twoim tekstem; „Odpowiedz wszystkim” dodatkowo uwzględnia pozostałych odbiorców i pomija Twój własny adres. Podczas **redagowania** przycisk **Załącz plik** dodaje plik z sejfu — na telefonie sejf jest magazynem, do którego masz dostęp, a wszystko, co trafia na urządzenie (zapisany załącznik, wstawione zdjęcie), już się w nim znajduje. Każdy załącznik dostaje własny wiersz z przyciskiem **Usuń załącznik**, dopóki wiadomość nie zostanie wysłana.

Rozpoczętej wiadomości nie musisz wysyłać: **Zapisz roboczą** umieści ją w folderze roboczych Twojego konta — tam, gdzie znajdzie ją każdy program pocztowy działający na tej skrzynce, a nie w miejscu dostępnym tylko na telefonie. Który to folder, mówi serwer; dopiero gdy milczy, nazwa jest zgadywana. Na liście, obok wiersza folderu, znajdują się dwa przełączniki: **Nieprzeczytane** zawęża to, co jest aktualnie wczytane (dzięki temu licznik i **Wczytaj więcej** pozostają dostępne), natomiast **Oznaczone** pyta serwer o wszystkie oznaczone wiadomości w folderze — łącznie z tymi daleko poniżej wczytanej strony. W widoku **Wszystkie skrzynki odbiorcze** przełącznik oznaczonych celowo nie występuje: to zapytanie dotyczy dokładnie jednej skrzynki.

Z otwartej wiadomości do sejfu prowadzą trzy drogi: **Zapisz jako notatkę**, **→ Zadanie** w menu ⋮ (tworzy wpis w Twojej domyślnej bazie zadań — z jej szablonem, statusem i datą wiadomości) oraz **+ .eml**, co dodatkowo zachowuje oryginalną wiadomość i odsyła do niej z poziomu notatki. Wszystkie trzy są zakotwiczone: przechwycenie tej samej wiadomości dwa razy otwiera to, co już istnieje. **Usuń** znajduje się teraz również w menu ⋮ zamiast obok strzałki wstecz; na liście wystarczy przesunięcie. Przeniesienie do kosza oferuje **Cofnij**, ponieważ można to odwrócić — trwałe usunięcie z kosza nadal pyta o potwierdzenie, ponieważ tego cofnąć się nie da. A zamiast kilku komunikatów ułożonych jeden na drugim jest teraz **jedna** linia: błąd, w przeciwnym razie niedostępne konta (od dwóch, jako liczba), w przeciwnym razie informacja o zapisanej kopii.

Notatkę możesz wysłać z jej własnego menu ⋮: **Wyślij notatkę e-mailem (mailto)** przekazuje ją do aplikacji pocztowej telefonu — Plainva nie potrzebuje do tego własnego konta — a **Wyślij e-mailem** otwiera własny edytor wiadomości Plainva z tematem i treścią.

## Import z innej aplikacji

W **Ustawienia → Konserwacja → Import z innej aplikacji** przenosisz notatki z innej aplikacji na to urządzenie — z tymi samymi źródłami co na komputerze.

Najpierw wybierasz, dokąd import zapisuje: do **podfolderu** otwartego vaultu albo do **nowego vaultu** na tym urządzeniu. Nowy vault jest właściwym wyborem, gdy nie ma tu jeszcze nic; nadajesz mu tylko nazwę, a cały import cofasz, usuwając go w **Więcej → Vaulty**.

Źródła wymagające dostępu — Notion przez API — proszą w kreatorze o token. Obowiązuje on dla tego jednego przebiegu i nie jest zapisywany.

Szczegóły każdego źródła znajdziesz w [Import z innej aplikacji](Import.md).

## Synchronizacja

**Ustawienia** (na samym dole **Notatek**) prowadzą przez **Aktywny vault** do zarządzania vaultami; tam łączysz się z magazynem w chmurze (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Połącz sejf w chmurze** pobiera na urządzenie istniejący sejf w chmurze; **Utwórz vault** pyta najpierw **Na tym urządzeniu** czy **W usłudze online**, a potem o strukturę początkową (pustą lub szablon, np. PARA) — przy ścieżce online następuje połączenie, docelowy folder w chmurze można od razu utworzyć przez **Nowy folder** w arkuszu wyboru, a struktura zostaje przesłana podczas pierwszej synchronizacji. Ten sam wybór między istniejącym a nowym sejfem w chmurze oferuje też pierwsze uruchomienie („Połącz sejf w chmurze”). Każde połączenie otrzymuje własny, osobny sejf na urządzeniu. Strona sejfu pokazuje status, postęp, oczekujące transfery i oferuje **Eksportuj sejf** (ZIP przez arkusz udostępniania).

Strona sejfu jest uporządkowana według tego, do czego służą jej elementy sterujące: na górze **karta stanu** odpowiada na jedno pytanie, z którym otwiera się tę stronę — czy działa? (stan, ostatnie uruchomienie, oczekujące transfery i interwał w jednym wierszu). Poniżej nazwane grupy — **Połączenie**, **Zawartość** — a na samym dole, oddzielona własną krawędzią, **Strefa zagrożenia** z **Rozłącz synchronizację** i **Usuń sejf**. Wcześniej stało tam nawet dziewięć identycznie wyglądających przycisków w jednym rzędzie, a **Przywróć usunięte pliki** sąsiadowało bezpośrednio z **Usuń sejf**.

Pod **Zawartością**, obok **Eksportuj sejf**, jest teraz też **automatyczna kopia zapasowa vaultu**: raz dziennie ZIP całego sejfu, z którego zachowywanych jest ostatnich **siedem** (**Liczba przechowywanych kopii zapasowych**); **Utwórz kopię zapasową teraz** tworzy ją od razu. Archiwa znajdują się w dokumentach urządzenia, a nie w pamięci podręcznej — to, co system operacyjny może w każdej chwili opróżnić, nie jest archiwum. Telefon nie dostaje budzika w tle: sprawdzanie odbywa się przy otwarciu aplikacji i za każdym powrotem do niej, więc kopia zapasowa nadrabia zaległości zamiast działać o stałej godzinie. Wiersz pod przełącznikiem podaje więc, kiedy ostatnio się wykonała — tak właśnie staje się widoczna kopia zapasowa, która po cichu nigdy się nie wykonuje. Do tej pory na telefonie był tylko ręczny eksport — sejf, o którego eksport nikt nie pomyślał, w ogóle nie miał archiwum.

To, jak często ten sejf sprawdza zmiany po stronie zdalnej, ustawisz na tej samej stronie (**interwał synchronizacji**, co najmniej 5 sekund) — lokalne zapisy i tak trafiają w górę natychmiast. W Google Drive, OneDrive, Dropbox i S3 **folder w chmurze** można zmienić także później; w WebDAV folder jest częścią adresu serwera, więc tam łączysz się na nowo. Jeśli synchronizacja ustawień jest zaszyfrowana, możesz dodatkowo włączyć **Pytaj o hasło przy każdym starcie**: klucz nie jest wtedy przechowywany na urządzeniu. A **Bezpieczeństwo i udostępnianie** mówi teraz wprost, że zaszyfrowane przestrzenie robocze są eksperymentalne i nie zostały jeszcze niezależnie zweryfikowane — przechowuj plik i kod odzyskiwania w bezpiecznym miejscu.

Strona vaulta podaje też, czy Twoje **ustawienia** podróżują razem z Tobą — jako karta z wyraźnym stanem zamiast gołego przycisku:

- **nie są synchronizowane**: synchronizacja ustawień jest wyłączona dla tego vaultu. Włącz ją na komputerze.
- **Nie zaszyfrowano jeszcze**: ten vault nie ma jeszcze frazy hasłowej synchronizacji. Możesz ją teraz ustawić **na telefonie**: kreator pokazuje kod odzyskiwania i każe wpisać z powrotem dwie losowo wybrane grupy, zanim cokolwiek zostanie zapisane. Jeśli w chmurze istnieje już fraza hasłowa, telefon to zgłasza i nigdy nie tworzy drugiej — to zablokowałoby dostęp wszystkim innym urządzeniom.
- **Nie odblokowano jeszcze na tym urządzeniu**: Twoje ustawienia są przechowywane w chmurze w postaci zaszyfrowanej. Wprowadź frazę hasłową ustawioną podczas konfiguracji — na komputerze albo tutaj, na telefonie; to urządzenie odblokuje je nią jednorazowo.
- **są synchronizowane**: to urządzenie jest odblokowane; foldery, widoki i reguły backupu pozostają zgodne z Twoimi innymi urządzeniami.

Każda karta podaje też, co *nie* podróżuje: logowania zawsze pozostają na urządzeniu (patrz [Kalendarz i wydarzenia](#kalendarz-i-wydarzenia)).

**Ustawienia** → **Bezpieczeństwo i udostępnianie** podaje, czym połączenie naprawdę jest — a przy zwykłym sejfie w chmurze konfiguruje zaszyfrowany obszar roboczy wprost na telefonie (tożsamość → plik odzyskiwania i kod → aktywacja). Bez połączenia z chmurą nie ma czego szyfrować i sekcja to mówi.

Obie konfiguracje — zaszyfrowany obszar roboczy i fraza hasłowa synchronizacji — działają teraz jako **osobny proces, bez paska nawigacji**: dopóki jedna z nich jest otwarta, istnieje dokładnie jedno wyjście, i ono pyta o potwierdzenie. To nie jest ozdobnik. Aż do ostatniego kroku Twój klucz istnieje wyłącznie w pamięci, a wyjście go odrzuca; wcześniej dotknięcie paska mogło to zrobić bez słowa. Ostatni krok pokazuje pasek postępu tam, gdzie jest coś do policzenia — obszar roboczy szyfruje na nowo każdy plik, podczas gdy fraza hasłowa synchronizacji to dwa zapisy, a wymyślanie dla niej procentu byłoby kłamstwem w kształcie paska.

**Udostępnieniami zarządzasz teraz tutaj**, a nie tylko na komputerze: w sekcji **Osoby i uprawnienia** zapraszasz członka z rolą (**Zaproś** go tworzy — jego urządzenie parujesz później), tworzysz grupę i zmieniasz rolę grupy bezpośrednio w jej wierszu. W sekcji **Slices** tworzysz udostępnienie dla **Folder**. Świadomie nie na telefonie: slices z dowolnego wyboru lub z reguły dynamicznej — obie potrzebowałyby ekranów, których tu nie ma.

**Synchronizacja folderu przez inną aplikację (iPhone i iPad).** Folder Plainvy pojawia się w aplikacji **Pliki**, w sekcji **Na moim iPhonie** → **Plainva**. Inny program — na przykład klient Syncthing — może go tam wskazać i utrzymywać w synchronizacji między Twoimi urządzeniami, bez łączenia Plainvy z jakąkolwiek usługą w chmurze. Vault utworzony na urządzeniu leży w nim jako `vault`; każde połączenie z chmurą dostaje własny podfolder w `vaults`. W drugą stronę to nie działa: Plainva pracuje we własnym folderze, nie w folderze innej aplikacji. Na Androidzie ten folder nie jest widoczny dla innych programów.

**Istniejący folder jako vault (Android i iOS).** W **Vaulty → Utwórz vault** jest trzecia droga, **Folder na tym urządzeniu**: wybierasz folder, którym zarządza inny program — Syncthing, aplikacja Pliki, drugi klient synchronizacji — a Plainva czyta i zapisuje tam, niczego nie kopiując. Folder pozostaje folderem: gdy usuniesz vault, znika tylko połączenie, pliki zostają. Zmiany, które inny program tam wprowadza, Plainva widzi po powrocie do aplikacji i przy otwarciu notatki. Synchronizacja w chmurze jest dla takich vaultów wyłączona — druga synchronizacja na tym samym magazynie nadpisałaby pierwszą — i mówi o tym karta w szczegółach vaultu. Gdy dostęp wygaśnie (folder przeniesiony, uprawnienie cofnięte), karta to nazywa, a **Połącz folder ponownie** go przywraca.

## Sieć bezpieczeństwa

Migawki (historia wersji), dziennik wersji roboczych (po awarii notatka oferuje Twój ostatni niezapisany stan) oraz kopie konfliktów z widokiem porównania chronią Twoje dane. Przechowywanie konfigurujesz w **Ustawieniach** → **Backup i historia wersji**.

**Jeśli ktoś zmieni tę samą notatkę gdzie indziej**, gdy piszesz tutaj, Plainva zapisuje Twoją wersję jako kopię obok i przejmuje tę, która nadeszła. Widać to teraz **przy notatce** i pozostaje tam, dopóki tego nie rozwiążesz: komunikat nad tekstem podaje ścieżkę kopii, otwiera ją i na życzenie pokazuje **różnice**. Wcześniej był to komunikat znikający po kilku sekundach — a zapis próbował dalej, więc każda runda tworzyła kolejną kopię. Teraz powstaje dokładnie jedna.

**Różnice** otwierają ten sam widok porównania co na komputerze: notatka po lewej, Twoja kopia po prawej, identyczne wiersze zwinięte, i te same wyjścia — **przyjmij**, **zachowaj obie** (kopia nazywa się wtedy `Notatka (Version …).md`), **odrzuć kopię**, każde z pytaniem.

**Podczas usuwania folderu** okno dialogowe podaje, ile plików on zawiera — liczba widnieje też na przycisku. Plainva najpierw tworzy migawkę każdego znajdującego się w nim pliku, którą możesz przywrócić w **Ustawieniach** → **Konserwacja** → **Przywróć usunięte pliki**. Otwarcie podaje przy tym jedno ograniczenie: **zachować można tylko to, co ten telefon zapisał choć raz.** Notatka, która dotarła wyłącznie przez synchronizację i nigdy nie była tu edytowana, nie istnieje w żadnej migawce. W przeciwieństwie do komputera telefon nie ma kosza systemowego, który by to złapał. Jeśli usunięcie dotyczy ponad 10 plików lub ponad jedną piątą vaultu, Plainva pyta drugi raz — dokładnie tak samo jak na komputerze.

## Udostępnianie i skróty

Na Androidzie i iOS udostępniony tekst i adresy URL stają się nową notatką w folderze skrzynki; udostępnione obrazy i pliki są przejmowane jako załączniki (do 25 MB na plik). Na Androidzie przytrzymanie ikony aplikacji dodatkowo udostępnia skróty **Nowa notatka** i **Dzisiaj**.

## Foldery, zdjęcia i kalendarz

Pływający przycisk **Plus** pozostaje dostępny w zagnieżdżonych folderach, a każda czynność szybkiego tworzenia tworzy element w otwartym folderze — również nowe foldery. Przycisk ⋮ w nagłówku należy natomiast do otwartego obiektu: pokazuje działania tego obiektu, nigdy ustawienia aplikacji.

Przycisk zdjęcia w edytorze oferuje **Zrób zdjęcie** lub **Wybierz z biblioteki**, zachowuje pozycję wstawiania i wyraźnie pokazuje błędy uprawnień lub pliku. Zdjęcia trafiają do folderu załączników sejfu — tego samego, którego używa Twój komputer.

Wydarzenia i notatki dzienne są celowo rozdzielone: **Kalendarz** pokazuje połączone kalendarze (zobacz [Kalendarz i wydarzenia](#kalendarz-i-wydarzenia)), **Dzisiaj** pokazuje notatkę dzienną wybranego dnia. Nie ma lokalnego widoku miesięcznego notatek dziennych — tę rolę pełni pasek w **Dzisiaj**.

## Załączniki i obrazy

Oprócz notatek i baz nawigator pokazuje teraz **załączniki** — obrazy, pliki PDF i wszystko inne, co leży w folderze. Obraz otwiera się w Plainvie; resztę aplikacja przekazuje systemowi, który wie, czym jest PDF, a Plainva nie. Przez **Udostępnij** plik trafia do dowolnej innej aplikacji.

W menu ⋮ notatki znajdziesz **Eksportuj jako Markdown…**: przekazuje sam plik do systemowego panelu udostępniania, gdzie są Drukuj, „Zapisz w Plikach” i każdy zainstalowany edytor. **Udostępnij** powyżej wysyła tylko tekst notatki. Jeśli notatka ma otwarte adnotacje, Plainva najpierw pyta **Dołączyć adnotacje?** — **Jako lista na końcu (czytelna wszędzie)** lub **Oznaczone w tekście (CriticMarkup)**; niewidoczne znaczniki kotwic znikają w każdym przypadku.

## Przesuwanie

**Przesuń wiersz w lewo**, aby odsłonić jego akcje: **Zakładka** i **Usuń** przy notatce, **Zmień nazwę** i **Usuń folder** przy folderze, **Usuń** przy bazie danych i w skrzynce. To te same akcje, które wiersz oferuje w swoim menu (długie przytrzymanie) — przesunięcie to tylko krótsza droga do nich, nigdy jedyna. Za pierwszym razem informuje o tym pasek nad listą; odsuwasz go dotknięciem, a pojawia się dokładnie raz na vault.

Usuwanie pyta przez ten sam dialog co wszędzie indziej. Gdy zaznaczasz kilka wierszy, przesuwanie jest wyłączone — gest, który oznacza dokładnie jeden wiersz, nie ma jasnego znaczenia obok zaznaczenia, które dopiero budujesz. Gdy w skrzynce włączone są **konwersacje**, przesunięcie na konwersacji dotyczy **całej** konwersacji (zamiast cofnięcia dowiesz się potem, ile było wiadomości); pojedynczą rozwiniętą wiadomość nadal przesuwasz osobno. Wiersze zadań nie mają akcji przesuwania — noszą swoje elementy sterujące widocznie na wierszu.

## Na szerokich ekranach

Aplikacja dostosowuje się do szerokości okna, a nie do nazwy urządzenia:

- **poniżej 600 px** — jedna powierzchnia po drugiej, tak jak na telefonie.
- **600 do 839 px** — pasek nawigacji zamienia się w **listwę z boku**; nadal jest to jedna powierzchnia.
- **od 840 px** — nawigator i powierzchnia robocza stoją **obok siebie**. To ten sam nawigator co obszar **Notatki** — tylko obok Twojej pracy, a nie przed nią.

**Listwa z boku pokazuje wszystkie obszary.** Na telefonie dolny pasek mieści od trzech do pięciu miejsc — więcej niż kciuk trafia niezawodnie, dlatego reszta znajduje się za **Obszarami**. Wzdłuż krawędzi szerokiej powierzchni to ograniczenie już nie obowiązuje: **cała** lista stoi tam w Twojej kolejności (**Ustawienia → Pasek nawigacji**), objazd przez **Obszary** znika, a **Ustawienia** znajdują się na samym dole. Listwa zaczyna się poniżej paska stanu — na tablecie z wycięciem na aparat jej pierwsza ikona wcześniej leżała pod nim.

**Nawigator chowa się.** Gdy szukasz notatki, lewa kolumna należy do niej; gdy ją piszesz, należy do notatki. Ikona na dole listwy — tuż nad **Ustawieniami** — chowa go i przywraca, a powierzchnia robocza zajmuje wtedy całą szerokość. Przełącznik pojawia się tylko tam, gdzie w ogóle istnieje druga kolumna (od 840 px), dotyczy tego urządzenia i zachowuje stan, w jakim go zostawiłeś, także po ponownym uruchomieniu. Na komputerze to ten sam ruch — tam nazywa się **Przełącz lewy panel boczny**.

Na tablecie albo na dużym telefonie obróconym w poziomie masz dzięki temu ten sam model przestrzenny co na komputerze — nawigujesz po lewej, pracujesz na środku — zamiast powiększonego telefonu.


## Bazy danych w kalendarzu

Nad widokami kalendarza stoi rząd chipów: każdy widok `.base` typu **kalendarz** lub **oś czasu**, który wskazuje kolumnę daty, można tam pokazać. Pokazane wpisy pojawiają się między terminami na liście dnia i w agendzie — z **rombem i przerywaną krawędzią**, żeby notatka nigdy nie wyglądała jak termin; w siatce miesiąca jako **pusta kropka**. Dotknięcie otwiera notatkę.

**Wybór należy do sejfu**, nie do urządzenia: to, co pokażesz na komputerze, zastaniesz tutaj, gdy tylko przejdzie synchronizacja ustawień. W telefonie termin ustawia się przez arkusz wpisu — przeciąganie zostaje na komputerze.

I odwrotnie: widok kalendarza bazy danych może pokazać **liczbę prawdziwych terminów** danego dnia w rogu komórki — widzisz, wobec czego planujesz.

## Powiadomienia o uwagach

Gdy ktoś napisał coś przy notatce, Plainva może o tym powiadomić — te same trzy poziomy i ten sam przełącznik podglądu co na komputerze, w **Ustawieniach → Treść i struktura**. Dotknięcie powiadomienia otwiera notatkę i wyróżnia właściwą kartę. Pojedynczą notatkę wyciszasz dzwonkiem w arkuszu komentarzy.

Gdy kilka uwag jest nowych naraz, powiadomienie otwiera **Otwarte komentarze** na karcie **Nowe** — dokładnie te wątki, o które chodziło; obok są **Wszystkie** i **Do mnie**.

**Powiadomienie przychodzi tu później niż na komputerze i jest to cecha, a nie usterka.** Plainva nie ma serwera, który mógłby trącić telefon — zbudowanie go oznaczałoby, że obcy serwer dowiaduje się, kto i kiedy skomentował którą notatkę. Uwaga zostaje więc zauważona tam, gdzie telefon i tak zagląda: po cyklu synchronizacji i przy powrocie na pierwszy plan. Nie działa w tym celu żaden licznik w tle; nie pozwala na to żadna platforma telefonu.
