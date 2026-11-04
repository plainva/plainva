# Dokumentacja baz danych (.base)

Stan na: 2026-11-03

Ta strona wymienia wszystko, co może zawierać plik `.base`, oraz to, co Plainva robi z każdą z jego części: każdy klucz najwyższego poziomu, każdą formę filtra, każdy typ widoku z jego opcjami, podsumowania, sortowanie, ograniczenia, los kluczy nieznanych Plainvie i miejsca, w których Plainva zachowuje się inaczej niż Bases w Obsidian. Opisuje to, co kod Plainva dziś odczytuje, oblicza i zapisuje — a nie dokumentację Obsidian.

W codziennej pracy zacznij od [Bazy danych (.base)](Databases_Base.md). Zasady, których narzędzie musi przestrzegać, zapisując pliki vaultu bezpośrednio, oraz pełny przykład relacji znajdują się w [Dokumentacji formatu plików](File_Format_Reference.md).

## W skrócie

| Część pliku | Co robi Plainva |
|---|---|
| `filters` | Odczytuje i stosuje źródła (folder, tag) oraz warunki opisane w [Filtry](#filtry) |
| `views` | Odczytuje wszystkie osiem typów widoków, ich kolejność, sortowanie, filtry i podsumowania |
| `properties` | Odczytuje schemat kolumn, nazwę wyświetlaną i blok `plainva` Plainva |
| `summaries` (widok) | Oblicza czternaście wbudowanych podsumowań |
| `formulas` | Zachowuje je w pliku, nie oblicza |
| `summaries` (najwyższy poziom) | Zachowuje własne formuły podsumowań, nie oblicza |
| `this` | Jeszcze nieobsługiwane |
| Inne klucze | Zachowuje je w pliku (zob. [Klucze nieznane Plainvie](#klucze-nieznane-plainvie)) |

## Klucze najwyższego poziomu

Plik `.base` to YAML z następującymi kluczami najwyższego poziomu. Wszystkie są opcjonalne; plik bez `views` otwiera się z jedną tabelą.

| Klucz | Zawartość | W Plainva |
|---|---|---|
| `filters` | Które notatki należą do bazy danych (źródła) | Odczytywany i stosowany |
| `properties` | Jeden wpis na kolumnę, kluczem jest identyfikator właściwości | Odczytywany; dodatki Plainva znajdują się w jego bloku `plainva` |
| `views` | Lista widoków | Odczytywany; każdy widok wymaga `name` |
| `formulas` | Formuły Obsidian, `name: expression` | Zachowywany bez zmian, nieobliczany |
| `summaries` | Własne formuły podsumowań Obsidian | Zachowywany bez zmian, nieobliczany |

Plainva nigdy nie zapisuje innego klucza najwyższego poziomu: Obsidian odmawia otwarcia pliku `.base` z nieznanym kluczem. Klucz najwyższego poziomu `columns:`, zapisywany przez bardzo stare wersje Plainva, jest nadal odczytywany i przy następnym zapisie pliku przenoszony do `properties`.

## Właściwości (`properties`)

### Identyfikatory właściwości

Identyfikator właściwości nazywa kolumnę. Istnieją trzy rodzaje:

| Identyfikator | Oznacza | Przykład |
|---|---|---|
| `note.<key>` | Klucz frontmatter notatek | `note.status` |
| `file.<field>` | Informację o pliku (zob. [Pola pliku](#pola-pliku-file)) | `file.mtime` |
| `formula.<name>` | Formułę Obsidian z `formulas` | `formula.price_per_unit` |

Klucze `properties`, `order` widoku i `sort[].property` używają tych identyfikatorów. We wyrażeniu filtra i w bloku `plainva` klucz frontmatter zapisuje się bez przedrostka (`status`); wyrażenie filtra rozumie też `note.status`.

Gdy notatka zapisuje klucz inną wielkością liter niż kolumna (`Due` przy kolumnie `due`), Plainva nadal pokazuje wartość w tej kolumnie i zapisuje zmiany pod pisownią samej notatki.

### Nazwa wyświetlana

`properties.<id>.displayName` to etykieta kolumny w Obsidian. Plainva pokazuje ją jako nagłówek kolumny i zachowuje. Bez niej klucz frontmatter jest pokazywany z wielką pierwszą literą (tylko na ekranie); pola pliku mają własne nazwy, na przykład **Nazwa**, **Zmodyfikowano**, **Rozmiar**, **Ścieżka**, **Lista zadań** i **Dzień z nazwy pliku**.

### Blok `plainva` kolumny

Wszystko, co Plainva dodaje do kolumny, znajduje się pod `properties.<id>.plainva`. Obsidian to ignoruje.

| Klucz | Wartość | Znaczenie |
|---|---|---|
| `input` | typ pola (lista poniżej) | Typ pola kolumny |
| `ratingMax` | liczba od 1 do 10 | Ile znaczników ma ocena (domyślnie 5) |
| `ratingGlyph` | jeden znak | Znacznik rysowany przez ocenę (domyślnie kropka) |
| `options` | lista opcji | Stałe wartości dla wyboru, statusu i wielokrotnego wyboru |
| `relationBase` | ścieżka `.base` względem vaultu | Baza danych, na którą wskazuje relacja |
| `relationLimit` | `one` | Relacja zawiera dokładnie jeden link; brak oznacza brak ograniczenia |
| `reverseOf` | `{ base, property }` | Obliczana kolumna relacji odwrotnej |
| `rollup` | `{ through, of, fn, where }` | Obliczana kolumna agregacji (zob. [Agregacje](#agregacje)) |
| `previousKeys` | lista do 8 dawnych nazw | Pozwala komentarzom odnaleźć przemianowaną kolumnę |

### Typy pól (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Odczytywane są także dwie starsze pisownie: `multi-select` jako `multiselect` oraz `link` jako `relation`. Kolumna bez `input` — lub z wartością spoza tej listy — dostaje typ na podstawie wartości w notatkach: `true`/`false` to pole wyboru, liczba to liczba, lista `[[links]]` to relacja, `2026-07-03` to data, adres internetowy to URL i tak dalej. Kolumna relacji odwrotnej i kolumna agregacji nie mają `input`.

### Opcje i kolory

Opcja ma postać `{ value, label, color, group }`; wymagane jest tylko `value`. `color` to jedna z nazw palety `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — nieznana nazwa wraca do koloru wyprowadzonego z wartości. `group` jest używane tylko przez **Status**: opcje z tą samą grupą tworzą etap. Zwykły ciąg znaków jest odczytywany jako opcja o tej wartości.

### Agregacje

Kolumna agregacji oblicza wartość na podstawie notatek, na które wskazuje kolumna linków tej bazy danych. Wartość nie jest zapisywana w żadnym pliku.

- `through` — kolumna relacji lub relacji odwrotnej tej bazy danych.
- `of` — właściwość połączonych notatek; niepotrzebna dla `count`.
- `fn` — jedno z `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, wymagane przez `countWhere` i `percentWhere`; `op` to jedno z `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, a pusta `value` oznacza „jest puste”.

Agregacja, której brakuje wymaganej części lub która wskazuje funkcję spoza tej listy, jest ignorowana: kolumna pozostaje pusta, a baza danych nadal się otwiera. Agregacja przez inną kolumnę obliczaną też pozostaje pusta.

## Pola pliku (`file.*`)

Te wartości pochodzą z pliku, nie z jego frontmatter. Każdy wiersz bazy danych niesie następujące:

| Pole | Wartość |
|---|---|
| `file.name` | Właściwość `title` notatki, jeśli ją ma, w przeciwnym razie nazwa pliku bez `.md` |
| `file.path` | Ścieżka względem vaultu |
| `file.mtime` | Czas ostatniej modyfikacji, w milisekundach |
| `file.ctime` | Czas utworzenia, w milisekundach, o ile system plików go podaje |
| `file.size` | Rozmiar w bajtach |
| `file.tags` | Wszystkie tagi notatki, z frontmatter i z tekstu, każdy z `#`; wypełniane, gdy potrzebuje ich filtr, tablica korkowa lub widok, który pokazuje kolumnę albo według niej sortuje |
| `file.tasks` | Postęp listy zadań jako `done/total`; wypełniane dla tablic i dla widoku, który pokazuje kolumnę |
| `file.day` | Dzień, który oznacza nazwa pliku notatki dziennej, według folderu i formatu vaultu; tylko do odczytu i tylko pole daty kalendarza lub osi czasu może go użyć |
| `file.revision` | Wewnętrzny znacznik zmiany; nie polegaj na nim |

`file.folder` działa jako źródło (zob. [Źródła](#źródła)), ale nie jest kolumną. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` i `file.file` nie są dostarczane: kolumna z jednym z nich pozostaje pusta, a filtr odczytuje je jako puste.

## Filtry

### Gdzie znajdują się filtry

`filters` najwyższego poziomu zawiera **źródła** — które notatki należą do bazy danych. Każdy widok może mieć własne `filters` z warunkami zawężającymi tylko ten widok; to tam Plainva zapisuje warunki. Oba poziomy działają łącznie. Warunki, które plik trzyma na najwyższym poziomie, nadal działają; następny zapis w Plainva przenosi je do każdego widoku.

### Źródła

| Źródło | Wyrażenie |
|---|---|
| Folder | `file.folder == "Projects/Active"` — folder i wszystkie jego podfoldery; `""` i `"/"` to cały vault |
| Tag | `file.hasTag("project")` — notatka niesie dokładnie ten tag; początkowy `#` jest ignorowany |

Kilka źródeł łączy się przez `and` lub `or` jak każdy inny warunek. Baza danych bez źródeł zawiera każdą notatkę vaultu. Załączniki, zarezerwowane `index.md` i `log.md` oraz pliki lub foldery, których nazwa zaczyna się od kropki, nigdy nie są wierszami.

### Warunki

Warunek jest ciągiem znaków. Wartości stoją w podwójnych cudzysłowach; `\"` i `\\` oznaczają cudzysłów i ukośnik wsteczny. Właściwość zapisuje się bez przedrostka lub z `note.`.

| Warunek | Wyrażenie |
|---|---|
| jest | `status == "Done"` |
| nie jest | `status != "Done"` |
| zawiera | `contains(labels, "urgent")` lub `labels.contains("urgent")` |
| nie zawiera | `!contains(labels, "urgent")` lub `!labels.contains("urgent")` |
| większe niż, mniejsze niż | `effort > "3"`, `effort < "8"` |
| co najmniej, co najwyżej | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| jest puste | `status == ""` lub `status.isEmpty()` |
| nie jest puste | `status != ""` lub `!status.isEmpty()` |
| ma tag | `file.tags.contains("#work")`, zaprzeczane przez `!` |
| kolor nagłówka, ikona | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Jak porównywane są wartości

- **jest** i **nie jest** porównują tekst. Dla listy (tagi, wielokrotny wybór, relacja) **jest** oznacza „lista ma ten wpis”, a **nie jest** — „nie ma”. Notatka bez właściwości nigdy nie pasuje do **jest** i zawsze pasuje do **nie jest**.
- **zawiera** szuka tekstu wewnątrz wartości lub wewnątrz każdego wpisu listy. `labels.contains("x")` na liście wymaga wpisu dokładnie równego `x`; dla `file.tags` obie formy wymagają całego tagu, więc `#work` nie pasuje do `#workshop` ani `#work/child`.
- **większe niż**, **mniejsze niż**, **co najmniej**, **co najwyżej** porównują jako liczby, gdy obie strony są liczbami, w przeciwnym razie jako tekst — co ustawia daty ISO (`2026-07-03`) we właściwej kolejności. Notatka bez wartości nigdy do nich nie pasuje.
- **jest puste** pasuje do brakującej właściwości, pustej wartości i pustej listy.
- Pole wyboru porównuje się jako `"true"` lub `"false"`.

### `and`, `or`, `not`

Obiekt `filters` ma na każdym poziomie dokładnie jedno z `and`, `or` i `not`; jego wpisy to ciągi warunków lub dalsze obiekty filtrów.

| Klucz | Pasuje, gdy |
|---|---|
| `and` | pasuje każdy wpis |
| `or` | pasuje co najmniej jeden wpis |
| `not` | nie pasuje żaden wpis |

Plainva oblicza dowolną głębokość. Panel filtrów edytuje jeden poziom grup pod **Wszystkie** lub **Dowolny** (**Dodaj grupę**); głębsza struktura pojawia się jako **Filtr złożony (bez możliwości edycji)**, pozostaje w pliku i jest stosowana — warunek w niej, którego Plainva nie potrafi odczytać, jest wymieniony pod nią jako niezastosowany. Starszy plik z `and` i `or` obok siebie na jednym poziomie jest odczytywany jako „wszystkie z `and` i jedno z `or`” i przy następnym zapisie zapisywany w prawidłowej formie.

### Czego Plainva nie potrafi odczytać

Rozumiane są tylko formy z dwóch powyższych tabel. Wszystko inne — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, liczba bez cudzysłowów (`price > 2`), `&&` i `||` w jednym ciągu, arytmetyka, funkcje dat takie jak `now()` czy `this` — pozostaje w pliku i jest pokazywane w panelu filtrów tak, jak zapisano, z uwagą **Nie zastosowano: Plainva nie potrafi odczytać tego warunku, więc niczego nie filtruje.** Widok pokazuje wtedy więcej notatek niż ten sam filtr w Obsidian.

## Formuły

Plainva nie oblicza formuł Obsidian. `formulas` pozostaje w pliku bez zmian, a kolumna `formula.<name>` w `order` widoku jest pokazywana bez wartości. **Eksportuj tabelę** → **Formuły (.base)** zapisuje niektóre agregacje jako formuły, aby Obsidian mógł je obliczyć (zob. [Bazy danych](Databases_Base.md)).

## Widoki

### Klucze każdego widoku

| Klucz | Wartość | W Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | Typ widoku; zob. następna tabela |
| `name` | tekst | Wymagany; Plainva nadaje nazwę widokowi bez niej przy zapisie |
| `order` | lista identyfikatorów właściwości | Widoczne kolumny, w tej kolejności |
| `sort` | lista `{ property, direction }` | Reguły sortowania, `ASC` lub `DESC` |
| `filters` | obiekt filtra | Własne warunki widoku |
| `summaries` | mapa identyfikator właściwości → nazwa podsumowania | Stopka każdej kolumny |
| `plainva` | mapa | Opcje widoku Plainva, poniżej |

### Osiem typów widoków

Obsidian zna `table`, `list` i `cards`. Pozostałe typy widoków Plainva są zapisywane jako `type: table` plus `plainva.render`, więc Obsidian pokazuje je jako tabelę.

| Typ widoku | `type` na dysku | `plainva.render` |
|---|---|---|
| **Tabela** (`table`) | `table` | — |
| **Lista** (`list`) | `list` | — |
| **Galeria** (`gallery`) | `cards` | — |
| **Tablica** (`board`) | `table` | `board` |
| **Kalendarz** (`calendar`) | `table` | `calendar` |
| **Oś czasu** (`timeline`) | `table` | `timeline` |
| **Graf** (`graph`) | `table` | `graph` |
| **Tablica korkowa** (`pinboard`) | `table` | `pinboard` |

Tablica, Kalendarz, Oś czasu, Graf i Tablica korkowa są oferowane jako **Typ widoku** tylko wtedy, gdy włączone jest **Zezwól na rozszerzenia Plainva dla plików .base**. `type`, którego Plainva nie zna, jest pokazywany jako tabela i pozostaje w pliku tak, jak zapisano, dopóki nie wybierzesz innej wartości w polu **Typ widoku**.

### Opcje widoku (`views[i].plainva`)

Wewnątrz bloku `plainva` właściwość zapisuje się bez przedrostka (`status`), a nie jako `note.status`.

| Klucz | Typy widoków | Wartość |
|---|---|---|
| `render` | Tablica, Kalendarz, Oś czasu, Graf, Tablica korkowa | Typ widoku, zob. wyżej |
| `groupBy` | Tablica | Właściwość, z której powstają kolumny; bez niego właściwość własnego `groupBy` widoku z Obsidian |
| `boardLaneBy` | Tablica | Druga właściwość dla **Tory według** |
| `boardWipLimits` | Tablica | Mapa wartość kolumny → najwięcej kart (**Limit WIP**), liczby całkowite większe od 0 |
| `boardColorMode` | Tablica | `column` zabarwia całą kolumnę; brak = tylko chip w nagłówku |
| `boardColumnOrder` | Tablica | Ręczna kolejność kolumn; `__UNGROUPED__` to kolumna bez wartości |
| `colorBy` | Tablica, Oś czasu | Karty i paski przyjmują kolor opcji tej właściwości (**Kolor według**) |
| `dateField` | Kalendarz, Oś czasu | Data początkowa (**Pole daty**, **Data początkowa**); właściwość daty lub `file.day` |
| `endField` | Kalendarz, Oś czasu | **Data końcowa** |
| `coverImage` | Galeria | Właściwość zawierająca **Okładka** |
| `subItemsProperty` | Tabela | Relacja nadrzędna dla **Elementy podrzędne** |
| `widths` | Tabela | Mapa kolumna → szerokość w pikselach |
| `dateFormat` | wszystkie | `long`, `iso` lub `relative`; brak = domyślna krótka forma |
| `graphEdges` | Graf | Właściwości relacji rysowane jako krawędzie |
| `graphColorBy` | Graf | Właściwość wyboru lub statusu, która barwi węzły |
| `graphSizeBy` | Graf | Właściwość liczbowa, która określa rozmiar węzłów |
| `graphShowExternal` | Graf | `true` pokazuje także cele linków spoza widoku |
| `graphShowIncoming` | Graf | `true` pokazuje także linki przychodzące z innych baz danych |
| `pinboardOrder` | Tablica korkowa | Ścieżki nieprzypiętych kart w ręcznej kolejności |
| `pinboardPinned` | Tablica korkowa | Ścieżki przypiętych kart w kolejności |
| `pinboardFilterBy` | Tablica korkowa | **Źródło etykiet**: właściwość wielokrotnego wyboru; brak = tagi |

### Opcje dotyczące całego pliku (tylko pierwszy widok)

Te klucze należą do całej bazy danych. Plainva zapisuje je tylko w bloku `plainva` pierwszego widoku i odczytuje pierwszą prawidłową wartość każdego z nich.

| Klucz | Wartość |
|---|---|
| `fileIconColor` | Kolor szesnastkowy ikony bazy danych (**Kolor ikony bazy danych**) |
| `newItemFolder` | Folder, w którym **Wpis** zapisuje nowe wpisy |
| `newItemTemplate` | Szablon nowych wpisów |
| `contextFilters` | Właściwości, które ograniczają osadzoną bazę danych do notatki, w której jest osadzona (**Ta notatka**) |
| `taskList` | Konto i lista (`"<account id> <list id>"`), na której tworzone jest także nowe zadanie |

## Podsumowania

`views[i].summaries` przypisuje kolumnie jedną z tych nazw; stopka oblicza ją na podstawie wierszy, które pokazuje widok.

| Nazwa | W Plainva | Wynik |
|---|---|---|
| `Average` | **Średnia** | Średnia z liczb |
| `Min` | **Min** | Najmniejsza liczba |
| `Max` | **Maks** | Największa liczba |
| `Sum` | **Suma** | Suma liczb |
| `Range` | **Rozstęp** | Największa minus najmniejsza liczba; dla dat rozpiętość w dniach |
| `Median` | **Mediana** | Wartość środkowa liczb |
| `Stddev` | **Odch. std.** | Odchylenie standardowe wszystkich liczb (populacji) |
| `Earliest` | **Najwcześniejsza** | Najwcześniejsza data |
| `Latest` | **Najpóźniejsza** | Najpóźniejsza data |
| `Checked` | **Zaznaczone** | Wiersze, których wartość to `true` lub `yes` |
| `Unchecked` | **Niezaznaczone** | Wszystkie pozostałe wiersze |
| `Empty` | **Bez wartości** | Wiersze bez wartości |
| `Filled` | **Z wartością** | Wiersze z wartością |
| `Unique` | **Różne** | Liczba różnych wartości; wpisy listy liczą się pojedynczo |

Liczby są zaokrąglane do dwóch miejsc po przecinku, odczytywany jest też przecinek dziesiętny. Kolumna bez użytecznej wartości nie pokazuje stopki zamiast 0. Każda inna nazwa to własna formuła z `summaries` najwyższego poziomu: Plainva ją zachowuje i pokazuje **Własne: …** w menu, ale nie oblicza żadnej wartości.

## Sortowanie i grupowanie

- **Sortowanie** — `sort` to lista reguł; pierwsza reguła rozstrzyga najpierw, następna tylko między równymi wierszami. Liczby sortują się jako liczby, wszystko inne jako tekst (daty ISO we właściwej kolejności). Wiersze bez wartości trafiają na koniec w obu kierunkach. Bez reguły na początku są ostatnio zmienione notatki. Plainva odczytuje też `field` zamiast `property` oraz `asc`/`desc` w dowolnej wielkości liter.
- **Grupowanie** — tablica grupuje według `plainva.groupBy`, z torami według `plainva.boardLaneBy`. Widok, który zamiast tego ma własne `groupBy` z Obsidian, grupuje swoją tablicę według tej właściwości, a zmiana grupowania jest w nim zapisywana (jego `direction` pozostaje). Plainva nie grupuje według niego tabeli.

## Osadzanie bazy danych i `this`

`![[Projects.base]]` w notatce pokazuje bazę danych wewnątrz notatki, w widoku czytania i w edytorze. Część po `#` (nazwa widoku, jak w `![[Projects.base#Board]]`) jest ignorowana: osadzenie pokazuje widok ostatnio używany dla tej bazy danych. Blok kodu ` ```base ` w notatce jest pokazywany jako kod, a nie jako baza danych.

**`this` jest jeszcze nieobsługiwane.** Filtr lub formuła używające `this` pozostają w pliku, ale Plainva ich nie oblicza. Najczęstszy przypadek, „pokaż wpisy należące do tej notatki”, pokrywają dwie rzeczy: `contextFilters` (**Ta notatka** w panelu filtrów) ogranicza osadzoną bazę danych do notatki, w której jest osadzona, przez właściwość relacji, a osadzona baza danych powiązana z bazą danych notatki-gospodarza sama oferuje **Filtruj tę bazę do bieżącej notatki**. Obie działają tylko wewnątrz Plainva; Obsidian pokazuje wszystkie wiersze.

## Ograniczenia

- `limit` widoku z Obsidian jest zachowywany, ale nie stosowany: widok pokazuje wszystkie swoje wiersze.
- Panel filtrów edytuje jeden poziom grup filtrów; głębsze są stosowane, ale można je tam tylko usunąć.
- Wartość filtra musi stać w podwójnych cudzysłowach (zob. [Czego Plainva nie potrafi odczytać](#czego-plainva-nie-potrafi-odczytać)).
- Źródło folderowe zawsze obejmuje podfoldery.
- `ratingMax` jest rysowane od 1 do 10, `previousKeys` zachowuje co najwyżej 8 nazw, **Limit WIP** przyjmuje tylko liczby całkowite większe od 0, a `relationLimit` zna tylko `one`.
- Agregacja nie może obliczać na podstawie innej kolumny obliczanej.

## Klucze nieznane Plainvie

Plainva odczytuje `.base`, zmienia tylko to, co zostało zmienione w aplikacji, i zapisuje cały plik od nowa — jako YAML z końcami wierszy LF i bez BOM, więc komentarze i odstępy pliku pisanego ręcznie nie są zachowywane. Z tego, czego nie zna:

- **Zachowywane:** każdy inny klucz najwyższego poziomu, `formulas`, `summaries` najwyższego poziomu, `displayName` i każdy inny klucz wpisu `properties`, nieznane klucze w bloku `plainva` kolumny lub widoku, agregacja, której Plainva nie potrafi odczytać, klucze widoku, których Plainva nie używa (`limit`, `image`, …), typ widoku, którego nie zna, oraz warunki filtrów, których nie potrafi odczytać. Wartość, którą Plainva rozumie, ale której nie zmieniono, zachowuje zapis z pliku (`status` lub `note.status`, opcja zapisana zwykłym tekstem).
- **Przepisywane:** tylko własne stare formy Plainva — mapa `columns:` najwyższego poziomu przechodzi do `properties`, `and` i `or` obok siebie na jednym poziomie przyjmują prawidłową formę, a widok, który bardzo stare wersje zapisały jako `type: board`, staje się `type: table` z `plainva.render`.
- **Położenie:** klucze, które zachowuje widok, należą do tego widoku. Usunięcie lub przeniesienie widoku w Plainva zabiera je ze sobą, a **Duplikuj** kopiuje je do nowego widoku.

## Różnice względem Bases w Obsidian

| Temat | Obsidian | Plainva |
|---|---|---|
| Formuły, własne podsumowania | Obliczane | Zachowywane, nieobliczane |
| `this` | Obsługiwane | Jeszcze nieobsługiwane |
| Wyrażenia filtrów | Pełny język wyrażeń | Formy z [Warunki](#warunki) |
| `file.folder == "X"` | Tylko notatki bezpośrednio w `X` | `X` i wszystkie jego podfoldery |
| `file.hasTag("x")` | Także `#x/child` | Dokładnie `#x` |
| `file.name` | Nazwa pliku | Właściwość `title`, jeśli notatka ją ma |
| `limit`, `groupBy` widoku | Stosowane | `limit` zachowywane, niestosowane; `groupBy` grupuje tablicę, nie tabelę |
| Typy widoków | `table`, `list`, `cards` i typy wtyczek | Osiem typów; nieznany jest pokazywany jako tabela i zachowywany w pliku |
| `![[db.base#View]]` | Otwiera ten widok | Ostatnio używany widok |
| Blok kodu ` ```base ` | Baza danych | Blok kodu |
| Bloki `plainva` Plainva | Ignorowane | Tablica, kalendarz, oś czasu, graf, tablica korkowa, relacje, agregacje, typy pól |

## Zobacz też

- [Bazy danych (.base)](Databases_Base.md) — bazy danych w codziennym użyciu
- [Dokumentacja formatu plików](File_Format_Reference.md) — zasady zapisu na dysku dla narzędzi, relacje w obu kierunkach, `index.md`
- [Notatki i Markdown](Notes_and_Markdown.md) — właściwości w notatce
