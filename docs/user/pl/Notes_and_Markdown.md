# Notatki i Markdown

Stan na: 2026-07-11

Każda notatka w Plainva to zwykły plik Markdown (`.md`). Ta strona wyjaśnia, jak wygodnie pisać i co dokładnie trafia do pliku — bo właśnie to sprawia, że notatki są przenośne: może je odczytać dowolny edytor tekstu, Obsidian czy diff w Git.

## Zasada podstawowa: wszystko jest tekstem

Wszystko, co widać w Plainva — sformatowany tekst, tabele, właściwości, ikony — jest zapisywane jako otwarty tekst:

```markdown
---
type: Note
okf_version: "0.1"
tags: [projekt]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mój projekt

Pogrubiona myśl z linkiem do [[Inna notatka]].

- [ ] Pierwsze zadanie
```

Blok między liniami `---` to **frontmatter** (YAML): tam znajdują się właściwości notatki. Poniżej następuje zwykły tekst Markdown. Prezentacja specyficzna dla Plainva (ikona, kolor nagłówka) jest zgrupowana pod jednym kluczem `plainva:` — inne programy po prostu ją ignorują.

## Pisanie w Podglądzie na żywo

**Podgląd na żywo** to domyślny tryb: Markdown renderuje się w trakcie pisania, pozostając w każdej chwili edytowalny.

### Menu slash

Wpisz `/` na początku wiersza, aby otworzyć menu wstawiania. Jest ono podzielone na sekcje:

- **Bloki podstawowe** — Tekst, Nagłówek 1–6, Lista punktowana, Lista numerowana, Lista zadań, Cytat, Blok kodu, Tabela, Separator, **Wzór (LaTeX)**, **Diagram Mermaid**
- **Formatowanie** — Pogrubienie, Kursywa, Przekreślenie, Kod w wierszu, Wyróżnienie, **Emoji**
- **Linki i multimedia** — Link, Link wewnętrzny, Obraz (z sieci), Obraz wewnętrzny, Osadzenie, Osadź bazę danych, Utwórz osadzoną bazę danych
- **Dokument** — Ikona dokumentu, Kolor nagłówka, Wstaw szablon
- **Callouts** — 13 wariantów (Notatka, Info, Do zrobienia, Streszczenie, Wskazówka, Sukces, Pytanie, Ostrzeżenie, Niepowodzenie, Niebezpieczeństwo, Bug, Przykład, Cytat)

### Więcej pomocy przy pisaniu

- **Toolbar zaznaczenia** — zaznacz fragment tekstu, a mała belka zaoferuje **Pogrubienie**, **Kursywę**, **Przekreślenie**, **Kod w wierszu**, **Wyróżnienie** i **Link**.
- **Mentions `@`** — wpisz `@` w dowolnym miejscu tekstu, aby wstawić **datę** (Dziś, Jutro, Wczoraj lub **Wybierz datę…**, zapisywaną jako data ISO), link do **notatki** lub osadzenie **bazy danych**.
- **Emoji** — polecenie slash **Emoji** (`/emoji`) otwiera przy kursorze wybór emoji; możesz też wpisać `:name` (np. `:rocket`), aby zobaczyć podpowiedzi w tekście. W obu przypadkach Plainva wstawia rzeczywisty **znak** emoji (przenośny Unicode), nigdy `:shortcode:` — dzięki temu notatka pozostaje czytelna w Obsidian, na GitHubie i wszędzie indziej. (To coś innego niż **Ikona dokumentu** notatki, która jest zapisywana we frontmatter.)
- **Uchwyty bloków** — po najechaniu na akapit z lewej strony pojawia się uchwyt: przeciągając go, przenosisz blok, klikając — otwierasz menu **Akcje bloku** (**Przekształć w** Tekst/Nagłówek/Lista/Zadanie/Cytat/Blok kodu, **Duplikuj**, **Przenieś w górę**/**Przenieś w dół**, **Usuń blok**). Jeśli przeciągniesz listę obok innej listy tego samego rodzaju, Plainva wstawia niewidoczną linię separatora `<!-- -->`, aby obie listy pozostały oddzielne — w Markdownie listy tego samego stylu mimo pustej linii zwykle by się scaliły (również w Obsidian).
- **Tabele** — renderowane jako widget z edytowalnymi klikalnie komórkami. Widok komórki renderuje formatowanie (**pogrubienie**, *kursywę*, `kod`, wyróżnienie), klikalne linki (`[[Link wewnętrzny]]`, adresy internetowe) i `<br>` jako złamanie wiersza; podczas edycji widzisz surowy tekst. Menu tabeli oferuje wstawianie/usuwanie wierszy i kolumn oraz wyrównanie (**Wyrównaj do lewej**/**Wyśrodkuj**/**Wyrównaj do prawej**).
- **Listy kontynuują się same** (Enter wstawia kolejny znacznik listy), bloki kodu otrzymują podświetlanie zależne od języka, wklejana zawartość jest konwertowana na Markdown (smart paste), a nagłówki można zwijać (folding).
- **Znajdź i zamień** w bieżącej notatce: `Ctrl+F` (patrz [Wyszukiwanie](Search.md)).

## Linki i linki zwrotne

- **Linki wewnętrzne**: `[[Nazwa notatki]]` (link wiki) — przez menu slash lub `@` z wbudowanym wyszukiwaniem notatek. Klasyczne linki Markdown `[tekst](ścieżka.md)` również działają.
- **Linki zwrotne**: sekcja **Linki zwrotne** w prawym pasku bocznym pokazuje, które notatki linkują do aktywnej — pogrupowane według pliku źródłowego, z licznikiem przy wielu wystąpieniach.
- **Zmiana nazwy z dbałością o linki**: przy zmianie nazwy pliku w drzewie plików Plainva aktualizuje wszystkie linki do niego w całym vaulcie (kotwice takie jak `#Sekcja` są zachowywane) i zgłasza: „Zaktualizowano N link(ów) w M pliku(ach) na nową nazwę."

## Właściwości (frontmatter)

Sekcja **Właściwości** w prawym pasku bocznym pokazuje frontmatter notatki jako formularz. **Dodaj właściwość** tworzy nowe; każda właściwość ma **Typ pola**:

| Grupa | Typy |
|---|---|
| **Podstawowe** | Tekst, Liczba, Pole wyboru, Data, Data i godzina |
| **Wybór** | Wybór, Status, Wielokrotny wybór |
| **Listy i relacje** | Lista, Tagi, Relacja |
| **Internet i kontakt** | URL, E-mail, Telefon |

Typy wyboru mogą mieć stałe opcje z **Kolorem** i (dla **Status**) **Grupą**/etapem — te listy opcji są zarządzane w bazach danych (`.base`), patrz [Bazy danych (.base)](Databases_Base.md).

Dwa pola są chronione: `type` i `okf_version` to **pola systemowe OKF** zarządzane przez Plainva — wartość `type` można wybrać z listy rozwijanej znanych typów, natomiast nazwa/typ pola/usuwanie są zablokowane (kontekst: [OKF](OKF.md)).

## Ikona dokumentu i kolor nagłówka

Każda notatka może mieć ikonę (w stylu Notion, nad tytułem, widoczną też w kartach i drzewie plików) oraz pasek koloru na pełną szerokość:

- W Podglądzie na żywo najedź nad tytuł: **Dodaj ikonę** / **Dodaj kolor nagłówka** (później: **Zmień ikonę** / **Zmień kolor nagłówka**) — lub użyj poleceń slash **Ikona dokumentu** i **Kolor nagłówka**.
- Wybór ikony ma dwa tryby: **Emoji** i **Ikony** (zestaw ikon Lucide, z wybieralnym kolorem).
- Oba są zapisywane we frontmatter pod `plainva:` (`icon`, `icon_color`, `header_color`) — czysta prezentacja, która nie przeszkadza innym programom.

## Szablony

Ustaw **Folder szablonów** w **Ustawienia → Vault → Treść i struktura** (**Wybierz folder…** obok pola pozwala wybrać folder bezpośrednio z vaulta). Następnie wstawiasz szablony przez `Ctrl+Alt+T` lub polecenie slash **Wstaw szablon**. Szablony w pełni określają zawartość nowych plików — łącznie z frontmatter: jeśli szablon ma własny `type`, to on wygrywa. Przy wstawianiu do istniejącej notatki frontmatter szablonu jest pomijany — wstawiana jest tylko treść.

Tworzenie szablonów działa z dowolnego miejsca: paleta poleceń (`Ctrl+P`) oferuje **Utwórz nowy szablon** (otwiera się nowy szablon do edycji) oraz **Zapisz bieżącą notatkę jako szablon** (kopiuje otwartą notatkę do folderu szablonów). Szablony to zwykłe pliki Markdown — edytuj, zmieniaj nazwę lub usuwaj je bezpośrednio w drzewie plików.

## Notatki dzienne

**Otwórz notatkę dzienną** (pasek boczny) lub kliknięcie w **Kalendarzu** tworzy dzisiejszą notatkę zgodnie z Twoim formatem daty, w skonfigurowanym folderze notatek dziennych, opcjonalnie z szablonu.

## Zadania, formuły, diagramy i przypisy

- **Pola wyboru zadań**: `- [ ] zadanie` renderuje się wszędzie jako pole wyboru — a w **trybie czytania** można je kliknąć: Plainva zapisuje z powrotem do pliku `[x]` lub `[ ]`.
- **Matematyka (LaTeX)**: `$E = mc^2$` w wierszu i `$$…$$` jako blok renderują się jako formuły w trybie czytania ORAZ w podglądzie na żywo (KaTeX). Gdy kursor stoi wewnątrz formuły, widoczna jest jej składnia; kliknięcie wyrenderowanej formuły otwiera ją do edycji. Tylko tryb źródłowy zawsze pokazuje surową składnię. Nie musisz pamiętać na pamięć bloku `$$…$$` — polecenie slash **Wzór (LaTeX)** (`/katex`) wstawia go i ustawia kursor w jego wnętrzu.
- **Diagramy Mermaid**: blok kodu z językiem `mermaid` (najszybciej przez polecenie slash **Diagram Mermaid**, `/mermaid`) jest rysowany jako diagram w trybie czytania i w podglądzie na żywo — kliknięcie diagramu pokazuje kod do edycji:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Przypisy**: `Tekst[^1]` plus `[^1]: Treść przypisu.` na końcu — tryb czytania renderuje odnośnik i aparat przypisów ze znacznikami skoku. Najszybciej idzie to przez polecenie slash **Przypis** (`/footnote`) — wstawia kolejny wolny odnośnik i przenosi od razu do definicji na końcu notatki.

## Drukowanie i zapisywanie jako PDF

Menu **⋮** edytora oraz paleta poleceń (`Ctrl+P`) zawierają **Drukuj / Zapisz jako PDF…**: drukowanie zawsze korzysta z widoku czytania (z trybu na żywo/źródłowego Plainva najpierw przełącza się do niego). W oknie dialogowym systemu możesz zamiast drukarki wybrać „Zapisz jako PDF".

## Eksportowanie notatki

- **Eksportuj jako Markdown…** (menu **⋮** edytora lub paleta poleceń): zapisuje kopię notatki w dowolnym miejscu za pomocą systemowego okna dialogowego — na przykład, aby przekazać ją innemu programowi. Powiązane załączniki (obrazy) nie są kopiowane razem z notatką; jeśli notatka się do nich odwołuje, Plainva pokazuje krótki komunikat.
- **PDF**: użyj **Drukuj / Zapisz jako PDF…** (powyżej) i wybierz w oknie dialogowym systemu „Zapisz jako PDF".

## Otwieranie notatki w innym edytorze

Twoje notatki to zwykłe pliki `.md`, więc może je otworzyć dowolny edytor Markdown. Menu **⋮** edytora zawiera opcję **Otwórz w domyślnej aplikacji**, która przekazuje bieżącą notatkę do programu, którego Twój system używa do plików Markdown (Byword, MacDown, VS Code i inne). Plainva nadal obserwuje ten plik, więc zmiany wprowadzone tam automatycznie pojawiają się tutaj.

## Obrazy i załączniki

- **Wstawianie**: polecenia slash **Obraz wewnętrzny** (wyszukaj i osadź z vaultu) lub **Obraz (z sieci)** (przez URL). Możesz też po prostu **wkleić** obraz ze schowka (Ctrl+V) — zostanie zapisany obok notatki i osadzony. A **pliki z eksploratora plików można przeciągnąć do edytora**: obrazy są osadzane (`![[…]]`), inne pliki są kopiowane i linkowane (`[[…]]`).
- **Podgląd**: pliki graficzne (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) otwierają się we wbudowanej przeglądarce obrazów z opcjami **Powiększ**/**Pomniejsz**, **Dopasuj** i **Rozmiar rzeczywisty (1:1)**.
- **Edycja**: przycisk **Edytuj** otwiera edytor obrazów z **Kadrowaniem**, obracaniem/odbiciem, **Zmianą rozmiaru**, narzędziami rysowania (**Pisak**, **Strzałka**, **Prostokąt**, **Tekst**) oraz **Cofnij**/**Ponów**. Zapisz bezpośrednio lub **Zapisz jako kopię…**. Edytowalne formaty to PNG, JPG i WebP; pozostałe formaty otwierają się tylko do podglądu.
- Inne załączniki otwierają się po dwukrotnym kliknięciu w domyślnym programie systemowym.

## A co z Obsidian?

Wszystko pozostaje standardowym Markdownem ze standardowym frontmatter. Obsidian otwiera pliki w pełni; zgrupowany klucz `plainva:` pokazuje jako nieedytowalny obiekt w panelu właściwości — to zamierzone i nieszkodliwe.

## Zobacz też

- [Bazy danych (.base)](Databases_Base.md) — notatki jako tabela, tablica lub kalendarz
- [OKF](OKF.md) — co oznaczają `type` i `okf_version`
- [Wyszukiwanie](Search.md) i [Skróty klawiszowe](Keyboard_Shortcuts.md)
