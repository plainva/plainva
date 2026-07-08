# OKF — Open Knowledge Format

Stan na: 2026-07-08

OKF (Open Knowledge Format) to otwarta konwencja dla kolekcji wiedzy w Markdown: zwykłe pliki Markdown z małym, jednolitym nagłówkiem frontmatter. Ta strona wyjaśnia, czym jest OKF, co Plainva robi dla niego automatycznie — i dlaczego niczego z tego nie *musisz* używać.

## Czym jest OKF?

Idea: każdy dokument w vaulcie sam mówi, czym jest. Wystarczy do tego minimalny nagłówek we frontmatter:

```markdown
---
type: Note
okf_version: "0.1"
---
# Moja notatka
```

- **`type`** — jakiego rodzaju to dokument (np. `Note`, `Daily Note`, `Projekt`). Jedyne pole wymagane przez konwencję.
- **`okf_version`** — wersja konwencji, według której plik został zapisany.
- **`index.md`** — w każdym folderze może znajdować się jedna `index.md` jako spis treści; nazwy `index.md` i `log.md` są do tego zarezerwowane i nie powinny być używane dla zwykłych notatek.

> Piszesz pliki za pomocą narzędzia lub skryptu? Dokładny kontrakt pól — dozwolone wartości, sposób serializacji każdego typu właściwości i zasady nazw zarezerwowanych — znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

## Dlaczego Plainva używa OKF?

Zwykły Markdown jest wspaniale przenośny — ale sam w sobie nie ma niezawodnej struktury. OKF dodaje jej dokładnie tyle, ile potrzeba, a wszystko pozostaje zwykłym Markdownem ze standardowym frontmatter:

- **Bazy danych, filtry i szablony mogą polegać na strukturze.** Każda notatka niesie `type`, dzięki czemu widoki `.base` nad zwykłymi plikami pozostają niezawodne.
- **Foldery pozostają łatwe w nawigacji.** Spis treści `index.md` dla każdego folderu działa zarówno dla ludzi, jak i dla narzędzi.
- **Skrypty i asystenci AI mogą bezpiecznie pracować z Twoim vaultem**, ponieważ format zapisu na dysku jest jednolity i udokumentowany.
- **Brak zamknięcia w jednym rozwiązaniu (lock-in).** OKF to otwarta konwencja oparta na zwykłym Markdownie — inne narzędzia OKF rozumieją Twoje pliki, dziś i za dziesięć lat.

## Co Plainva robi automatycznie

**Nowe pliki** otrzymują nagłówek OKF automatycznie: każda notatka utworzona w Plainva otrzymuje `type` i `okf_version` we frontmatter. Wartości konfigurujesz dla każdego vaultu osobno: **Ustawienia → Ustawienia vaultu → OKF (Open Knowledge Format)** → **type dla nowych notatek** (domyślnie `Note`) i **type dla notatek dziennych** (domyślnie `Daily Note`). Jeśli szablon ma własny `type`, to on wygrywa.

**Istniejące pliki nigdy nie są zmieniane bez pytania.** Plainva dodaje pola OKF tylko przy tworzeniu nowych plików lub gdy wyraźnie uruchamiasz konwersję.

**Chronione pola systemowe:** w panelu **Właściwości** pola `type` i `okf_version` są oznaczone jako pola systemowe OKF („Pole systemowe OKF – zarządzane przez Plainva”): wartość `type` można wybrać z listy rozwijanej znanych typów, `okf_version` jest tylko do wyświetlania; zmiana nazwy, zmiana typu i usuwanie są zablokowane, aby konwencja nie mogła się przypadkowo zepsuć.

**Okno wyjaśniające:** przy pierwszym otwarciu vaultu Plainva jednorazowo pokazuje **Czym jest OKF?** — to samo podsumowanie jest zawsze dostępne w ustawieniach.

## index.md: spis treści dla każdego folderu

`index.md` to spis treści folderu: lista zawartych w nim notatek i podfolderów, z opisami i linkami względnymi.

- **Generowanie** — zawsze na Twoje działanie, nigdy znikąd: kliknij prawym przyciskiem na folder → **Wygeneruj/odśwież index.md**, lub zbiorczo przez **zarządzanie index.md** (**Ustawienia → OKF → Otwórz…**).
- **Przejęcie zamiast generowania** — jeśli masz już notatki przeglądowe (MOC, przegląd, folder note, README…), zarządzanie proponuje je jako kandydatów. **Przejmij** zmienia nazwę pliku na `index.md` (linki są aktualizowane w całym vaulcie) i może opcjonalnie przygotować go pod OKF.
- **Automatyczna aktualizacja** — listingi *wygenerowane* przez Plainva mają na końcu pliku niewidoczny znacznik (komentarz HTML). Tylko takie oznaczone pliki są automatycznie aktualizowane, ilekroć coś się zmieni w folderze — i tylko w vaultach OKF (rozpoznawanych po `okf_version` w głównej `index.md`).
- **Tylko do odczytu z wyjściem awaryjnym** — zarządzane pliki index.md otwierają się w trybie czytania z banerem „Ten plik index.md jest zarządzany przez Plainva i aktualizowany automatycznie.” Tam możesz kliknąć **Odśwież** — lub wybrać **Edytuj mimo to**: usuwa to znacznik, a plik znów w pełni należy do Ciebie (już bez automatycznych aktualizacji).
- **Wszystko naraz** — **Zaktualizuj wszystkie pliki index.md** jest dostępne w menu kontekstowym głównego katalogu vaultu i w ustawieniach; pliki bez znacznika są przy tym pomijane.
- **Uzupełnianie braków** — w zarządzaniu index.md przycisk **Utwórz index.md we wszystkich folderach bez niego** zaznacza z góry każdy folder, który nie ma jeszcze index.md, dzięki czemu możesz utworzyć je wszystkie za jednym razem.
- W trybie czytania zarządzane listingi renderują się jako karty z ikonami plików/folderów; linki otwierają się bezpośrednio w Plainva.

## Konwertowanie istniejącego vaultu (opt-in)

Jeśli pliki w vaulcie nie są zgodne z formatem OKF (brak pola `type` lub zarezerwowane nazwy używane jako zwykłe notatki), Plainva oferuje konwersję — jednorazowo przy otwieraniu vaultu i na stałe w **Ustawienia → OKF → Konwersja OKF** (wpis pojawia się tylko wtedy, gdy jest coś do zrobienia).

Kreator **Konwertuj do formatu OKF** działa w jasnych krokach:

1. **Skanowanie** — pokazuje, ile plików jest dotkniętych (foldery szablonów i systemowe są wykluczone; pliki z nieczytelnym frontmatter są pomijane, nigdy „naprawiane”).
2. **Decyzje** — domyślny `type` dla plików bez niego; istniejące wartości `type` możesz **zachować** (zalecane — są już prawidłowymi typami OKF) lub zmienić nazwę na inne pole.
3. **Podgląd (bez zmian)** — dry run pokazuje z wyprzedzeniem, co by się zmieniło.
4. **Konwersja** — przed każdą zmianą plik jest kopiowany do `.plainva/backups/`; raport podsumowuje zmienione, pominięte i folder kopii zapasowej. Potem możesz opcjonalnie **przejść do zarządzania index.md**.

Wskazówka z kreatora: zmiany przechodzą normalnie przez synchronizację — dla vaultów git wykonaj najpierw commit.

## Czy muszę używać OKF?

Nie. OKF to łagodny standard:

- Nowe pliki otrzymują nagłówek automatycznie — nigdzie to nie przeszkadza i nic nie kosztuje.
- Istniejące vaulty (np. z Obsidian) działają dalej bez zmian; konwersja jest ściśle opcjonalna.
- Samo brakujące `okf_version` nie liczy się jako naruszenie — możesz na stałe równolegle używać Plainva i Obsidian bez ciągłych przypomnień.
- Obsidian i każdy inny edytor mogą nadal otwierać wszystkie pliki: to jest i pozostaje zwykły Markdown.

## Zobacz też

- [Dokumentacja formatu plików](File_Format_Reference.md) — dokładny kontrakt na dysku dla każdego pliku vaultu
- [Notatki i Markdown](Notes_and_Markdown.md) — frontmatter i właściwości
- [Bazy danych (.base)](Databases_Base.md) — co w praktyce daje jednolity `type`
- [FAQ i rozwiązywanie problemów](FAQ.md) — m.in. kopie zapasowe i index.md tylko do odczytu
