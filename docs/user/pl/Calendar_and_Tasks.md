# Kalendarz i zewnętrzne zadania

Stan na: 2026-07-18

Plainva może połączyć Twoje istniejące konta kalendarza i zadań — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Kalendarz + Tasks) i **Microsoft** (kalendarz Outlook + To Do) — i pracować z nimi w obu kierunkach. Twoje notatki pozostają centrum: wydarzenia stają się notatkami ze spotkań, a zewnętrzne listy zadań odzwierciedlają się jako zwykłe notatki w Twojej [domyślnej bazie zadań](Tasks.md).

## Łączenie konta

Otwórz **Ustawienia → Vault → Kalendarz i konta → Dodaj konto…** i wybierz dostawcę:

- **CalDAV**: adres URL serwera, nazwa użytkownika i **hasło aplikacji** (w Nextcloud: Ustawienia → Bezpieczeństwo → Urządzenia i sesje). Bez rejestracji, bez kluczy.
- **Google**: wymaga własnego identyfikatora klienta OAuth (ten sam model BYO co przy synchronizacji Google Drive — patrz [przewodnik Google Drive](Google_Drive_BYO_Guide.md)). W swoim projekcie Google Cloud dodatkowo włącz *Google Calendar API* i *Google Tasks API* oraz dodaj ich zakresy do ekranu zgody. Przeglądarka otwiera się w celu wyrażenia zgody; łączenie weryfikuje konto, zanim cokolwiek zostanie zapisane.
- **Microsoft**: wystarczy kliknąć **Połącz** i potwierdzić w przeglądarce — konfiguracja nie jest potrzebna.

Każde konto wyświetla swoje **kalendarze** (zaznaczone pojawiają się w karcie kalendarza) i swoje **listy zadań** (celowo domyślnie odznaczone — zaznaczenie jednej uruchamia opisaną niżej synchronizację zadań). Hasła i tokeny są przechowywane w pęku kluczy Twojego systemu operacyjnego. Ustawienie **Folder spotkań** poniżej kont określa, gdzie tworzone są notatki ze spotkań.

## Karta kalendarza

Otwórz ją przez lewy pasek akcji (ikona kalendarza) lub paletę poleceń (**Otwórz kalendarz**). W nagłówku dostępny jest przełącznik pięciu widoków: **Dzień**, **3 dni** i **Tydzień** pokazują **siatkę czasu** z listwą godzin po lewej stronie; wydarzenia widoczne są jako bloki przy swojej godzinie rozpoczęcia, ich wysokość odpowiada czasowi trwania, nakładające się wydarzenia stoją obok siebie, a czerwona linia oznacza „teraz”. Wydarzenia całodniowe i (przy włączonej nakładce zadań) zadania z terminem znajdują się w pasku nad siatką. **Miesiąc** pokazuje siatkę miesiąca (jedna kolorowa kropka na kalendarz) oraz siatkę czasu wybranego dnia po prawej stronie. **Agenda** wyświetla nadchodzące tygodnie pogrupowane według dnia. **Dziś** przenosi z powrotem; strzałki przełączają o bieżący okres (dzień, trzy dni, tydzień lub miesiąc). Pierwszy dzień tygodnia zależy od ustawienia **Początek tygodnia** (Ustawienia → Aplikacja → Wygląd: Poniedziałek, Sobota lub Niedziela) — dotyczy to również kalendarza w pasku bocznym. Widok odświeża się automatycznie co kilka minut; przycisk odświeżania wymusza to natychmiast.

- **Nowe wydarzenie**: **Kliknięcie pustego miejsca w siatce czasu** otwiera małe okienko szybkiego tworzenia (tytuł, godzina, kalendarz, miejsce) — **Zapisz** tworzy je od razu, **Więcej opcji** otwiera pełne okno dialogowe wydarzenia. **Przeciągnięcie** w siatce ustawia czas trwania. **+** w nagłówku otwiera pełne okno dialogowe: tytuł, kalendarz, data/godzina lub zakres całodniowy, miejsce, opis oraz opcjonalne, proste **powtarzanie** (codziennie/co tydzień/co miesiąc/co rok).
- **Edytuj / usuń**: **Kliknięcie wydarzenia** w siatce czasu otwiera okno dialogowe wypełnione jego wartościami, z akcjami **Notatka ze spotkania** i **Usuń**. Zmiany są zapisywane u dostawcy z zabezpieczeniem: jeśli wydarzenie zmieniło się w międzyczasie zdalnie, Plainva odświeża widok zamiast go nadpisywać.
- **Wydarzenia cykliczne** mają odznakę powtarzania. Edytowanie lub usuwanie jednej instancji pyta **„Tylko to wydarzenie”** (tworzy wyjątek / pomija tylko to jedno wystąpienie) lub **„Wszystkie wydarzenia”** (zmienia całą serię). Plainva nigdy nie nadpisuje istniejącej reguły powtarzania.
- **Pokaż zadania** (obok przycisku odświeżania, gdy ustawiona jest domyślna baza zadań): nakłada na pasek siatki czasu i siatkę miesiąca wpisy z terminem znajdujące się w Twojej [domyślnej bazie zadań](Tasks.md); ukończone zadania są przekreślone. Domyślnie wyłączone, wybór jest zapamiętywany dla każdego urządzenia.

## Wydarzenie → notatka ze spotkania

Ikona notatki przy dowolnym wydarzeniu tworzy (lub otwiera ponownie) jego **notatkę ze spotkania** — zwykłą notatkę w folderze spotkań o nazwie `RRRR-MM-DD Tytuł.md`, wstępnie wypełnioną datą, miejscem i uczestnikami, plus małym znacznikiem `plainva.pim` we frontmatter, który wiąże ją z wydarzeniem. Ponowne kliknięcie tego samego wydarzenia zawsze otwiera tę samą notatkę; Twoja notatka, która przypadkiem nosi tę samą nazwę, nigdy nie jest naruszana.

## Zewnętrzne listy zadań w Twojej bazie zadań

Zaznacz **listę zadań** przy połączonym koncie, a jej zadania pojawią się jako notatki w Twojej [domyślnej bazie zadań](Tasks.md): tytuł staje się notatką (H1), termin trafia do kolumny daty w bazie danych, a ukończenie odwzorowuje się na **właściwość pola wyboru zrobione** bazy danych (kolumna statusu podąża za tą zmianą; baza danych bez kolumny pola wyboru korzysta z konwencji statusu — pierwsza opcja = otwarte, ostatnia = zrobione). Synchronizacja jest dwukierunkowa i działa dla poszczególnych pól:

- Edytujesz notatkę (tytuł, termin, status) → zmiana jest wysyłana do dostawcy.
- Zmieniasz zadanie zdalnie → notatka podąża za zmianą.
- Jeśli obie strony się zmieniły, dla danego pola wygrywa Twoja lokalna zmiana; reszta podąża za stroną zdalną.

Dwie zasady bezpieczeństwa chronią Twoje dane: **usunięcie notatki nigdy nie usuwa zdalnego zadania** (synchronizacja po prostu się zatrzymuje i zadanie nie jest ponownie importowane), a **zdalnie usunięte zadanie nigdy nie usuwa Twojej notatki** (po prostu staje się zwykłą notatką). Zmiana nazwy lub przeniesienie notatki zadania nie stanowi problemu — znacznik we frontmatter utrzymuje powiązanie.

Obecne ograniczenia: zadania utworzone jako zwykłe notatki nie są wysyłane do dostawcy (twórz je zdalnie albo przez bazę zadań), a wszystko na tej stronie jest na razie desktop-first.
