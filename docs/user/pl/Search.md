# Wyszukiwanie

Stan na: 2026-07-15

Plainva oferuje trzy sposoby wyszukiwania: wyszukiwanie pełnotekstowe w całym vaulcie, szybkie przełączanie do otwierania plików oraz znajdź i zamień wewnątrz notatki.

## Wyszukiwanie pełnotekstowe w vaulcie

Pole wyszukiwania na górze paska bocznego **Pliki** przeszukuje cały vault — tytuły *i* treść. Stoi za tym lokalny indeks pełnotekstowy (SQLite FTS5), budowany przy otwieraniu vaultu i utrzymywany na bieżąco przy każdej zmianie; wyszukiwanie działa więc również offline i bez zauważalnego opóźnienia.

Wyszukiwanie reaguje w trakcie pisania: prefiksy słów pasują już od razu ("Projek" znajduje "Projekt plan") — bez potrzeby naciskania Enter. **X** po prawej stronie pola czyści bieżące wyszukiwanie (albo naciśnij `Esc`); pasek boczny pokazuje wtedy znowu zwykłe drzewo plików.

Lista wyników pokazuje na górze liczbę trafień i grupuje wyniki: najpierw trafienia **Nazwa pliku** (termin występuje w nazwie notatki), potem trafienia **Treść**. Każdy wiersz pokazuje ikonę dokumentu, ścieżkę folderu oraz — przy trafieniach w treści — fragment tekstu z podświetlonym dopasowaniem. Kliknięcie wyniku otwiera notatkę i przenosi od razu do pierwszego wystąpienia; jest ono tam zaznaczone. Jeśli nic nie pasuje, lista pokazuje **Brak wyników**.

Pole wyszukiwania działa też w pozostałych widokach paska bocznego: w **Tagi** filtruje listę tagów, w **Zakładki** — zakładki.

### Operatory wyszukiwania

- `"dokładna fraza"` — cudzysłów dopasowuje sekwencję słów dokładnie. Działa to też jako wyszukiwanie całego wyrazu dla pojedynczego słowa: `"plan"` znajduje "plan", ale nie "planowanie".
- `-termin` — wyklucza notatki zawierające dany termin (działa też z frazami: `-"stara wersja"`).
- `path:folder` — tylko pliki, których ścieżka zawiera dany tekst (np. `path:Projekty`; ze spacjami: `path:"Mój Folder"`).
- `tag:nazwa` — tylko notatki z danym tagiem, wliczając tagi zagnieżdżone: `tag:projekt` znajduje też `#projekt/wewnetrzny`. `tag:#projekt` działa równie dobrze.
- Operatory można zanegować (`-path:Archiwum`, `-tag:zrobione`) i dowolnie łączyć z terminami wyszukiwania: `plan tag:projekt -szkic`.
- Wiele terminów łączonych jest operatorem AND. Znaki specjalne takie jak `- ( ) : *` wewnątrz terminów są nieszkodliwe — Plainva traktuje wpis dosłownie.

## Szybkie przełączanie (Quick Switcher)

`Ctrl+O` lub `Ctrl+K` otwiera szybkie przełączanie: wpisz tekst, nawiguj strzałkami, otwórz przez `Enter`. Bez wpisanego tekstu pokazuje listę **Ostatnie pliki** — najszybszy sposób na przeskakiwanie między aktualnymi notatkami. Wyniki można też otwierać bezpośrednio w nowej karcie (stopka okna dialogowego pokazuje odpowiednie klawisze).

Dopasowanie jest rozmyte (fuzzy): `notprojekt` znajduje też „Notatka Projekt" — litery muszą pojawić się tylko w odpowiedniej kolejności, a początki wyrazów liczą się dodatkowo. A gdy notatka jeszcze nie istnieje, lista pokazuje **Utwórz „…"**: `Enter` tworzy ją od razu (w katalogu głównym vaultu) i otwiera — wpisz nazwę, naciśnij Enter, zacznij pisać.

Poniżej trafień w nazwie przełącznik pokazuje dodatkowo grupę **Treść**: notatki, których tekst pasuje do wpisu, z podświetlonym fragmentem dopasowania. Otwarcie takiego wyniku przenosi od razu do dopasowania wewnątrz notatki — tak samo jak przy wyszukiwaniu w pasku bocznym.

## Znajdź i zamień w notatce

`Ctrl+F` otwiera pasek wyszukiwania edytora (w Podglądzie na żywo i w trybie źródłowym):

- **Znajdź** przez `Enter`/**następny** i **poprzedni** po trafieniach; **wszystkie** podświetla każde wystąpienie.
- Opcje: **wielkość liter**, **całe wyrazy**, **regexp**.
- **Zamień**: zamień pojedyncze trafienia (**zamień**) lub **zamień wszystko**.

### W całym vaulcie

`Ctrl/Cmd+Shift+F` (albo **Znajdź i zamień w vaulcie** w palecie poleceń) przeszukuje od razu wszystkie notatki. Wpisz termin, naciśnij **Znajdź**, a dopasowania pojawią się pogrupowane według notatki, każde z linią kontekstu. Wpisz zamiennik, odznacz notatki, które chcesz pominąć, a **Zamień w N notatkach** przepisze resztę — każda notatka jest zapisywana z powrotem w bezpieczny sposób (zapis atomowy + migawka wersji), dzięki czemu nieaktualny podgląd nigdy nie nadpisze nowszej treści. Wielkość liter, całe wyrazy i regexp działają też tutaj; w trybie regexp w zamienniku dostępne są odwołania wsteczne `$1`/`$2`.

## Tagi

Widok paska bocznego **Tagi** wyświetla wszystkie `#tagi` w vaulcie z liczbą wystąpień; kliknięcie pokazuje **Pliki z #tag**. Tagi działają w tekście (`#projekt`) oraz we frontmatter (`tags: [projekt]`). Pole wyszukiwania paska bocznego filtruje też listę tagów.

**Zmiana nazwy tagu** obejmuje od razu cały vault: kliknij prawym przyciskiem myszy tag w widoku **Tagi** i wpisz nową nazwę. Plainva przepisuje tag wszędzie — w tekście notatek (`#tag` oraz jego podtagi `#tag/child`) i we frontmatter (`tags:`) — zapisując każdą dotkniętą notatkę z powrotem tą samą bezpieczną drogą. Niepowiązane tagi, które jedynie zawierają tę nazwę (na przykład `#area/tag`), pozostają nietknięte.

## Nawigacja w notatce

**Konspekt** w prawym pasku bocznym wyświetla wszystkie nagłówki aktywnej notatki — kliknięcie przenosi do danego miejsca. Do przeskakiwania między notatkami pomocne są też **Linki zwrotne** (kto tu linkuje) oraz przyciski **Wstecz**/**Do przodu** edytora.

## Zobacz też

- [Skróty klawiszowe](Keyboard_Shortcuts.md)
- [Bazy danych (.base)](Databases_Base.md) — strukturalne zapytania na właściwościach zamiast pełnego tekstu
