# Bazy danych (.base)

Stan na: 2026-08-19

Dzięki plikom `.base` zamieniasz notatki w bazy danych: tabele, tablice, kalendarze — z filtrami, typowanymi właściwościami i relacjami między bazami danych. Koncepcja przypomina bazy danych Notion, z jedną decydującą różnicą: **dane nie znajdują się w bazie danych, lecz w Twoich notatkach.**

> **Wskazówka:** Jeśli utworzysz nowy vault z szablonu **PARA**, **GTD**, **Zettelkasten** lub **Journal** (patrz [Pierwsze kroki](Getting_Started.md)), pasujące bazy danych są już przygotowane i powiązane ze sobą — to dobry punkt wyjścia, aby zobaczyć, jak wszystko do siebie pasuje.

## Koncepcja podstawowa

Plik `.base` przechowuje wyłącznie *widok* na Twoje notatki: jakie źródła (foldery, tagi), jakie widoki, jakie filtry i kolumny. Rzeczywiste wartości znajdują się we frontmatter poszczególnych notatek Markdown — każdy wiersz tabeli *jest* notatką.

Konkretnie oznacza to:

- Edytujesz komórkę w tabeli, a Plainva zapisuje wartość we frontmatter notatki.
- Usuwasz plik `.base` i tracisz tylko widok — wszystkie dane pozostają w notatkach.
- Te same notatki mogą pojawiać się jednocześnie w dowolnej liczbie baz danych.

Format pliku jest zgodny z formatem Bases Obsidian (szczegóły na końcu strony).

## Tworzenie bazy danych

- **Drzewo plików**: kliknij prawym przyciskiem → **Nowa baza danych (.base)** — lub przez przycisk **Nowy** paska bocznego (**Nowa baza**).
- Kreator **Nowa baza danych** pyta o dwie rzeczy: **źródło danych** (co najmniej jeden **folder** lub jeden **tag**; łączenie ich zawęża wynik — licznik na żywo pokazuje, ile notatek pasuje) oraz kolumny (właściwości znalezione w pasujących notatkach, gotowe do przejęcia). Następnie **Utwórz bazę danych**.
- **Wewnątrz notatki**: polecenie slash **Osadź bazę danych** (pokaż istniejącą `.base` inline) lub **Utwórz osadzoną bazę danych** (utwórz nową `.base` w folderze i osadź ją).

Każda baza danych może mieć własną ikonę z **kolorem ikony bazy danych** — widoczną w drzewie plików, kartach i nagłówku.

Baza danych może też służyć jako **Domyślna baza zadań** vaultu (**Ustawienia → Vault → Treść i struktura**): [widok Zadania](Tasks.md) pokazuje wtedy jej wpisy jako osobną sekcję i może przenosić do niej pola wyboru z notatek.

## Widoki

Baza danych może mieć dowolną liczbę widoków; każdy ma **typ widoku**:

| Widok | Do czego służy |
|---|---|
| **Tabela** | Klasyczna siatka, sortowalna, z edycją inline i opcjonalnymi elementami podrzędnymi |
| **Lista** | Kompaktowa lista wierszy |
| **Galeria** | Karty z opcjonalną **okładką** |
| **Tablica** | Kolumny kanban zgrupowane według właściwości (**Grupuj według**) — przeciąganie kart między kolumnami zmienia wartość; przeciągnięcie **nagłówka kolumny** zmienia kolejność kolumn |
| **Kalendarz** | Wpisy według **pola daty** w widoku **Miesiąc**, **Tydzień** lub **Dzień**, przeciągalne |
| **Oś czasu** | Oś czasu z **datą początkową** i opcjonalną **datą końcową** |
| **Tablica korkowa** | Tablica karteczek samoprzylepnych w stylu Google Keep — karty pokazują wyrenderowaną treść notatki (osobna sekcja poniżej) |

**Dodaj widok** tworzy kolejne; **Opcje widoku** oferują **Zmień nazwę**, **Duplikuj**, **Usuń** oraz zmianę kolejności przez przeciąganie. Plainva zapamiętuje ostatnio aktywny widok dla każdego pliku. Kalendarz i Oś czasu wymagają pola daty (**Tylko data** lub **Data i godzina** jako **Format**); wpisy pokazują pola włączone w **Właściwościach**.

## Konfiguracja: karty dla widoku, kolumn, filtra, sortowania, źródła danych

Przycisk **Konfiguruj** (w prawym górnym rogu) otwiera panel **obok** aktywnego widoku, dzięki czemu każda zmiana od razu widać w tabeli lub na tablicy. **Karty** u góry pozwalają wybrać jeden obszar — zawsze widoczny jest tylko jeden, zamiast długiej listy. Mały znacznik pokazuje przy każdym obszarze, czy jest to **Ten widok**, czy **Cała baza**:

- **Widok** — **typ widoku** jako wybór kafelków z ikonami (Tabela, Lista, Karta, Tablica, Galeria, Kalendarz, Oś czasu, Tablica korkowa) wraz z opcjami właściwymi dla danego typu: grupowanie i kolor kolumn tablicy, pole daty dla kalendarza/osi czasu, okładka galerii, elementy podrzędne, format daty. Te selektory pokazują wyłącznie właściwości **pasującego typu**: **pole daty** tylko właściwości dat, **Grupuj według** tylko właściwości Wybór/Status/Wielokrotny wybór/Relacja, **okładka** tylko właściwości Tekst/URL. Dla typu widoku **Graf** karta **Właściwości** jest wyłączona — graf nie pokazuje żadnych kolumn właściwości (kolor, rozmiar i krawędzie ustawia się we własnym pasku narzędzi).
- **Kolumny** — właściwości widoku, podzielone na **Widoczne** i **Ukryte**. Kliknij ikonę oka, aby pokazać lub ukryć kolumnę; przeciągnij uchwyt, aby zmienić kolejność. Każdy wiersz pokazuje odznakę typu pola, ikona koła zębatego otwiera edytor kolumny, **Nowa właściwość** dodaje kolejną.
- **Filtr** — każda reguła wyświetla się jako czytelne zdanie w formie **chipu** (np. „Status nie jest Ukończone”); kliknięcie rozwija edytor (właściwość, operator, wartość). Operatory dostosowują się do typu pola: **jest** / **nie jest** / **zawiera** / **nie zawiera** / **jest puste** / **nie jest puste**, dla liczb **większe niż** / **mniejsze niż** / **co najmniej** / **co najwyżej**, dla dat **po** / **przed** / **od** / **do**. **Logika** na górze decyduje, czy muszą pasować **Wszystkie** warunki (AND), czy **Dowolny** (OR). **Dodaj grupę** buduje grupy filtrów w stylu Notion: ramkę z własną logiką AND/OR wewnątrz logiki głównej. Głęboko zagnieżdżone filtry z Obsidian pojawiają się jako **Filtr złożony (bez możliwości edycji)** — są zachowywane i stosowane. Filtry są zapisywane **osobno dla każdego widoku**; wszystko znajduje się w pliku `.base`, a nie w osobnym magazynie danych.
- **Sortowanie** — wiele reguł sortowania (**Rosnąco**/**Malejąco**); priorytet zmieniasz przez przeciąganie.
- **Źródło danych** — źródła folderów i tagów bazy danych (można też wybrać **Folder główny**). Brak źródła = wszystkie pliki. Dotyczy całej bazy danych, nie tylko aktywnego widoku.

Na telefonie **Konfiguruj** otwiera te same obszary jako listę; dotknięcie jednego z nich wchodzi w odpowiedni obszar szczegółów, a strzałka wstecz z niego wychodzi.

## Właściwości i typy pól

Kliknięcie nagłówka kolumny otwiera edytor właściwości (**Właściwość: X**):

- **Nazwa** — zmiana nazwy wpływa na notatki: po zapisaniu właściwość jest zmieniana we frontmatter każdej pasującej notatki (z potwierdzeniem i wskaźnikiem postępu).
- **Typ pola** — Tekst, Liczba, Pole wyboru, Data, Data i godzina, Lista, Tagi, Wybór, Status, Wielokrotny wybór, URL, E-mail, Telefon, Relacja (to samo pogrupowane menu typów co w panelu **Właściwości** notatek).
- **Opcje** (dla Wybór/Status/Wielokrotny wybór) — stałe wartości z **kolorem** i, dla **Status**, **grupą**/etapem (np. do zrobienia → w toku → gotowe); zmiana kolejności przez przeciąganie. Po otwarciu edytora kolumny lista opcji jest już wypełniona wartościami używanymi w bazie danych, dzięki czemu możesz nadać każdej z nich kolor bez konieczności wpisywania jej od nowa.
- **Usuń właściwość** — usuwa kolumnę, schemat, filtry i reguły sortowania z bazy danych. Checkbox **Usuń również z frontmatter notatek** (domyślnie włączony) dodatkowo czyści notatki źródłowe.

Uwagi dotyczące zachowania:

- Jeśli właściwości brakuje w niektórych notatkach, Plainva oferuje **dodanie jej (pustej) do N plików źródłowych**.
- Dla **Wybór**, **Status**, **Wielokrotny wybór**, **Lista** i **Tagi** przecinek w wartości oddziela wiele wpisów; w typie **Tekst** przecinek pozostaje zwykłym tekstem.
- Pola systemowe OKF `type` i `okf_version` są tu również chronione: nazwa, typ pola i usuwanie są zablokowane, a komórki `okf_version` są tylko do odczytu (kontekst: [OKF](OKF.md)).

## Relacje

Relacje łączą notatki ze sobą — jak w Notion, ale zapisywane jako zupełnie zwykłe `[[linki wiki]]` we frontmatter (widoczne w Obsidian jako klikalne linki właściwości).

- **Tworzenie**: dodaj właściwość typu pola **Relacja**. Opcjonalnie wybierz **docelową bazę danych (.base)** — wtedy wybór podpowiada tylko notatki z tej bazy danych (puste = **dowolna notatka**; **ta baza danych** włącza relacje do samej siebie). **Kardynalność** ogranicza do **dokładnie 1** lub pozwala na **brak ograniczeń**.
- **Ustawianie wartości**: wybór przeszukuje notatki, wyklucza bieżący wpis i może utworzyć cel w locie przez **Utwórz nową notatkę**. Chip „Powiązana notatka nie istnieje” oznacza zerwany link (cel usunięty/zmieniona nazwa poza Plainva).
- **Relacja odwrotna**: opcja **Pokaż w „X”** tworzy w docelowej bazie danych obliczaną kolumnę pokazującą linki w drugą stronę — jest bezpośrednio edytowalna (edycje zapisują się w linkujących notatkach). Usunięcie relacji usuwa też jej kolumnę odwrotną.
- **Elementy podrzędne**: dla relacji do samej siebie można **Włączyć elementy podrzędne** — wpisy z relacją do rodzica pojawiają się w tabeli jako rozwijane pod wpisem nadrzędnym (cykle są obsługiwane; po wyłączeniu lista pozostaje płaska, a wartości są zachowane).
- **Tablica według relacji**: tablice mogą grupować według relacji; przeciąganie kart między kolumnami przepisuje link.
- **Filtrowanie na relacjach**: zawiera / nie zawiera / jest puste / nie jest puste, z wyborem notatki.
- Linki zwrotne też się liczą: linki frontmatter pojawiają się w panelu **Linki zwrotne**, a zmiana nazwy pliku automatycznie aktualizuje linki relacji.

## Agregacje

**Agregacja** oblicza wartość na podstawie notatek, do których wskazuje link — „ile zadań tego projektu jest jeszcze otwartych”, „ile pracy w sumie w to włożono”, „kiedy przypada termin ostatniego z nich”.

- **Tworzenie**: nowa właściwość typu pola **Agregacja**. Wybierasz trzy rzeczy: **link**, przez który ma być liczone (relację lub relację odwrotną tej bazy danych), **właściwość** połączonych notatek oraz **obliczenie**. **Liczba z warunkiem** i **Procent z warunkiem** dodają **warunek** — z tymi samymi operatorami co filtry.
- **Obliczenia**: liczba · liczba z warunkiem · procent z warunkiem · suma · średnia · mediana · najmniejsza i największa wartość · najwcześniejsza i najpóźniejsza data · zaznaczone i niezaznaczone · z wartością i bez wartości · różne wartości.
- **Podgląd**: podczas konfigurowania edytor pokazuje wartości, jakie wynikałyby z tego dla pierwszych wpisów. Przebiegają tą samą ścieżką co gotowa kolumna, więc podgląd nie może pokazać niczego innego niż to, co pokaże tabela.
- **Wartość nigdy nie jest zapisywana.** Jest obliczana na nowo za każdym razem, gdy jest wyświetlana — tak jak relacja odwrotna. Żadna notatka nie zawiera „12 otwartych zadań”, więc żadna synchronizacja nie może wlec za sobą nieaktualnej liczby, a żadne urządzenie nie może twierdzić czegoś innego. Komórka jest więc **nieedytowalna**: to, co chcesz zmienić, zmieniasz w połączonych notatkach.
- **Nic do zmierzenia nie oznacza zera**: suma bez ani jednej wartości liczbowej pozostaje pusta, zamiast wskazywać 0. **Liczba**, przeciwnie, liczy notatki — projekt bez zadań ma uczciwie 0.
- **W Obsidian** kolumna pozostaje pusta: Obsidian nie zna agregacji i pokazuje bazę danych jako tabelę bez tych wartości. Plik pozostaje prawidłowy, nic nie ginie.
- **Ograniczenie**: agregacja nie liczy na podstawie innej agregacji. Jeśli wybrany link wskazuje na obliczoną kolumnę, nowa kolumna pozostaje pusta.

## Stopki kolumny

Pod kolumną tabeli może stać wiersz, który ją podsumowuje — **Suma** nakładu pracy, **Najwcześniejsza** data albo liczba wierszy mających w ogóle jakąś wartość.

- **Ustawianie**: w **Konfiguruj → Kolumny** wybierz **Stopkę kolumny** obok kolumny. **Bez stopki kolumny** usuwa ją ponownie.
- **Obliczenia**: Średnia · Min · Maks · Suma · Rozstęp · Mediana · Odch. std. · Najwcześniejsza · Najpóźniejsza · Zaznaczone · Niezaznaczone · Bez wartości · Z wartością · Różne.
- **Stopka liczy po wierszach, które pokazuje widok** — a nie po całym vaulcie. Filtr zmienia więc też liczbę poniżej.
- **Nic do zmierzenia nie oznacza zera**: kolumna bez choćby jednej użytecznej wartości zostawia swoją stopkę pustą, zamiast wskazywać 0. Kolumna bez własnej stopki pozostaje pusta i nigdy nie pożycza liczby sąsiedniej kolumny.
- **Widoczne w Obsidianie**: stopki kolumn to funkcja samego Obsidiana, a nie dodatek Plainvy. To, co ustawisz tutaj, zobaczysz tam — i odwrotnie. Własne wyrażenia formuł napisane w Obsidianie zostają zachowane w pliku; Plainva po prostu nie pokazuje dla nich żadnej wartości.

## Planowanie projektów: kamienie milowe, zależności, nakład

Widok osi czasu zamienia bazę w plan. Niosą to cztery rzeczy i wszystkie mieszkają w notatkach, a nie w pliku `.base`:

- **Kamień milowy** to wpis z datą i **bez końca**. Oś czasu rysuje go jako romb zamiast paska — moment, nie okres. Nie ma czego włączać: zostaw właściwość końca pustą.
- **Zależności** mówią „to nie może się zacząć, dopóki tamto nie jest skończone". Właściwość nazywa się `blockedBy`, a jej kształt jest zgodny z **RFC 9253** — tym samym słownictwem, które zapisuje już wtyczka TaskNotes:

```yaml
blockedBy:
  - uid: "[[Projects/Rollout]]"
    reltype: FINISHTOSTART
    gap: P1D
```

  Zapisywany jest tylko **jeden** kierunek: zapisana para to dwa fakty, które mogą sobie przeczyć. Oceniany i rysowany jest wyłącznie `FINISHTOSTART`; pozostałe typy pozostają w pliku nietknięte. Cykl jest odrzucany przy zapisie, ze wskazaniem ścieżki, którą by zamknął.
- **Konflikt jest zgłaszany, nigdy poprawiany.** Jeśli zadanie zaczyna się przed zakończeniem tego, na które czeka, strzałka robi się czerwona i taka zostaje. Daty są Twoim stwierdzeniem — Plainva mówi tylko, że dwie z nich do siebie nie pasują.
- **Nakład** to zwykła liczba minut we właściwości wedle Twojego wyboru (szablon **Projekt** nazywa ją `effort`). Stopka kolumny go sumuje; podsumowanie zlicza go po zadaniach projektu.
- **Czas rzeczywisty** *nie* jest zapisywany. Odczytuje się go z wydarzeń, które zadanie zablokowało, więc pozostaje poprawny, gdy przesuniesz lub wydłużysz wydarzenie. Bez konta kalendarza kolumna pokazuje myślnik zamiast zera: „nie zmierzono" i „zmierzono i było zero" to różne stwierdzenia.

## Do czego należy ta notatka? (kontekst bazy danych)

Gdy otwierasz wpis bazy danych bezpośrednio — z drzewa plików, z wyszukiwania lub przez `[[link]]` — Plainva mówi Ci teraz, czego jest częścią:

- Nad notatką znajduje się **wiersz kontekstu**: bazy danych, do których należy notatka, jako klikalne chipy (kliknięcie otwiera bazę danych), a po nich ścieżka `element nadrzędny / ta notatka`, gdy baza danych korzysta z elementów podrzędnych. Jeśli notatka należy do **kilku** baz danych, pojawiają się wszystkie — wiersz zawija się, zamiast pomijać którąś z nich.
- W prawym pasku bocznym sekcja **Bazy danych** jest **inspektorem wpisu**: pokazuje notatkę tak, jak widzi ją jej baza danych — kolumny pierwszego widoku, w kolejności tego widoku, z typami i kolorami opcji z `.base`, i **edytowalne** tak samo jak w tabeli. Dzięki temu status można zmienić bez otwierania bazy danych. Nad nimi znajduje się pozycja w widoku (**12 / 34**) ze strzałkami do poprzedniego i następnego wpisu. Notatka należąca do kilku baz danych dostaje osobny blok dla każdej z nich. Poniżej następują **element nadrzędny**, **elementy podrzędne** (rozwijane) oraz wpisy **powiązane** przez relacje — każdy klikalny.
- Pozycja pojawia się tylko wtedy, gdy notatka rzeczywiście **jest** w widoku: przynależność do bazy danych celowo nie zależy od filtrów widoku, więc obie te rzeczy mogą się zasadnie różnić.
- Panel **Właściwości** pozostaje przy tym przydatny: pokazuje surowy frontmatter — każde pole, bez kolejności, typów i filtrów bazy danych.
- Jeśli notatka nie należy do żadnej bazy danych, nie pojawia się ani wiersz, ani sekcja. Nic z tego nie jest zapisywane w notatce: kontekst jest obliczany na nowo przy każdym otwarciu na podstawie plików `.base` i Twoich linków, a sama notatka pozostaje zwykłym Markdownem.

## Tworzenie nowych wpisów

Przycisk **Wpis** w lewym górnym rogu (dawniej **Nowy**; wyraźnie oddzielony od globalnego przycisku **Nowy** paska bocznego) tworzy nowy element:

- Nazwa pliku podąża za wzorem `{nazwa bazy danych}_{numer kolejny}` (spacje zamieniają się na `_`); notatka zaczyna się od pasującego nagłówka i dziedziczy tagowe źródła oraz proste wartości filtrów bazy danych, dzięki czemu od razu pojawia się w widoku. Następnie otwiera się okno podglądu do wypełnienia.
- **Folder zapisu**: nowe elementy trafiają na stałe do wyznaczonego folderu. Jeśli baza danych nie ma źródła folderowego, dialog jednorazowo przeprowadzi Cię przez jego utworzenie; przy kilku źródłach folderowych wybierasz raz. Można to zmienić w każdej chwili przez menu strzałki przy przycisku → **Zmień folder zapisu…**.
- **Szablony**: menu strzałki (**Szablony i folder zapisu**) wyświetla szablony z folderu szablonów Twojego vaultu — użyj jednorazowo, ustaw gwiazdką **Jako domyślny** (wtedy każde kliknięcie **Wpis** dla tej bazy danych go użyje) lub **Utwórz nowy szablon** (nowy szablon zaczyna się od nagłówka `# {{title}}`, dzięki czemu wpisy utworzone na jego podstawie dziedziczą swoją nazwę pliku jako H1). To samo menu oferuje również **Otwórz folder szablonów**, które pokazuje folder szablonów w drzewie plików — szablony to zwykłe notatki, które możesz tam edytować, zmieniać ich nazwy lub usuwać.
- **Szablony dla poszczególnych baz danych**: szablony można przypisywać do baz danych. Domyślnie menu strzałki pokazuje tylko szablony przypisane do tej bazy danych (plus jej szablon domyślny); wszystkie pozostałe są dostępne przez **Pokaż wszystkie szablony (n)**. Przypisujesz bezpośrednio tam — ikona bazy danych przy każdym wierszu nosi napis **Przypisz do tej bazy danych** lub **Usuń przypisanie do tej bazy danych** — albo na samym szablonie: menu **⋮** edytora oferuje **Docelowe bazy danych…**, okno dialogowe z polem wyszukiwania, w którym przypisujesz szablon do dowolnej liczby baz danych. Szablon utworzony z bazy danych przez **Utwórz nowy szablon** od razu jest do niej przypisany. Przypisanie jest zapisywane jako lista `plainva.templateFor` we frontmatter szablonu (patrz [Dokumentacja formatu plików](File_Format_Reference.md)); nigdy nie jest kopiowane do wpisów tworzonych na podstawie szablonu, a zmiana nazwy pliku `.base` przenosi przypisania automatycznie. Polecenie slash **Wstaw szablon** celowo pozostaje nieprzefiltrowane — wstawia tekst do istniejącej notatki i nie ma kontekstu bazy danych.
- **Listy zadań**: jeśli baza danych jest bazą zadań i masz połączone konto kalendarza/zadań, **Konfiguruj → Źródło danych** pokazuje wiersz **Twórz też nowe zadania w**. Wybierz tam listę, a każde zadanie utworzone w Plainva zostanie utworzone też na tej liście u dostawcy — z **+ Nowe zadanie**, z przeniesionego pola wyboru i z e-maila przechwyconego jako zadanie, tak samo; bez wyboru pozostaje zwykłą notatką, dokładnie jak dotychczas. Wybór należy do bazy danych (zapisany jako `plainva.taskList`, patrz [Dokumentacja formatu plików](File_Format_Reference.md)), a nie do pojedynczego zadania, i wiersz pojawia się tylko wtedy, gdy konto rzeczywiście oferuje listę zadań. Jeśli wybrana lista później zniknie (konto usunięte, lista usunięta), Plainva nie tworzy zadania gdzie indziej — traktuje bazę danych tak, jakby nic nie zostało wybrane. Nowe zadanie zapamiętuje, jakiemu zadaniu u dostawcy odpowiada; bez tej notatki kolejna synchronizacja utworzyłaby drugą notatkę dla tego samego zadania. Jeśli utworzenie u dostawcy się nie powiedzie, notatka pozostaje, a Plainva o tym informuje — notatka jest rezultatem, zadanie u dostawcy zaś dodatkiem.
- **Symbole zastępcze szablonów**: szablony interpolują `{{title}}`, `{{date}}` i `{{time}}`. Kiedy *wstawiasz* szablon do notatki (polecenie slash **Wstaw szablon** / `Mod+Alt+T`), rozwiązywane są jeszcze dwa: `{{cursor}}` oznacza miejsce, w którym po wstawieniu znajdzie się kursor, a `{{prompt:Etykieta}}` prosi Cię o wartość (oznaczoną jako *Etykieta*) i wstawia Twoją odpowiedź. Utworzenie *nowej* notatki z szablonu działa od tego czasu tak samo: Plainva pyta o wszystkie wartości `{{prompt:…}}` naraz i ustawia kursor na `{{cursor}}`, gdy tylko notatka się otworzy. Tylko w tle (synchronizacja zadań, przechwytywanie e-maili) nic się nie pyta — tam odpowiedzi pozostają puste. Pełny wykaz symboli zastępczych zawiera [Notatki i Markdown](Notes_and_Markdown.md).
- **Zmiana nazwy, duplikowanie, usuwanie**: kliknięcie prawym przyciskiem na wpisie oferuje w każdym widoku (tabela, lista, karty, tablica, kalendarz, oś czasu) **Otwórz**, **Otwórz w podziale**, **Zmień nazwę…**, **Duplikuj** i **Usuń…** — usuwanie przechodzi przez znany dialog kaskadowy. Te same akcje są w menu ⋮ okna podglądu, a dwuklik na jego tytule też zmienia nazwę. Jeśli nagłówek wciąż odzwierciedla nazwę pliku (stan świeżego wpisu `{nazwa bazy}_{numer}`), zmienia się razem z nią; nagłówka napisanego przez Ciebie nic nie rusza.

## Tablica korkowa (karteczki samoprzylepne jak w Google Keep)

Typ widoku **Tablica korkowa** pokazuje notatki bazy danych jako karty z ich wyrenderowaną treścią — tablicę pełną karteczek samoprzylepnych. Karty renderują tekst, listy i klikalne pola wyboru (kliknięcie odhacza zadanie bezpośrednio w notatce), obrazy i formatowanie; tabele, formuły i osadzenia pojawiają się jako subtelne symbole zastępcze. Kliknięcie karty otwiera notatkę w oknie podglądu.

- **Szybkie tworzenie**: pole **Napisz notatkę…** nad tablicą rozwija się w małe wyskakujące okienko z polem **Tytuł** i wielowierszowym tekstem notatki — jak w Google Keep. Wpisany tytuł staje się nazwą pliku ORAZ pierwszym nagłówkiem notatki; bez tytułu plik otrzymuje nazwę ze znacznikiem czasu, a notatka nie ma nagłówka. Tekst w obu przypadkach jest treścią — bez szablonu, bez okrężnych dróg (Ctrl/Cmd+Enter zapisuje).
- **Przypinanie**: przycisk pinezki (w prawym górnym rogu po najechaniu na kartę) przenosi kartę do sekcji **Przypięte**.
- **Układanie**: przeciągnij karty, aby zmienić ich kolejność; kolejność jest zapisywana w pliku `.base` i synchronizowana razem z nim. Karty jeszcze nieuporządkowane (świeżo utworzone lub dodane spoza aplikacji) pojawiają się na górze, od najnowszych. Jeśli w **Konfiguruj** ustawiona jest reguła sortowania, ma ona pierwszeństwo — wtedy przeciąganie jest wyłączone.
- **Etykiety**: pasek chipów nad tablicą filtruje karty — domyślnie według tagów, z możliwością przełączenia na właściwość typu wielokrotny wybór (**Konfiguruj** → **Źródło etykiet**). Wiele chipów filtruje z logiką AND; wybór jest tymczasowy i nigdy nie jest zapisywany do pliku. Etykiety karty edytujesz przez **Etykiety** w menu kontekstowym karty.
- **Kolor**: menu kontekstowe zabarwia kartę. Kolorem jest kolor nagłówka notatki (`plainva.header_color`) — obowiązuje wszędzie tam, gdzie notatka się pojawia, także w nagłówku edytora.
- **Właściwości**: właściwości zaznaczone w **Konfiguruj** → **Właściwości** pojawiają się jako kompaktowe wiersze u dołu każdej karty — wartości dat są zgodne z formatem daty widoku, puste wartości są pomijane.
- **Telefon**: na telefonie dotknięcie otwiera notatkę, przytrzymanie pokazuje akcje (przypnij, etykiety, kolor, usuń), przeciąganie po przytrzymaniu zmienia kolejność. Wskazówka: skieruj bazę danych na folder skrzynki (**Ustawienia** → **Foldery**), a szybkie notatki z ＋ oraz teksty udostępnione z innych aplikacji trafią prosto na tablicę.

Uwaga dotycząca synchronizowanych vaultów: jeśli dwa urządzenia jednocześnie ułożą tablicę, może pojawić się kopia pliku `.base` z rozszerzeniem `.CONFLICT` — dotyczy to tylko układu, nigdy treści notatek; usuń lub scal kopię.

## Codzienne użytkowanie

- **Edycja inline**: pojedyncze kliknięcie w komórkę (lub na wartość karty) czyni ją edytowalną — w każdym widoku.
- **Otwieranie**: kliknięcie tytułu wpisu otwiera notatkę w oknie podglądu — swobodnie pływającym oknie, które można przeciągać za pasek tytułu i którego rozmiar można zmieniać, chwytając za róg. Zachowuje własną historię **Wstecz**/**Do przodu** dla notatek otwieranych w jego wnętrzu, ma przełącznik pokazujący kolumnę **Właściwości** dla wyświetlanej notatki oraz oferuje **Otwórz jako kartę** i **Otwórz w podziale**. `Ctrl`+klik otwiera bezpośrednio w podziale; alternatywnie przeciągnij kartę na strefę upuszczania **Upuść tutaj: otwórz w podziale**.
- **Przeciąganie**: podczas przeciągania kart (Tablica, Kalendarz, Oś czasu) karta-widmo podąża za kursorem. W **Tablicy** możesz też przeciągnąć **nagłówek kolumny**, aby zmienić kolejność kolumn — w tablicach **Wybór**/**Status** zmienia to kolejność opcji właściwości (dzięki czemu listy rozwijane wszędzie podążają za tą kolejnością); tablice relacji i wolnego tekstu zapamiętują kolejność dla każdego widoku.
- **Kolor kolumny**: w ustawieniach **Widoku** tablicy opcja **Kolor kolumny** pozwala kolumnie przejąć kolor swojej grupy — albo **Cała kolumna** (cała kolumna zostaje zabarwiona), albo **Tylko etykieta** (tylko etykieta w nagłówku, wartość domyślna). Dotyczy grup Wybór/Status/Wielokrotny wybór.
- **Osadzanie**: bazy danych można osadzać w notatkach (polecenie slash **Osadź bazę danych** lub `@` → **Bazy danych**) i obsługiwać je tam w pełni funkcjonalnie.
- **Automatyczny zakres wewnątrz powiązanego elementu**: gdy osadzisz bazę danych wewnątrz pojedynczego elementu *powiązanej* bazy danych, jest ona automatycznie filtrowana do tego elementu — osadź bazę danych zadań w notatce projektu, a zobaczysz tylko zadania tego projektu. Działa to w obu kierunkach (osadź stronę „wiele”, aby zobaczyć wiersze wskazujące na element główny, lub stronę „jeden”, aby zobaczyć, na co wskazuje element główny) oraz dla baz danych z relacjami do samych siebie i hierarchią nadrzędny/elementy podrzędne (osadzenie bazy danych wewnątrz elementu pokazuje zagnieżdżone elementy podrzędne tego elementu). Mały chip **Filtr** w nagłówku osadzonej bazy danych pokazuje, do czego jest ograniczony zakres; użyj go, aby zmienić relację lub wybrać **Pokaż wszystko**. Zakres nigdy nie jest zapisywany w pliku `.base`, dzięki czemu ta sama baza danych pokazuje właściwe wiersze w każdym elemencie, w którym jest osadzona.
- **Nowe wpisy dziedziczą powiązanie**: utworzenie wpisu przyciskiem **Wpis** wewnątrz takiego zakresowego osadzenia automatycznie łączy go z elementem głównym (zadanie utworzone w osadzonej liście zadań projektu od razu należy do tego projektu). W kierunku odwrotnym to element główny zostaje powiązany z nowym wpisem; już przypisana relacja jednowartościowa pozostaje nienaruszona.
- **Jawny filtr „Ta notatka” (jak „ta strona” w Notion)**: zamiast polegać na automatycznym zakresie, możesz uczynić go jawnym i trwałym. W **Konfiguruj → Filtr** dodaj regułę na właściwości relacji i wybierz wartość **Ta notatka**. Baza danych jest wtedy ograniczona do notatki, w której akurat jest osadzona — idealne dla **szablonów**: osadź bazę danych zadań w szablonie projektu, a każdy utworzony na jego podstawie projekt pokazuje własne zadania. Działa to dla dowolnej właściwości typu link wiki, nie tylko wykrytych relacji, a jawny filtr **Ta notatka** ma pierwszeństwo przed automatycznym zakresem. Ten filtr istnieje wyłącznie w Plainva (nie jest zapisywany w `.base` jako zwykły filtr), więc zarówno Obsidian, jak i samodzielne otwarcie pokazują wszystkie wiersze.

## Kilka wpisów naraz

Czasem zmiana nie dotyczy jednego wpisu, tylko dwunastu.

**Zaznaczanie (komputer)**: W **tabeli** i na **liście** przed każdym wierszem znajduje się pole wyboru. Pozostaje niewidoczne, dopóki nie jest potrzebne: pojawia się, gdy kursor znajdzie się nad wierszem, gdy dotrze do niego klawiatura, oraz przy każdym wierszu, gdy tylko coś zostanie zaznaczone. `Shift`+kliknięcie zaznacza zakres, pole wyboru w nagłówku zaznacza wszystko. Kliknięcie w **komórkę** nadal ją edytuje — zaznaczanie nie odbiera mu tego kliknięcia.

**Zaznaczanie (telefon)**: Przytrzymaj wiersz i wybierz **Zaznacz kilka** — to pierwsza pozycja w arkuszu. Od tej chwili dotknięcie zaznacza zamiast otwierać, dopóki nie wyczyścisz zaznaczenia.

Gdy coś jest zaznaczone, pasek narzędzi zastępuje belka, która pokazuje, ile wpisów jest zaznaczonych.

- **Usuń**: Zadawane jest JEDNO pytanie, nie dwanaście — i jest to to samo pytanie kaskadowe co przy usuwaniu pojedynczego elementu (patrz niżej). Na komputerze robi to też klawisz `Delete`; gdy piszesz w polu, klawisz należy do pola.
- **Ustaw wartość**: **Ustaw wartość…** pyta o właściwość, a następnie pokazuje edytor odpowiedni dla jej typu. Na telefonie są to dwa arkusze, a lista właściwości pokazuje **obecnie różne** tam, gdzie zaznaczone wpisy się różnią. Pusta wartość **usuwa** właściwość, dokładnie tak jak wyczyszczenie komórki.

Podczas działania widać postęp („7 z 24”) i można go przerwać — to, co już zostało zapisane, pozostaje i jest zgłaszane. Pojedynczy plik, który zawiedzie, nie kończy operacji: na końcu widać, ile zostało zmienionych, a ile nie. Jeśli zmiana dotyczy dużej części widoku, pojawia się to samo drugie pytanie co przy usuwaniu.

**Granica, celowo**: ustawianie działa dla właściwości z *jedną* wartością — tekst, liczba, pole wyboru, data, wybór, status, e-mail, telefon. **Nie** dla tagów, list, wielokrotnego wyboru i relacji: tam „ustaw wszystkie na X” oznaczałoby, że każda istniejąca wartość znika. To wymaga własnych operacji *dodaj* i *usuń*, które pojawią się później.

## Usuwanie z powiązaniami (usuwanie kaskadowe)

Gdy usuwasz coś, z czym powiązane są inne wpisy, Plainva pokazuje przegląd zamiast zwykłego pytania tak/nie:

- **Element z przypisanymi elementami** (np. projekt, na który wskazują zadania przez relację): okno dialogowe wymienia przypisane elementy — łącznie z ich własnymi elementami podrzędnymi — pogrupowane według bazy danych źródłowej, z pytaniem **Usuń też przypisane elementy**. Elementy **wspólne** (przypisane też do innego elementu) są domyślnie wykluczone i noszą odznakę w rodzaju „również ‘Kampania Q3’”.
- **Usuwanie całej bazy danych**: przy usuwaniu `.base` okno dialogowe pyta, czy razem z nią mają zniknąć również **wszystkie elementy** bazy danych (**Usuń też wszystkie elementy**). Elementy będące zarazem wierszami *innej* bazy danych są domyślnie wykluczone. Przeglądy folderów (`index.md`) i załączniki zawsze pozostają.
- **Powiązane bazy danych**: każda baza danych powiązana przez relację dostaje własną, wyraźnie nazwaną kartę z dwoma poziomami — najpierw tylko elementy **przypisane**, opcjonalnie **cała** baza danych (plik plus wszystkie elementy). Oba poziomy są domyślnie **wyłączone**: nic z powiązanej bazy danych nie zostaje usunięte bez Twojego wyraźnego zaznaczenia.

**Pokaż elementy** otwiera listę dla każdej grupy z polem wyboru przy każdym elemencie, dzięki czemu możesz zachować pojedyncze elementy. Czerwony przycisk liczy na żywo („Usuń 15 plików”). **Uporządkuj odwołania** (domyślnie włączone) usuwa z właściwości pozostałych notatek odwołania do usuniętych elementów; linki w treści notatki pozostają nietknięte. Po przekroczeniu znanego progu masowego usuwania pojawia się też drugie zabezpieczające potwierdzenie, a przy aktywnej synchronizacji usunięcie dociera również do chmury. Każdy usunięty plik zachowuje migawkę wersji — możliwą do przywrócenia przez **Przywróć usunięte pliki**. Jeśli usunięta zostanie baza danych ustawiona jako **Domyślna baza zadań**, Plainva resetuje to ustawienie i usuwa przypisania szablonów; zadania w Google/Microsoft pozostają nietknięte. Na telefonie ten sam przegląd pojawia się jako arkusz z zaznaczeniami grupowymi i licznikiem (bez odznaczania pojedynczych elementów).

## Przykład: jak wygląda plik .base

Pliki `.base` to YAML — oto prosta lista projektów:

```yaml
filters:
  and:
    - 'file.hasTag("projekt")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: otwarte
          color: teal
          group: Aktywne
        - value: gotowe
          color: gray
          group: Ukończone
views:
  - type: table
    name: Wszystkie projekty
  - type: table
    name: Tablica
    plainva:
      render: board
      groupBy: status
```

Wszystko specyficzne dla Plainva (kolory, renderowanie tablicy, relacje, folder zapisu) znajduje się pod kluczami `plainva:`.

## Bezpośrednia edycja plików .base (narzędzia i AI)

Plik `.base` to zwykły YAML, więc narzędzie, skrypt lub AI może go edytować bezpośrednio, bez przechodzenia przez ten interfejs. Trzy twarde zasady:

- **Notatka jest źródłem prawdy.** Wartości właściwości znajdują się we frontmatter notatek, nigdy w `.base`. Zmieniasz wartość, edytując notatkę, nie plik `.base`.
- **`.base` używa tylko czterech kluczy najwyższego poziomu Obsidian** (`filters`, `formulas`, `properties`, `views`). Dodanie innego klucza najwyższego poziomu sprawia, że Obsidian odrzuca cały plik.
- **Każdy widok potrzebuje niepustego stringa `name`, a `filters` niesie na każdym poziomie dokładnie jedno z `and` / `or` / `not`.**

Częsta pułapka: klucze w mapie `properties:` i w liście `order:` widoku są z przedrostkiem `note.` (np. `note.status`), ale te same klucze wewnątrz wyrażeń filtra i podkluczy `plainva` (jak `groupBy`) są gołe (`status`).

Pełny, dokładny kontrakt formatu — wszystkie klucze `plainva:`, serializacja wartości, dwustronna konfiguracja relacji — znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

## A co z Obsidian?

Format odpowiada formatowi Bases Obsidian; Plainva zapisuje swoje rozszerzenia wyłącznie w podkluczach `plainva:`, które Obsidian ignoruje („graceful degradation”):

- Obsidian otwiera plik bez błędów; widoki dostępne tylko w Plainva, jak Tablica/Kalendarz/Oś czasu, pojawiają się tam jako zwykła tabela.
- Kolumny relacji odwrotnej pojawiają się w Obsidian puste (są obliczane); wartości relacji w notatkach są tam widoczne jako klikalne linki.
- Przy pierwszym użyciu rozszerzenia Plainva dialog (**Rozszerzenie Plainva**) na to wskazuje; można go wyłączyć w **Ustawieniach** pod **Rozszerzone bazy danych** lub **Ostrzeżenia**.

## Zobacz też

- [Dokumentacja formatu plików](File_Format_Reference.md) — dokładny kontrakt `.base` na dysku dla narzędzi i ręcznej edycji
- [Notatki i Markdown](Notes_and_Markdown.md) — właściwości/frontmatter w szczegółach
- [OKF](OKF.md) — co w praktyce daje jednolity `type`

## Kalendarz bazy danych: miesiąc, tydzień, dzień

Widok kalendarza pokazuje trzy zakresy — **Miesiąc**, **Tydzień** i **Dzień**. Przełącznik znajduje się u góry obok **Dziś**; ◀ i ▶ zawsze przesuwają się o wyświetlany zakres. Zmiana zachowuje dzień, na który patrzysz: z **Miesiąca** na **Tydzień** zobaczysz tydzień, w którym ten dzień leży.

Jeśli kolumna daty niesie **godzinę**, pojawia się ona przed tytułem, a wpisy danego dnia są posortowane według zegara — wpisy bez godziny stoją poniżej. **Początek tygodnia** wynika z Twojego ustawienia w **Wyglądzie**, dokładnie jak w prawdziwym kalendarzu.

Jeśli widok ma też **datę końcową** (Konfiguruj → Widok), wpis obejmujący kilka dni rysowany jest jako **jeden pasek** nad swoimi dniami, a nie jako łańcuch identycznych kart. Tam, gdzie opuszcza tydzień, pasek jest ucinany przy krawędzi i kontynuowany bez powtarzania tytułu.

## Oś czasu: paski, krawędzie, kolor

Oś czasu pokazuje **jeden wiersz na wpis**, a w nim **pasek** od daty początkowej do końcowej. U góry przełączasz między **Tydzień**, **3 tygodnie** i **Kwartał**; pionowa linia oznacza **dziś** we wszystkich wierszach.

**Krawędzie paska są uchwytami.** Przeciągnij prawą krawędź, a Plainva zapisze w notatce **datę końcową**; lewa krawędź zapisuje **datę początkową**. Przeciągnij sam pasek, a obie daty przesuną się razem — jego długość pozostaje taka, jaka była. Dwóch rzeczy żaden gest nie wymusi: krawędź nigdy nie przechodzi za drugą (koniec przed początkiem byłby zepsutym zapisem), a bez skonfigurowanej **daty końcowej** żadna nie powstaje — wtedy porusza się tylko początek.

Pasek wychodzący poza pokazany zakres jest ucinany przy krawędzi i **nie ma tam uchwytu**: to, co widzisz, to krawędź okna, a nie koniec wpisu.

**Kolor według właściwości:** w Konfiguruj → Widok wybierz przy **Kolor według** właściwość typu wybór, status lub wielokrotny wybór. Paski przyjmą wtedy kolor swojej wartości — ten sam, który nosi jako chip i na tablicy. Bez tego wyboru wszystkie paski zachowują kolor akcentu.
