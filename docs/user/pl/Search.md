# Wyszukiwanie

Stan na: 2026-10-01

Plainva oferuje trzy sposoby wyszukiwania: wyszukiwanie pełnotekstowe w całym vaulcie, szybkie przełączanie do otwierania plików oraz znajdź i zamień wewnątrz notatki.

## Wyszukiwanie pełnotekstowe w vaulcie

Pole u góry panelu bocznego przeszukuje tytuły i treść w całym sejfie. Lokalny indeks pełnotekstowy (SQLite FTS5) powstaje podczas otwierania sejfu i jest aktualizowany po zmianach plików. Wyszukiwanie działa offline.

Wyszukiwanie reaguje w trakcie pisania: prefiksy słów pasują już od razu ("Projek" znajduje "Projekt plan") — bez potrzeby naciskania Enter. **X** po prawej stronie pola czyści bieżące wyszukiwanie (albo naciśnij `Esc`); pasek boczny pokazuje wtedy znowu zwykłe drzewo plików.

W chińskim, japońskim, tajskim i innych pismach bez spacji między słowami wyszukiwanie znajduje termin w dowolnym miejscu tekstu: `議事録` znajduje "今日は会議の議事録を書いた", `搜索` znajduje "全文搜索". Znajdowane są też słowa łacińskie wewnątrz takiego tekstu ("Plainva" w "…でPlainvaを使った").

Lista pokazuje poszczególne wystąpienia wraz z fragmentem tekstu, ścieżką nagłówków i numerem wiersza. Otwarcie pozycji zaznacza dokładnie wybrane wystąpienie; kilka dopasowań w tej samej notatce jest pokazanych osobno. Licznik obejmuje tylko załadowane wyniki. Można wczytać kolejne wystąpienia. Strzałki zmieniają wybór, a Enter go otwiera. Ładowanie, brak wyników i błędy są wyraźnie wskazane; nowe zapytanie odrzuca stare odpowiedzi. Gdy po edycji nie można jednoznacznie odnaleźć wystąpienia, pojawia się komunikat. Te same wystąpienia są dostępne w szybkim przełączniku i wyszukiwaniu mobilnym. Powrót do wyszukiwania na telefonie przywraca zapytanie, wczytane wyniki i pozycję listy. Wyniki są ułożone według pola **Trafność**, chyba że przyciskiem sortowania obok pola wyszukiwania (na telefonie: na pasku ekranu wyszukiwania) wybierzesz **Ostatnia zmiana**, **Tytuł** lub **Ścieżka**; doładowanie kolejnych zachowuje wybraną kolejność. Na telefonie arkusz sortowania pozostaje otwarty, dopóki nie stukniesz **Gotowe**: ponowne stuknięcie wybranej kolejności odwraca kierunek.

Pole wyszukiwania działa też w pozostałych widokach paska bocznego: w **Tagi** filtruje listę tagów, w **Zakładki** — zakładki.

### Operatory wyszukiwania

- `"dokładna fraza"` — cudzysłów dopasowuje sekwencję słów dokładnie. Działa to też jako wyszukiwanie całego wyrazu dla pojedynczego słowa: `"plan"` znajduje "plan", ale nie "planowanie". W pismach bez spacji cudzysłów niczego nie zmienia: taki tekst nie ma granic słów.
- `-termin` — wyklucza notatki zawierające dany termin (działa też z frazami: `-"stara wersja"`).
- `path:folder` — tylko pliki, których ścieżka zawiera dany tekst (np. `path:Projekty`; ze spacjami: `path:"Mój Folder"`).
- `tag:nazwa` — tylko notatki z danym tagiem, wliczając tagi zagnieżdżone: `tag:projekt` znajduje też `#projekt/wewnetrzny`. `tag:#projekt` działa równie dobrze.
- Operatory można zanegować (`-path:Archiwum`, `-tag:zrobione`) i dowolnie łączyć z terminami wyszukiwania: `plan tag:projekt -szkic`.
- Wiele terminów łączonych jest operatorem AND. Znaki specjalne takie jak `- ( ) : *` wewnątrz terminów są nieszkodliwe — Plainva traktuje wpis dosłownie.

## Wyszukiwanie według znaczenia

Z lokalnym modelem wyszukiwanie znajduje notatki także według tego, co znaczą — nie tylko według słów, i między językami: pytanie po polsku znajduje angielską notatkę, która mówi to samo. Model liczy na tym urządzeniu; notatki i obliczone z nich wektory nigdy go nie opuszczają.

Włącz je w **Ustawienia → AI & automatyzacja → Wyszukiwanie semantyczne** (AI musi być włączone). Wybierz model — zalecany jest **Granite Embedding Multilingual R2 (97M)** — a Plainva pokaże rozmiar, źródło, licencję i szacowany czas, zanim cokolwiek zostanie pobrane. Każdy plik pochodzi z ustalonej wersji w huggingface.co i jest sprawdzany sumą SHA-256; logowanie nie jest potrzebne. Przed przetworzeniem pierwszej notatki Plainva sprawdza, czy model liczy poprawnie na tym urządzeniu.

Zamiast pakietu możesz wybrać **Własny dostawca**: wtedy wektory liczy model profilu **Embeddingi** — dowolny model embeddingów, który oferuje Twój dostawca, na przykład `text-embedding-3-small` w OpenAI, `gemini-embedding-001` w Gemini albo `nomic-embed-text` w Ollamie. Z Ollamą lub LM Studio nic nie opuszcza Twojego komputera. W przypadku chmury przegląd pokazuje raz, co tam trafia — każdą notatkę, którą przepuszczają Twoje reguły prywatności, teraz i przy każdej zmianie, oraz Twoje pytania wyszukiwania — a **Zatwierdź na stałe** to uruchamia; **Wycofaj zgodę** w ustawieniach to zatrzymuje. Notatki, które Twoje reguły trzymają z dala od chmury, zostają poza nią, a w zaszyfrowanym obszarze roboczym liczy tylko pakiet albo serwer na tym komputerze. Jeśli pod tą samą nazwą odpowiada inny model — nowe `ollama pull`, przeniesiony serwer — Plainva zauważa to przed następną notatką i liczy wektory od nowa, zamiast mieszać dwa modele. Gdy dostawca jest nieosiągalny, wyszukiwanie odpowiada według słów i o tym informuje. **Nieużywane na tym urządzeniu** pokazuje pakiety i wektory modeli, których już nie używasz; **Usuń** je sprząta.

**Zmierz to urządzenie** (obok **Wstrzymaj**, gdy model liczy) sprawdza to urządzenie względem budżetów, których trzyma się Plainva: pierwsze przejście przez 5000 sekcji, zmienioną notatkę znalezioną ponownie, wyszukiwanie w 20 000 sekcji, pamięć aplikacji w szczycie i pobieranie. Pomiar odbywa się na przykładowym tekście, nigdy na Twoich notatkach, a przetwarzanie w tym czasie czeka; **Kopiuj wyniki** kopiuje liczby do schowka — na przykład do Twojej opinii o becie.

Gdy model jest aktywny, nagłówek wyników oferuje **Słowa**, **Znaczenie** i **Oba**:

- **Słowa** to opisane wyżej wyszukiwanie pełnotekstowe.
- **Znaczenie** pokazuje notatki, których sekcje są najbliższe pytaniu; otwarcie wyniku prowadzi do tej sekcji.
- **Oba** (domyślnie) układa razem wyniki ze słów i znaczenia.

Przy **Znaczenie** i **Oba** każda notatka pojawia się raz, a mała etykieta mówi, co ją znalazło: **Słowa**, **Znaczenie** albo **Słowa i znaczenie**. Operatory wyszukiwania (`path:`, `tag:`, `-termin`) ograniczają także wyniki według znaczenia. Wybór dotyczy tego urządzenia.

Plainva przetwarza notatki w tle, najpierw ostatnio zmienione; edytowana notatka dochodzi kilka sekund po zakończeniu pisania. Do tego czasu znajduje się ją tylko po słowach — wynik według znaczenia nigdy nie pochodzi ze starego tekstu notatki. Wiersz pod wynikami pokazuje postęp i oferuje **Wstrzymaj**. Na telefonie przetwarzanie trwa tylko wtedy, gdy Plainva jest otwarta. **Usuń (z wektorami)** w ustawieniach usuwa model i wszystko, co obliczył.

### Powiązane notatki

Obok otwartej notatki Plainva pokazuje do trzech notatek bliskich jej znaczeniowo, ale jeszcze z nią niepołączonych linkiem — na komputerze w sekcji **Powiązane** prawego panelu bocznego, po **Linki zwrotne**; na telefonie w karcie **Powiązane** arkusza notatki. Powstają z wektorów, które wyszukiwanie według znaczenia i tak przechowuje na tym urządzeniu: nic nie jest wysyłane, nawet do własnego dostawcy. Podpowiedź pojawia się tylko wtedy, gdy notatka wyraźnie wyróżnia się na tle reszty vaulta; kopie i wspólny tekst szablonu się nie liczą. Dlatego większość notatek nie ma podpowiedzi i sekcja wtedy znika.

Każda podpowiedź wskazuje dwie najbliższe sekcje — na przykład „Produkcja ↔ Dni zdjęciowe › Podział” — oraz notatki, do których obie linkują. **Dlaczego ta podpowiedź?** pokazuje początek obu sekcji (kliknięcie przenosi do nich); **Nieprzydatne** ukrywa dokładnie tę parę na tym urządzeniu i nie zmienia wyszukiwania. **Wstrzymaj dla tej notatki** i **Wstrzymaj w tym vaulcie** są w menu sekcji, a na telefonie pod listą. **Pokazuj powiązane notatki** w **Ustawienia → AI & automatyzacja → Wyszukiwanie semantyczne** wyłącza podpowiedzi na tym urządzeniu; tam też wznawia się wstrzymany vault lub notatki i przywraca ukryte podpowiedzi.

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

Każde trafienie pokazuje dwa wiersze: **przed** z miejscem trafienia i **po** z wynikiem — przy wyrażeniu regularnym odwołania `$1` są rozwinięte, więc zmianę można sprawdzić, zanim cokolwiek zostanie zapisane. Nieprawidłowe wyrażenie jest nazwane przy polu zamiast pustej listy; gdy nic nie pasuje, pusty stan mówi, co sprawdzić. Podczas zamiany widzisz postęp i możesz **Anulować** — już zapisane notatki pozostają zapisane i są wymienione. Na telefonie każde trafienie pokazuje te same dwa wiersze.

**W telefonie** to samo znajdziesz w lupa w nagłówku, następnie `>` i **Znajdź i zamień w całym vault**: trafienia są zgrupowane według notatek i zwinięte, żeby termin z czterdziestoma trafieniami nie przykrył akcji; dotknij notatki, aby do niej zajrzeć, odznacz te, które mają zostać nietknięte, a przycisk sam nazywa swój zasięg (**Zamień w 2 notatkach**). Gdy opuścisz aplikację, trwająca zamiana zatrzyma się przy kolejnej notatce — już zapisane notatki pozostają zapisane i zostają wymienione.

## Tagi

Widok paska bocznego **Tagi** wyświetla wszystkie `#tagi` w vaulcie z liczbą wystąpień; kliknięcie pokazuje **Pliki z #tag**. Tagi działają w tekście (`#projekt`) oraz we frontmatter (`tags: [projekt]`). Pole wyszukiwania paska bocznego filtruje też listę tagów.

W notatce tag jest rysowany jako mała pigułka — podczas pisania i podczas czytania; sam tekst pozostaje `#projekt/strona`. Kliknięcie pigułki (na telefonie: dotknięcie w trybie czytania) otwiera notatki, które noszą ten tag. To, co liczy się jako tag, jest wszędzie takie samo — na liście tagów, w zadaniu i przy zmianie nazwy: `#` na początku wiersza lub po spacji, a po nim litery, cyfry, `_`, `-` lub `/`. Same cyfry nie są tagiem (`#42` pozostaje numerem), podobnie jak wszystko wewnątrz kodu lub linku. **Koloruj tagi** w **Ustawienia → Aplikacja → Wygląd** nadaje każdemu tagowi kolor wynikający z jego nazwy; tagi zagnieżdżone dzielą kolor tagu najwyższego poziomu. Ustawienie należy do tego urządzenia i niczego nie zapisuje w Twoich notatkach.

**Zmiana nazwy tagu** obejmuje od razu cały vault: kliknij prawym przyciskiem myszy tag w widoku **Tagi** i wpisz nową nazwę. Plainva przepisuje tag wszędzie — w tekście notatek (`#tag` oraz jego podtagi `#tag/child`) i we frontmatter (`tags:`) — zapisując każdą dotkniętą notatkę z powrotem tą samą bezpieczną drogą. Niepowiązane tagi, które jedynie zawierają tę nazwę (na przykład `#area/tag`), pozostają nietknięte.

## Nawigacja w notatce

**Konspekt** w prawym pasku bocznym wyświetla wszystkie nagłówki aktywnej notatki — kliknięcie przenosi do danego miejsca. Do przeskakiwania między notatkami pomocne są też **Linki zwrotne** (kto tu linkuje) oraz przyciski **Wstecz**/**Do przodu** edytora.

## Zobacz też

- [Skróty klawiszowe](Keyboard_Shortcuts.md)
- [Bazy danych (.base)](Databases_Base.md) — strukturalne zapytania na właściwościach zamiast pełnego tekstu
