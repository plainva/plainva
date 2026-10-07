# Łączenie aplikacji AI (beta)

Stan na: 2026-10-07

Aplikacje AI na Twoim komputerze — Claude Code, Claude Desktop, Cursor, VS Code i inne, które mówią protokołem Model Context Protocol (MCP) — mogą czytać Twój vault przez Plainva: przeszukiwać go, czytać notatki i ich sekcje, konspekty, linki zwrotne, bazy danych, zadania i ostatnie notatki oraz otwierać notatkę w Plainva. Niczego nie mogą zmienić. To część eksperymentalnych funkcji AI i działa tylko na komputerze.

Kierunek odwrotny — asystent Plainva korzystający z narzędzi samodzielnie podłączanych serwerów — opisano w sekcji **Narzędzia zewnętrzne (MCP)** na stronie [Asystent AI](AI_Assistant.md).

Trzecią drogę — Plainva uruchamia agenta AI innego producenta w folderze vaultu, z jego sesją na karcie AI — opisano na stronie [Agenci zewnętrzni](External_Agents.md).

## Jak to działa

Plainva instaluje obok aplikacji mały program pomocniczy, `plainva-mcp`. Aplikacja AI go uruchamia, a program łączy się z działającą Plainva prywatnym kanałem tego komputera — nazwanym potokiem w Windows, gniazdem w prywatnym folderze w macOS i Linuksie. Żaden port sieciowy nigdy nie jest otwierany. Plainva musi działać z otwartym vaultem; w przeciwnym razie aplikacja dostaje jasny komunikat.

## Włączanie

1. Otwórz **Ustawienia → AI & automatyzacja** i włącz **Używaj AI na tym urządzeniu**.
2. Włącz **Pozwól aplikacjom AI na tym komputerze czytać ten vault**.
3. Skonfiguruj aplikację (zob. niżej). Przy pierwszym połączeniu Plainva pyta, jaka to aplikacja, jaki program ją uruchomił i które foldery może czytać. Nic nie jest zaznaczone: wybierz foldery albo **Cały vault**, potem **Zezwól**. **Odmów** odprawia aplikację, a Plainva przez dziesięć minut nie pyta o nią ponownie.

Aplikacja przechowuje sekret w pęku kluczy systemu na następny raz. Foldery przyznaje się dla każdej aplikacji i każdego vaultu osobno: w innym vaulcie aplikacja pyta ponownie.

## Konfiguracja aplikacji

- **Claude Code:** skopiuj **Polecenie dla Claude Code** z ustawień i uruchom je w terminalu.
- **Claude Desktop:** **Utwórz pakiet…** zapisuje plik `plainva.mcpb`; otwórz go, a Claude Desktop zainstaluje Plainva.
- **Inne aplikacje (JSON):** skopiuj konfigurację i dodaj ją do ustawień MCP aplikacji, na przykład do `mcp.json` w Cursor.

## Co widzi aplikacja

Tylko foldery, na które zezwolono, i tylko to, co Twoje zasady prywatności puszczają do modelu w chmurze: notatki z `cloud: deny`, albo w folderze z taką regułą, dla aplikacji nie istnieją — ani ich tekst, ani tytuły —, linki do nich są zatrzymywane, a miejsca z dziennika nigdy nie wychodzą. Własne foldery Plainva (`.plainva`, `.agent`) i same reguły nigdy nie są czytelne. Każda ścieżka w zapytaniu i w odpowiedzi jest sprawdzana dwa razy: w oknie aplikacji i w natywnej części Plainva.

Ustawienia pokazują dozwolone aplikacje z ich folderami i ostatnie zapytania. **Usuń** cofa zgodę aplikacji we wszystkich vaultach.

Oprócz narzędzi Plainva udostępnia swoje trzy umiejętności jako prompty, w języku aplikacji: `daily-orientation`, `weekly-review` i `project-status`, który pyta o nazwę projektu. Aplikacja obsługująca prompty pokazuje je wśród swoich poleceń.

## Ograniczenia

- Tylko na komputerze: telefony nie uruchamiają takich aplikacji, a ani iOS, ani Android nie pozwalają jednej aplikacji oferować innej prywatnego kanału.
- ChatGPT i claude.ai w przeglądarce nie mogą go osiągnąć: łączą się tylko z serwerami w internecie, a Plainva takiego nie prowadzi.
- Tylko odczyt; to, by aplikacja proponowała zmiany, przyjdzie w późniejszej wersji.
