# Graf

Stan na: 2026-07-10

Graf Plainva to narzędzie do pracy, nie plakat: pokazuje, gdzie jesteś, co jest połączone, czego brakuje — i możesz działać na tym bezpośrednio. Istnieje JEDEN silnik grafu w trzech odsłonach.

## Graf kontekstowy (prawy pasek boczny)

Otwórz sekcję **Graf** w prawym pasku bocznym. Pokazuje aktywną notatkę na środku, strukturę folderów powyżej, dla przeglądów folderów (index.md) zawarte w nich notatki poniżej, przychodzące odwołania po lewej i wychodzące po prawej. Relacje z baz danych niosą swoją nazwę właściwości jako etykietę.

- Kliknięcie węzła otwiera notatkę (fokus obraca się razem z Tobą).
- Ctrl/Cmd+klik otwiera w podziale, kliknięcie środkowym przyciskiem w nowej karcie.
- Przeciągnięcie węzła w inne miejsce przypina go tam (mała kropka) i jest zapamiętywane per notatka — otwórz tę notatkę ponownie, a Twój układ wróci. Aktywna notatka zawsze pozostaje na środku. **Igła przypięcia** w prawym górnym rogu włącza i wyłącza zapamiętywanie; jej wyłączenie odrzuca zapamiętany układ tej notatki.
- Poniżej pojawiają się maksymalnie trzy **sugestie**: notatki, które wspominają Twoją aktywną notatkę (ale jej nie linkują), są często łączone razem z nią, mają podobne sąsiedztwo lub dzielą rzadki tag. Tam, gdzie tytuł występuje jako tekst w edytowanej notatce, sugestia pokazuje **podgląd fragmentu**, który zostałby połączony; **Połącz** zamienia dokładnie ten fragment w link wiki (jako `[[Cel|tekst]]`, gdy widoczny tekst różni się od celu). Jeśli nie ma pasującego fragmentu, link jest dopisywany na końcu notatki (podgląd to sygnalizuje). **Odrzuć sugestię** zapamiętuje Twoją decyzję.

## Mapa sejfu (własna karta)

Otwórz mapę przez **Ctrl/Cmd+Shift+G**, przez ikonę grafu na **pasku akcji** po lewej stronie, lub przez paletę poleceń (**Otwórz graf**). Otwiera się we własnej karcie. Zamiast kłębka zobaczysz swoją rzeczywistą strukturę folderów jako bąbelki — podwójne kliknięcie bąbelka rozwija jego notatki, **Zwiń wszystkie foldery** cofa to. Układ jest deterministyczny: ta sama mapa wygląda tak samo za każdym razem, gdy ją otwierasz. **Przesuwaj mapę** środkowym przyciskiem myszy lub Ctrl/Cmd+przeciągnięciem, a **powiększaj i pomniejszaj** kółkiem myszy. Przeciągnij węzeł, a zostanie przypięty (mała kropka). W prawym górnym rogu **igła przypięcia** włącza i wyłącza zapamiętywanie: wyłącz ją, a zapamiętany układ tego widoku zostanie odrzucony i wróci automatyczny układ (tak samo jak **Resetuj układ** w menu kontekstowym). Przypięcia są przechowywane per urządzenie.

Narzędzia na pasku nagłówka:

- Style krawędzi na pierwszy rzut oka (legenda, w lewym dolnym rogu): **relacje** to ciągłe linie akcentu z etykietą, **linki** są przerywane, **osadzenia** kropkowane.
- **Szukaj** przyciemnia wszystko, co nie pasuje. Filtruj według **typu** (OKF) i **tagu**; rodzaje krawędzi (**Linki**, **Relacje**, **Osadzenia**) przełącza się pojedynczo.
- **Skup na zaznaczeniu** zawęża mapę do wybranej notatki plus 1–3 kroki sąsiedztwa.
- **Mapa ciepła** rozjaśnia niedawno edytowane notatki (7/30/90 dni) — „nad czym ostatnio pracowałem?”.
- **Podróż w czasie** pokazuje notatki według daty utworzenia; suwak odtwarza wzrost Twojego sejfu. Data pochodzi z właściwości `date`/`datum`, w przeciwnym razie z daty utworzenia pliku (przybliżenie dla sejfów wyłącznie w chmurze).

Praca na mapie:

- Przeciągnij jeden węzeł **na** drugi: Plainva proponuje zapisanie linku tekstowego — lub bezpośrednio pasującą **relację** z Twoich baz danych (jeśli relacja dopuszcza dokładnie jeden wpis, Plainva pyta przed zastąpieniem).
- Kliknięcie prawym przyciskiem na węźle: Otwórz, Podgląd, Otwórz w podziale, **Nowa połączona notatka**, Zmień nazwę (z aktualizacją linków w całym sejfie), Dodaj zakładkę, Usuń.
- Kliknięcie prawym przyciskiem na pustym miejscu: **Nowa notatka**, Resetuj układ, **Eksportuj jako PNG/SVG**.
- Kliknięcie wiązki krawędzi między folderami wyświetla poszczególne linki; najechanie na krawędź pokazuje zdanie, w którym żyje link.
- **Przeciągnięcie na pustym miejscu** rysuje prostokąt zaznaczenia i oznacza wiele notatek (Shift+przeciągnięcie rozszerza istniejące zaznaczenie); przeciągnij później jeden z zaznaczonych węzłów, a przesuną się wszystkie razem. Stopka umożliwia dodanie zakładki lub usunięcie zaznaczenia.

## Porządkowanie

Przycisk **Porządki** otwiera listę roboczą z trzema kartami: **Sieroty** (notatki bez połączeń), **Uszkodzone linki** (cele, które nie istnieją — **Utwórz notatkę** je tworzy) i **Wzmianki** (**Skanuj sejf** znajduje miejsca, gdzie notatka jest wymieniona, ale nie połączona; **Połącz** zamienia wystąpienie w link wiki). Stopka mapy pokazuje liczbę sierot — kliknięcie jej otwiera panel.

## Graf jako widok bazy danych

Każda baza danych `.base` może otrzymać widok **Graf** (dodaj widok → **Graf**): wiersze bazy danych stają się węzłami, Twoje **relacje** stają się oznaczonymi etykietami krawędziami. Na pasku nagłówka wybierasz właściwości krawędzi, **Kolor według** właściwości typu wybór, **Rozmiar według** właściwości liczbowej oraz czy pojawiają się **cele zewnętrzne** (relacje wskazujące poza bazę danych) lub **relacje przychodzące** (relacje z innych baz danych, które wskazują na te wpisy — np. zadania projektu). Widok jest zapisywany w sposób zgodny z Obsidian — Obsidian pokazuje ten sam plik jako tabelę.

## Ograniczenia

- Graf pokazuje notatki (pliki), nie poszczególne akapity.
- Przypięcia i odrzucone sugestie żyją pod `.plainva/` i nie podróżują z synchronizacją — podstawowy układ mapy jest identyczny na każdym urządzeniu.
- Sugestie to czysta analiza sejfu; nic nie opuszcza Twojego komputera.
