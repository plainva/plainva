# Zadania

Stan na: 2026-07-26
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

## Domyślna baza zadań

Pola wyboru świetnie nadają się do szybkich notatek, ale czasem linia rozrasta się do „prawdziwego” zadania — ze statusem, terminem i własną notatką. Służy do tego opcja **Domyślna baza zadań** w **Ustawienia → Vault → Treść i struktura**: [baza danych (`.base`)](Databases_Base.md), w której takie zadania żyją jako osobne notatki. **Utwórz nową bazę…** od razu tworzy gotową bazę danych (folder zapisu oraz `.base` z **kolumną pola wyboru zrobione** (`zrobione`), kolumną statusu, kolumną terminu, widokiem tabeli i tablicy); możesz też równie dobrze wybrać istniejącą bazę danych. Właściwość pola wyboru jest źródłem prawdy o ukończeniu zadania (włączone/wyłączone — tak jak u dostawców); kolumna statusu pozostaje spójna, gdy je odhaczasz. Baza danych bez kolumny pola wyboru korzysta z konwencji statusu: pierwsza opcja = otwarte, ostatnia = zrobione.

Po ustawieniu widok Zadania pokazuje dwie sekcje: wpisy **Bazy zadań** na górze oraz **Z notatek** poniżej — znajomą listę pól wyboru. Status można edytować bezpośrednio w przeglądzie: pole wyboru JEST właściwością zrobione tej notatki i ją przełącza (kolumna statusu podąża za tą zmianą), a kliknięcie plakietki statusu otwiera menu ze wszystkimi opcjami (**Zmień status**). Filtry **Otwarte**/**Ukończone**/**Wszystkie** dotyczą obu sekcji, a **Otwórz jako bazę** przenosi do pełnego widoku bazy danych z jej tablicą i filtrami. **Odśwież** dodatkowo uruchamia rzeczywistą synchronizację z dostawcą, gdy połączone są konta.

## Zamiana pola wyboru na zadanie w bazie danych

Każdy wiersz zadania niesie ikonę bazy danych: **Przenieś do bazy zadań**. Jedno kliknięcie

- tworzy nową notatkę w folderze zapisu bazy danych (z użyciem jej domyślnego szablonu, jeśli jest ustawiony),
- przenosi datę `📅` do kolumny terminu, ustawia pierwszą opcję statusu dla otwartych zadań i zapisuje `#tags` z linii jako tagi notatki,
- łączy nową notatkę z powrotem z notatką źródłową za pomocą właściwości `source` oraz
- zastępuje linię pola wyboru w notatce źródłowej linkiem wiki do nowej notatki zadania — element pozostaje czytelny tam, gdzie został napisany, a zadanie żyje teraz w bazie danych.

**Kliknij prawym przyciskiem** ikonę, aby zamiast tego wybrać inną bazę danych jako cel; jeśli nie ustawiono domyślnej bazy danych, kliknięcie od razu otwiera ten wybór. Wszystko pozostaje zwykłym Markdownem: nowe zadanie to zwykła notatka z frontmatter, a link w notatce źródłowej to normalny `[[link wiki]]`.

**+ Nowe zadanie** w nagłówku sekcji tworzy wpis bezpośrednio w bazie zadań (ten sam folder zapisu, szablon i wartości domyślne co przy przenoszeniu pola wyboru) i otwiera go. Pola wyboru napisane w notatce w niej pozostają — zadaniami bazy stają się dopiero wtedy, gdy je przeniesiesz.

## Blokowanie czasu na zadanie

Zadania w Plainvie mają dokładność **dzienną**: zadanie ma termin, a nie godzinę. Gdy chcesz zarezerwować na nie okno czasowe, Plainva tworzy **wydarzenie** — to obiekt, który ma zakres czasu, pokazuje nakładanie się w siatce i synchronizuje się z Twoim kontem kalendarza.

Ikona kalendarza w wierszu zadania otwiera **Zablokuj czas**: datę (wypełnioną terminem), początek i **Czas trwania** (15 min, 30 min, 1 godz., 2 godz. lub **Własny**), a przy kilku zapisywalnych kalendarzach także wybór kalendarza. Wydarzenie nosi tytuł zadania i odsyła z powrotem do notatki.

Przy zadaniu z bazy danych notatka zapamiętuje blokadę również w swoim frontmatterze (`plainva.blocks`), więc powiązanie widać z obu stron. Wiersz z polem wyboru nie ma własnej notatki — powstaje tam tylko wydarzenie wskazujące notatkę, w której znajduje się ten wiersz. Ikona pojawia się tylko wtedy, gdy podłączone jest konto kalendarza.

## Powtarzanie zadań

Zadanie, które powraca regularnie, otrzymuje **Powtarzanie** za pomocą ikony powtarzania w sekcji **Baza zadań**. Plainva nie tworzy **serii**: odhaczenie zadania tworzy **następne** jako osobną notatkę obok ukończonej, z nowym terminem. Dzięki temu zawsze otwarte jest dokładnie jedno zadanie, ukończone pozostaje jako zapis tego, co zostało zrobione, a nie istnieje niewidoczna seria, z której można by przypadkiem usunąć wszystko naraz — usunięcie zadania kończy łańcuch.

Okno dialogowe oferuje trzy elementy:

- **Rytm** — Codziennie, Co tydzień, Co miesiąc lub Co rok, plus interwał pod **Co** (na przykład „Co 3" + „Codziennie" = co trzy dni).
- **Liczone od: Terminu** — stały rytm („co poniedziałek"). Odhaczenie zaległego zadania z opóźnieniem sprawia, że Plainva przeskakuje do najbliższego terminu **w przyszłości**, zamiast zapychać listę tymi, które zostały przegapione.
- **Liczone od: Wykonania** — rytm zaczyna się w dniu odhaczenia zadania („co trzy dni po podlaniu roślin").

**Nie powtarzaj** ponownie usuwa powtarzanie. Zadania miesięczne nigdy nie przesuwają się poza koniec miesiąca: 31 stycznia plus miesiąc to 28 lub 29 lutego, a nie 3 marca.

Reguła znajduje się we frontmatterze notatki (`plainva.repeat`) i dzięki temu podróżuje razem z synchronizacją — nie jest ukrytym ustawieniem aplikacji ani kolumną bazy danych, ponieważ należy do **tego** zadania, a nie do każdego wpisu w bazie danych. Zadania odzwierciedlone z listy zadań Twojego dostawcy nie oferują powtarzania: powtarzają się tam, a dodatkowy rytm nałożony na to spowodowałby duplikaty odsyłane z powrotem do dostawcy.

## Ukrywanie notatek z widoku Zadania

Niektóre notatki zawierają pola wyboru, które nigdy nie są „prawdziwymi" zadaniami — przede wszystkim **szablony**. Aby trzymać je z dala od listy, notatka może wykluczyć samą siebie. Prawda pozostaje w pliku: wykluczenie to pole frontmatter w notatce, a nie ukryte ustawienie aplikacji. Synchronizuje się, jest widoczne w Obsidian i można je sprawdzić w dowolnym edytorze tekstu:

```yaml
---
plainva:
  tasks: false
---
```

Nie musisz zapisywać tego pola ręcznie:

- **Ukryj z zadań** — ikona oka znajduje się po prawej stronie wiersza nagłówka każdej notatki; jedno kliknięcie zapisuje znacznik w tej notatce i ją ukrywa.
- **Pokaż ukryte** — ta opcja na pasku filtrów przywraca ukryte notatki (przyciemnione), każda z ikoną **Pokaż ponownie w zadaniach** (która usuwa znacznik).
- **Ukryj szablony** — jeśli Twój folder szablonów zawiera notatki z polami wyboru, w prawym górnym rogu pojawia się przycisk **Ukryj szablony**, który jednocześnie zapisuje znacznik we wszystkich nich.

Nowo utworzone szablony automatycznie niosą znacznik. Gdy tworzysz notatkę **z** szablonu, znacznik jest ponownie usuwany — nowa notatka to prawdziwa treść i normalnie pokazuje swoje zadania.

## Zgodność z Obsidian

Zadania to zwykłe pola wyboru GFM (GitHub-Flavored Markdown). Plainva nigdy nie dodaje specjalnej składni: te same linie `- [ ]` renderują się jako pola wyboru w Obsidian i czytelnie wyświetlają się w dowolnym edytorze. Konwencje `📅 data` i `#tag` to typowy styl wtyczki Obsidian Tasks, ale w Twojej notatce są to zwykły tekst.

## Zobacz też

- [Notatki i Markdown](Notes_and_Markdown.md) — pisanie list zadań w edytorze
- [Wyszukiwanie](Search.md) — wyszukiwanie pełnotekstowe w całym vaulcie
- [Bazy danych (.base)](Databases_Base.md) — bazy danych na poziomie notatek

## Oznaczanie w przeglądzie

Zaznaczenie zadania w przeglądzie zapisuje pole w notatce źródłowej i odświeża tę notatkę w indeksie przed ponownym odczytem listy. Zadanie natychmiast znika z **Otwarte** i nie wraca z nieaktualnego indeksu.
