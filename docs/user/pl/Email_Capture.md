# Przechwytywanie e-maili

Stan na: 2026-08-21
Plainva może czytać Twoją skrzynkę pocztową, aby wydobyć wiedzę z e-maili do Twojego vaulta — a od wersji 0.4.0 także pisać i wysyłać wiadomości. Nacisk pozostaje na **przechwytywaniu** wiadomości jako notatek; skrzynka połączona przez **IMAP** jest do przechwytywania wyłącznie odczytywana (nic się w niej nie zmienia, nawet znaczniki nieprzeczytanych), o ile nie skonfigurujesz wysyłania.

> **Eksperymentalne.** Klient pocztowy komunikuje się z prawdziwymi zewnętrznymi kontami (IMAP/SMTP oraz Microsoft), których nie da się przećwiczyć w automatycznych testach Plainva. Działa i jest używany codziennie, ale traktuj go jako wersję zapoznawczą: zachowaj kopię zapasową i zgłaszaj, proszę, wszystko, co wygląda nietypowo.

## Łączenie skrzynki pocztowej

**Ustawienia → Twój vault → Konta w chmurze → Połącz konto…** i wybierz dostawcę:

- **Microsoft** — dla Outlook.com i Microsoft 365: w kroku wyboru usług zaznacz **E-mail** (na życzenie razem z **Pliki** i **Kalendarz i zadania** — jedno konto, jedno logowanie) i zaloguj się bezpośrednio w przeglądarce, całkowicie bez hasła aplikacji i bez IMAP. Plainva korzysta w tym celu z centralnej rejestracji aplikacji Plainva (własny identyfikator aplikacji możesz opcjonalnie podać w szczegółach konta). Czytanie skrzynki, przechwytywanie i **bezpośrednie wysyłanie** odbywają się przez logowanie Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — dedykowane kafelki: adres e-mail plus **hasło aplikacji**, serwery są już wypełnione (przy większości tych kafelków w tym samym kroku można też zaznaczyć **Kalendarz i zadania** — jedno hasło aplikacji dla wszystkich wybranych usług). Asystent za każdym razem linkuje oficjalną instrukcję dostawcy dotyczącą tworzenia hasła aplikacji.
- **Serwer e-mail (IMAP)** — dla wszystkich innych dostawców: host, port i hasło lub **hasło aplikacji**. Gotowe ustawienia wstępne obejmują dostawców z całego świata — od **web.de**/**GMX** i **T-Online**, przez **Orange**, **Libero**, **WP**, **Seznam** i **Comcast**, po **QQ Mail**, **NetEase**, **Naver** i **Yahoo! JAPAN**; lista **Dostawca** ma do tego linię wyszukiwania, a wpisanie adresu automatycznie wybiera pasujące ustawienie wstępne. Tam, gdzie dostawca ma swoje osobliwości, asystent informuje o tym tuż pod formularzem: niektórzy wymagają **hasła aplikacji** lub **kodu autoryzacyjnego** zamiast hasła konta, u innych trzeba najpierw włączyć IMAP w ustawieniach dostawcy — zawsze z linkiem do oficjalnej instrukcji. Dla Gmaila to `imap.gmail.com`, port `993`, z hasłem aplikacji z [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (wymaga uwierzytelniania dwuskładnikowego) — bez OAuth, bez weryfikacji; asystent sam zwraca na to uwagę przy adresach Gmail. **Skrzynek Outlook.com** nie da się już połączyć przez IMAP z hasłem (Microsoft wyłączył tę drogę) — ustawienie wstępne wskazuje na kafelek **Microsoft**. **Proton Mail** działa tylko przez lokalnie uruchomiony, płatny Proton Mail Bridge (ma własne ustawienie wstępne). Do bezpośredniego wysyłania można podać host SMTP.

Łączenie sprawdza logowanie, zanim cokolwiek zostanie zapisane; dane dostępowe trafiają do pęku kluczy Twojego systemu operacyjnego. Połączone skrzynki i ustawienia przechwytywania znajdziesz później w obszarze **E-mail**: ustawienie **Folder e-mail** określa, gdzie są przechowywane przechwycone e-maile (domyślnie `Mail`).

**Logowanie na drugim urządzeniu.** Gdy skrzynka przyjeżdża przez synchronizację ustawień, jej hasło nie wędruje automatycznie — logowania są przenoszone tylko wtedy, gdy sam włączysz synchronizację danych logowania. Taka skrzynka pokazuje w obszarze **E-mail** przycisk **Zaloguj się na tym urządzeniu**: wpisz hasło, a Plainva sprawdzi je u dostawcy i dopiero potem zapisze w pęku kluczy. W przypadku skrzynki Microsoft ten sam przycisk prowadzi do **Konta w chmurze**, bo tam odbywa się logowanie w przeglądarce. Jeśli przez to lista wiadomości pozostaje pusta, ta sama wskazówka z tym samym przyciskiem znajduje się także tam — nie musisz sam szukać ustawień.

## Czytanie poczty

Otwórz kartę e-mail przez lewy pasek akcji (ikona koperty) lub paletę poleceń (**Otwórz e-mail**). Lista pokazuje Twoją skrzynkę odbiorczą od najnowszych (nieprzeczytane pogrubione, **Wczytaj więcej** doładowuje kolejne). Wybranie wiadomości otwiera ją w **przeglądarce w piaskownicy**:

- **Zdalna zawartość jest blokowana** — piksele śledzące, zdalne obrazy i moduły ładujące style są usuwane i liczone („Zablokowano zdalną zawartość (n)”). Wyświetlane są tylko samodzielnie osadzone obrazy inline. **Pokaż obrazy** obok licznika jednorazowo odsłania obrazy https danej wiadomości; **Zawsze wczytuj zdalne obrazy** w ustawieniach poczty zamienia to w stałą zgodę. Uwaga: wczytanie zdalnych obrazów pozwala nadawcy zobaczyć Twój adres IP oraz moment otwarcia wiadomości — dlatego domyślnie zawartość jest blokowana.
- **Przeczytane znaczy przeczytane** — otwarta wiadomość liczy się jako przeczytana po trzech sekundach. Jeśli oznaczysz ją w tym czasie ręcznie **jako nieprzeczytaną**, pozostaje nieprzeczytana, dopóki jest otwarta; odliczanie zaczyna się od nowa dopiero wtedy, gdy ją zamkniesz i otworzysz ponownie. Tak samo na obu urządzeniach — wcześniej licznik na komputerze cofał oznaczenie po trzech sekundach, a telefon oznaczał wiadomość jako przeczytaną natychmiast po otwarciu.
- Linki są pokazywane jako zwykły tekst i nie są klikalne w przeglądarce.
- Skrypty i formularze nigdy się nie uruchamiają. Wiadomość jest renderowana w izolowanej ramce z restrykcyjną polityką treści.
- **Szerokie wiadomości są dopasowywane** — wiele newsletterów powstaje dla stałej szerokości kolumny i nie da się ich przełamać. Zamiast ucinać taką wiadomość przy lewej krawędzi, Plainva zmniejsza ją do szerokości ramki; na telefonie ramka rośnie razem z nią, więc przewijasz stronę jak zwykle.
- **Konwersacje** — przełącznik nad listą (ikona dymku) zwija powiązane wiadomości w jeden wiersz: uczestnicy, liczba i temat, od którego wymiana się zaczęła. Dotknięcie go rozwija; każda wiadomość zachowuje swój folder i podaje go, gdy nie jest tym otwartym. Plainva czyta przy tym także **Wysłane**, aby Twoje własne odpowiedzi były częścią rozmowy. Wyłączone — wszystko zostaje jak dotąd, płaska lista — a wybór jest pamiętany dla każdego vaultu, na obu urządzeniach. Grupowanie idzie za łańcuchem odpowiedzi wiadomości (u Microsoftu za konwersacją, którą prowadzi sam dostawca); tylko gdy odpowiedź nie niesie tego łańcucha, pomaga temat — i wtedy jedynie przy rozpoznawalnej odpowiedzi („Re:”, „Odp:”) i w ciągu 30 dni, żeby dwie wiadomości o tym samym temacie się nie zlały.
- **Wszystkie skrzynki odbiorcze** — pierwsza pozycja nad listą folderów pokazuje skrzynki odbiorcze **wszystkich** kont na jednej liście, od najnowszych, a każdy wiersz podaje konto, do którego należy. Przeczytane/nieprzeczytane i oznaczanie działają również tutaj; przenoszenie i usuwanie pozostają przy pojedynczej skrzynce, bo każde konto ma własny folder docelowy — otwórz wiadomość, a działasz w jej skrzynce. Konto bez zapisanego logowania zostaje wymienione z nazwy i nie opróżnia listy pozostałych.
- **Zaznaczanie wielu** — Ctrl+kliknięcie (macOS: ⌘+kliknięcie) wybiera pojedyncze wiadomości, Shift+kliknięcie zakres; w widoku konwersacji Ctrl+kliknięcie na konwersacji wybiera całą wymianę, a każda wiadomość zachowuje przy tym własny folder.

Załączniki są wyświetlane z nazwą i rozmiarem; oryginalny plik `.eml` (poniżej) zawiera je w całości.

Gdy otwierasz folder, który już kiedyś otwierałeś, lista pojawia się **natychmiast** z lokalnej pamięci, a odświeżanie działa w tle; dopóki trwa, wskazówka mówi „aktualizowanie” — potwierdzone jest tylko to, co przysłał serwer. To samo dotyczy wiadomości, którą już przeczytałeś. Na telefonie **najnowsza** wiadomość w folderze jest wczytywana z wyprzedzeniem w tle — otwiera się wtedy bez czekania, nawet jeśli nigdy jej nie otwierałeś.

Na komputerze trzy kolumny (foldery · lista · czytnik) można przeciągać za linie podziału; szerokości są pamiętane **dla każdego sejfu** i przetrwają ponowne uruchomienie. Każda kolumna zachowuje minimalną szerokość, więc czytnik nigdy nie zostanie wyparty.

Gdy odświeżenie się nie powiedzie — brak sieci albo dostawca ogranicza żądania — lista nadal pokazuje ostatnią kopię widzianą na tym urządzeniu, wraz z odpowiednią informacją, zamiast pustego panelu. Przeczytana już wiadomość pozostaje czytelna w ten sam sposób. To zawsze tylko pamięć podręczna: serwer ma pierwszeństwo, nic tutaj nie jest jedyną kopią czegokolwiek, a usunięcie vaulta usuwa też ją.

## Przenoszenie wiadomości do vaulta

Trzy przyciski przy każdej wiadomości:

- **Zapisz jako notatkę** — tworzy notatkę w folderze e-mail (`RRRR-MM-DD Temat.md`) z nadawcą i datą we frontmatter oraz tekstem wiadomości w postaci zwykłego tekstu pod nagłówkiem tematu. Przechwycenie tej samej wiadomości po raz drugi otwiera istniejącą notatkę zamiast ją duplikować.
- **+ .eml** — dodatkowo zapisuje surowy oryginał obok notatki i go linkuje. Plik `.eml` zawiera wszystko, łącznie z załącznikami, i otwiera się w dowolnym programie pocztowym. Jeśli notatka już istnieje, kopia źródłowa zostanie do niej dodana — chyba że jakaś jest już podlinkowana.
- **→ Zadanie** — tworzy wpis w Twojej [domyślnej bazie zadań](Tasks.md) z tematem jako tytułem, dzisiejszą datą jako terminem i wstępnie ustawionym statusem otwarte.

## Pisanie i wysyłanie

Gdy tylko konto może wysyłać — konto **Microsoft** albo konto **IMAP** ze skonfigurowanym **hostem SMTP** — możesz pisać i wysyłać wiadomości z Plainva:

- **Napisz** (w karcie e-mail) otwiera pływające okno z opisanymi wierszami **Od / Do / DW / UDW**. Wpisz adres i naciśnij Enter lub przecinek, aby zamienić go w chip; **DW/UDW** pojawiają się na żądanie. Treść to edytor Markdown z paskiem narzędzi formatowania i menu poleceń „/". Link `[tekst](https://…)` wyświetla się jako gotowy link już podczas pisania — znaki Markdown wracają, gdy tylko kursor do niego wejdzie, a kliknięcie otwiera cel w przeglądarce. Przy wysyłce treść i tak jest przekształcana do HTML: odbiorca zawsze otrzymuje prawdziwy link, niezależnie od tego, jak wyglądał w oknie.
- **Wstaw szablon…** umieszcza szablon notatki w treści wiadomości. Pytania szablonu (`{{prompt:…}}`) są zadawane **raz, w jednym oknie**, zamiast wędrować dalej jako symbole zastępcze; jego frontmatter zostaje na zewnątrz — treść maila go nie ma, a odbiorca dostałby YAML. Po anulowaniu nic nie zostaje wstawione.
- **Odpowiedz**, **Odpowiedz wszystkim** i **Przekaż dalej** przy dowolnej wiadomości otwierają to samo okno z zacytowanym oryginałem i wstępnie wypełnionymi odbiorcami; przekazanie zabiera ze sobą załączniki.
- **Wyślij** wychodzi przez SMTP (konta IMAP) lub Microsoft Graph (konta Microsoft).
- **Ta notatka e-mailem** (menu `⋮` notatki lub paleta poleceń) rozpoczyna wiadomość z bieżącą notatką w załączniku lub wstawioną jako tekst.

## Przekazanie notatki bez klienta pocztowego

Nie musisz wysyłać z poziomu Plainva. To działa dla dowolnej notatki i nie wymaga SMTP:

- **Odpowiedz jako notatka** (przy wiadomości): tworzy notatkę zaadresowaną do nadawcy (`to:` we frontmatter) z zacytowanym oryginałem — napisz swoją odpowiedź w Plainva.
- **Zapisz notatkę jako szkic w skrzynce** (paleta poleceń, przy dowolnej otwartej notatce): zapisuje notatkę jako **szkic we własnej skrzynce** przez IMAP — wybierz konto, odbiorcę i folder szkiców, a potem otwórz swój zwykły program pocztowy, sprawdź i wyślij stamtąd. Formatowanie jest zachowane.
- **Wyślij notatkę e-mailem (mailto)** (paleta poleceń): otwiera Twój domyślny program pocztowy z notatką jako zwykłym tekstem (długie notatki są skracane).
- **Kopiuj notatkę jako tekst e-maila** (paleta poleceń): umieszcza notatkę w schowku z formatowaniem — wklej ją w dowolnym edytorze wiadomości.

## Podpis i adresy nadawcy

W **Ustawieniach → E-mail → Wysyłanie** każda skrzynka ma dwa własne ustawienia:

- **Podpis** — w Markdownie, dodawany pod Twoim tekstem podczas pisania (i nad cytowanym lub przekazanym oryginałem, gdzie czytelnik się go spodziewa). Zmiana nadawcy w oknie tworzenia wiadomości podmienia podpis, zamiast doklejać drugi. Pole to ten sam edytor co okno tworzenia wiadomości, więc widzisz podpis dokładnie w takiej postaci, w jakiej zostanie wysłany.
- **Podpis dla adresu** — gdy masz dodatkowe adresy nadawcy, nad polem pojawia się wybór **Podpis dla**. „Domyślny (wszystkie adresy)” to podpis konta; wybierz adres, aby napisać podpis tylko dla niego. Adresy bez własnego podpisu nadal używają domyślnego, a zmiana nadawcy podczas pisania wstawia właściwy — także między dwoma adresami tego samego konta. Gdy opróżnisz pole adresu, wróci on do domyślnego.
- **Dodatkowe adresy nadawcy** — jeden w wierszu, np. `Imię <alias@example.org>`. Pole **Od** pokazuje wtedy adresy zamiast kont: najpierw własny adres skrzynki, potem aliasy. O tym, czy adres faktycznie zostanie przyjęty, decyduje Twój dostawca — serwer, który odmawia wysyłki z aliasu, mówi to wprost, a Plainva pokazuje ten błąd, zamiast po cichu wysyłać pod innym nazwiskiem.

## Działania w skrzynce

Gwiazdki/flagi synchronizują się przez IMAP i Microsoft; **Oflagowane** pokazuje wybór serwera. Wiadomości można przenosić pojedynczo lub grupowo. Poza koszem **Usuń** zawsze oznacza „przenieś do kosza”; tylko w koszu dostępne jest **Usuń trwale** po potwierdzeniu. W Gmailu przenoszenie zmienia etykiety, a działania w **Wszystkie** mogą wpłynąć na wiadomość we wszystkich etykietach; Plainva ostrzega przed operacją.

## Wypisywanie się i cofanie wysyłki

Gdy wiadomość niesie nagłówek `List-Unsubscribe`, Plainva pokazuje w czytniku przycisk **Wypisz się**. To, co dzieje się dalej, wskazał **sam nadawca**: Plainva niczego nie zgaduje z treści i niczego nie klika w twoim imieniu. Adres strony otwiera się po potwierdzeniu w przeglądarce, adres pocztowy trafia do okna pisania, żebyś widział, co wychodzi. Nieszyfrowane trasy `http://` są odrzucane, bo wypisanie się tą drogą przesyła twój adres otwartym tekstem.

**Cofnij wysyłkę** to **opóźnienie, a nie odwołanie**: po wysłaniu Plainva czeka kilka sekund, zanim przekaże wiadomość serwerowi, a w tym czasie komunikat trzyma w pogotowiu przycisk **Cofnij**. Potem wiadomość jest w drodze i nie da się jej zatrzymać — żaden program pocztowy nie odzyska doręczonej wiadomości. Jeśli w tej chwili opuścisz Plainvę (na telefonie: przełączysz się do innej aplikacji), wysyłka nastąpi **natychmiast**, a nie zostanie anulowana: wiadomość, którą kazałeś wysłać, nie może zniknąć dlatego, że aplikacja przeszła w tło.

## Odkładanie

Bywa poczta, która nie jest pilna, ale też nie jest załatwiona. **Odłóż** usuwa wiadomość z listy do wybranego momentu — później dzisiaj, jutro rano, w weekend albo w przyszłym tygodniu. Na komputerze pozycja jest w menu kontekstowym wiersza, na telefonie dodatkowo jako gest przesunięcia. Przycisk **Odłożone** przywraca je do widoku; stamtąd **Przywróć teraz** natychmiast wraca wiadomość na listę.

Dwie rzeczy warto powiedzieć wprost. Po pierwsze, odkładanie to **własny znacznik Plainvy**, nie funkcja serwera: ani IMAP, ani Microsoft czegoś takiego nie mają. Znacznik podróżuje z synchronizacją ustawień, więc wiadomość odłożona na telefonie odpoczywa też na komputerze — w innym programie pocztowym leży normalnie w skrzynce odbiorczej. Po drugie, odkładanie ukrywa tylko **listę tego folderu**, w którym to zrobiłeś: wyszukiwanie i „Wszystkie skrzynki" nadal pokazują wiadomość. Odłożone znaczy „nie na drodze", a nie „zniknęło".

## Zgłaszanie spamu

**Spam** przenosi wiadomość do folderu spamu konta i — tam, gdzie serwer to obsługuje — oznacza ją słowem kluczowym `$Junk`. W folderze spamu ten sam przycisk nazywa się **To nie spam** i przywraca wiadomość do skrzynki odbiorczej. Oba są dostępne w czytniku, w zaznaczeniu wielokrotnym, a na telefonie dodatkowo jako akcja przesunięcia wiersza.

Uczciwie: **samo przeniesienie niekoniecznie uczy filtr.** Niektóre serwery się na tym uczą, inne zapisują tylko słowo kluczowe, a jeszcze inne je odrzucają. Po akcji Plainva mówi, co naprawdę się stało — „oznaczono jako spam i przeniesiono” albo tylko „przeniesiono”. Jeśli Twoje konto w ogóle nie ma folderu spamu, Plainva proponuje utworzenie folderu **Junk**, zamiast wpychać pocztę do wymyślonej nazwy folderu.

## Wiadomość o nieobecności

Wiadomość o nieobecności należy do serwera, a nie do programu, który akurat jest otwarty. Dlatego Plainva oferuje ją **tylko tam, gdzie przetrwa wyłączenie komputera** — przy kontach Microsoft i przy skrzynkach z serwerem Sieve (mailbox.org, Fastmail, Nextcloud, Mailcow i inne). Jeśli skrzynka nie ma żadnego z nich, nie pojawia się przełącznik, tylko zdanie, które to wyjaśnia.

Znajdziesz ją w **Ustawieniach → Poczta**, a na telefonie w obszarze kont: temat, treść i zakres dat. Bez zakresu wiadomość działa, dopóki jej nie wyłączysz; z zakresem zaczyna się i kończy sama — nawet jeśli nigdy więcej nie otworzysz Plainvy.

**Twoje własne reguły filtrujące pozostają nietknięte.** W skrypcie Sieve Plainva zapisuje wyłącznie własną sekcję, oznaczoną `# --- BEGIN PLAINVA`, a całą resztę zostawia znak po znaku. Jeśli znajdzie tam sekcję, której nie potrafi bezpiecznie odczytać, **nie zmienia nic** i mówi Ci o tym.

## Reguły

Reguła sprawdza nadawcę, odbiorcę lub temat, a potem coś robi: przenosi, oznacza jako przeczytane, oznacza flagą, zgłasza jako spam albo wyrzuca do kosza. Znajdziesz je w **Ustawieniach → Poczta**.

**A teraz najważniejsze:** reguły działają na razie **tylko wtedy, gdy Plainva jest otwarta**, i tylko na wiadomościach, które Plainva pobrała. Na telefonie oznacza to dodatkowo: tylko wtedy, gdy aplikacja była na pierwszym planie. Reguła niczego więc nie filtruje, gdy komputer jest wyłączony — karta mówi to na miejscu, zamiast sugerować filtr serwerowy, którego tu jeszcze nie ma.

Jeśli reguła sprawdza **treść wiadomości**, zadziała dopiero po jej otwarciu: treści nie ma na liście. To również jest napisane na karcie.

**Zapisywanie u dostawcy.** Jeśli skrzynka ma serwer Sieve, przycisk **Zapisz u dostawcy** zamienia reguły w filtr serwerowy: działa on także wtedy, gdy Plainva jest zamknięta. Plainva zapisuje wyłącznie własną oznaczoną sekcję i pozostawia ręcznie napisane reguły bez zmian — ta sama obietnica co przy autoodpowiedzi, bo obie dzielą tę jedną sekcję.

Reguła, której serwer nie potrafi wyrazić — na przykład sprawdzenie treści wiadomości na serwerze bez odpowiedniego rozszerzenia — pozostaje **lokalna**, a Plainva ją wymienia. Celowo nie jest wysyłana: skrypt z wymaganiem nieznanym serwerowi zostaje odrzucony **w całości**, a wraz z nim zniknęłaby autoodpowiedź.

Reguły Gmaila nadal ustawia się we własnych ustawieniach Google.

**W Microsoft** nie potrzeba dodatkowego serwera: ten sam przycisk zapisuje reguły jako reguły Outlooka w skrzynce. Plainva zastępuje wyłącznie reguły, które sama utworzyła, i nie rusza Twoich — umieszcza je też *za* Twoimi, bo ręcznie napisana reguła była pierwsza. Microsoft porównuje tylko przez „zawiera”: „jest dokładnie”, „zaczyna się od”, „kończy się na”, reguła na odbiorców DW oraz oznaczanie pozostają więc lokalne i zostaną Ci wymienione.

**Na telefonie** tworzysz reguły w całości sam: w ustawieniach poczty dotknij reguły, a zobaczysz ją jako **Jeżeli** i **To** — każdy warunek i każda akcja to wiersz, a dotknięcie pyta o pole, porównanie i wartość na osobnych arkuszach. To celowo nie jest zmniejszony formularz: pięć elementów obok siebie na szerokości telefonu to sposób, w jaki reguła zostaje źle wpisana. Ostatniego warunku nie da się usunąć — reguła bez warunku pasowałaby do każdej wiadomości.

**Zapisz jako notatkę** to akcja, której nie ma żaden program pocztowy: reguła zapisuje wiadomość jako notatkę w Twoim sejfie, z nadawcą, datą i treścią — to samo przechwycenie co przycisk w czytniku, tylko automatycznie. Ta sama wiadomość dwa razy daje **tę samą** notatkę, a wiadomość zostaje w folderze: zapisywana jest kopia, nic nie jest przenoszone. Reguła z tą akcją **zawsze** pozostaje lokalna, nawet przy skrzynce, która potrafiłaby wykonywać reguły. To celowe: zapisanie reszty reguły u dostawcy pozwoliłoby serwerowi przenieść wiadomość, zanim byłoby co zapisywać.
