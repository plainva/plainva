# Łączenie aplikacji AI (beta)

Stan na: 2026-11-18

Aplikacje AI na Twoim komputerze — Claude Code, Claude Desktop, Cursor, VS Code i inne, które mówią protokołem Model Context Protocol (MCP) — mogą czytać Twój vault przez Plainva: przeszukiwać go, czytać notatki i ich sekcje, konspekty, linki zwrotne, bazy danych, zadania i ostatnie notatki oraz otwierać notatkę w Plainva. Same niczego nie zmieniają: aplikacja, której na to pozwolisz, może proponować zmiany, a te czekają, aż zdecydujesz (zob. niżej). To część eksperymentalnych funkcji AI i działa tylko na komputerze.

Kierunek odwrotny — asystent Plainva korzystający z narzędzi samodzielnie podłączanych serwerów — opisano w sekcji **Narzędzia zewnętrzne** na stronie [Asystent AI](AI_Assistant.md).

Trzecią drogę — Plainva uruchamia agenta AI innego producenta w folderze vaultu, z jego sesją na karcie AI — opisano na stronie [Agenci zewnętrzni](External_Agents.md).

## Jak to działa

Plainva instaluje obok aplikacji mały program pomocniczy, `plainva-mcp`. Aplikacja AI go uruchamia, a program łączy się z działającą Plainva prywatnym kanałem tego komputera — nazwanym potokiem w Windows, gniazdem w prywatnym folderze w macOS i Linuksie. Żaden port sieciowy nigdy nie jest otwierany. Plainva musi działać z otwartym vaultem; w przeciwnym razie aplikacja dostaje jasny komunikat.

## Włączanie

1. Otwórz **Ustawienia → AI** i włącz **Używaj AI na tym urządzeniu**.
2. Na karcie **Aplikacje AI na tym komputerze** włącz **Pozwól aplikacjom AI na tym komputerze czytać ten vault**.
3. Skonfiguruj aplikację (zob. niżej). Przy pierwszym połączeniu Plainva pyta, jaka to aplikacja, jaki program ją uruchomił i które foldery może czytać. Nic nie jest zaznaczone: wybierz spośród folderów najwyższego poziomu vaultu albo **Cały vault**, potem **Zezwól**. **Odmów** odprawia aplikację, a Plainva przez dziesięć minut nie pyta o nią ponownie. Pod folderami znajduje się **Może proponować zmiany** — wyłączone, dopóki tego nie zaznaczysz; na co pozwala, opisano niżej.

Aplikacja przechowuje sekret w pęku kluczy systemu na następny raz. Foldery przyznaje się dla każdej aplikacji i każdego vaultu osobno: w innym vaulcie aplikacja pyta ponownie. Gdy otworzysz inny vault, aplikacje połączone z poprzednim zostają rozłączone; nowy odczytają dopiero po ponownym połączeniu. Dopóki włączone jest **W pełni lokalnie** (zob. [Asystent AI](AI_Assistant.md)), serwer odpoczywa: żadna aplikacja nie może czytać vaultu, a aplikacja, która się łączy, zostaje odrzucona.

## Konfiguracja aplikacji

- **Claude Code:** skopiuj **Polecenie dla Claude Code** z ustawień i uruchom je w terminalu.
- **Claude Desktop:** **Utwórz pakiet…** zapisuje plik `plainva.mcpb`; otwórz go, a Claude Desktop zainstaluje Plainva.
- **Inne aplikacje (JSON):** skopiuj konfigurację i dodaj ją do ustawień MCP aplikacji, na przykład do `mcp.json` w Cursor.

## Co widzi aplikacja

Tylko foldery, na które zezwolono, i tylko to, co Twoje zasady prywatności puszczają do modelu w chmurze, który może sięgać do internetu — aplikacja jest traktowana jak taki model, bo Plainva nie widzi, co robi z tym, co przeczyta: notatki z `cloud: deny` albo `web: deny`, albo w folderze z jedną z tych reguł, dla aplikacji nie istnieją — ani ich tekst, ani tytuły —, linki do nich są zatrzymywane, a miejsca z dziennika nigdy nie wychodzą. Notatka w dozwolonym folderze, której nazwy nie da się ocenić w takiej postaci, jaka jest — kończy się spacją lub kropką, zawiera dwukropek albo nie jest w złożonej postaci Unicode — też zostaje pominięta, a odpowiedź mówi, ile notatek pominięto. Własne foldery Plainva (`.plainva`, `.agent`) i same reguły nigdy nie są czytelne. Każda ścieżka w zapytaniu i w odpowiedzi jest sprawdzana dwa razy: w oknie aplikacji i w natywnej części Plainva. Link do folderu w dozwolonym folderze, który prowadzi gdzie indziej, nie jest śledzony, a baza danych odpowiada tylko wartościami obliczonymi z notatek, które aplikacja może czytać: liczba lub suma po linkach do innych folderów pomija te notatki. Link w tym, co czyta aplikacja, zostaje tylko wtedy, gdy prowadzi do notatki, którą aplikacja może czytać; każdy inny — także do notatki, która nie istnieje — jest wstrzymywany. Wyszukiwanie nie znajduje notatki po tekście wstrzymanego linku i w razie wątpliwości ją pomija; zmiana, która dotknęłaby wstrzymanego linku albo wniosła jego znacznik do notatki, zostaje odrzucona.

Ustawienia pokazują aplikacje dozwolone na tym komputerze z ich folderami w tym vaulcie (**żaden w tym vaulcie** przy aplikacji dozwolonej tylko gdzie indziej) i ostatnie zapytania. **Usuń** cofa zgodę aplikacji we wszystkich vaultach. Obowiązuje to od razu — także dla aplikacji, która jest w tej chwili połączona.

Dopóki zaszyfrowany workspace otwartego vaultu nie jest otwarty na tym urządzeniu — jest zablokowany albo to urządzenie nie ma do niego klucza — Plainva nie odpowiada żadnej aplikacji: każde zapytanie — także lista czy wyszukiwanie — jest odrzucane z komunikatem, który mówi, który z tych dwóch przypadków zachodzi, zapytanie, które trwa w chwili blokady, nie dostaje nic z tego, co znalazło, a aplikacja, która się łączy, od razu się o tym dowiaduje. Odblokuj workspace albo skonfiguruj go na tym urządzeniu, a to samo połączenie znów odpowiada. Zgoda dotyczy nazwy folderu: jeśli zmienisz nazwę dozwolonego folderu, aplikacja przestaje go widzieć, dopóki znów na niego nie zezwolisz, a nowy folder o starej nazwie byłby dla niej widoczny.

Oprócz narzędzi Plainva udostępnia pięć swoich umiejętności jako prompty, we własnym języku Plainvy, oraz opis formatu plików jako zasób (`plainva://format`): prompty to `daily-orientation`, `weekly-review`, `project-status`, `meeting-prep` i `task-triage`; `project-status` pyta o nazwę projektu, a `meeting-prep` o spotkanie. Aplikacja obsługująca prompty pokazuje je wśród swoich poleceń.

## Pozwalanie aplikacji na proponowanie zmian

Czytanie nigdy nie jest zgodą na pisanie. To, czy aplikacja może także proponować zmiany, jest osobną odpowiedzią: **Może proponować zmiany** w pytaniu przy pierwszym połączeniu albo później przełącznik **… może proponować zmiany** w ustawieniach — dla każdej aplikacji i każdego vaultu osobno, wyłączony, dopóki go nie włączysz. Obowiązuje od następnego zapytania aplikacji; Plainva od razu informuje połączoną aplikację, że jej narzędzia się zmieniły (aplikacja, która używa najnowszej rewizji protokołu, dowie się o tym tylko wtedy, gdy o to poprosiła) — czy wtedy pokaże je bez ponownego połączenia, zależy od niej.

Aplikacja, której na to pozwolono, dostaje sześć dodatkowych narzędzi i żadne z nich nie zmienia vaultu:

- **Zmiana w notatce** — w jej tekście albo w jednej z właściwości — staje się propozycją na marginesie notatki, podpisaną nazwą aplikacji i „(aplikacja AI)”. Tam akceptujesz lub odrzucasz każdą zmianę osobno, jak przy każdej propozycji (zobacz [Komentarze i propozycje](Comments_and_Suggestions.md)).
- **Nowa notatka** staje się szkicem w **Do decyzji** na karcie AI. Powstaje, gdy wybierzesz tam **Utwórz**.
- **Zmiana nazwy, przeniesienie i usunięcie** najpierw pytają. Plainva pokazuje we własnym oknie, co by się stało — przy zmianie nazwy także notatki, których linki poszłyby za nią — a aplikacja pokazuje informację, że Plainva czeka. Dopiero po **Zezwól** w Plainva i gdy aplikacja będzie kontynuować, Plainva robi to tak, jak wtedy, gdy robisz to ręcznie; aplikacja dowiaduje się tylko, czy to nastąpiło. Przy usuwaniu Plainva otwiera wtedy własne okno usuwania i nic nie znika, zanim tam nie potwierdzisz. Aplikacji, która nie potrafi pokazać takiej informacji — potrzebuje rewizji protokołu MCP 2026-07-28 lub nowszej i musi móc zadać Ci pytanie w formularzu —, te trzy narzędzia nie są oferowane.

Adres internetowy, który wnosi aplikacja, jest zapisywany tak, aby nic go nie otwierało ani nie wczytywało (`https[://]…`), tak jak u asystenta. Własnych zasad prywatności notatki (`plainva.ai`) nie ustawia żadna aplikacja, a w zaszyfrowanym workspace nic nie jest proponowane, szkicowane ani planowane. Lista ostatnich zapytań w ustawieniach pokazuje osiem najnowszych i oznacza te zapytania, o które Plainva pytała Ciebie (**pytanie**), te, na które odpowiedź brzmiała „nie” (**odmówiono**), i te, które nie zostały przepuszczone (**odrzucone**); zapytanie, które zostało przepuszczone, nie nosi żadnego słowa.

## Ograniczenia

- Tylko na komputerze: telefony nie uruchamiają takich aplikacji, a ani iOS, ani Android nie pozwalają jednej aplikacji oferować innej prywatnego kanału.
- ChatGPT i claude.ai w przeglądarce nie mogą go osiągnąć: łączą się tylko z serwerami w internecie, a Plainva takiego nie prowadzi.
- Aplikacja nigdy sama nie zmienia vaultu: to, co napisze, czeka jako propozycja lub szkic, a zmiana nazwy, przeniesienie czy usunięcie wymaga Twojej zgody w Plainva.
