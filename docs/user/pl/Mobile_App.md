# Aplikacja mobilna

Stan na: 2026-07-26

Plainva jest też dostępna jako aplikacja na Androida i iOS. Działa na tych samych plikach Markdown, tym samym formacie **OKF** i tym samym mechanizmie synchronizacji co aplikacja desktopowa — Twój sejf pozostaje identyczny w obu światach.

## Układ

- **Dolny pasek:** **od trzech do pięciu** obszarów według wyboru — stałej karty **Więcej** już nie ma; miejsce należy do Twoich obszarów.
- **Każdy obszar** (Notatki, Dzisiaj, Tagi, Zakładki, Kalendarz, Bazy danych, Graf) jest zawsze o jedno dotknięcie – przez **arkusz obszarów**: albo przez **▾ obok tytułu** na górnym pasku, albo przez **długie przytrzymanie dolnego paska**. Arkusz zaznacza bieżący obszar i prowadzi na dole prosto do **Dostosuj pasek nawigacji…**.
- **Konfigurowanie paska:** **Ustawienia** → **Pasek nawigacji**. Przyciskami **−**/**+** ustalasz, ile obszarów pokazuje pasek (3–5, z podglądem na żywo), a **uchwytem do przeciągania** porządkujesz listę: górne pozycje tworzą pasek (oznaczone ramką), przeciągnięcie pozycji w górę przenosi ją na pasek. Nic nie jest ukrywane — to, czego nie ma na pasku, pozostaje dostępne przez arkusz obszarów. Jeśli obszar, w którym akurat jesteś, opuści pasek, aplikacja przechodzi do pierwszego widocznego.
- **＋** unosi się jako okrągły przycisk nad paskiem i otwiera szybkie tworzenie: notatka, notatka dzienna, folder, baza danych, „Z szablonu…”.
- **Górny pasek:** tytuł z **▾** (otwiera arkusz obszarów), wyszukiwanie i **Ustawienia** (⋮); ekran główny pokazuje dodatkowo „Ostatnie” i Twoje zakładki.
- **Ustawienia:** przycisk ⋮ otwiera najpierw listę obszarów (jak lewa strona ustawień na komputerze) — dotknięcie otwiera daną stronę. Na górze **Aktywny vault** prowadzi do zarządzania vaultami: przełączanie vaultów (znacznik = aktywny), **Utwórz vault** i **Połącz sejf w chmurze**.

## Czytanie i edycja notatek

Notatki otwierają się **wyrenderowane i tylko do odczytu**; ikona pióra w prawym górnym rogu przełącza na edycję (z paskiem narzędzi nad klawiaturą: formatowanie, listy, link wiki, polecenia slash, wstawianie zdjęcia). Osadzenia `![[Notatka]]` pojawiają się jako klikalne karty podglądu.

Przycisk **Szczegóły notatki** w nagłówku (między zakładką a menu ⋮) otwiera arkusz kontekstowy notatki: właściwości (bezpośrednio edytowalne), linki zwrotne, konspekt, graf oraz **historię wersji** — każda edycja automatycznie tworzy migawki, które możesz przeglądać, porównywać i przywracać. Źródło Markdown i wyszukiwanie w notatce znajdziesz w menu ⋮.

## Bazy danych (`.base`)

Bazy danych `.base` działają jak na komputerze: każdy widok (tabela, lista, galeria, tablica, kalendarz, oś czasu), edycja komórek zgodna z typem pola, karty na tablicy przenosisz, przytrzymując je. **Konfiguruj** zarządza widokami, kolumnami, filtrami (w tym grupami), sortowaniem i właściwościami. Schematy relacji (cele, liczność) nadal są utrzymywane na komputerze.

Widok **Tablica korkowa** pokazuje notatki jako dwukolumnową tablicę karteczek samoprzylepnych: dotknięcie otwiera notatkę, przytrzymanie pokazuje akcje (przypnij, etykiety, kolor, usuń), przeciąganie po przytrzymaniu zmienia kolejność, a pola wyboru odhaczasz bezpośrednio na karcie. Pole wprowadzania na górze tworzy nową notatkę. Wskazówka: skieruj bazę danych na folder skrzynki (**Ustawienia** → **Treść i struktura**), a szybkie notatki z ＋ oraz teksty udostępnione z innych aplikacji trafią prosto na tablicę.

## Kalendarz i wydarzenia

**Kalendarz** (dolna karta lub przez „Więcej”) pokazuje Twoje notatki dzienne w postaci siatki miesięcznej. Ikona zegara w prawym górnym rogu otwiera **kalendarz wydarzeń** z widokami **Dzień**, **3 dni** i **Agenda** — połączone kalendarze korzystają z tego samego modelu kont co na komputerze. Dotknięcie wydarzenia pokazuje jego szczegóły; przy zaproszeniu możesz od razu **zaakceptować**, oznaczyć jako **wstępne** lub **odrzucić**.

Kontami zarządzasz z poziomu ikony koła zębatego w kalendarzu wydarzeń: **CalDAV** łączysz bezpośrednio na urządzeniu za pomocą hasła aplikacji (np. Fastmail, Nextcloud, iCloud); Google i Microsoft łączysz przez logowanie w przeglądarce. Dla każdego konta możesz pokazywać lub ukrywać poszczególne kalendarze.

**Logowanie dotyczy każdego urządzenia osobno.** Synchronizowane są *ustawienia* Twojego konta, nigdy samo logowanie — to celowe: dane logowania nie powinny opuszczać urządzenia. Konto, które pojawiło się dzięki synchronizacji ustawień, widnieje więc na liście, ale nosi oznaczenie **zaloguj się**, a pod nim znajduje się wskazówka, co zrobić. Dopóki na tym urządzeniu żadne konto nie jest zalogowane, kalendarz wyjaśnia to w tym miejscu zamiast po prostu pozostawać pusty, a **Zaloguj się na tym urządzeniu** prowadzi do kont. Zalogowane konta pokazują **aktywne**.

## Poczta e-mail

W **Ustawieniach → Poczta e-mail** połączysz **skrzynkę Microsoft** (Outlook.com, Microsoft 365) bezpośrednio przez logowanie w przeglądarce — bez hasła aplikacji. Tak jak przy kalendarzu, logowanie obowiązuje osobno na każdym urządzeniu.

Potem otworzysz **Pocztę e-mail** jako osobny obszar przez ▾ przy tytule i umieścisz ją w pasku nawigacji. Wiersz pod tytułem pokazuje folder, liczbę nieprzeczytanych i konto oraz otwiera wybór folderów. Dotknij wiadomości, aby ją przeczytać; **Zapisz jako notatkę** umieści ją w folderze **Mail** Twojego sejfu (dwukrotne zapisanie otworzy tę samą notatkę). Zdalne obrazy pozostają zablokowane, dopóki ich nie zezwolisz dla tej wiadomości — wczytany obraz zdradza nadawcy, kiedy i gdzie czytałeś.

**Skrzynki IMAP nie działają jeszcze na telefonie.** Wymagają bezpośredniego połączenia z serwerem poczty, które dopiero powstaje. Skrzynka IMAP, która trafiła tu z komputera przez synchronizację ustawień, pojawia się na liście i mówi o tym na miejscu — na razie korzystaj z niej na komputerze.

## Synchronizacja

W **Ustawieniach** (⋮) **Aktywny vault** prowadzi do zarządzania vaultami; tam łączysz się z magazynem w chmurze (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Połącz sejf w chmurze** pobiera na urządzenie istniejący sejf w chmurze; **Utwórz vault** pyta najpierw **Na tym urządzeniu** czy **W usłudze online**, a potem o strukturę początkową (pustą lub szablon, np. PARA) — przy ścieżce online następuje połączenie, docelowy folder w chmurze można od razu utworzyć przez **Nowy folder** w arkuszu wyboru, a struktura zostaje przesłana podczas pierwszej synchronizacji. Ten sam wybór między istniejącym a nowym sejfem w chmurze oferuje też pierwsze uruchomienie („Połącz sejf w chmurze”). Każde połączenie otrzymuje własny, osobny sejf na urządzeniu. Strona sejfu pokazuje status, postęp, oczekujące transfery i oferuje **Eksportuj sejf** (ZIP przez arkusz udostępniania).

To, jak często ten sejf sprawdza zmiany po stronie zdalnej, ustawisz na tej samej stronie (**interwał synchronizacji**, co najmniej 5 sekund) — lokalne zapisy i tak trafiają w górę natychmiast. W Google Drive, OneDrive, Dropbox i S3 **folder w chmurze** można zmienić także później; w WebDAV folder jest częścią adresu serwera, więc tam łączysz się na nowo. Jeśli synchronizacja ustawień jest zaszyfrowana, możesz dodatkowo włączyć **Pytaj o hasło przy każdym starcie**: klucz nie jest wtedy przechowywany na urządzeniu. A **Bezpieczeństwo i udostępnianie** mówi teraz wprost, że zaszyfrowane przestrzenie robocze są eksperymentalne i nie zostały jeszcze niezależnie zweryfikowane — przechowuj plik i kod odzyskiwania w bezpiecznym miejscu.

Strona vaulta podaje też, czy Twoje **ustawienia** podróżują razem z Tobą — jako karta z wyraźnym stanem zamiast gołego przycisku:

- **nie są synchronizowane**: synchronizacja ustawień jest wyłączona dla tego vaultu. Włącz ją na komputerze.
- **Nie zaszyfrowano jeszcze**: ten vault nie ma jeszcze frazy hasłowej synchronizacji. Możesz ją teraz ustawić **na telefonie**: kreator pokazuje kod odzyskiwania i każe wpisać z powrotem dwie losowo wybrane grupy, zanim cokolwiek zostanie zapisane. Jeśli w chmurze istnieje już fraza hasłowa, telefon to zgłasza i nigdy nie tworzy drugiej — to zablokowałoby dostęp wszystkim innym urządzeniom.
- **Nie odblokowano jeszcze na tym urządzeniu**: Twoje ustawienia są przechowywane w chmurze w postaci zaszyfrowanej. Wprowadź frazę hasłową ustawioną podczas konfiguracji — na komputerze albo tutaj, na telefonie; to urządzenie odblokuje je nią jednorazowo.
- **są synchronizowane**: to urządzenie jest odblokowane; foldery, widoki i reguły backupu pozostają zgodne z Twoimi innymi urządzeniami.

Każda karta podaje też, co *nie* podróżuje: logowania zawsze pozostają na urządzeniu (patrz [Kalendarz i wydarzenia](#kalendarz-i-wydarzenia)).

**Ustawienia** → **Bezpieczeństwo i udostępnianie** podaje, czym połączenie naprawdę jest — a przy zwykłym sejfie w chmurze konfiguruje zaszyfrowany obszar roboczy wprost na telefonie (tożsamość → plik odzyskiwania i kod → aktywacja). Bez połączenia z chmurą nie ma czego szyfrować i sekcja to mówi.

## Sieć bezpieczeństwa

Migawki (historia wersji), dziennik wersji roboczych (po awarii notatka oferuje Twój ostatni niezapisany stan) oraz kopie konfliktów z widokiem porównania chronią Twoje dane. Przechowywanie konfigurujesz w **Ustawieniach** → **Backup i historia wersji**.

## Udostępnianie i skróty

Na Androidzie i iOS udostępniony tekst i adresy URL stają się nową notatką w folderze skrzynki; obrazy i pliki są importowane jako załączniki (do 25 MB na plik). Na Androidzie przytrzymaj ikonę aplikacji, aby użyć dodatkowych skrótów **Nowa notatka** i **Dzisiaj**. Strona vaulta pozwala włączyć **Synchronizuj ustawienia** oraz bezpiecznie odblokować lub zablokować zaszyfrowany vault hasłem.

## Foldery, zdjęcia i kalendarz

Pływający przycisk **Plus** pozostaje dostępny w zagnieżdżonych folderach, a każda akcja tworzy w otwartym folderze. W nagłówku **menu z trzema kropkami** otwiera ustawienia; nowe foldery tworzy się przyciskiem **Plus**.

Przycisk zdjęcia oferuje **Zrób zdjęcie** lub **Wybierz z biblioteki**, zachowuje pozycję wstawiania i pokazuje błędy uprawnień lub pliku.

**Kalendarz** otwiera bezpośrednio kalendarz połączonego dostawcy. Notatki dzienne pozostają w **Dzisiaj**; dawny lokalny widok miesiąca usunięto bez zmiany istniejących danych.
