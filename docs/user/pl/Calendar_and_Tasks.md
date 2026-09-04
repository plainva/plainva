# Kalendarz i zewnętrzne zadania

Stan na: 2026-09-03

Plainva może połączyć Twoje istniejące konta kalendarza i zadań — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Kalendarz + Tasks) i **Microsoft** (kalendarz Outlook + To Do) — i pracować z nimi w obu kierunkach. Twoje notatki pozostają centrum: wydarzenia stają się notatkami ze spotkań, a zewnętrzne listy zadań odzwierciedlają się jako zwykłe notatki w Twojej [domyślnej bazie zadań](Tasks.md).

> **Eksperymentalne.** Kalendarz komunikuje się z prawdziwymi zewnętrznymi kontami (CalDAV, Google, Microsoft), których nie da się przećwiczyć w automatycznych testach Plainva. Działa i jest używany codziennie, ale traktuj go jako wersję zapoznawczą: zachowaj kopię zapasową i zgłaszaj, proszę, wszystko, co wygląda nietypowo.

## Łączenie konta

Otwórz **Ustawienia → Twój vault → Konta w chmurze → Połącz konto…**, wybierz dostawcę i w kroku wyboru usług zaznacz **Kalendarz i zadania**:

- **Nextcloud / CalDAV**: adres serwera, nazwa użytkownika i **hasło aplikacji** (w Nextcloud: Ustawienia → Bezpieczeństwo → Urządzenia i sesje). Bez rejestracji, bez kluczy — w przypadku Nextcloud Plainva samodzielnie wyprowadza adres CalDAV z adresu serwera (dla innych serwerów CalDAV wybierz kafelek **WebDAV / CalDAV** lub **Zaawansowane: ustaw punkty końcowe osobno**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: dedykowane kafelki z już wypełnionymi adresami kalendarza — wystarczy adres e-mail plus **hasło aplikacji**, bez pola serwera (w przypadku Apple hasło aplikacji jest obowiązkowe; asystent linkuje instrukcję dostawcy). Uwaga: sam Yahoo zaznacza, że jego usługa CalDAV jest niestabilna — jeśli grymasi, nie jest to wina Plainva.
- **Google**: wymaga własnego identyfikatora klienta OAuth (ten sam model BYO co przy synchronizacji Google Drive — patrz [przewodnik Google Drive](Google_Drive_BYO_Guide.md)). W swoim projekcie Google Cloud dodatkowo włącz *Google Calendar API* i *Google Tasks API* oraz dodaj ich zakresy do ekranu zgody. Przeglądarka otwiera się w celu wyrażenia zgody; łączenie weryfikuje konto, zanim cokolwiek zostanie zapisane.
- **Microsoft**: wystarczy kliknąć **Zaloguj się przez Microsoft…** i potwierdzić w przeglądarce — konfiguracja nie jest potrzebna. Jedno konto Microsoft może w tym samym przebiegu obsługiwać też **Pliki** (OneDrive) i **E-mail**.

Asystent pokazuje status dla każdej usługi („Połączono — znaleziono n kalendarzy”). Wybór **kalendarzy** (zaznaczone pojawiają się w karcie kalendarza) i **list zadań** (celowo domyślnie odznaczone — zaznaczenie jednej uruchamia opisaną niżej synchronizację zadań) zarządzasz później w obszarze **Kalendarz**; tam znajduje się też **Folder spotkań** (gdzie powstają notatki ze spotkań) i **Domyślny kalendarz**. Hasła i tokeny są przechowywane w pęku kluczy Twojego systemu operacyjnego.

**Każde urządzenie loguje się osobno.** Jeśli korzystasz z [synchronizacji ustawień](Sync_Setup.md#szyfrowanie-synchronizacji-hasło), *dane* konta podróżują razem z Tobą, ale logowanie nigdy — celowo pozostaje na urządzeniu. Konto przejęte w ten sposób pojawia się więc na liście na drugim urządzeniu, ale nie jest tam jeszcze zalogowane; w [aplikacji mobilnej](Mobile_App.md) nosi wtedy oznaczenie **zaloguj się**, a kalendarz wyjaśnia to zamiast pozostawać pusty. Wystarczy połączyć się raz.

**Gdy logowanie wygasa.** Obszar kalendarza pokazuje wtedy błąd bezpośrednio przy dotkniętym koncie i mówi, co zrobić: jeśli logowanie wygasło lub zostało cofnięte, pojawia się tam **Zaloguj ponownie** — jeden przebieg, który u Microsoft i Google przywraca **wszystkie** usługi tego konta (pliki, kalendarz, e-mail). Jeśli winna jest konfiguracja dostawcy (błędny lub usunięty Client ID, brakujące API w projekcie), wskazówka kieruje tam zamiast oferować nowe logowanie; przy błędzie sieci wystarczy spróbować ponownie później. Przy projekcie Google w trybie **testowym** najczęstszą przyczyną jest limit 7 dni — szczegóły w [przewodniku Google Drive](Google_Drive_BYO_Guide.md). Dopóki konto jest nieosiągalne, Plainva nie twierdzi już, że nie udostępnia ono list zadań: lista pozostaje pusta, z błędem nad nią. W aplikacji mobilnej obowiązuje to samo: wiersz konta podaje powód, a **Zaloguj się ponownie** naprawia konto na miejscu.

**Dwukrotne połączenie tego samego konta nie tworzy drugiego.** Gdy dostawca potwierdzi, że to to samo konto — Plainva kieruje się **zweryfikowaną tożsamością** dostawcy, nigdy wyświetlaną nazwą; dwie osoby w tej samej firmie łatwo mają taką samą — nowe logowanie zostaje przejęte przez konto, które już masz, zamiast pojawić się obok niego. Wybór kalendarzy, stan synchronizacji, a przede wszystkim powiązania między Twoimi notatkami zadań a zadaniami u dostawcy przetrwają to; bez nich kolejna synchronizacja tworzyłaby każde odzwierciedlone zadanie po raz drugi. Przy CalDAV, gdzie nie ma zweryfikowanej tożsamości, pojawia się jak dotąd osobny wpis.

## Karta kalendarza

**Wpisy statusu Google** — miejsce pracy, czas skupienia i nieobecność — pojawiają się jako osobny wiersz albo jako spokojny pas za dniem, a nie jako kolejny blok spotkania: „Praca z domu" to nie spotkanie, a dzień z trzema takimi wpisami i jednym spotkaniem nie może wyglądać jak cztery spotkania. Plainva je **czyta** i nigdy nie zapisuje: utworzenie nieobecności w Google automatycznie odrzuca zaproszenia, a to nie jest efekt uboczny, który miałby wywoływać widok kalendarza.

Otwórz ją przez lewy pasek akcji (ikona kalendarza) lub paletę poleceń (**Otwórz kalendarz**). W nagłówku dostępny jest przełącznik pięciu widoków: **Dzień**, **3 dni** i **Tydzień** pokazują **siatkę czasu** z listwą godzin po lewej stronie; wydarzenia widoczne są jako bloki przy swojej godzinie rozpoczęcia, ich wysokość odpowiada czasowi trwania, nakładające się wydarzenia stoją obok siebie, a czerwona linia oznacza „teraz”. Wydarzenia całodniowe i (przy włączonej nakładce zadań) zadania z terminem znajdują się w pasku nad siatką. **Miesiąc** pokazuje siatkę miesiąca (jedna kolorowa kropka na kalendarz) oraz siatkę czasu wybranego dnia po prawej stronie. **Agenda** wyświetla nadchodzące tygodnie pogrupowane według dnia. **Dziś** przenosi z powrotem; strzałki przełączają o bieżący okres (dzień, trzy dni, tydzień lub miesiąc). Pierwszy dzień tygodnia zależy od ustawienia **Początek tygodnia** (Ustawienia → Aplikacja → Wygląd: Poniedziałek, Sobota lub Niedziela) — dotyczy to również kalendarza w pasku bocznym. Widok odświeża się automatycznie co kilka minut; przycisk odświeżania wymusza to natychmiast. W przypadku kalendarzy Microsoft i większości serwerów CalDAV Plainva pobiera teraz tylko **zmiany** zamiast całego zakresu za każdym razem — zauważalnie mniej danych, zwłaszcza na telefonie. Pełne odświeżenie nadal odbywa się co najmniej raz na godzinę, żeby nic nie pozostało w zawieszeniu, co przeoczyła lista zmian; a usuwane jest tylko to, co dostawca wyraźnie zgłasza jako usunięte. W przypadku Google każde odświeżenie jest pełne: jego API nie pozwala łączyć list zmian z zakresem dat. Zakończone już wydarzenia są wyświetlane **przygaszone** (tak jak w Kalendarzu Google), dzięki czemu reszta dzisiejszej agendy się wyróżnia. **Wydarzenie wielodniowe** to jeden ciągły **pasek** obejmujący dni, których dotyczy — jeden podpis, jeden cel kliknięcia zamiast wpisu na każdy dzień. Jeśli wykracza poza koniec tygodnia, zostaje ucięte prosto przy krawędzi i biegnie dalej w następnym wierszu bez powtarzania tytułu. Pas całodniowy w widokach Dzień, 3 dni i Tydzień działa tak samo.

- **Nowe wydarzenie**: **Kliknięcie pustego miejsca w siatce czasu** otwiera małe okienko szybkiego tworzenia (tytuł, godzina, kalendarz, miejsce) — **Zapisz** tworzy je od razu, **Więcej opcji** otwiera pełne okno dialogowe wydarzenia. **Przeciągnięcie** w siatce ustawia czas trwania. **+** w nagłówku otwiera pełne okno dialogowe: tytuł, kalendarz, data/godzina lub zakres całodniowy, miejsce, **opis**, **kolor**, **uczestnicy** oraz opcjonalne **powtarzanie** w stylu Outlooka. Ten kolor nadpisuje kolor kalendarza dla tego jednego wydarzenia (bez wpływu na konta Microsoft — Outlook nie ma kolorów dla pojedynczych wydarzeń). Na telefonie kolor wydarzenia wybierasz w arkuszu wydarzenia z tej samej siatki.
- **Uczestnicy**: wpisz adres e-mail i naciśnij **Enter** (lub przecinek), aby dodać go jako **chip**; × usuwa jeden wpis. Powtarzanie ustawia się tuż obok daty/godziny — wybierz częstotliwość, interwał, dni tygodnia (przy powtarzaniu tygodniowym) oraz sposób zakończenia (nigdy / w wybranym dniu / po N wystąpieniach); możesz też dodać lub zmienić powtarzanie istniejącego wydarzenia.
- **Podgląd**: **kliknięcie wydarzenia** otwiera **podgląd wydarzenia** — swobodnie unoszące się okno, które pokazuje wydarzenie zamiast je edytować: czas trwania, miejsce, opis, uczestników wraz z ich odpowiedziami, a do tego **Akceptuj / Wstępnie / Odrzuć**, **Notatka ze spotkania** oraz pod **⋮** wszystkie pozostałe działania (kolor, zablokuj w innych kalendarzach, wyślij e-mailem, usuń). Okno nie przyciemnia aplikacji, można je przenosić i zmieniać jego rozmiar; **Esc** je zamyka. Jeśli wydarzenie należy do **serii**, podgląd to pokazuje — wraz z rytmem i, jeśli jest wczytane, kolejnym wystąpieniem. Nie pada tu żadne pytanie: „tylko to czy wszystkie?” to pytanie o edycję, a nie o podgląd.
- **Edytuj / usuń**: **Edytuj wydarzenie** w podglądzie otwiera okno dialogowe wypełnione jego wartościami, z akcjami **Notatka ze spotkania** i **Usuń**. Zmiany są zapisywane u dostawcy z zabezpieczeniem: jeśli wydarzenie zmieniło się w międzyczasie zdalnie, Plainva odświeża widok zamiast go nadpisywać. Przy **pojedynczym wydarzeniu** okno ma dodatkowo **wybór kalendarza** — wybierz inny kalendarz, a wydarzenie zostanie tam **przeniesione** (utworzone w docelowym, usunięte ze źródłowego; otrzymuje przy tym nowy identyfikator u dostawcy).
- **Wydarzenia cykliczne**: wydarzenie z serii otwiera się do edycji tak samo jak każde inne — pytanie pojawia się dopiero przy **zapisywaniu**, i tylko wtedy, gdy naprawdę coś zmieniłeś. Okno dialogowe nazywa zmianę („Czas: 09:00 → 09:15”) i pyta, czy ma dotyczyć **tylko tego wydarzenia**, czy **wszystkich wydarzeń w serii**. Przy „wszystkich” do serii trafia tylko to, co zmieniłeś; jej własna data rozpoczęcia i wszystko, czego nie dotknąłeś, pozostaje bez zmian. Jeśli zamkniesz formularz bez zmian, nic się nie dzieje — żadnego okna dialogowego, żadnego zapisu u dostawcy. **Usuwanie** nadal pyta z góry: tam kliknięcie już jest zmianą.
- **Przenoszenie / zmiana rozmiaru**: możesz **przeciągnąć** wydarzenie bezpośrednio w siatce czasu — przeciągnięcie bloku zmienia jego termin (także na inny dzień w widoku tygodniowym lub 3-dniowym), a przeciągnięcie jego **dolnej krawędzi** zmienia czas trwania. Nowy czas jest od razu zapisywany u dostawcy (wydarzenia cykliczne są na razie edytowalne wyłącznie przez okno dialogowe).
- **Jak wygląda wydarzenie**: **odwołane** wydarzenie pozostaje widoczne, ale pokazuje się jako **obrys** z **przekreślonym tytułem** — widzisz, że termin się zwolnił, zamiast go po cichu stracić. **Zaproszenie, na które nie odpowiedziałeś**, też jest obrysem (to jeszcze nie Twój termin); wydarzenie **wstępne** — tak oznaczone przez organizatora albo z Twoją odpowiedzią „być może” — jest **kreskowane**. Wszystko potwierdzone pozostaje wypełnione. W agendzie dochodzi jeszcze słowo (**Odwołane**, **Bez odpowiedzi**, **Wstępne**). Jeśli **odmówisz**, wydarzenie staje się **przygaszonym obramowaniem** z przekreślonym tytułem (w agendzie **Odrzucono**): dla innych się odbywa, ale nie należy już do Twojego dnia. Odwołanie przez organizatora pozostaje wyraźniejsze — dotyczy wszystkich.
- **RSVP i odpowiedzi**: gdy zostałeś zaproszony na wydarzenie, okno dialogowe udostępnia przyciski **Akceptuj**, **Wstępnie** i **Odrzuć** — Plainva wysyła Twoją odpowiedź do dostawcy (Google/Microsoft/CalDAV). **Lista uczestników** pokazuje, kto zaakceptował, a kto odrzucił (kanał zwrotny).
- **Zaproszenia e-mailem**: gdy wydarzenie ma uczestników, zaznacz **Powiadom uczestników e-mailem**. W przypadku Google Plainva prosi wtedy Google o wysłanie jego natywnego zaproszenia (to samo wydarzenie, więc odpowiedzi odbiorcy synchronizują się z powrotem do Twojego wydarzenia); Microsoft powiadamia uczestników automatycznie. Dla CalDAV — albo aby wysłać kopię z własnej skrzynki — akcja **Wyślij e-mailem** w kalendarzu otwiera edytor wiadomości z załączonym, zgodnym ze standardem zaproszeniem iCalendar, dzięki czemu Gmail i inne klienty pokazują je jako wydarzenie z opcjami Tak/Może/Nie.
- **Blokowanie w innych kalendarzach**: akcja **kopiuj** przy wydarzeniu (albo przycisk **Zablokuj w innych kalendarzach** w jego oknie dialogowym) odwzorowuje je w jednym lub kilku innych Twoich edytowalnych kalendarzach — jako nieprzejrzysty zastępnik **Zajęty** albo **ze szczegółami** (w stylu Notion Calendar). Wydarzenie cykliczne jest odwzorowane wraz z powtarzaniem, więc blokada również się powtarza. Jeśli w którymś kalendarzu się nie uda, komunikat podaje dla każdego kalendarza powód zwrócony przez dostawcę; gdy kontu brakuje uprawnienia, oferuje **Zaloguj się ponownie** i prowadzi prosto do konta. Na telefonie ta sama akcja jest w **podglądzie wydarzenia**: najpierw wybierz kalendarze, potem **Zajęty** lub **Ze szczegółami**.
- **Wydarzenia cykliczne** mają odznakę powtarzania. Edytowanie lub usuwanie jednej instancji pyta **„Tylko to wydarzenie”** (tworzy wyjątek / pomija tylko to jedno wystąpienie) lub **„Wszystkie wydarzenia”** (zmienia całą serię). Plainva nigdy nie nadpisuje istniejącej reguły powtarzania.
- **Pokaż zadania** (obok przycisku odświeżania, gdy ustawiona jest domyślna baza zadań): nakłada na pasek siatki czasu i siatkę miesiąca wpisy z terminem znajdujące się w Twojej [domyślnej bazie zadań](Tasks.md). Domyślnie wyłączone, wybór jest zapamiętywany dla każdego urządzenia. Jeśli kolumna terminu niesie **godzinę** (typ kolumny „data i godzina”), zadanie staje na swoim miejscu **w siatce dnia** zamiast w pasie całodniowym — obrysowane przerywaną linią zamiast wypełnione, bo termin nie jest przedziałem, z polem wyboru wprost w bloku. Bez godziny wszystko zostaje po staremu.
  - Kliknięcie **pola wyboru** odhacza zadanie bezpośrednio tutaj — nie trzeba otwierać notatki. Kliknięcie **tytułu** nadal ją otwiera. Odhaczenie zapisuje ten sam plik, który zapisuje widok Zadania: jeśli zadanie ma **powtarzanie**, powstaje wtedy kolejne.
  - **Zadania są zabarwione inaczej niż wydarzenia.** Zakończone wydarzenie jest po prostu przeszłością i wyświetla się przygaszone; **zaległe** zadanie jest natomiast pilniejsze i zostaje **wyróżnione**. Zadania z terminem dzisiaj wyświetlają się normalnie, przyszłe przygaszone, ukończone przekreślone.
  - **Ikona powtarzania** przy wierszu pokazuje, że to zadanie ma powtarzanie. Mimo to pojawia się w kalendarzu tylko **raz** — zobacz [Zadania](Tasks.md), dlaczego tak jest.

## Kalendarz we własnym oknie

Kliknij prawym przyciskiem **Kalendarz** na pasku akcji, aby otworzyć go we własnym oknie — przydatne obok notatki, którą piszesz. Kliknij ten sam wpis ponownie, a to okno wysunie się na wierzch, zamiast otwierać kolejny kalendarz.

Paleta poleceń oferuje **Otwórz okno komunikacji**: jedno okno z pocztą i kalendarzem obok siebie. Więcej w [Pierwszych krokach](Getting_Started.md).

## Wydarzenie → notatka ze spotkania

Ikona notatki przy dowolnym wydarzeniu tworzy (lub otwiera ponownie) jego **notatkę ze spotkania** — zwykłą notatkę w folderze spotkań o nazwie `RRRR-MM-DD Tytuł.md`, wstępnie wypełnioną datą, miejscem i uczestnikami, plus małym znacznikiem `plainva.pim` we frontmatter, który wiąże ją z wydarzeniem. Ponowne kliknięcie tego samego wydarzenia zawsze otwiera tę samą notatkę; Twoja notatka, która przypadkiem nosi tę samą nazwę, nigdy nie jest naruszana.

## Zewnętrzne listy zadań w Twojej bazie zadań

Listy przypomnień (Przypomnienia Apple przez CalDAV iCloud, listy zadań Nextcloud) są na serwerze osobnymi kolekcjami, dlatego pojawiają się w sekcji **Listy zadań** — nigdy w **Kalendarzach**. Jeśli połączone konto nie pokazuje list zadań, sekcja to komunikuje i proponuje **Szukaj ponownie**; gdy samo wyszukiwanie się nie powiodło, wyświetlany jest powód, a Twój dotychczasowy wybór zostaje zachowany.

Zaznacz **listę zadań** przy połączonym koncie, a jej zadania pojawią się jako notatki w Twojej [domyślnej bazie zadań](Tasks.md): tytuł staje się notatką (H1), termin trafia do kolumny daty w bazie danych, a ukończenie odwzorowuje się na **właściwość pola wyboru zrobione** bazy danych (kolumna statusu podąża za tą zmianą; baza danych bez kolumny pola wyboru korzysta z konwencji statusu — pierwsza opcja = otwarte, ostatnia = zrobione). Synchronizacja jest dwukierunkowa i działa dla poszczególnych pól:

Nowe listy zadań są **zaznaczone od początku** — inaczej niż kalendarze, które najpierw wybierasz. Odznaczenie pozostaje: po restarcie, po odświeżeniu list i poprzez synchronizację ustawień.

- Edytujesz notatkę (tytuł, termin, status) → zmiana jest wysyłana do dostawcy.
- Zmieniasz zadanie zdalnie → notatka podąża za zmianą.
- Jeśli obie strony się zmieniły, dla danego pola wygrywa Twoja lokalna zmiana; reszta podąża za stroną zdalną.

**Usuwanie działa w obie strony — ale tylko wtedy, gdy to potwierdzisz.** Usuń notatkę zadania w Plainva, a zadanie zostanie usunięte także u dostawcy. Masz wtedy osiem sekund: powiadomienie na dole zawiera przycisk **Cofnij**, a jedno kliknięcie przywraca notatkę **wraz z jej treścią**, zanim cokolwiek dotrze do dostawcy. Dopiero gdy okno się zamknie, zadanie zostaje usunięte.

Ta reguła ma celowo dwa ograniczenia. **Sam brak pliku niczego nie usuwa.** Jeśli notatka zniknie bez Twojego udziału — niedokończona synchronizacja, folder, który jeszcze nie dotarł — zadanie u dostawcy pozostaje nietknięte. A **zamknięcie Plainvy przed upływem ośmiu sekund niczego nie usuwa**; bezpiecznym skutkiem przerwanego usuwania jest to, że zadanie nadal istnieje. Jeśli zadanie zostało w tym czasie zmienione u dostawcy, Plainva przerywa usuwanie i to zgłasza — cudza zmiana nie znika po cichu.

**To obowiązuje na obu urządzeniach.** Synchronizacja działa też na telefonie — zadania są tam importowane, istniejące notatki są rozpoznawane zamiast tworzone podwójnie, a Twoje zmiany są wysyłane do dostawcy. Jedyna różnica dotyczy okna cofania: na komputerze zamknięcie Plainvy anuluje usunięcie; na telefonie robi to wysłanie aplikacji w tło. W obu przypadkach zadanie zostaje.

W drugą stronę obowiązuje dawna reguła: **zdalnie usunięte zadanie nigdy nie usuwa Twojej notatki** (po prostu staje się zwykłą notatką). Zmiana nazwy lub przeniesienie notatki zadania nie stanowi problemu — znacznik we frontmatter utrzymuje powiązanie.

**Ponowne połączenie nie tworzy już duplikatów.** Gdy zalogujesz się ponownie na konto, skonfigurujesz Plainvę na drugim urządzeniu albo indeks wyszukiwania zostanie odbudowany, Plainva rozpoznaje istniejące notatki po tym samym znaczniku i przejmuje je, zamiast importować zadania po raz drugi. Dopóki vault wciąż się synchronizuje, żadne notatki zadań nie są w ogóle tworzone — notatka, która wciąż jest w drodze, w przeciwnym razie stałaby się dokładnie takim duplikatem.

Obecne ograniczenia: zadania utworzone jako zwykłe notatki nie są wysyłane do dostawcy (twórz je zdalnie albo przez bazę zadań), a wszystko na tej stronie jest na razie desktop-first.

Kopie utworzone przez **Zablokuj w innych kalendarzach** zawierają zależne od dostawcy powiązanie Plainva w Google, Microsoft i CalDAV. Widoki kalendarza pokazują relację ikoną łącza; po odświeżeniu źródło i blokada są ponownie kojarzone zamiast tworzyć niezależne duplikaty.

## Przypomnienia na komputerze

W **Ustawieniach → Kalendarz → Przypomnienia** włączasz **Przypominaj o spotkaniach**; za pierwszym razem system pyta raz o uprawnienie. Liczy się przypomnienie, które niesie samo spotkanie — dopiero gdy nic nie mówi, obowiązuje **Wyprzedzenie**, a spotkania całodniowe odzywają się o porze wybranej w **Spotkaniach całodniowych**. **Zadania z terminem** dokładają zadania z Twojej bazy zadań, a **Tylko te kalendarze** zawężają, skąd przychodzą przypomnienia (nic nie zaznaczone znaczy: wszystkie, a kalendarz podłączony później dołącza sam z siebie). Tuż pod nim znajduje się **Zadania bez godziny**: zadanie ma termin W swoim dniu, a nie wieczorem wcześniej — dlatego ma własną regułę (dzień i godzina dowolnie wybierane, domyślnie **w dniu terminu o 09:00**). Wcześniej pożyczało regułę spotkań całodniowych, co oznaczało, że odzywało się o 19:00 poprzedniego wieczoru i nigdy więcej, bez żadnej wskazówki, dlaczego. Zadanie, którego kolumna terminu niesie **godzinę**, nadal korzysta z normalnego wyprzedzenia. Wiersz **Spotkania całodniowe** przyjmuje teraz też dowolną godzinę zamiast dwóch stałych kombinacji; oba wiersze wypisują poniżej wynikające z tego zdanie.

**Oba przełączniki są niezależne.** Jeśli chcesz otrzymywać przypomnienia tylko o zadaniach, włącz **Zadania z terminem** i wyłącz **Przypominaj o spotkaniach** — wcześniej jedno zależało od drugiego, a nigdzie nie było o tym mowy.

Przypomnienie mówi teraz, **co** zapowiada: „Termin · 09:30” albo „Zadanie · termin dzisiaj”. Na Androidzie każdy rodzaj nosi dodatkowo własną ikonę na pasku stanu. A **wiersz pod ustawieniami mówi, co zostało zaplanowane** — „Zaplanowano: 12 terminów · 3 zadania” — albo dlaczego nic nie zaplanowano, na przykład dlatego, że na tym urządzeniu nie ustawiono bazy zadań (dociera ona przez synchronizację ustawień).

**Różnica wobec telefonu stoi w ustawieniu, nie drobnym drukiem.** Na telefonie przypomnienie przejmuje system operacyjny i budzi je nawet przy zamkniętej aplikacji. Na komputerze takiego przekazania nie ma: **Plainva budzi je sama i dlatego musi działać.** Przy zamkniętej aplikacji przypomnienie przepada i nie jest nadrabiane. W zamian nie ma tu żadnego limitu.

Samo powiadomienie nie ma przycisku — komputer tego nie udostępnia. Działanie znajduje się w komunikacie w aplikacji: **Pokaż w kalendarzu** przy spotkaniu, **Otwórz zadanie** przy zadaniu. Okno nigdy nie wysuwa się przy tym na wierzch.

### Działanie w tle

Ponieważ przypomnienie na komputerze dociera tylko wtedy, gdy Plainva działa, w **Ustawieniach → Start i zachowanie → W tle** są dwa przełączniki — osobne, bo to dwa różne życzenia, i oba **domyślnie wyłączone**:

- **Uruchamiaj wraz z systemem** rejestruje Plainvę przy logowaniu.
- **Po zamknięciu działaj dalej w obszarze powiadomień** umieszcza ikonę Plainvy w obszarze powiadomień; zamknięcie okna nie kończy już aplikacji, tylko ją tam odkłada. Przez ikonę wracasz przez **Otwórz**, widzisz **następne spotkanie** i kończysz Plainvę przez **Zakończ**.

**Drugi przełącznik dowodzi sam siebie.** Nie każde środowisko pokazuje obszar powiadomień — a tego, czy ikona naprawdę się pojawi, nie da się wiarygodnie przewidzieć. Dlatego Plainva ją tworzy i **pyta, czy ją widzisz**. Tylko „tak" zachowuje ustawienie; jeśli powiesz „nie", ikona zostaje usunięta, a przełącznik pozostaje wyłączony. Dzięki temu okno nigdy nie zniknie bez drogi powrotnej. To samo zabezpieczenie działa przy następnym starcie: jeśli ikony nie da się już utworzyć, ustawienie samo się wyłącza.

Wiersz **Przypomnienia pojawiają się** poniżej mówi w każdej chwili, co obowiązuje — *dopóki Plainva działa* albo *także przy zamkniętym oknie*.

**Warto wiedzieć:** gdy Plainva działa dalej w tle, działają też **synchronizacja, odświeżanie kalendarza i sprawdzanie kopii zapasowych**. Przy następnym otwarciu skarbiec jest aktualny — aplikacja pracuje, gdy na nią nie patrzysz.


## Pokazywanie baz danych w kalendarzu

Kalendarz może pokazywać **wpisy z Twoich baz danych** obok terminów. Pasek **Pokaż:** nad widokiem wymienia każdy widok `.base` typu **kalendarz** lub **oś czasu**, który wskazuje kolumnę daty. Jedno kliknięcie pokazuje go, kolejne ukrywa.

Tak pokazany wpis **pozostaje rozpoznawalny jako notatka**: przerywana krawędź, romb z przodu, nigdy wypełniony kształt terminu. Kliknięcie otwiera ten sam podgląd, który wiersz bazy danych już ma. **Przeciągnięcie na inny dzień zapisuje kolumnę daty** notatki — dokładnie to, co robi edycja tej komórki w tabeli. Jeśli kolumna niesie godzinę, wpis stoi o tej godzinie w siatce dnia; bez godziny stoi w pasku całodniowym.

**To, które widoki są pokazywane, należy do sejfu** i podróżuje przez synchronizację ustawień: Twój kalendarz wygląda tak samo na komputerze i w telefonie.

**I odwrotnie:** w widoku kalendarza bazy danych przycisk **Terminy w tle** pokazuje prawdziwe terminy dnia jako cichy wiersz — widzisz, wobec czego planujesz. To celowo tylko tło: nie są wierszami tej bazy i nie da się ich kliknąć.

## Wpisanie wpisu bazy danych do kalendarza

Wpis z datą może stać się **prawdziwym wydarzeniem** u Twojego dostawcy. Menu wiersza (lub arkusz akcji na telefonie) oferuje **Dodaj do kalendarza**. Wydarzenie przejmuje datę wpisu — z godziną, jeśli kolumna ją niesie, w przeciwnym razie jako wydarzenie całodniowe — i zawiera odnośnik z powrotem do notatki.

Od tej chwili oba pozostają powiązane, według trzech stałych reguł:

* **Gdy przesuniesz wydarzenie** w Google, Outlooku lub na serwerze CalDAV, **kolumna daty notatki podąża za nim.**
* **Gdy usuniesz notatkę,** okno usuwania informuje, że jest powiązana z wydarzeniem. Wydarzenie pozostaje u Twojego dostawcy — Plainva nigdy nie usuwa go przy okazji.
* **Gdy usuniesz wydarzenie,** znika tylko powiązanie. Notatka i jej data pozostają nietknięte.

To coś innego niż **blokowanie czasu** przy zadaniu: tam rezerwujesz czas na coś, a data zadania zostaje na miejscu. Tutaj mówisz: *ten wpis JEST tym wydarzeniem.*
