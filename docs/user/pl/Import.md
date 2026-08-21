# Import z innej aplikacji

Stan na: 2026-08-21

Plainva potrafi przenieść notatki z innych aplikacji do notatek. Import zawsze zapisuje dane w vaulcie, który masz aktualnie otwarty, w podfolderze o nazwie, którą wybierasz — dzięki temu nigdy nie dotyka reszty Twojego vaultu, a zaimportowany folder możesz później przenieść lub usunąć jak każdy inny folder.

**Import działa na obu urządzeniach — z tymi samymi źródłami.** Na komputerze prowadzą do niego ekran powitalny, paleta poleceń i menu kontekstowe folderu; w telefonie znajdziesz go w **Ustawienia → Konserwacja → Import z innej aplikacji**. Dostępne są tam także źródła wymagające dostępu do usługi — Notion przez API.

## Rozpoczynanie importu

Trzy sposoby:

- **Ekran powitalny** → **Import z innej aplikacji** — sposób na start, gdy nie masz jeszcze żadnego vaultu, czyli normalny przypadek przy przechodzeniu na inną aplikację.
- **Paleta poleceń** (`Mod+P`) → **Importuj z innej aplikacji...**
- **Kliknij prawym przyciskiem folder** w drzewie plików → **Importuj z innej aplikacji...**

Pierwszy krok pyta o eksport — **Wybierz pliki...** albo **Wybierz folder...**, zależnie od tego, co masz. Kreator podaje następnie nazwę rozpoznanej aplikacji, a Ty decydujesz, dokąd zapisuje import. Potem pojawia się podgląd z liczbami dla tego przebiegu, ograniczeniami tego importu i przełącznikami dla źródła. Nic nie zostaje zapisane, dopóki nie naciśniesz **Rozpocznij import**.

**Nie musisz wiedzieć, która pozycja pasuje do Twojego eksportu.** Wybierz pliki, a Plainva rozpozna źródło — eksport z Notion po długich identyfikatorach w ścieżkach, graf Logseq po folderach `journals/` i `pages/`, eksport z Keep lub Simplenote po zawartości pliku JSON. Kreator pokazuje, co rozpoznał; jeśli się pomylił, zmień to na liście powyżej, a Twój wybór pozostanie.

## Dokąd zapisuje import

Dokładnie jedno z dwóch na import — nigdy oba naraz:

- **Nowy vault**: wybierasz pusty folder, Plainva tworzy w nim świeży vault i importuje do niego. Nic z tego, co już masz, nie zostanie naruszone, a cofnięcie całego importu polega na usunięciu tego folderu. To właściwy wybór, jeśli dopiero wypróbowujesz Plainva. W telefonie vault nie jest folderem, który wybierasz, tylko obszarem aplikacji: nadajesz mu jedynie nazwę. Cofnięcie importu oznacza wtedy usunięcie tego vaultu w **Więcej → Vaulty**.
- **Podfolder otwartego vaultu**: wszystko trafia do jednego, nowo utworzonego podfolderu, który nazywasz. Reszta Twojego vaultu pozostaje nietknięta.

Wiersz docelowy pod wyborem zawsze podaje dokładny folder, więc to, gdzie coś trafi, nigdy nie jest zgadywaniem.

## Opcje tego importu

Podgląd pokazuje pod liczbami przełączniki **dopasowane do rozpoznanego źródła** — każde źródło ma swoje, a to, czego dane źródło nie potrafi, nigdy się tam nie pojawia. Znajdują się tam, a nie wcześniej, bo pytania mają sens dopiero, gdy widać, co nadchodzi; przełącznik zmieniający liczby powoduje ich natychmiastowe przeliczenie.

- **Zachowaj daty ze źródła** (włączone) — zaimportowane notatki zachowują daty utworzenia i modyfikacji ze źródła. Bez tej opcji wszystko otrzymuje dzisiejszą datę.
- **Importuj też usunięte notatki** (wyłączone) — dla Google Keep i Simplenote, których eksport zawiera kosz. Domyślnie to, co tam leży, pozostaje na miejscu; raport wymienia to z nazwy.

## Co pokazuje podgląd

Podgląd to ostatni przystanek przed zapisaniem czegokolwiek i wymienia wszystko, co inaczej byłoby później niespodzianką:

- liczby dla tego przebiegu — notatki i bazy danych, a także **załączniki** i **listy kontrolne**, tam gdzie źródło je ma,
- dokładny folder docelowy,
- czego ten import **nie potrafi** przenieść, oraz osobno każdy element archiwum, który został pominięty,
- przy vaulcie z połączeniem chmurowym informację, że zaimportowane notatki zostaną potem **przesłane**,
- przy bardzo dużych źródłach informację, że indeksowanie wyszukiwania i pierwsza synchronizacja chwilę potrwają.

## Zatrzymywanie przebiegu

Duża przestrzeń robocza może zająć chwilę, dlatego import można zatrzymać: **Zatrzymaj import** w trakcie przebiegu. To, co już trafiło do vaultu, zostaje tam, a raport to opisuje — częściowy import to nie zepsuty import. Podobnie jak przy pełnym imporcie, cofnięciem jest usunięcie folderu.

## Co możesz zaimportować

| Źródło | Co wybierasz | Co zostaje przeniesione |
|---|---|---|
| **Notion (API)** | Token integracji | Strony, hierarchia folderów, bazy danych z wierszami, relacje, 21 typów właściwości |
| **Notion (eksport ZIP)** | Plik ZIP lub rozpakowany folder | Strony i struktura folderów; baza danych otrzymuje kolumny i wartości wierszy z sąsiedniego pliku CSV |
| **Evernote (ENEX)** | Jeden lub więcej plików `.enex` | Notatki, tagi, listy kontrolne (zaznaczone i niezaznaczone), daty utworzenia/aktualizacji |
| **Google Keep (Takeout)** | Plik ZIP z Google Takeout lub pliki `.json` | Notatki, listy kontrolne, etykiety jako tagi, kolor w nagłówku notatki, przypięte notatki jako tablica |
| **Simplenote** | Wyeksportowany plik `.json` | Aktywne notatki i ich tagi |
| **Logseq** | Twój folder grafu | Pliki, skopiowane bez zmian |
| **Joplin** | Folder lub ZIP eksportu Markdown | Notatki z notatnikami, frontmatterem, tagami i zasobami |
| **Bear (TextBundle)** | Wyeksportowane foldery `.textbundle` | Notatki wraz z obrazami |
| **Notesnook** | Eksport Markdown | Notatki i ich foldery notatników; notatka w dwóch notatnikach jest importowana raz |
| **Capacities** | Folder lub ZIP eksportu | Notatki z właściwościami jako frontmatter oraz media |
| **Amplenote** | ZIP eksportu | Notatki z frontmatterem i obrazami |
| **Supernotes** | Eksport Markdown | Karty jako Markdown, wraz z plikami metadanych obok |
| **Heptabase** | Eksport Markdown | Karty z frontmatterem; układ tablicy nie jest przenoszony |
| **UpNote** | Eksport Markdown | Notatki z notatnikami i załącznikami |
| **Craft** | Eksport Markdown | Dokumenty wraz z zasobami |
| **Anytype** | Eksport Markdown | Obiekty z relacjami jako frontmatter |
| **Standard Notes** | Odszyfrowana kopia JSON | Notatki z tytułami i tagami |
| **Workflowy / Dynalist** | Eksport OPML | Jedna notatka na element najwyższego poziomu, dzieci jako zagnieżdżone listy |
| **Trilium** | Eksport poddrzewa | Drzewo notatek i załączniki; notatki HTML stają się Markdownem |
| **Roam Research** | Eksport JSON | Strony jako notatki, struktury jako zagnieżdżone listy; odwołania do bloków stają się tekstem, na który wskazywały |
| **Reflect** | Eksport Markdown | Notatki z linkami wiki i notatkami dziennymi |
| **TiddlyWiki** | Eksport JSON | Tiddlery jako notatki z tagami i datami; WikiText pozostaje w takiej postaci, w jakiej został zapisany |
| **Tana** | Tekst Tana Paste | Każdy węzeł najwyższego poziomu staje się notatką, jego elementy podrzędne pozostają punktami listy |
| **RemNote** | Eksport Markdown | Dokumenty z zagnieżdżonymi remami |
| **Folder / ZIP HTML** | Folder, pliki lub ZIP ze stronami HTML | Strony jako notatki Markdown, z przekierowanymi linkami między nimi |
| **Folder Markdown / ZIP** | Folder, pliki lub ZIP | Pliki `.md` i ich struktura folderów |

**Obsidian** też jest na liście, ale nie uruchamia żadnego importu — i żadnego nie potrzebuje. Plainva pracuje na tych samych plikach Markdown: pozycja to wyjaśnia i oferuje **Otwórz vault**. Linki wiki, tagi, frontmatter i pliki `.base` nadal działają, a Twój vault pozostaje użyteczny w Obsidianie. Trzeba przy tym uczciwie dodać: nie ma ekosystemu wtyczek, nie ma Canvasa ani Dataview — w zamian masz filtry w `.base`, a składnia wtyczek w Twoich notatkach pozostaje zwykłym tekstem.

## Dlaczego nie ma tu mojej aplikacji?

Kilku aplikacji nie ma na liście, a powód za każdym razem jest inny — i to ma znaczenie, bo dwie z nich brakuje tylko na razie.

- **OneNote** — nie ma zbiorczego eksportu, z którego dałoby się cokolwiek sensownego odczytać. Drogą byłoby Graph API Microsoftu z logowaniem delegowanym: jedno wywołanie na stronę, kolejne na każdy obrazek, a do tego decyzja, jak swobodna kanwa w ogóle ma stać się Markdownem. To odnotowany projekt na przyszłość, nie odrzucony — samo API jest dostępne bezpłatnie.
- **Apple Notes** — Apple również nie oferuje zbiorczego eksportu, a odczytanie notatek oznacza inżynierię wsteczną bazy SQLite, wyłącznie na macOS. Uznane narzędzia eksportujące już to robią. Wyeksportuj do Markdown jednym z nich, a potem wczytaj folder przez **Folder Markdown / ZIP**.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — brak udokumentowanego eksportu, z którego warto by importować.
- **Confluence** — jego API zwraca własny format storage Confluence, dialekt XHTML zbudowany wokół makr, który wymagałby osobnego konwertera; a to wiki zespołowe, nie osobista kolekcja. Dziś drogą jest eksport przestrzeni: wyeksportuj przestrzeń jako **HTML** i wczytaj folder przez **Folder / ZIP HTML**. Linki między wyeksportowanymi stronami działają dalej.

Dla wszystkiego, czego tu nie ma, droga jest ta sama: jeśli Twoja aplikacja potrafi zapisywać pliki Markdown, pozycja **Folder Markdown / ZIP** je przyjmie, razem z ich strukturą folderów.

## Notion w szczegółach

Notion to jedyne źródło, w którym te dwie ścieżki znacząco się różnią.

**Z tokenem integracji (zalecane).** Token utwórz na `notion.so/my-integrations` — kreator wymienia trzy kroki i otwiera dla Ciebie tę stronę. Następnie otwórz w Notion każdą stronę, którą chcesz zaimportować, kliknij **„..."** w prawym górnym rogu → **Połączenia** i dodaj swoją integrację — Notion udostępnia tylko strony, które zostały wyraźnie połączone z Twoją integracją.

**Plainva nie zapisuje tokena.** Obowiązuje tylko dla tego jednego przebiegu i potem znika; nie powstaje żadne połączone konto. Przy kolejnym imporcie wklejasz go ponownie.

Przez API Plainva widzi strukturę, a nie tylko tekst:

- Hierarchia stron staje się strukturą folderów.
- Każda baza danych staje się plikiem `.base` oraz folderem z **jedną notatką na wiersz**.
- **Relacje stają się linkami wiki** między tymi notatkami, w obu kierunkach.
- Mapowanych jest 21 typów właściwości — wybór, status, wielokrotny wybór, data, liczba, pole wyboru, URL, e-mail, telefon, formuła, rollup, relacja, osoby, unikalny identyfikator i inne.
- Widoki tabeli, tablicy, kalendarza i listy są generowane na podstawie schematu bazy danych.
- Bazy danych osadzone na stronie stają się aktywnymi osadzeniami `![[Database.base]]`.

**Z eksportu ZIP.** Działa offline i nie wymaga tokena, ale eksport z Notion nie zawiera ani schematu baz danych, ani identyfikatorów stron. Strony i ich foldery zostają przeniesione, a **linki między zaimportowanymi stronami nadal działają** — Notion zapisuje je z długim identyfikatorem w każdym segmencie ścieżki, a Plainva kieruje je do notatek, które faktycznie zostały zapisane. Plik `.csv` obok każdego folderu bazy danych jest czytany po to, czego same strony nie niosą: po kolumny, ich typy i wartości każdego wiersza jako frontmatter. Wiersze, dla których eksport nie ma strony, są zapisywane jako notatki. Dopasowanie odbywa się po tytule — droga API ma prawdziwe identyfikatory i pozostaje lepszym wyborem dla przestrzeni zbudowanej na relacjach.

## Czego import nie przenosi

Każdy import podaje swoje ograniczenia w podglądzie, a potem ponownie w raporcie. Najważniejsze z nich:

- **Załączniki są przenoszone.** Z archiwum ZIP lub folderu zachowują miejsce, które miały w eksporcie, dzięki czemu względny odnośnik do obrazu w notatce nadal działa. Z Notion przez API są pobierane w trakcie importu — Notion podpisuje te odnośniki, a one wygasają w ciągu godziny — i trafiają do folderu `Attachments`; obrazy, które strona pobiera skądinąd z sieci, pozostają odnośnikami. Dwa wyjątki zostają w eksporcie i są w raporcie wymienione pojedynczo: załączniki wewnątrz pliku `.enex` z Evernote oraz obrazy z Google Keep.
- **Niektóre elementy archiwum są pomijane celowo:** bardzo duże pliki, dowiązania symboliczne oraz elementy z niebezpieczną ścieżką. Pojawiają się z podanym powodem w podglądzie, zanim rozpoczniesz import.
- **Bardzo długie strony Notion** są odczytywane w całości, ale treść zagnieżdżona w rozwijanych blokach, kolumnach lub podlistach nie jest uwzględniana.
- **Pliki Logseq są kopiowane bez zmian** — właściwości `key:: value` oraz odwołania do bloków nie są konwertowane na właściwości ani linki Plainva.
- **Usunięte pozostaje usunięte.** Kosz Simplenote i Google Keep jest pomijany — te notatki zostały już raz odrzucone, a import nie powinien po cichu ich przywracać. Są wymienione z nazwy w raporcie, dzięki czemu widzisz, co zostało pominięte.
- **Eksporty ZIP z Notion** dopasowują wiersze do stron po tytule (patrz wyżej) i nie przenoszą relacji między bazami danych.

## Daty zostają przeniesione

Kolekcja rozwijana latami traci swoją oś czasu, jeśli po imporcie wszystko nosi dzisiejszą datę. Dlatego Plainva przenosi daty ze źródła:

- Trafiają jako `created` i `updated` do frontmattera zaimportowanej notatki — stamtąd odczytuje je też oś czasu grafu.
- Sam plik również otrzymuje datę modyfikacji ze źródła, dzięki czemu sortowanie według daty i **Ostatnio otwarte** działają poprawnie. Datę utworzenia pliku można ustawić tylko w systemie Windows; na pozostałych systemach nośnikiem tej informacji jest frontmatter.
- Jeśli źródło nie dostarcza żadnych dat, Plainva używa daty pliku eksportu. Nigdy jej nie zmyśla: gdy nie ma żadnej wskazówki, pole pozostaje puste.

## Jeden błąd nie kończy całego importu

Jeśli pojedynczej notatki nie da się zapisać, import biegnie dalej, a raport wymienia ją wraz z powodem. Raport jest zapisywany nawet wtedy, gdy przebieg zatrzyma się przedwcześnie — dzięki temu zawsze widzisz, co już trafiło do Twojego vaultu.

## Nic nie zostaje nadpisane

Import zapisuje dane w otwartym vaulcie, dlatego został zaprojektowany tak, aby był nieniszczący:

- Jeśli nazwa notatki jest już zajęta, zaimportowana notatka zostaje **ponumerowana** (`Meeting (2).md`) zamiast zastępować istniejącą. Dotyczy to również sytuacji, gdy dwie notatki źródłowe mają tę samą nazwę.
- Zaimportowane notatki otrzymują zwykły frontmatter OKF — `type` oraz stempel `generated` z aktorem importu Plainva (`plainva-import/<wersja>`) i momentem przebiegu, a tam, gdzie pochodzenie jest znane, także `sources` — dzięki czemu zachowują się jak każda inna notatka Plainva w filtrach i widokach `.base`. Stempel pozwala odnaleźć wszystko, co trafiło razem w tym samym przebiegu.
- Nic poza docelowym podfolderem nie zostaje zmienione.

Jeśli wolisz, aby import był całkowicie oddzielny, utwórz najpierw nowy vault (**Nowy vault** na ekranie powitalnym) i zaimportuj do niego.

## Raport importu

Każde uruchomienie zapisuje **raport importu** do folderu docelowego. Zawiera on:

- liczbę zaimportowanych notatek i baz danych,
- co ten import w ogóle nie potrafi przenieść,
- wszystko, co dotarło **niekompletnie** albo zostało **pominięte**, wraz z powodem,
- oraz każdy plik wraz z jego statusem.

Raport jest rzetelnym zapisem przebiegu importu — jeśli coś zostało obcięte lub pominięte, pojawia się w nim, zamiast zostać po cichu policzone jako sukces. Warto go przeczytać, zanim usuniesz eksport.

Na samym dole znajduje się informacja, jak **cofnąć** import: wszystko z jednego przebiegu znajduje się w jednym folderze — usunięcie go usuwa import. Przy celu **Nowy vault** jest to folder samego nowego vaultu. Nie jest do tego potrzebne żadne osobne polecenie cofania. Sam raport jest zwykłą notatką i można go usunąć, gdy tylko go przeczytasz.

## Powiązane strony

- [Bazy danych (.base)](Databases_Base.md) — co dzieje się z zaimportowanymi bazami danych Notion
- [OKF](OKF.md) — frontmatter, jaki otrzymują zaimportowane notatki
- [Pierwsze kroki](Getting_Started.md) — tworzenie osobnego vaultu na potrzeby importu
- **Tabele i bloki kodu HTML tracą strukturę.** Konwersja czyta nagłówki, listy, wyróżnienia, linki i obrazy; tabela staje się tekstem swoich komórek. Każda strona, której to dotyczyło, jest wymieniona w raporcie.
