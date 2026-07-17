# Dokumentacja formatu plików

Stan na: 2026-07-17

Ta strona to precyzyjny kontrakt formatu na dysku dla **każdego pliku w vaulcie Plainva**. Jest napisana tak, aby narzędzie — inny program, skrypt lub asystent AI — mógł czytać i bezpiecznie edytować pliki vaultu bezpośrednio, bez przechodzenia przez interfejs użytkownika Plainva. Jeśli używasz tylko aplikacji, ta strona nigdy nie jest Ci potrzebna; [pozostałe strony podręcznika](README.md) opisują zwykłe użycie.

Wszystko tutaj to zwykły tekst UTF-8. Notatki to Markdown z frontmatter YAML; bazy danych to YAML. Nic nie jest zastrzeżone i nic nie jest ukryte.

## Zasady podstawowe (przeczytaj najpierw)

1. **Notatka jest źródłem prawdy. `.base` to tylko widok.** *Wartości* właściwości znajdują się we frontmatter poszczególnych notatek — nigdy w `.base`. Aby zmienić wartość, edytujesz notatkę.
2. **Notatki pozostają Obsidian-natywne.** We frontmatter notatki zapisuj wyłącznie proste skalary i listy (string, liczba, boolean, data ISO, lista YAML). Nigdy nie zapisuj zagnieżdżonego obiektu ani flagi „aktywne/wybrane” w notatce.
3. **`.base` używa tylko czterech kluczy najwyższego poziomu Obsidian** (`filters`, `formulas`, `properties`, `views`). Dodanie jakiegokolwiek innego klucza najwyższego poziomu sprawia, że Obsidian odrzuca cały plik. Wszystkie dane specyficzne dla Plainva znajdują się pod zagnieżdżonymi podkluczami `plainva:`.
4. **Zachowaj to, czego nie rozumiesz.** Nieznane klucze muszą przetrwać cykl odczytu/zapisu bez zmian. Nie „porządkuj” kluczy, których nie rozpoznajesz.
5. **Zapisuj UTF-8 bez BOM, z zakończeniami linii LF.**

## Vault w skrócie

Vault to zwykły folder. Typy plików, które napotkasz:

| Plik | Co to jest | Edytowalny jako tekst |
|---|---|---|
| `*.md` | Notatka: frontmatter YAML + treść Markdown | Tak |
| `*.base` | Widok bazy danych na notatkach (YAML) | Tak |
| `index.md` | Zarządzany spis treści folderu (nazwa zarezerwowana) | Tak, z rozwagą — patrz [index.md](#indexmd-spis-treści-folderu) |
| `log.md` | Nazwa zarezerwowana, obecnie nieużywana | Zostaw w spokoju |
| obrazy, PDF-y, … | Załączniki | Nie (binarne) |
| `.plainva/` | Wewnętrzny folder Plainva (kopie zapasowe, stan) | **Nie — nigdy nie dotykaj** |

Zarezerwowane nazwy `index.md` i `log.md` nigdy nie są zwykłymi notatkami; nie twórz zwykłej treści pod tymi nazwami.

---

## Notatki (`.md`)

Notatka to plik Markdown. Opcjonalny blok frontmatter YAML (między dwiema liniami `---`) na samej górze zawiera jej właściwości; po nim następuje treść Markdown.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### Pola frontmatter OKF

Plainva stosuje się do OKF (Open Knowledge Format), minimalnej konwencji. Dwa pola najwyższego poziomu:

| Pole | Typ | Znaczenie |
|---|---|---|
| `type` | string | Jakiego rodzaju to dokument (`Note`, `Daily Note`, `Project`, …). Jedyne pole, którego OKF rzeczywiście wymaga. |
| `okf_version` | string | Wersja konwencji, względem której plik został zapisany, np. `"0.1"`. Ujmij w cudzysłów, aby YAML zachował ją jako string. |

Plik **bez** `type` nadal otwiera się bez problemu; jest po prostu „niezgodny z OKF”. Samo brakujące `okf_version` nie jest naruszeniem. Gdy tworzysz nową notatkę, dodanie `type` (i `okf_version`) jest dobrą praktyką. Pełne uzasadnienie znajdziesz w [OKF](OKF.md).

### Serializacja wartości właściwości

Każdy klucz frontmatter to jedna właściwość. Zapisz wartość w natywnej formie YAML odpowiadającej jej typowi:

| Typ właściwości | Forma YAML | Przykład |
|---|---|---|
| Tekst | skalar string | `title: Hello` |
| Liczba | liczba | `priority: 3` |
| Pole wyboru | boolean | `done: true` |
| Data | string daty ISO | `due: 2026-07-20` |
| Data i godzina | string daty i godziny ISO | `at: 2026-07-20T14:30:00` |
| Lista | lista YAML ze stringami | `authors: [Ada, Alan]` |
| Tagi | lista YAML ze stringami | `tags: [project, active]` |
| Wybór / Status | pojedynczy skalar string | `status: Done` |
| Wielokrotny wybór | lista YAML ze stringami | `labels: [urgent, later]` |
| URL / E-mail / Telefon | skalar string | `site: https://example.org` |
| Relacja (pojedyncza) | **string** linku wiki | `project: "[[Project Alpha]]"` |
| Relacja (wielokrotna) | lista YAML ze stringami linków wiki | `related: ["[[A]]", "[[B]]"]` |

„Aktywna” wartość właściwości typu Wybór/Status to po prostu ten zwykły skalar. *Paleta dozwolonych opcji* i ich kolory **nie** znajdują się w notatce — znajdują się w nadrzędnym pliku `.base` (patrz [Opcje i kolory](#opcje-i-kolory)). Dzięki temu notatka pozostaje w 100% Obsidian-natywna.

> Ujmuj wartości linków wiki w cudzysłów (`"[[X]]"`). Nieocudzysłowione `[[X]]` to w YAML sekwencja flow i nie zostanie sparsowane tak, jak zamierzasz.

### Przestrzeń nazw `plainva:` w notatkach

Specyficzne dla Plainva dodatki do notatek są zgrupowane pod jednym kluczem `plainva:`, dzięki czemu inne edytory mogą je ignorować:

| Klucz | Wartość | Znaczenie |
|---|---|---|
| `icon` | grafem emoji lub `lucide:<nazwa-kebab>` | Ikona dokumentu (w stylu Notion) |
| `icon_color` | kolor hex (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tonacja ikony `lucide:` (emoji ją ignorują) |
| `header_color` | kolor hex | Pasek nagłówka na pełną szerokość |
| `tasks` | `false` | Wyklucza pola wyboru tej notatki z [widoku Zadania](Tasks.md) |
| `templateFor` | lista linków wiki do plików `.base` | Przypisuje **szablon** do wymienionych baz danych (istotne tylko dla notatek wewnątrz folderu szablonów) |
| `pim` | mapowanie (patrz niżej) | Kotwica wiążąca notatkę z zewnętrznym wydarzeniem kalendarza, zadaniem lub e-mailem |

Wszystkie te pola są opcjonalne. Jeśli nie zapisujesz żadnego z nich, pomiń klucz `plainva:` całkowicie. Nieprawidłowe wartości są ignorowane przy odczycie, nigdy traktowane jako błąd.

`pim` to kotwica integracji PIM (patrz [Kalendarz i zewnętrzne zadania](Calendar_and_Tasks.md) i [Przechwytywanie e-maili](Email_Capture.md)). To małe mapowanie zapisywane przez Plainva, gdy notatka odzwierciedla zewnętrzny obiekt: `uid` plus `account`, a w zależności od rodzaju `calendar` (notatki ze spotkań), `kind: task` + `list` (zsynchronizowane zadania) lub `kind: email` + `mailbox` (przechwycone e-maile). Narzędzia powinny zachowywać je bez zmian; usunięcie go jedynie odłącza notatkę od jej zdalnego obiektu (nic nie jest usuwane zdalnie). Przykład:

```yaml
plainva:
  pim:
    kind: task
    uid: MTIzNDU2
    account: 3f9c21ab
    list: MDEyMzQ1
```

`templateFor` to kontrakt pola przypisania szablonu (patrz [Bazy danych (.base)](Databases_Base.md)): na notatce wewnątrz folderu szablonów wymienia bazy danych, w których menu **Wpis** domyślnie pokazuje ten szablon. Wartości to całe linki wiki wraz z rozszerzeniem `.base` — w formie gołej (`"[[Tasks.base]]"` pasuje do pliku o tej nazwie w dowolnym folderze, więc przetrwa samo przeniesienie folderu) albo kwalifikowanej ścieżką (`"[[Projekte/Tasks.base]]"` pasuje dokładnie do tej ścieżki). Plainva zapisuje gołe linki i kwalifikuje je tylko wtedy, gdy istnieją dwa pliki `.base` o tej samej nazwie. Skalar zamiast listy jest tolerowany. Gdy wpis jest tworzony z szablonu, `templateFor` — w odróżnieniu od pozostałych kluczy `plainva:` — **nie** jest kopiowany do nowej notatki.

### Linki

- **Link wiki:** `[[Nazwa notatki]]` — rozwiązywany według nazwy notatki w całym vaulcie. Z kotwicą nagłówka: `[[Notatka#Sekcja]]`. Z tekstem wyświetlanym: `[[Notatka|pokazywany tekst]]`.
- **Link Markdown:** `[tekst](względna/ścieżka.md)` również działa.
- **Linki zwrotne** są wyprowadzane automatycznie, także z linków wiki we frontmatter (to właśnie sprawia, że relacje pojawiają się jako linki zwrotne).

---

## Bazy danych (`.base`)

Plik `.base` to YAML. Przechowuje *widok* na notatki — jakie notatki (źródła), jak je pokazywać (widoki), jak filtrować i sortować oraz schemat kolumn. Nie przechowuje **żadnych wartości notatek**. Format jest zgodny z wtyczką Bases w Obsidian.

### Zasady twarde — złamanie jednej sprawia, że Obsidian odrzuca cały plik

- **Tylko te klucze najwyższego poziomu:** `filters`, `formulas`, `properties`, `views`. Nigdy nie dodawaj innego klucza najwyższego poziomu. (Historycznie klucz najwyższego poziomu `columns:` psuł każdy plik — nie wprowadzaj ponownie tego wzorca.)
- **Każdy widok potrzebuje niepustego stringa `name`.**
- **Obiekt `filters` niesie dokładnie jedno z `and` / `or` / `not` na każdym poziomie** — nigdy dwa obok siebie.

Sam Plainva naprawia starsze pliki naruszające dwie ostatnie zasady przy następnym zapisie, ale narzędzie piszące bezpośrednio musi je od razu zastosować poprawnie.

### Identyfikatory właściwości: kiedy używać przedrostka `note.`

To najczęstsza pułapka, więc wprost:

| Gdzie | Forma | Przykład |
|---|---|---|
| Klucze mapy `properties:` | z przedrostkiem | `note.status`, `file.name` |
| Lista `order:` widoku | z przedrostkiem | `[file.name, note.status]` |
| `sort[].property` widoku | z przedrostkiem | `note.due` |
| Wewnątrz wyrażeń **filtra** | **bez przedrostka** | `status == "Done"` |
| Wewnątrz podkluczy `plainva` (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **bez przedrostka** | `groupBy: status` |

Reguła praktyczna: pola strukturalne *zwrócone do Obsidian* używają `note.<key>` (i `file.<x>` dla wbudowanych, jak `file.name`, `file.folder`, `file.mtime`); wszystko wewnątrz **formuły filtra** lub **bloku `plainva`** używa gołego klucza frontmatter.

### Klucze najwyższego poziomu

- **`filters`** — które notatki należą do tej bazy danych. W Plainva ten klucz zawiera wyłącznie **źródła** (folder/tag); warunki właściwości są przechowywane osobno dla każdego widoku, w `views[i].filters`. Patrz [Filtry](#filtry).
- **`properties`** — schemat kolumn, indeksowany według id właściwości. Natywne podklucze Obsidian, jak `displayName` (etykieta nagłówka kolumny), są dozwolone i zachowywane; cała bogatość Plainva znajduje się pod `properties[id].plainva`.
- **`views`** — uporządkowana lista widoków. Każdy potrzebuje `name` i `type`.
- **`formulas`** — funkcja Obsidian. Plainva ich nie tworzy, ale zachowuje bez zmian.

### Mapa podkluczy `plainva:`

Wszystko, co specyficzne dla Plainva, ma nadaną przestrzeń nazw. Trzy miejsca:

**`properties[<note.key>].plainva`** — na kolumnę:

| Klucz | Wartość | Znaczenie |
|---|---|---|
| `input` | jeden z typów wejścia poniżej | Typ pola kolumny |
| `options` | lista obiektów opcji | Kuratorowane wartości dla wybór/status/wielokrotny wybór |
| `relationBase` | ścieżka `.base` względna do vaultu | Docelowa baza danych relacji (patrz [Relacje](#relacje-kontrakt-dwustronny)) |
| `relationLimit` | `one` | Kardynalność: pojedynczy link. Pomiń dla braku ograniczeń. |
| `reverseOf` | `{ base, property }` | Oznacza kolumnę **obliczanej relacji odwrotnej** (bez `input`) |

**`views[i].plainva`** — na widok:

| Klucz | Wartość | Znaczenie |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` / `graph` / `pinboard` | Rodzaj widoku dostępny tylko w Plainva (patrz niżej) |
| `groupBy` | goły klucz właściwości | Kolumna grupowania tablicy |
| `dateField` | goły klucz właściwości | Data początkowa kalendarza/osi czasu |
| `endField` | goły klucz właściwości | Data końcowa osi czasu |
| `coverImage` | goły klucz właściwości | Właściwość okładki galerii |
| `subItemsProperty` | goły klucz właściwości | Kolumna nadrzędna relacji do samej siebie do zagnieżdżania elementów podrzędnych |
| `widths` | mapa id → px | Szerokości kolumn |
| `dateFormat` | string | Format daty per widok (`default` jest domyślny — pomiń go) |
| `pinboardOrder` | lista ścieżek względnych do vaultu | Ręczna kolejność NIEPRZYPIĘTYCH kart na tablicy korkowej |
| `pinboardPinned` | lista ścieżek względnych do vaultu | Przypięte karty; kolejność na liście odpowiada kolejności w sekcji |
| `pinboardFilterBy` | `tags` lub goły klucz wielokrotnego wyboru | Źródło etykiet paska chipów tablicy korkowej (`tags` jest domyślne — pomiń ten klucz) |

Oprócz bloku `plainva`, widok może nieść natywny obiekt **`views[i].filters`** — **filtry właściwości dla poszczególnych widoków** (ta sama jednokorzeniowa gramatyka `and`/`or`/`not` co `filters` na poziomie pliku). Plainva przechowuje tu reguły filtrów właściwości, po jednym zestawie na widok, dzięki czemu każdy widok filtruje niezależnie; `filters` na poziomie pliku zachowuje wtedy tylko źródła. Obsidian stosuje `views[i].filters` natywnie dla każdego widoku.

**`views[0].plainva`** — klucze dotyczące całego pliku, dozwolone **wyłącznie na pierwszym widoku**:

| Klucz | Wartość | Znaczenie |
|---|---|---|
| `fileIconColor` | kolor hex | Tonacja ikony bazy danych (drzewo/karty/nagłówek) |
| `newItemFolder` | folder względny do vaultu | Gdzie przycisk „Nowy” zapisuje nowe elementy |
| `newItemTemplate` | ścieżka `.md` względna do vaultu | Domyślny szablon nowych elementów |
| `contextFilters` | lista prostych kluczy właściwości | Filtry samoodniesienia („Ta notatka”) — patrz niżej |

`contextFilters` to odpowiednik filtra „ta strona” z Notion w Plainva. Każdy wpis to klucz właściwości; gdy baza danych jest osadzona w notatce, jej wiersze są ograniczane do tej notatki głównej za pośrednictwem tej właściwości (rozwiązywane przez indeks linków: właściwość relacji, czyli strona właścicielska, lub zwykła właściwość z linkiem wiki dopasowuje wiersze wskazujące na notatkę główną, a obliczana kolumna odwrotna dopasowuje to, na co wskazuje notatka główna). Celowo **nie** jest zapisywany w natywnym `filters`, więc Obsidian go ignoruje i pokazuje wszystkie wiersze; przy samodzielnym otwarciu w Plainva jest on również pomijany (brak notatki głównej) i pokazywane są wszystkie wiersze. Wiele wpisów łączy się logiką AND.

### Typy wejścia

`plainva.input` to jeden z:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Obliczana kolumna **odwrotna** **nie ma** `input` — jest identyfikowana wyłącznie przez `reverseOf`.

### Opcje i kolory

Kolumny Wybór/Status/Wielokrotny wybór mogą nieść kuratorowaną listę opcji. Każda opcja:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` to **nazwa palety**, nie kolor CSS. Prawidłowe nazwy: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Nieznany kolor przechodzi na kolor wyprowadzony z wartości.

### Typy widoków

`views[i].type` na dysku to natywny typ Obsidian. Widoki dostępne tylko w Plainva są zapisywane jako `type: table` plus wskazówka `plainva.render`, dzięki czemu Obsidian degraduje je do zwykłej tabeli:

| Chcesz | `type` na dysku | `plainva.render` |
|---|---|---|
| Tabela | `table` | — |
| Lista | `list` | — |
| Galeria | `cards` | — |
| Tablica | `table` | `board` |
| Kalendarz | `table` | `calendar` |
| Oś czasu | `table` | `timeline` |

### Filtry

`filters` wybiera, które notatki znajdują się w bazie danych, i zawęża je.

**Warunki źródła** decydują o przynależności:

- Folder: `file.folder == "Path/To/Folder"` (względny do vaultu; folder główny to `""`).
- Tag: `file.hasTag("project")` (bez wiodącego `#`).

Wiele źródeł to po prostu wiele wpisów. Brak `filters` w ogóle = każda notatka w vaulcie.

**Gdzie znajdują się warunki właściwości:** na poziomie pliku `filters` obowiązuje dla każdego widoku. Plainva zamiast tego przechowuje reguły filtrów właściwości **dla każdego widoku osobno** w `views[i].filters` (ta sama jednokorzeniowa struktura) i zachowuje na poziomie pliku tylko źródła, dzięki czemu każdy widok może filtrować niezależnie. Oba warianty są zgodne z formatem Obsidian; narzędzie może zapisać dowolny z nich. Starszy plik z warunkami właściwości na poziomie pliku nadal działa — Plainva rozdziela je do poszczególnych widoków przy najbliższym zapisie.

**Warunki właściwości** używają gołych nazw właściwości i tych operatorów:

| Operator | Wyrażenie |
|---|---|
| jest równe | `status == "Done"` |
| nie jest równe | `status != "Done"` |
| zawiera | `contains(labels, "urgent")` |
| nie zawiera | `!contains(labels, "urgent")` |
| większe / mniejsze | `priority > "2"`, `priority < "5"` |
| co najmniej / co najwyżej | `priority >= "2"`, `priority <= "5"` |
| jest puste | `status == ""` |
| nie jest puste | `status != ""` |

**Struktura (jednokorzeniowa!):** jedno z `and` / `or` / `not`, którego wpisy są stringami warunków — lub jeden poziom zagnieżdżonych obiektów grup `{and:[...]}` / `{or:[...]}` (grupy w stylu Notion). Przykład łączący źródło, warunek i grupę OR:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Kompletna, opisana `.base`

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## Relacje (kontrakt dwustronny)

Relacja łączy notatki ze sobą. To najbardziej podatna na błędy rzecz do napisania ręcznie, ponieważ obejmuje **trzy** miejsca. Utrzymaj wszystkie trzy spójne.

1. **Wartość znajduje się we frontmatter notatki źródłowej**, jako link wiki (lub ich lista):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **Źródłowa `.base` deklaruje kolumnę relacji** (`relationBase` = docelowa baza danych; `relationLimit: one` dla pojedynczego linku):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **Docelowa `.base` może pokazać relację odwrotną** za pomocą kolumny **obliczanej**. Jej wartości **nie są** nigdzie przechowywane — są wyprowadzane z linków notatek źródłowych:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Przykład krok po kroku: Zadania ↔ Projekty

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Wynik: w `Projects.base` obliczana kolumna `tasks` dla **Project Alpha** wymienia „Write proposal”, ponieważ pole `project` tego zadania linkuje z powrotem do niej. Zauważ, że `Project Alpha.md` **nie ma** klucza `tasks:` — strona odwrotna jest obliczana, nigdy przechowywana.

### Czego NIE robić w relacjach

- **Nie zapisuj wartości odwrotnych w notatkach.** Kolumna `reverseOf` jest obliczana. Zapisanie klucza `tasks:` w `Project Alpha.md` jest błędne i nie przetrwa cyklu odczytu/zapisu.
- **Zadbaj, aby cele linków się rozwiązywały.** `"[[Project Alpha]]"` musi pasować do istniejącej nazwy notatki, w przeciwnym razie link pokazuje się jako uszkodzony.
- **Utrzymuj ścieżki względne do vaultu** z ukośnikami do przodu i bez wiodącego `./` (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` to goły klucz źródłowy** (`project`), nie `note.project`.

### Relacje do samej siebie i elementy podrzędne

Dla relacji, której celem jest ta sama baza danych, skieruj `relationBase` na tę samą `.base`. Aby zagnieździć dzieci pod rodzicami w widoku tabeli, ustaw `views[i].plainva.subItemsProperty` na goły klucz relacji nadrzędnej. Cykle są obsługiwane; przy wyłączonych elementach podrzędnych wiersze pozostają płaskie, a wartości są zachowane.

---

## `index.md` (spis treści folderu)

`index.md` to zarezerwowana nazwa dla spisu treści folderu.

- **Tylko główna `index.md` może nieść frontmatter**, i tylko `okf_version` (oznacza to vault jako aktywny w OKF). `index.md` poza folderem głównym musi być **wolna od frontmatter** — frontmatter tam jest naruszeniem nazwy zarezerwowanej.
- **Zarządzana** przez Plainva `index.md` kończy się znacznikiem `<!-- plainva:index generated -->` (komentarz HTML, niewidoczny w trybie czytania). Jego obecność oznacza, że Plainva automatycznie utrzymuje plik aktualny. Jeśli edytujesz taki plik ręcznie, albo zachowaj znacznik (i utrzymaj wygenerowany kształt), albo usuń go świadomie, aby na stałe przejąć plik.
- Generowane listingi to sekcje linków w formie `* [Tytuł](względny/url) - opis`.

Jeśli generujesz przegląd folderu ręcznie, bezpiecznym wyborem jest **nie** dodawać znacznika — wtedy Plainva nigdy go nie nadpisze.

---

### Widoki grafu (`plainva.render: "graph"`)

Widok grafu jest przechowywany tak jak każdy niekative widok: `type: table` plus wskazówka render. Jego opcje żyją w TEJ SAMEJ przestrzeni nazw `views[i].plainva`:

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # klucze właściwości relacji rysowane jako krawędzie
      graphColorBy: status         # właściwość wybór/status -> kolor węzła
      graphSizeBy: prio            # właściwość liczbowa -> rozmiar węzła
      graphShowExternal: true      # dołącz cele relacji spoza widoku
      graphShowIncoming: true      # relacje z INNYCH baz danych, które tu wskazują (np. zadania projektu)
```

Wszystkie klucze opcji grafu są opcjonalne; pomiń je całkowicie, gdy nieustawione. Obsidian renderuje ten sam plik jako zwykłą tabelę i nie może zgłosić błędu.

Widok **Tablica** (`plainva.render: "board"`) może dodatkowo nieść `views[i].plainva.boardColumnOrder` — listę kluczy kolumn grupujących (`__UNGROUPED__` oznacza kolumnę bez wartości), która zapamiętuje ręczną kolejność kolumn. Tablice Wybór/Status zamiast tego zmieniają kolejność `options` właściwości. Pomiń klucz, gdy nieustawiony.

### Widok tablicy korkowej (`plainva.render: "pinboard"`)

Tablica korkowa jest przechowywana tak jak każdy nienatywny widok: `type: table` plus wskazówka render. Jej klucze znajdują się w tej samej przestrzeni nazw `views[i].plainva`:

```yaml
views:
  - type: table
    name: Pinboard
    plainva:
      render: pinboard
      pinboardOrder:                  # ręczna kolejność nieprzypiętych kart
        - "Notes/Groceries.md"
      pinboardPinned:                 # przypięte; kolejność listy = kolejność sekcji
        - "Notes/Idea.md"
      pinboardFilterBy: note.labels   # źródło etykiet paska chipów; pomiń = tags
```

Zasady: przypięte ścieżki nie powtarzają się w `pinboardOrder`. Karty spoza obu list renderują się na górze, od najnowszych (czas utworzenia). Wpisy, których plik już nie istnieje lub opuścił zestaw źródłowy, są ignorowane i usuwane przy najbliższym zapisie. Gdy notatka zostanie przemianowana lub przeniesiona, Plainva automatycznie przekierowuje ścieżki na obu listach; narzędzia zewnętrzne muszą robić to samo. Obsidian ignoruje te klucze i pokazuje widok jako tabelę.

## Nie dotykaj i bezpieczeństwo

- **`.plainva/`** przechowuje kopie zapasowe i stan wewnętrzny. Nigdy nie czytaj z niego logiki programu ani do niego nie zapisuj.
- **Nieznane klucze są święte.** Gdy przepisujesz `.base` lub notatkę, przenieś każdy klucz, którego nie zamierzałeś zmienić, bez zmian. Sam Plainva zachowuje nieznane klucze `.base` przez wewnętrzną surową kopię; zewnętrzny program piszący powinien robić to samo (sparsuj → zmień tylko to, co zamierzasz → zserializuj).
- **Wartości zmieniają się w notatce, nie w `.base`.** Aby ustawić komórkę, edytuj frontmatter notatki. `.base` decyduje tylko o tym, które notatki i kolumny są pokazywane.
- **Nie dodawaj kluczy najwyższego poziomu `.base`** poza `filters` / `formulas` / `properties` / `views`.
- **Kodowanie:** UTF-8 bez BOM, zakończenia linii LF, wszędzie.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — ten sam materiał z perspektywy pisania ręcznego w aplikacji
- [Bazy danych (.base)](Databases_Base.md) — bazy danych wyjaśnione dla codziennego użytku
- [OKF](OKF.md) — `type`, `okf_version`, index.md i konwersja vaultu
