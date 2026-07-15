# Zadania

Stan na: 2026-07-15

Widok Zadania zbiera w jednym miejscu każde pole wyboru w Twoim vaulcie: wszystkie elementy list `- [ ]` i `- [x]` ze wszystkich Twoich notatek, pogrupowane według notatki, w której się znajdują. To widok „co jeszcze muszę zrobić?" na zwykłym Markdownie — bez wtyczki, bez specjalnego pliku.

## Dlaczego osobny widok (a nie `.base`)

[Baza danych (`.base`)](Databases_Base.md) działa na całych notatkach — jeden wiersz na notatkę. Pole wyboru to pojedyncza *linia* wewnątrz notatki, a notatka może zawierać ich wiele, więc `.base` nie może ich wyświetlić. Widok Zadania działa na poziomie linii: czyta linie zadań bezpośrednio, dzięki czemu pojedyncza notatka projektu z dziesięcioma podzadaniami pokazuje wszystkie dziesięć.

## Otwieranie widoku Zadania

- Kliknij **ikonę listy zadań** na pasku akcji przy lewej krawędzi, lub
- otwórz **paletę poleceń** (`Ctrl/Cmd+P`) i uruchom **Otwórz zadania**.

Widok otwiera się jako karta, tak jak każda notatka.

## Czytanie listy

Zadania są pogrupowane według notatki; tytuł notatki to nagłówek, który można kliknąć, aby otworzyć notatkę. Każde zadanie pokazuje swoje pole wyboru i tekst, przekreślony po ukończeniu. **Termin** zapisany jako `📅 2026-08-01` w linii zadania pojawia się jako mała plakietka.

## Filtrowanie

Pasek na górze zawęża listę:

- **Otwarte / Ukończone / Wszystkie** — według stanu pola wyboru (domyślnie **Otwarte**).
- **Filtruj zadania…** — dowolny tekst; dopasowuje treść zadania.
- **Wszystkie foldery** — tylko zadania w wybranym folderze (i jego podfolderach).
- **Wszystkie tagi** — tylko zadania z wybranym tagiem `#tag` w treści.
- **Z terminem** — tylko zadania z datą `📅`.

Tagi i terminy są odczytywane bezpośrednio z linii zadania — na przykład `- [ ] Zapłać fakturę #finance 📅 2026-08-01`.

## Odznaczanie zadań

Kliknij **pole wyboru** zadania, aby przełączyć je między stanem otwartym a ukończonym. Zmiana jest zapisywana bezpośrednio z powrotem do notatki (jako zwykły, bezpieczny zapis pliku — zmienia się tylko pojedynczy znak `[ ]`/`[x]`), dzięki czemu notatka, Obsidian i ewentualna synchronizacja pozostają zgodne. Kliknij zamiast tego **tekst** zadania, aby otworzyć notatkę i przejść do tej linii.

Jeśli notatka zmieniła się od momentu zbudowania listy, nieaktualne przełączenie jest pomijane, a lista się odświeża — przycisk **odśwież** w prawym górnym rogu pozwala przeładować listę w każdej chwili.

## Zgodność z Obsidian

Zadania to zwykłe pola wyboru GFM (GitHub-Flavored Markdown). Plainva nigdy nie dodaje specjalnej składni: te same linie `- [ ]` renderują się jako pola wyboru w Obsidian i czytelnie wyświetlają się w dowolnym edytorze. Konwencje `📅 data` i `#tag` to typowy styl wtyczki Obsidian Tasks, ale w Twojej notatce są to zwykły tekst.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — pisanie list zadań w edytorze
- [Wyszukiwanie](Search.md) — wyszukiwanie pełnotekstowe w całym vaulcie
- [Bazy danych (.base)](Databases_Base.md) — bazy danych na poziomie notatek
