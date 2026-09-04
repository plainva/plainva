# OKF — Open Knowledge Format

Stan na: 2026-09-04

OKF (Open Knowledge Format) to otwarta konwencja dla kolekcji wiedzy w Markdown: zwykłe pliki Markdown z małym, jednolitym nagłówkiem frontmatter. Ta strona wyjaśnia, czym jest OKF, co Plainva robi dla niego automatycznie — i dlaczego niczego z tego nie *musisz* używać.

## Czym jest OKF?

Idea: każdy dokument w vaulcie sam mówi, czym jest. Wystarczy do tego minimalny nagłówek we frontmatter:

```markdown
---
type: Note
---
# Moja notatka
```

- **`type`** — jakiego rodzaju to dokument (np. `Note`, `Daily Note`, `Projekt`). Jedyne pole wymagane przez konwencję.
- **`okf_version`** — wersja konwencji, którą przestrzega vault. Znajduje się **raz**, w głównej `index.md` (obecnie `"0.2"`), a nie w każdej notatce.
- **`index.md`** — w każdym folderze może znajdować się jedna `index.md` jako spis treści; nazwy `index.md` i `log.md` są do tego zarezerwowane i nie powinny być używane dla zwykłych notatek.

> Piszesz pliki za pomocą narzędzia lub skryptu? Dokładny kontrakt pól — dozwolone wartości, sposób serializacji każdego typu właściwości i zasady nazw zarezerwowanych — znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

**Skąd pochodzi OKF:** OKF to otwarta specyfikacja Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), licencja Apache-2.0). Plainva stosuje się do **OKF 0.2** (opublikowanego 25 lipca 2026). Nowością w 0.2 jest pięć opcjonalnych pól, którymi notatka mówi, skąd pochodzi, czy ktoś ją sprawdził i czy nadal jest aktualna — `generated`, `verified`, `sources`, `stale_after` i `status`. To, co Plainva z nich pokazuje i zapisuje, opisano niżej w sekcji „Pochodzenie, weryfikacja i cykl życia”.

## Dlaczego Plainva używa OKF?

Zwykły Markdown jest wspaniale przenośny — ale sam w sobie nie ma niezawodnej struktury. OKF dodaje jej dokładnie tyle, ile potrzeba, a wszystko pozostaje zwykłym Markdownem ze standardowym frontmatter:

- **Bazy danych, filtry i szablony mogą polegać na strukturze.** Każda notatka niesie `type`, dzięki czemu widoki `.base` nad zwykłymi plikami pozostają niezawodne.
- **Foldery pozostają łatwe w nawigacji.** Spis treści `index.md` dla każdego folderu działa zarówno dla ludzi, jak i dla narzędzi.
- **Skrypty i asystenci AI mogą bezpiecznie pracować z Twoim vaultem**, ponieważ format zapisu na dysku jest jednolity i udokumentowany.
- **Brak zamknięcia w jednym rozwiązaniu (lock-in).** OKF to otwarta konwencja oparta na zwykłym Markdownie — inne narzędzia OKF rozumieją Twoje pliki, dziś i za dziesięć lat.

## Co Plainva robi automatycznie

**Nowe pliki** otrzymują nagłówek OKF automatycznie: każda notatka utworzona w Plainva otrzymuje `type` we frontmatter — od OKF 0.2 znacznik wersji `okf_version` znajduje się raz w głównej `index.md`, a nie już w każdej notatce. Wartości konfigurujesz dla każdego vaultu osobno: **Ustawienia → Vault → Treść i struktura → OKF (Open Knowledge Format)** → **type dla nowych notatek** (domyślnie `Note`) i **type dla notatek dziennych** (domyślnie `Daily Note`). Jeśli szablon ma własny `type`, to on wygrywa.

**Istniejące pliki nigdy nie są zmieniane bez pytania.** Plainva dodaje pola OKF tylko przy tworzeniu nowych plików lub gdy wyraźnie uruchamiasz konwersję.

**Chronione pola systemowe:** w panelu **Właściwości** pola `type` i — gdzie starsze notatki wciąż je niosą — `okf_version` są oznaczone jako pola systemowe OKF („Pole systemowe OKF – zarządzane przez Plainva”): wartość `type` można wybrać z listy rozwijanej znanych typów, `okf_version` jest tylko do wyświetlania; zmiana nazwy, zmiana typu i usuwanie są zablokowane, aby konwencja nie mogła się przypadkowo zepsuć.

**Okno wyjaśniające:** **Czym jest OKF?** w ustawieniach daje Ci skróconą wersję w trzech zdaniach oraz link do tej strony. Nie otwiera się już samo; jeśli vault zawiera pliki, które nie są zgodne z formatem OKF, Plainva zgłasza to jednorazowo w małym komunikacie z przyciskiem, który prowadzi Cię bezpośrednio do konwersji.

## Pochodzenie, weryfikacja i cykl życia (OKF 0.2)

Od OKF 0.2 notatka może mówić, skąd pochodzi, kto ją sprawdził i czy nadal jest aktualna. Plainva zamienia to w trzy rzeczy:

**Co Plainva pokazuje.**

- Notatka ze `status: draft` lub `status: deprecated` niesie odznakę w nagłówku dokumentu — **Szkic** lub **Wycofana**. `stable` pozostaje ciche; własna kolumna `status` z innymi wartościami (powiedzmy `Open` w bazie zadań) nie jest stanem cyklu życia i nie otrzymuje odznaki.
- Gdy minie `stale_after`, nad notatką pojawia się komunikat **Oznaczona jako nieaktualna (od …)** ze skrótem do właściwości. Komunikat jest tylko do wyświetlania — Plainva niczego w notatce nie zmienia.
- Sekcja **Zaufanie i pochodzenie** panelu właściwości (na telefonie: w karcie kontekstowej notatki) podsumowuje pola i wyprowadza z nich poziom zaufania: **Niezweryfikowana**, **Potwierdzona maszynowo** lub **Sprawdzona przez osobę** — plus autora wygenerowania, listę sprawdzeń, źródła jako klikalne linki, status i datę nieaktualności. Wiersze **Status**, **Nieaktualna po** i **Wersja OKF** mają przetłumaczone etykiety; klucz zapisany w pliku (`status`, `stale_after`, `okf_version`) pojawia się jako podpowiedź przy ikonie kłódki i nigdy się nie zmienia.

**Co Plainva zapisuje.**

- `generated` (a tam, gdzie źródło jest znane, także `sources`) ustawiają dokładnie trzy maszynowe ścieżki zapisu: **importer** (`plainva-import/<wersja>`, jeden moment na przebieg — raport importu też go niesie), **przechwytywanie e-maili** (`plainva-mail-capture/<wersja>`, ze źródłem = Message-ID wiadomości) oraz **synchronizacja zadań** (`plainva-task-sync/<wersja>`, tylko gdy tworzy notatkę).
- `verified` jest zapisywane wyłącznie przez **Oznacz jako sprawdzoną** w sekcji **Zaufanie i pochodzenie**: Plainva dopisuje do listy `human:<Twoje imię>` wraz z bieżącym momentem — druga weryfikacja nigdy nie nadpisuje pierwszej. O Twoje imię pyta się raz na vault; zostaje na tym urządzeniu i można je zmienić pod **Ustawienia → Vault → Treść i struktura → Nazwa sprawdzającego**.
- Edytor nigdy sam nie dotyka żadnego z tych pól, a istniejące notatki nigdy nie są oznaczane z mocą wsteczną. `status` i `stale_after` ustawiasz sam, jako właściwość albo we frontmatter.

**Podnoszenie wersji pakietu.** Wersja konwencji znajduje się raz, w głównej `index.md`. Vault, który wciąż deklaruje `"0.1"`, działa dalej bez zmian — pod **Ustawienia → Vault → Treść i struktura → Wersja pakietu** (na telefonie: **Ustawienia → Vault → Konserwacja → Wersja pakietu**) podnosisz ją do 0.2 przyciskiem **Podnieś…**. Okno dialogowe pokazuje z wyprzedzeniem, co się zmieni: linię w głównej `index.md` oraz, jako pole wyboru (domyślnie zaznaczone), usunięcie przestarzałego pola `okf_version` z notatek, które wciąż je niosą. Każdy plik jest kopiowany do kopii zapasowej przed zmianą; **Uporządkuj…** wykonuje tylko drugą część. Szczegółowa tabela pól i reguły zapisu znajdują się w [Dokumentacji formatu plików](File_Format_Reference.md).

## index.md: spis treści dla każdego folderu

`index.md` to spis treści folderu: lista zawartych w nim notatek i podfolderów, z opisami i linkami względnymi.

- **Generowanie** — zawsze na Twoje działanie, nigdy znikąd: kliknij prawym przyciskiem na folder → **Utwórz przegląd** / **Odśwież przegląd**, lub zbiorczo przez **zarządzanie index.md** (**Ustawienia → Vault → Treść i struktura**).
- **Przejęcie zamiast generowania** — jeśli masz już notatki przeglądowe (MOC, przegląd, folder note, README…), zarządzanie proponuje je jako kandydatów. **Przejmij** zmienia nazwę pliku na `index.md` (linki są aktualizowane w całym vaulcie) i może opcjonalnie przygotować go pod OKF.
- **Automatyczna aktualizacja** — listingi *wygenerowane* przez Plainva mają na końcu pliku niewidoczny znacznik (komentarz HTML). Tylko takie oznaczone pliki są automatycznie aktualizowane, ilekroć coś się zmieni w folderze — i tylko w vaultach OKF (rozpoznawanych po `okf_version` w głównej `index.md`).
- **Tylko do odczytu z wyjściem awaryjnym** — zarządzane pliki index.md otwierają się w trybie czytania z banerem „Ten plik index.md jest zarządzany przez Plainva i aktualizowany automatycznie.” Tam możesz kliknąć **Odśwież** — lub wybrać **Edytuj mimo to**: usuwa to znacznik, a plik znów w pełni należy do Ciebie (już bez automatycznych aktualizacji).
- **Wszystko naraz** — **Zaktualizuj wszystkie pliki index.md** jest dostępne w menu kontekstowym głównego katalogu vaultu i w ustawieniach; pliki bez znacznika są przy tym pomijane.
- **Uzupełnianie braków** — w zarządzaniu index.md przycisk **Utwórz index.md we wszystkich folderach bez niego** zaznacza z góry każdy folder, który nie ma jeszcze index.md, dzięki czemu możesz utworzyć je wszystkie za jednym razem.
- **Na telefonie** — to samo, dwoma drzwiami: przytrzymanie folderu proponuje **Utwórz przegląd** albo **Odśwież przegląd**, zależnie od tego, czego ten folder potrzebuje. Do rzadkiego przeglądu całego sejfu służy **Ustawienia → Vault → Konserwacja → Przeglądy**: foldery bez przeglądu są na górze, a **Utwórz index.md w N folderach bez niego** tworzy je za jednym razem. Folder, którego `index.md` napisałeś sam, pojawia się na liście i pozostaje nietknięty — przejęcie jest nazwaną decyzją na tej liście, nigdy skutkiem ubocznym dotknięcia. Automatyczne utrzymanie działa teraz również na telefonie: sejf edytowany tam nie dezaktualizuje się już, dopóki nie otworzy go komputer.
- W trybie czytania zarządzane listingi renderują się jako karty z ikonami plików/folderów; linki otwierają się bezpośrednio w Plainva.

## Konwertowanie istniejącego vaultu (opt-in)

Jeśli pliki w vaulcie nie są zgodne z formatem OKF (brak pola `type` lub zarezerwowane nazwy używane jako zwykłe notatki), Plainva oferuje konwersję — jednorazowo przy otwieraniu vaultu i na stałe w **Ustawienia → Vault → Treść i struktura** (wpis pojawia się tylko wtedy, gdy jest coś do zrobienia).

Kreator **Konwertuj do formatu OKF** działa w jasnych krokach:

1. **Skanowanie** — pokazuje, ile plików jest dotkniętych (foldery szablonów i systemowe są wykluczone; pliki z nieczytelnym frontmatter są pomijane, nigdy „naprawiane”).
2. **Decyzje** — domyślny `type` dla plików bez niego; istniejące wartości `type` możesz **zachować** (zalecane — są już prawidłowymi typami OKF) lub zmienić nazwę na inne pole.
3. **Podgląd (bez zmian)** — dry run pokazuje z wyprzedzeniem, co by się zmieniło.
4. **Konwersja** — przed każdą zmianą plik jest kopiowany do `.plainva/backups/`; raport podsumowuje zmienione, pominięte i folder kopii zapasowej. Potem możesz opcjonalnie **przejść do zarządzania index.md**.

Wskazówka z kreatora: zmiany przechodzą normalnie przez synchronizację — dla vaultów git wykonaj najpierw commit.

### Na telefonie

Ta sama droga istnieje też mobilnie: **Ustawienia → Vault → Konserwacja → Konwertuj do formatu OKF**. Kroki są te same — skanowanie, decyzje, podgląd, konwersja — a podgląd wymienia z nazwy notatki, których to dotyczy, zanim cokolwiek zostanie zapisane.

Dochodzą dwie rzeczy, ponieważ telefon może w każdej chwili usunąć aplikację z pamięci:

- **Wstrzymanie i wznowienie.** Przebieg zatrzymuje się przy następnym pliku, gdy dotkniesz **Wstrzymaj** albo aplikacja przejdzie w tło. Wznowienie zapisuje do tego samego folderu kopii zapasowej — drugi nie powstaje.
- **Pytanie przy starcie.** Jeśli przebieg pozostanie niedokończony, Plainva powie o tym przy następnym otwarciu vaulta i zaproponuje **Kontynuuj** lub **Wycofaj**; **Później** to poprawna odpowiedź. Przerwany przebieg zostawia vault przekonwertowany częściowo, a nie uszkodzony: dodawane są wyłącznie pola frontmattera, a każda notatka pozostaje poprawnym Markdownem.

**Wycofaj** przywraca pliki z folderu kopii zapasowej — także na komputerze, z raportu na końcu przebiegu. Folder kopii zostaje potem na miejscu; to jedyna kopia stanu sprzed konwersji.

## Czy muszę używać OKF?

Nie. OKF to łagodny standard:

- Nowe pliki otrzymują nagłówek automatycznie — nigdzie to nie przeszkadza i nic nie kosztuje.
- Istniejące vaulty (np. z Obsidian) działają dalej bez zmian; konwersja jest ściśle opcjonalna.
- Brakujące `okf_version` — lub takie, które starsze notatki wciąż niosą — nie liczy się jako naruszenie; możesz na stałe równolegle używać Plainva i Obsidian bez ciągłych przypomnień.
- Obsidian i każdy inny edytor mogą nadal otwierać wszystkie pliki: to jest i pozostaje zwykły Markdown.

## Zobacz też

- [Dokumentacja formatu plików](File_Format_Reference.md) — dokładny kontrakt na dysku dla każdego pliku vaultu
- [Notatki i Markdown](Notes_and_Markdown.md) — frontmatter i właściwości
- [Bazy danych (.base)](Databases_Base.md) — co w praktyce daje jednolity `type`
- [FAQ i rozwiązywanie problemów](FAQ.md) — m.in. kopie zapasowe i index.md tylko do odczytu
