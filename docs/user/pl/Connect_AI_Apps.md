# Łączenie aplikacji AI (beta)

Stan na: 2026-10-07

Aplikacje AI na Twoim komputerze — Claude Code, Claude Desktop, Cursor, VS Code i inne, które mówią protokołem Model Context Protocol (MCP) — mogą czytać Twój vault przez Plainva: przeszukiwać go, czytać notatki i ich sekcje, konspekty, linki zwrotne, bazy danych, zadania i ostatnie notatki oraz otwierać notatkę w Plainva. Same niczego nie zmieniają: aplikacja, której na to pozwolisz, może proponować zmiany, a te czekają, aż zdecydujesz (zob. niżej). To część eksperymentalnych funkcji AI i działa tylko na komputerze.

Kierunek odwrotny — asystent Plainva korzystający z narzędzi samodzielnie podłączanych serwerów — opisano w sekcji **Narzędzia zewnętrzne (MCP)** na stronie [Asystent AI](AI_Assistant.md).

Trzecią drogę — Plainva uruchamia agenta AI innego producenta w folderze vaultu, z jego sesją na karcie AI — opisano na stronie [Agenci zewnętrzni](External_Agents.md).

## Jak to działa

Plainva instaluje obok aplikacji mały program pomocniczy, `plainva-mcp`. Aplikacja AI go uruchamia, a program łączy się z działającą Plainva prywatnym kanałem tego komputera — nazwanym potokiem w Windows, gniazdem w prywatnym folderze w macOS i Linuksie. Żaden port sieciowy nigdy nie jest otwierany. Plainva musi działać z otwartym vaultem; w przeciwnym razie aplikacja dostaje jasny komunikat.

## Włączanie

1. Otwórz **Ustawienia → AI & automatyzacja** i włącz **Używaj AI na tym urządzeniu**.
2. Włącz **Pozwól aplikacjom AI na tym komputerze czytać ten vault**.
3. Skonfiguruj aplikację (zob. niżej). Przy pierwszym połączeniu Plainva pyta, jaka to aplikacja, jaki program ją uruchomił i które foldery może czytać. Nic nie jest zaznaczone: wybierz foldery albo **Cały vault**, potem **Zezwól**. **Odmów** odprawia aplikację, a Plainva przez dziesięć minut nie pyta o nią ponownie. Pod folderami znajduje się **Może proponować zmiany** — wyłączone, dopóki tego nie zaznaczysz; na co pozwala, opisano niżej.

Aplikacja przechowuje sekret w pęku kluczy systemu na następny raz. Foldery przyznaje się dla każdej aplikacji i każdego vaultu osobno: w innym vaulcie aplikacja pyta ponownie.

## Konfiguracja aplikacji

- **Claude Code:** skopiuj **Polecenie dla Claude Code** z ustawień i uruchom je w terminalu.
- **Claude Desktop:** **Utwórz pakiet…** zapisuje plik `plainva.mcpb`; otwórz go, a Claude Desktop zainstaluje Plainva.
- **Inne aplikacje (JSON):** skopiuj konfigurację i dodaj ją do ustawień MCP aplikacji, na przykład do `mcp.json` w Cursor.

## Co widzi aplikacja

Tylko foldery, na które zezwolono, i tylko to, co Twoje zasady prywatności puszczają do modelu w chmurze, który może sięgać do internetu — aplikacja jest traktowana jak taki model, bo Plainva nie widzi, co robi z tym, co przeczyta: notatki z `cloud: deny` albo `web: deny`, albo w folderze z jedną z tych reguł, dla aplikacji nie istnieją — ani ich tekst, ani tytuły —, linki do nich są zatrzymywane, a miejsca z dziennika nigdy nie wychodzą. Własne foldery Plainva (`.plainva`, `.agent`) i same reguły nigdy nie są czytelne. Każda ścieżka w zapytaniu i w odpowiedzi jest sprawdzana dwa razy: w oknie aplikacji i w natywnej części Plainva.

Ustawienia pokazują dozwolone aplikacje z ich folderami i ostatnie zapytania. **Usuń** cofa zgodę aplikacji we wszystkich vaultach. Obowiązuje to od razu — także dla aplikacji, która jest w tej chwili połączona.

Oprócz narzędzi Plainva udostępnia swoje trzy umiejętności jako prompty, w języku aplikacji: `daily-orientation`, `weekly-review` i `project-status`, który pyta o nazwę projektu. Aplikacja obsługująca prompty pokazuje je wśród swoich poleceń.

## Pozwalanie aplikacji na proponowanie zmian

Czytanie nigdy nie jest zgodą na pisanie. To, czy aplikacja może także proponować zmiany, jest osobną odpowiedzią: **Może proponować zmiany** w pytaniu przy pierwszym połączeniu albo później przełącznik **… może proponować zmiany** w ustawieniach — dla każdej aplikacji i każdego vaultu osobno, wyłączony, dopóki go nie włączysz. Obowiązuje od następnego zapytania aplikacji; dodatkowe narzędzia pojawiają się w aplikacji, gdy połączy się ponownie.

Aplikacja, której na to pozwolono, dostaje sześć dodatkowych narzędzi i żadne z nich nie zmienia vaultu:

- **Zmiana w notatce** — w jej tekście albo w jednej z właściwości — staje się propozycją na marginesie notatki, podpisaną nazwą aplikacji i „(aplikacja AI)”. Tam akceptujesz lub odrzucasz każdą zmianę osobno, jak przy każdej propozycji (zobacz [Komentarze i propozycje](Comments_and_Suggestions.md)).
- **Nowa notatka** staje się szkicem w **Oczekujące** na karcie AI. Powstaje, gdy wybierzesz tam **Utwórz**.
- **Zmiana nazwy, przeniesienie i usunięcie** najpierw pytają. Plainva pokazuje we własnym oknie, co by się stało — przy zmianie nazwy także notatki, których linki poszłyby za nią — a aplikacja pokazuje informację, że Plainva czeka. Dopiero po **Zezwól** w Plainva i gdy aplikacja będzie kontynuować, Plainva robi to tak, jak wtedy, gdy robisz to ręcznie; aplikacja dowiaduje się tylko, czy to nastąpiło. Przy usuwaniu Plainva otwiera wtedy własne okno usuwania i nic nie znika, zanim tam nie potwierdzisz. Aplikacji, która nie potrafi pokazać takiej informacji, te trzy narzędzia nie są oferowane.

Adres internetowy, który wnosi aplikacja, jest zapisywany tak, aby nic go nie otwierało ani nie wczytywało (`https[://]…`), tak jak u asystenta. Własnych zasad prywatności notatki (`plainva.ai`) nie ustawia żadna aplikacja, a w zaszyfrowanym workspace nic nie jest proponowane, szkicowane ani planowane. **Ostatnie zapytania** w ustawieniach mówi przy każdym zapytaniu, co się z nim stało — także to, że Plainva zapytała Ciebie, albo że odmówiono.

## Ograniczenia

- Tylko na komputerze: telefony nie uruchamiają takich aplikacji, a ani iOS, ani Android nie pozwalają jednej aplikacji oferować innej prywatnego kanału.
- ChatGPT i claude.ai w przeglądarce nie mogą go osiągnąć: łączą się tylko z serwerami w internecie, a Plainva takiego nie prowadzi.
- Aplikacja nigdy sama nie zmienia vaultu: to, co napisze, czeka jako propozycja lub szkic, a zmiana nazwy, przeniesienie czy usunięcie wymaga Twojej zgody w Plainva.
