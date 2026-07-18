# Aplikacja mobilna

Stan na: 2026-07-18

Plainva jest też dostępna jako aplikacja na Androida i iOS. Działa na tych samych plikach Markdown, tym samym formacie **OKF** i tym samym mechanizmie synchronizacji co aplikacja desktopowa — Twój sejf pozostaje identyczny w obu światach.

## Układ

- **Dolny pasek:** trzy dowolnie rozmieszczone ekrany plus stała karta **Więcej**. **Więcej** wyświetla wszystkie ekrany (Notatki, Dzisiaj, Tagi, Zakładki, Kalendarz, Bazy danych, Graf) — dotknięcie je otwiera, **uchwyt** zmienia kolejność listy: górne trzy tworzą pasek (oznaczone ramką), przeciągnięcie ekranu w górę przenosi go na pasek.
- **＋** unosi się jako okrągły przycisk nad paskiem i otwiera szybkie tworzenie: notatka, notatka dzienna, folder, baza danych, „Z szablonu…”.
- **Górny pasek:** wyszukiwanie i **Ustawienia** (⋮); ekran główny pokazuje dodatkowo „Ostatnie” i Twoje zakładki.
- **Ustawienia:** przycisk ⋮ otwiera najpierw listę obszarów (jak lewa strona ustawień na komputerze) — dotknięcie otwiera daną stronę. Na górze **Aktywny vault** prowadzi do zarządzania vaultami: przełączanie vaultów (znacznik = aktywny), **Utwórz vault** i **Połącz sejf w chmurze**.

## Czytanie i edycja notatek

Notatki otwierają się **wyrenderowane i tylko do odczytu**; ikona pióra w prawym górnym rogu przełącza na edycję (z paskiem narzędzi nad klawiaturą: formatowanie, listy, link wiki, polecenia slash, wstawianie zdjęcia). Osadzenia `![[Notatka]]` pojawiają się jako klikalne karty podglądu.

Przycisk **Szczegóły notatki** w nagłówku (między zakładką a menu ⋮) otwiera arkusz kontekstowy notatki: właściwości (bezpośrednio edytowalne), linki zwrotne, konspekt, graf oraz **historię wersji** — każda edycja automatycznie tworzy migawki, które możesz przeglądać, porównywać i przywracać. Źródło Markdown i wyszukiwanie w notatce znajdziesz w menu ⋮.

## Bazy danych (`.base`)

Bazy danych `.base` działają jak na komputerze: każdy widok (tabela, lista, galeria, tablica, kalendarz, oś czasu), edycja komórek zgodna z typem pola, karty na tablicy przenosisz, przytrzymując je. **Konfiguruj** zarządza widokami, kolumnami, filtrami (w tym grupami), sortowaniem i właściwościami. Schematy relacji (cele, liczność) nadal są utrzymywane na komputerze.

Widok **Tablica korkowa** pokazuje notatki jako dwukolumnową tablicę karteczek samoprzylepnych: dotknięcie otwiera notatkę, przytrzymanie pokazuje akcje (przypnij, etykiety, kolor, usuń), przeciąganie po przytrzymaniu zmienia kolejność, a pola wyboru odhaczasz bezpośrednio na karcie. Pole wprowadzania na górze tworzy nową notatkę. Wskazówka: skieruj bazę danych na folder skrzynki (**Ustawienia** → **Treść i struktura**), a szybkie notatki z ＋ oraz teksty udostępnione z innych aplikacji trafią prosto na tablicę.

## Synchronizacja

W **Ustawieniach** (⋮) **Aktywny vault** prowadzi do zarządzania vaultami; tam łączysz się z magazynem w chmurze (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Połącz sejf w chmurze** pobiera na urządzenie istniejący sejf w chmurze; **Utwórz vault** pyta najpierw **Na tym urządzeniu** czy **W usłudze online**, a potem o strukturę początkową (pustą lub szablon, np. PARA) — przy ścieżce online następuje połączenie, docelowy folder w chmurze można od razu utworzyć przez **Nowy folder** w arkuszu wyboru, a struktura zostaje przesłana podczas pierwszej synchronizacji. Ten sam wybór między istniejącym a nowym sejfem w chmurze oferuje też pierwsze uruchomienie („Połącz sejf w chmurze”). Każde połączenie otrzymuje własny, osobny sejf na urządzeniu. Strona sejfu pokazuje status, postęp, oczekujące transfery i oferuje **Eksportuj sejf** (ZIP przez arkusz udostępniania).

## Sieć bezpieczeństwa

Migawki (historia wersji), dziennik wersji roboczych (po awarii notatka oferuje Twój ostatni niezapisany stan) oraz kopie konfliktów z widokiem porównania chronią Twoje dane. Przechowywanie konfigurujesz w **Ustawieniach** → **Backup i historia wersji**.

## Udostępnianie i skróty (Android)

Tekst udostępniony z innych aplikacji trafia jako nowa notatka do folderu skrzynki. Przytrzymaj ikonę aplikacji, aby uzyskać skróty **Nowa notatka** i **Dzisiaj**.
