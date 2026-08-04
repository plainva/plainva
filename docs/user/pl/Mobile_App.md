# Aplikacja mobilna

Stan na: 2026-08-04

Plainva jest też dostępna jako aplikacja na Androida i iOS. Działa na tych samych plikach Markdown, tym samym formacie **OKF** i tym samym mechanizmie synchronizacji co aplikacja desktopowa — Twój sejf pozostaje identyczny w obu światach.

## Instalacja aplikacji

Aplikacja mobilna jest w **zamkniętej wersji beta**. Na **Androidzie** wchodzisz w dwóch krokach: dołącz do grupy testerów przez [plainva.com/android-beta](https://plainva.com/android-beta), a potem potwierdź w Google Play. Na **iPhonie** dystrybucja idzie przez TestFlight; lista oczekujących jest na [plainva.com](https://plainva.com).

Google udostępnia aplikację w publicznym Sklepie Play dopiero wtedy, gdy 12 testerów wytrwa 14 dni z rzędu — samo dołączenie i pozostawienie jej zainstalowanej już pomaga.

## Układ

- **Dolny pasek:** **od dwóch do czterech** powierzchni roboczych według wyboru oraz stały wpis **Obszary** na końcu — razem od trzech do pięciu miejsc, jakie powinien mieć pasek. **Notatki** pozostają zawsze widoczne: to dzięki nim docierasz do swoich plików.
- **Każdy obszar** (Notatki, Dzisiaj, Zadania, Kalendarz, E-mail, Graf) jest zawsze o jedno dotknięcie – przez **arkusz obszarów**: **Obszary** na pasku, **▾ obok tytułu** albo **długie przytrzymanie paska**. Arkusz zaznacza bieżący obszar i prowadzi na dole prosto do **Dostosuj pasek nawigacji…**. Tagi, zakładki i ostatnio otwierane elementy nie są już osobnymi obszarami — znajdziesz je teraz pod **Notatkami**.
- **Konfigurowanie paska:** **Ustawienia** → **Pasek nawigacji**. Przyciskami **−**/**+** ustalasz, ile powierzchni roboczych pokazuje pasek (2–4, z podglądem na żywo), a **uchwytem do przeciągania** porządkujesz listę: górne pozycje tworzą pasek (oznaczone ramką), przeciągnięcie pozycji w górę przenosi ją na pasek. Gdy przeciągniesz w stronę górnej lub dolnej krawędzi, lista przewija się razem z tym, dzięki czemu jeden ruch obejmuje całą listę. Nic nie jest ukrywane — to, czego nie ma na pasku, pozostaje dostępne przez **Obszary**. Jeśli obszar, w którym akurat jesteś, opuści pasek, aplikacja przechodzi do pierwszego widocznego. Ten sam pasek możesz też uporządkować **na komputerze** (Ustawienia → Vault → Paski i obszary); przy włączonej synchronizacji ustawień układ przenosi się między Twoimi urządzeniami.
- **＋** unosi się jako okrągły przycisk nad paskiem i otwiera szybkie tworzenie: notatka, notatka dzienna, folder, baza danych, „Z szablonu…”.
- **Nagłówek:** wszędzie taki sam — po lewej Wstecz (na powierzchni roboczej brak), pośrodku tytuł i jedna linia kontekstu, po prawej wyszukiwanie i ⋮. Podczas przewijania odrywa się od treści, a pasek nawigacji zwija się do samych ikon; gdy przewiniesz w górę, otwiera się on ponownie.
- **Przycisk ⋮ zawsze oznacza to samo:** działania na otwartym obiekcie. Ustawienia aplikacji nie kryją się za nim.
- **Ustawienia:** na samym dole **Notatek**, tak samo jak na komputerze. Otwierają najpierw listę obszarów (jak lewa strona ustawień na komputerze) — dotknięcie otwiera daną stronę. Na górze **Aktywny vault** prowadzi do zarządzania vaultami: przełączanie vaultów (znacznik = aktywny), **Utwórz vault** i **Połącz sejf w chmurze**.

## Czytanie i edycja notatek

Notatki otwierają się **wyrenderowane i tylko do odczytu**; ikona pióra w prawym górnym rogu przełącza na edycję (z paskiem narzędzi nad klawiaturą: formatowanie, listy, link wiki, polecenia slash, wstawianie zdjęcia). Osadzenia `![[Notatka]]` pojawiają się jako klikalne karty podglądu.

Przycisk **Szczegóły notatki** w nagłówku (między zakładką a menu ⋮) otwiera arkusz kontekstowy notatki: właściwości (bezpośrednio edytowalne), linki zwrotne, konspekt, graf oraz **historię wersji** — każda edycja automatycznie tworzy migawki, które możesz przeglądać, porównywać i przywracać. Źródło Markdown i wyszukiwanie w notatce znajdziesz w menu ⋮.

## Szablony

Szablony na telefonie zachowują się dokładnie tak samo jak na komputerze: symbole zastępcze (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) są wypełniane w chwili tworzenia notatki, **wszystkie** pytania szablonu pojawiają się razem w **jednym** arkuszu — anulujesz go i nic nie powstaje — a `{{cursor}}` ustawia kursor, gdy notatka się otwiera.

Reguły **folder → szablon** i **typ notatki → szablon** ustala się na komputerze; podróżują one wraz z synchronizacją ustawień i obowiązują też tutaj — notatka w `Projekte/` zaczyna się więc tak samo na obu urządzeniach, także przy szybkich notatkach z `＋` i przy **+ Wpis** w bazie danych. Dwa szczegóły: `{{weekday:…}}` na telefonie zawsze liczy od poniedziałku (ustawienie początku tygodnia jeszcze tam nie istnieje), a `{{clipboard}}` pyta o zawartość schowka w tym samym arkuszu, zamiast odczytywać ją bez pytania. Pełny wykaz symboli zastępczych zawiera [Notatki i Markdown](Notes_and_Markdown.md).

## Bazy danych (`.base`)

Bazy danych `.base` działają jak na komputerze: każdy widok (tabela, lista, galeria, tablica, kalendarz, oś czasu), edycja komórek zgodna z typem pola, karty na tablicy przenosisz, przytrzymując je. **Konfiguruj** zarządza widokami, kolumnami, filtrami (w tym grupami), sortowaniem i właściwościami. Schematy relacji (cele, liczność) nadal są utrzymywane na komputerze.

Widok **Tablica korkowa** pokazuje notatki jako dwukolumnową tablicę karteczek samoprzylepnych: dotknięcie otwiera notatkę, przytrzymanie pokazuje akcje (przypnij, etykiety, kolor, usuń), przeciąganie po przytrzymaniu zmienia kolejność, a pola wyboru odhaczasz bezpośrednio na karcie. Pole wprowadzania na górze tworzy nową notatkę. Wskazówka: skieruj bazę danych na folder skrzynki (**Ustawienia** → **Treść i struktura**), a szybkie notatki z ＋ oraz teksty udostępnione z innych aplikacji trafią prosto na tablicę.

## Zadania

Obszar **Zadania** zbiera każde pole wyboru w Twoim vaulcie — wszystkie linie `- [ ]` i `- [x]` ze wszystkich notatek, pogrupowane według notatki. To przegląd na poziomie linii, którego nie może dać baza danych, ponieważ baza danych pracuje na całych notatkach.

Dotknięcie zadania otwiera notatkę **w tej linii**; pole wyboru odhacza je i zapisuje z powrotem dokładnie ten jeden znak `[ ]`/`[x]`. Terminy (`📅`) i `#tags` pojawiają się jako plakietki, dzięki czemu nie powtarzają się w tekście.

Jeśli Twój vault ma **bazę zadań** (**Ustawienia** → **Treść i struktura**), obszar pokazuje ją nad nim jako osobną sekcję: odznaczanie, zmiana statusu, **+ Nowe zadanie** i **Otwórz jako bazę**. Każdy wiersz zadania dostaje wtedy też przycisk, który **przenosi go do bazy** — linia zostaje jako link wiki, a zadanie żyje dalej jako osobna notatka.

Nad listą znajdziesz te same filtry co na komputerze: **Folder**, **Tag**, **Z terminem** i **Pokaż ukryte**. Ukrywanie jest właściwością **notatki**, a nie pojedynczego zadania — ikona oka na nagłówku notatki zapisuje `plainva.tasks: false` we frontmatterze tej notatki i usuwa ją z przeglądu; **Ukryj szablony** robi to samo jednocześnie dla całego folderu szablonów. Plik zachowuje swoje zadania, po prostu przestają się liczyć. Długie przytrzymanie przycisku przenoszenia wybiera **docelową bazę danych**, gdy Twój vault ma więcej niż jedną.

Dwie kolejne akcje przy zadaniu z bazy danych: **Zablokuj czas** tworzy wydarzenie w kalendarzu dla zadania, gdy podłączony jest kalendarz (data, początek, czas trwania, a przy kilku zapisywalnych kalendarzach także ich wybór), a **Powtarzanie** tworzy kolejne zadanie z nowym terminem, gdy je odhaczysz. Oba opisano w [Zadaniach](Tasks.md).

## Dzisiaj

**Dzisiaj** to powierzchnia dnia. Pasek na górze wybiera dzień — biegnie **w obu kierunkach**, dwa tygodnie wstecz i dwa tygodnie do przodu, a kropka oznacza każdy dzień, który ma już notatkę dzienną. Poniżej znajduje się **notatka dzienna** wybranego dnia (z jej szablonem i folderem, do otwarcia lub utworzenia), następnie **terminy i zadania** tego dnia, a na końcu to, co edytowałeś tego dnia.

Środkowa sekcja łączy to, co inaczej znajdowałoby się w dwóch obszarach: najpierw wydarzenia całodniowe, potem te z konkretną godziną w porządku chronologicznym, a na końcu zadania z terminem tego dnia. Dotknięcie zadania otwiera jego notatkę. Bez podłączonego kalendarza i bez bazy zadań ta sekcja po prostu nie istnieje.

## Tagi

Lista tagów znajduje się pod **Notatkami**. Dotknięcie otwiera notatki danego tagu; strzałka rozwija zagnieżdżone tagi. **Długie przytrzymanie** tagu oferuje **Zmień nazwę tagu** — w całym vaulcie, tak jak na komputerze: Plainva przepisuje każdą notatkę, która go zawiera (we frontmatterze i jako `#tag` w tekście, wraz z jego dziećmi `tag/child`), a potem informuje, w ilu notatkach nazwa została zmieniona. Notatka, której nie da się odczytać ani zapisać, zostaje pominięta — pozostałe i tak zostają przemianowane.

## Graf

**Mapa sejfu** pokazuje Twój sejf jako węzły i krawędzie. Dotknięcie bąbelka folderu rozwija go, dotknięcie notatki ją otwiera; plakietki powyżej filtrują według typu notatki, tagu i rodzaju krawędzi. Przeciągnij węzeł, a **mapa zapamięta jego położenie** — zapamiętany układ znajduje się w `.plainva/graph.json` i celowo pozostaje na tym urządzeniu, tak jak indeks wyszukiwania.

**Długie przytrzymanie** węzła otwiera jego menu: otwórz (albo rozwiń/zwiń w przypadku folderu), **Skup na zaznaczeniu** oraz, jeśli węzeł jest przypięty, **Odepnij**. Długie przytrzymanie **krawędzi** wymienia oba jej końce i otwiera jedną lub drugą notatkę. Przeciągnij jedną notatkę **na drugą**, a Plainva zaproponuje, by je **połączyć** — jako link tekstowy na końcu notatki albo przez relację odpowiedniej bazy danych; relacja dopuszczająca dokładnie jeden wpis pyta wcześniej, ponieważ zastępuje bieżącą wartość. Plakietka **Zaznacz** zamienia przeciągnięcie po pustym miejscu w prostokąt zaznaczenia (telefon nie ma klawisza modyfikującego); zaznaczone notatki można usunąć razem, przez to samo potwierdzenie co pojedynczą. **Eksportuj jako SVG…** przekazuje mapę do arkusza udostępniania Twojego urządzenia.

To samo porządkowanie w mniejszej skali wykonuje **graf w arkuszu kontekstowym notatki**: pokazuje sąsiedztwo otwartej notatki, a poniżej sugestie, co jeszcze mogłoby do niej należeć. **Połącz** umieszcza link w miejscu wystąpienia w tekście — nie na końcu notatki — a odrzucona sugestia pozostaje odrzucona, nawet po zamknięciu notatki.

Chip **Porządki** otwiera listę porządkowania: **sieroty** (notatki, na które nic nie wskazuje), **uszkodzone linki** (odwołania donikąd) i **wzmianki** — miejsca, w których notatka jest wymieniona, ale nie połączona. Sierotę usuwasz przez to samo potwierdzenie co wszędzie indziej, dla uszkodzonego linku tworzysz brakującą notatkę, a wzmiankę łączysz dokładnie **w miejscu wystąpienia**, a nie na końcu notatki. To, co odrzucisz, pozostaje odrzucone: nie pojawia się ponownie przy kolejnym przebiegu. Skanowanie wzmianek odczytuje każdą notatkę, dlatego uruchamia się dopiero na Twoje polecenie — można je przerwać w każdej chwili.

**Fokus** można też ustawić z menu węzła: mapa pokazuje wtedy tylko jego sąsiedztwo do głębokości, którą wybierzesz (1–3). Plakietka z głębokością znów usuwa fokus. Kolejne dwie plakietki pokazują mapę według wieku: **Mapa ciepła** zabarwia każdy węzeł według tego, jak niedawno się zmienił, a **Podróż w czasie** ukrywa wszystko, co jest nowsze niż suwak — dzięki temu możesz obserwować, jak Twój sejf rośnie.

## Kalendarz i wydarzenia

**Kalendarz** (dolna karta lub przez „Więcej”) pokazuje Twoje notatki dzienne w postaci siatki miesięcznej. Ikona zegara w prawym górnym rogu otwiera **kalendarz wydarzeń** z widokami **Dzień**, **3 dni** i **Agenda** — połączone kalendarze korzystają z tego samego modelu kont co na komputerze. Dotknięcie wydarzenia pokazuje jego szczegóły; przy zaproszeniu możesz od razu **zaakceptować**, oznaczyć jako **wstępne** lub **odrzucić**.

Kontami zarządzasz z poziomu ikony koła zębatego w kalendarzu wydarzeń: **CalDAV** łączysz bezpośrednio na urządzeniu za pomocą hasła aplikacji (np. Fastmail, Nextcloud, iCloud); Google i Microsoft łączysz przez logowanie w przeglądarce. Dla każdego konta możesz pokazywać lub ukrywać poszczególne kalendarze.

Z poziomu wydarzenia opcja **Notatka ze spotkania** tworzy przypisaną do niego notatkę — tę samą, którą znajduje też komputer: pozostaje powiązana z wydarzeniem, więc ponowne jej wywołanie otwiera ją ponownie zamiast tworzyć drugą, a trafia do **Folderu spotkań**. Ten folder oraz **Domyślny kalendarz** (ten, w którym zaczyna się nowe wydarzenie) ustawiasz w obszarze kont, pod **Ustawieniami kalendarza**; oba należą do sejfu i podróżują wraz z synchronizacją ustawień. W tym samym miejscu wybierasz, dla każdego konta osobno, które **Listy zadań** są odzwierciedlane w Twojej bazie zadań.

**Logowanie dotyczy każdego urządzenia osobno.** Synchronizowane są *ustawienia* Twojego konta, nigdy samo logowanie — to celowe: dane logowania nie powinny opuszczać urządzenia. Konto, które pojawiło się dzięki synchronizacji ustawień, widnieje więc na liście, ale nosi oznaczenie **zaloguj się**, a pod nim znajduje się wskazówka, co zrobić. Dopóki na tym urządzeniu żadne konto nie jest zalogowane, kalendarz wyjaśnia to w tym miejscu zamiast po prostu pozostawać pusty, a **Zaloguj się na tym urządzeniu** prowadzi do kont. Zalogowane konta pokazują **aktywne**. Jeśli logowanie później wygaśnie lub zostanie odwołane, w wierszu widnieje **logowanie wygasło** wraz z powodem — a **Zaloguj się ponownie** przywraca je do działania bez usuwania konta: to samo konto, te same kalendarze.

**Jedno logowanie dla wszystkich usług — także tutaj.** Jeśli konto Microsoft lub Google obejmuje kilka usług (na przykład pliki i kalendarz), ekran **Konta w chmurze** oferuje ich scalenie w jedno logowanie. Potem jedno logowanie utrzymuje przy życiu każdą usługę zamiast tylko jednej — wcześniej jedna usługa mogła działać dalej, podczas gdy inna tego samego konta po cichu wygasła. Skrzynka Gmail pozostaje poza tym: działa przez IMAP z hasłem aplikacji i nie wymaga zgody.

## Poczta e-mail

W **Ustawieniach → Poczta e-mail** połączysz **skrzynkę Microsoft** (Outlook.com, Microsoft 365) bezpośrednio przez logowanie w przeglądarce — bez hasła aplikacji. Tak jak przy kalendarzu, logowanie obowiązuje osobno na każdym urządzeniu.

Potem otworzysz **Pocztę e-mail** jako osobny obszar przez ▾ przy tytule i umieścisz ją w pasku nawigacji. Wiersz pod tytułem pokazuje folder, liczbę nieprzeczytanych i konto oraz otwiera wybór folderów. Dotknij wiadomości, aby ją przeczytać; **Zapisz jako notatkę** umieści ją w folderze **Mail** Twojego sejfu (dwukrotne zapisanie otworzy tę samą notatkę). Zdalne obrazy pozostają zablokowane, dopóki ich nie zezwolisz dla tej wiadomości — wczytany obraz zdradza nadawcy, kiedy i gdzie czytałeś.

**Skrzynki IMAP działają też na telefonie.** Dodaj jedną w **Ustawieniach → Poczta e-mail**: wybierz dostawcę, wpisz adres i hasło aplikacji, a Plainva uzupełni serwery. Jeśli Twojego dostawcy nie ma na liście, przycisk **Zaawansowane** pozwoli Ci samodzielnie wpisać serwery IMAP i SMTP, porty oraz inną nazwę użytkownika, a istniejące konto można później edytować. Wybór kilku wiadomości działa przez przytrzymanie jednej z nich; potem kolejne dodaje zwykłe dotknięcie. W widoku konwersacji przytrzymanie lub dotknięcie wiersza konwersacji wybiera całą wymianę — a każda wiadomość zachowuje własny folder, więc odpowiedź z folderu **Wysłane** zostanie oznaczona właśnie tam.

Otwarta wiadomość oferuje **Odpowiedz**, **Odpowiedz wszystkim** i **Przekaż dalej**. Odpowiedź cytuje oryginał pod Twoim tekstem; „Odpowiedz wszystkim” dodatkowo uwzględnia pozostałych odbiorców i pomija Twój własny adres. Podczas **redagowania** przycisk **Załącz plik** dodaje plik z sejfu — na telefonie sejf jest magazynem, do którego masz dostęp, a wszystko, co trafia na urządzenie (zapisany załącznik, wstawione zdjęcie), już się w nim znajduje. Każdy załącznik dostaje własny wiersz z przyciskiem **Usuń załącznik**, dopóki wiadomość nie zostanie wysłana.

Rozpoczętej wiadomości nie musisz wysyłać: **Zapisz roboczą** umieści ją w folderze roboczych Twojego konta — tam, gdzie znajdzie ją każdy program pocztowy działający na tej skrzynce, a nie w miejscu dostępnym tylko na telefonie. Który to folder, mówi serwer; dopiero gdy milczy, nazwa jest zgadywana. Na liście, obok wiersza folderu, znajdują się dwa przełączniki: **Nieprzeczytane** zawęża to, co jest aktualnie wczytane (dzięki temu licznik i **Wczytaj więcej** pozostają dostępne), natomiast **Oznaczone** pyta serwer o wszystkie oznaczone wiadomości w folderze — łącznie z tymi daleko poniżej wczytanej strony. W widoku **Wszystkie skrzynki odbiorcze** przełącznik oznaczonych celowo nie występuje: to zapytanie dotyczy dokładnie jednej skrzynki.

Z otwartej wiadomości do sejfu prowadzą trzy drogi: **Zapisz jako notatkę**, **→ Zadanie** w menu ⋮ (tworzy wpis w Twojej domyślnej bazie zadań — z jej szablonem, statusem i datą wiadomości) oraz **+ .eml**, co dodatkowo zachowuje oryginalną wiadomość i odsyła do niej z poziomu notatki. Wszystkie trzy są zakotwiczone: przechwycenie tej samej wiadomości dwa razy otwiera to, co już istnieje. **Usuń** znajduje się teraz również w menu ⋮ zamiast obok strzałki wstecz; na liście wystarczy przesunięcie. Przeniesienie do kosza oferuje **Cofnij**, ponieważ można to odwrócić — trwałe usunięcie z kosza nadal pyta o potwierdzenie, ponieważ tego cofnąć się nie da. A zamiast kilku komunikatów ułożonych jeden na drugim jest teraz **jedna** linia: błąd, w przeciwnym razie niedostępne konta (od dwóch, jako liczba), w przeciwnym razie informacja o zapisanej kopii.

Notatkę możesz wysłać z jej własnego menu ⋮: **Wyślij notatkę e-mailem (mailto)** przekazuje ją do aplikacji pocztowej telefonu — Plainva nie potrzebuje do tego własnego konta — a **Wyślij e-mailem** otwiera własny edytor wiadomości Plainva z tematem i treścią.

## Synchronizacja

W **Ustawieniach** (⋮) **Aktywny vault** prowadzi do zarządzania vaultami; tam łączysz się z magazynem w chmurze (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Połącz sejf w chmurze** pobiera na urządzenie istniejący sejf w chmurze; **Utwórz vault** pyta najpierw **Na tym urządzeniu** czy **W usłudze online**, a potem o strukturę początkową (pustą lub szablon, np. PARA) — przy ścieżce online następuje połączenie, docelowy folder w chmurze można od razu utworzyć przez **Nowy folder** w arkuszu wyboru, a struktura zostaje przesłana podczas pierwszej synchronizacji. Ten sam wybór między istniejącym a nowym sejfem w chmurze oferuje też pierwsze uruchomienie („Połącz sejf w chmurze”). Każde połączenie otrzymuje własny, osobny sejf na urządzeniu. Strona sejfu pokazuje status, postęp, oczekujące transfery i oferuje **Eksportuj sejf** (ZIP przez arkusz udostępniania).

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

## Sieć bezpieczeństwa

Migawki (historia wersji), dziennik wersji roboczych (po awarii notatka oferuje Twój ostatni niezapisany stan) oraz kopie konfliktów z widokiem porównania chronią Twoje dane. Przechowywanie konfigurujesz w **Ustawieniach** → **Backup i historia wersji**.

## Udostępnianie i skróty

Na Androidzie i iOS udostępniony tekst i adresy URL stają się nową notatką w folderze skrzynki; obrazy i pliki są importowane jako załączniki (do 25 MB na plik). Na Androidzie przytrzymaj ikonę aplikacji, aby użyć dodatkowych skrótów **Nowa notatka** i **Dzisiaj**. Strona vaulta pozwala włączyć **Synchronizuj ustawienia** oraz bezpiecznie odblokować lub zablokować zaszyfrowany vault hasłem.

## Foldery, zdjęcia i kalendarz

Pływający przycisk **Plus** pozostaje dostępny w zagnieżdżonych folderach, a każda akcja tworzy w otwartym folderze. W nagłówku **menu z trzema kropkami** otwiera ustawienia; nowe foldery tworzy się przyciskiem **Plus**.

Przycisk zdjęcia oferuje **Zrób zdjęcie** lub **Wybierz z biblioteki**, zachowuje pozycję wstawiania i pokazuje błędy uprawnień lub pliku. Zdjęcia trafiają do folderu załączników sejfu — tego samego, którego używa Twój komputer.

**Kalendarz** otwiera bezpośrednio kalendarz połączonego dostawcy. Notatki dzienne pozostają w **Dzisiaj**; dawny lokalny widok miesiąca usunięto bez zmiany istniejących danych.
