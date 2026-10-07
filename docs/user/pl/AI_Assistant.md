# Asystent AI (Beta)

Stan na: 2026-10-07

Plainva potrafi odpowiadać na pytania o notatki za pomocą wybranego modelu AI. Czyta vault, przywołuje notatki, z których korzystała, otwiera notatki oraz widoki i proponuje zmiany — jako propozycje w notatce, jako szkice czegoś nowego albo jako plan, który potwierdzasz. Sama nigdy nie zmienia notatki. Asystent jest **eksperymentalny** i wyłączony, dopóki nie zostanie włączony, osobno na każdym urządzeniu.

## Włączanie

Otwórz **Ustawienia → AI & automatyzacja** (część aplikacji) i włącz **Używaj AI na tym urządzeniu**. Bez tego przełącznika nie ma przycisku AI, karty AI ani asystenta. Nic nie zostanie nigdzie wysłane, dopóki o coś nie zapytasz.

## Wybór dostawcy

Plainva nie ma własnej usługi AI: korzysta się z wybranego dostawcy, z własnym kluczem. Każdego dostawcę można wybrać; Plainva podaje ich warunki i czas przechowywania, aby decyzja należała do użytkownika — sama nikogo nie wyklucza.

| Rodzaj | Dostawcy |
|---|---|
| Dostawcy w chmurze | Anthropic, OpenAI, Google Gemini |
| Pośrednicy i własne serwery | OpenRouter, dowolny **serwer kompatybilny z OpenAI** |
| Na tym komputerze (desktop) | Ollama, LM Studio |
| Na tym telefonie | Apple (iPhone), Gemini Nano (Android) |

1. W **AI & automatyzacja** wybierz **Dodaj dostawcę** i wskaż jednego z nich. Każdy wpis niesie krótką uwagę o swoich warunkach — na przykład, że w bezpłatnym dostępie Google dane wejściowe mogą czytać ludzie.
2. Wpisz klucz przyciskiem **Wpisz klucz**. Klucz trafia do bezpiecznego magazynu tego urządzenia; Plainva nigdy nie pokazuje go ponownie — ani AI, ani na ekranie.
3. **Przetestuj połączenie** wczytuje własną listę modeli dostawcy. Jeśli się nie powiedzie, komunikat mówi dlaczego (odrzucony klucz, brak połączenia, nieznany model).

Taki **serwer kompatybilny z OpenAI** dodaje się, podając jego adres. Plainva pyta jeszcze raz przed dodaniem, w oknie systemu operacyjnego, i wysyła tylko na potwierdzony adres. Zwykłe `http` działa tylko dla serwera na tym urządzeniu; wszystko inne wymaga `https`.

Jeśli nie masz jeszcze klucza: model na tym komputerze (Ollama, LM Studio) nic nie kosztuje, a konsola każdego dostawcy wydaje klucze.

**Model systemu na telefonie.** Na iPhonie z Apple Intelligence (od iPhone'a 15 Pro) **Dodaj dostawcę** proponuje najpierw **Apple**, na niektórych telefonach z Androidem **Gemini Nano**. Nie potrzebuje klucza, nic nie kosztuje i nic nie opuszcza urządzenia — dlatego żaden przegląd nie pyta przed wysłaniem. Jego okno jest małe, około 4000 tokenów na notatki, pytanie i odpowiedź razem: idzie mniej notatek, wcześniejsze tury są skracane i nie używa narzędzi. Wiersz mówi, czy jest gotowy, a jeśli nie, to dlaczego — Apple Intelligence wyłączone, urządzenie, które go nie uruchomi, model, który system jeszcze przygotowuje; na Androidzie **Załaduj model** prosi system o jego pobranie. Model Apple nie zna każdego języka (nie zna polskiego). Jeśli wskazuje go profil **Lokalny**, pisze też streszczenia na telefonie.

## Modele i profile

Cztery profile — **Szybki**, **Zrównoważony**, **Silny** i **Lokalny** — służą do przypisania modeli. Dla każdego wybierz dostawcę i model, z listy dostawcy albo wpisując identyfikator modelu dokładnie tak, jak nazywa go dostawca. **Domyślny dla nowych rozmów** decyduje, którym profilem zaczyna się nowa rozmowa. Plainva nie ogłasza żadnego modelu „najlepszym”.

Piąte miejsce, **Audio**, zawiera model, który transkrybuje notatki głosowe; nigdy nie jest domyślne dla rozmowy.

Szóste miejsce, **Embeddingi**, zawiera model, którym liczy wyszukiwanie po znaczeniu, gdy w **Wyszukiwanie semantyczne** wybierzesz **Własny dostawca** — zobacz [Wyszukiwanie](Search.md).

## Zadawanie pytań

- **Desktop:** przycisk AI na pasku akcji, **Ctrl+J** (⌘J w macOS) lub **Zapytaj AI** w palecie poleceń otwiera asystenta — małe okno nad bieżącą pracą. **Otwórz jako kartę** przenosi tę samą rozmowę do karty AI, gdzie wyświetlana jest lista rozmów.
- **Telefon:** **Zapytaj AI** w menu ⋮ notatki otwiera arkusz AI nad tą notatką. Obszar **AI** (w arkuszu obszarów albo na pasku nawigacji, jeśli zostanie tam umieszczony) pokazuje rozmowę na pełnym ekranie; **Rozmowy** pokazują wcześniejsze.
- **Obok notatki:** na komputerze ta sama rozmowa jest ostatnią sekcją prawego paska bocznego, **AI**. Na telefonie lub tablecie to karta **AI** w kontekście notatki — obok **Właściwości** i **Linki zwrotne** — który tablet pokazuje obok notatki.

Otwarta notatka jest dołączana automatycznie; można ją usunąć z kontekstu jej ✕, jeśli trzeba. **Przypnij notatkę…** dodaje kolejne notatki. Asystent potrafi też sam czegoś poszukać: przeszukuje vault, czyta notatki i ich sekcje, bazy danych, linki zwrotne i powiązane notatki, wyświetla listę zadań, spotkań oraz notatek niedawno otwartych lub zmienionych, a także otwiera notatki i widoki. Sam nie potrafi niczego zmienić, utworzyć ani usunąć; to, co może zamiast tego zaproponować, opisano niżej, w części „Proponowanie zmian”.

Asystent potrafi też coś Ci pokazać: otworzyć notatkę przy nagłówku, pokazać notatkę na grafie, ustawić kalendarz na wybrany dzień, otworzyć widoki, pokazać i ukryć paski boczne. Korzysta w tym celu z poleceń z palety poleceń — i to tylko z tych, które coś pokazują: tych, które tworzą, zmieniają, usuwają, eksportują albo otwierają okno, wywołać nie może.

Każda rozmowa zaczyna się od wiersza „Odpowiedzi pisze AI — ⟨model⟩ przez ⟨dostawca⟩”. Pod każdą odpowiedzią widnieje wiersz z informacją, co dokąd zostało wysłane: ile notatek, w przybliżeniu ile tokenów i — tam, gdzie dostawca publikuje ceny — przybliżony koszt. **Zatrzymaj** kończy odpowiedź w każdej chwili.

Link w odpowiedzi otwiera się dopiero po potwierdzeniu jego adresu, a obrazy w odpowiedziach nigdy nie są wczytywane.

## Co idzie z pytaniem

Do każdego pytania Plainva zbiera to, co może mieć znaczenie — na tym urządzeniu, zanim cokolwiek zostanie wysłane:

- **Gdzie jesteś:** data i godzina, otwarta notatka lub baza danych i zaznaczenie w niej, otwarte karty, zadania z terminem w najbliższym tygodniu, najbliższe spotkania i dzisiejsza notatka dzienna.
- **Notatki, które mogą mieć znaczenie:** znalezione po Twoich słowach, po linkach otwartej notatki i po tym, co niedawno otwierano lub zmieniano. Najpierw decydują Twoje zasady prywatności; oceniane są wyłącznie notatki, na które pozwalają. Kilka idzie jako sekcje — nie całe notatki —, inne tylko z tytułem i kartą — pierwszym zdaniem swojej sekcji i każdym zdaniem z liczbami, datami, zadaniami, zaprzeczeniami lub linkami, słowo w słowo — albo samą nazwą; asystent doczytuje je, gdy tego potrzebuje.

Notatka, którą rozmowa już zawiera i która od tamtej pory się nie zmieniła, jest wymieniana, a nie wysyłana ponownie. Miejsca z dziennika i wartości nastroju nigdy nie są wysyłane same z siebie.

## Zanim cokolwiek zostanie wysłane

Pierwsze zapytanie w sesji pokazuje przegląd: dokąd idzie (dostawca i model), które notatki i która część każdej z nich, co jeszcze idzie (zaznaczenie, spotkania, zadania), co zostało zatrzymane i w przybliżeniu ile tokenów. **Wyślij** wysyła; **Anuluj** nie wysyła niczego i oddaje Twoje słowa do pola wpisywania; − obok notatki ją pomija. W zakresie, który zatwierdzono, kolejne zapytania idą bez pytania. Przegląd wraca za każdym razem, gdy zakres rośnie: inny model lub dostawca, nowy rodzaj danych, notatki z innego folderu, nowe narzędzia albo znacznie większe zapytanie. Model na tym urządzeniu nigdy nie pyta.

Aby widzieć przegląd przed każdym zapytaniem, włącz **Pytaj przed każdym zapytaniem** — w samym przeglądzie albo w **Ustawienia → AI & automatyzacja**, w sekcji **Wysyłanie**.

Wiersz pod każdą odpowiedzią otwiera przegląd tego, co z nią poszło. Jeśli odpowiedź nie cytuje żadnej z wysłanych notatek, mówi o tym komunikat nad tym wierszem; wtedy sprawdź odpowiedź w notatkach. Jeśli wysłano notatki, wiersz podaje też pokrycie: **pokrycie wysokie**, gdy prawie każde stwierdzenie odpowiedzi wskazuje notatkę, **pokrycie częściowe** lub **pokrycie niskie**, gdy jest ich mniej.

## Pokaż kontekst

Oko pod polem wpisywania, **Pokaż kontekst**, pokazuje, co zabrałoby następne zapytanie — zanim wyjdzie, dla wybranego teraz modelu. Przy każdej notatce: dlaczego została wybrana (otwarta teraz, przypięta, pasuje do Twoich słów, bliskie znaczeniowo, połączona, wkrótce termin …), która część idzie i w przybliżeniu ile tokenów. Każdą notatkę można

- pominąć w następnym zapytaniu (**Przywróć** ją przywraca),
- przypiąć do rozmowy,
- zachować na tym urządzeniu na stałe: to wpisuje do notatki regułę `cloud: deny` (zob. niżej).

Notatki zatrzymywane przez Twoje reguły też są wymienione, żeby było wiadomo, czego brakuje; nigdy nie są oceniane ani wysyłane. **Wyślij z tym kontekstem** wysyła to, co wpisano. W szerokiej karcie AI widok zostaje otwarty jako kolumna obok rozmowy.

Nad notatkami **Wysłano** podaje, ile z tych notatek idzie — na przykład ~870 z 3460 tokenów — a **Zaoszczędzono**, o ile to mniej niż wysłanie w całości wszystkich proponowanych notatek; za pierwszym razem podaje też, ile tokenów by to było. **Pokaż jako ślad na grafie** otwiera graf z otwartą notatką i źródłami zaznaczonymi oraz linkami między nimi.

Gdy tekst, który poszedłby do chmury, wygląda na hasło lub klucz, numer konta lub karty, numer dokumentu lub podatkowy albo dane o zdrowiu, pod notatką pojawia się **Możliwie wrażliwe** i to, co rozpoznano — w **Pokaż kontekst** i w przeglądzie przed wysłaniem. **Zostaw na tym urządzeniu** zapisuje w notatce regułę `cloud: deny`. Numery i sekrety **Zakryj w tej rozmowie** zastępuje znacznikiem w rodzaju `⟦withheld account⟧` w każdej wiadomości tej rozmowy, także gdy model sam czyta notatkę, dopóki nie wybierzesz **Wyślij bez zakrywania**; przegląd liczy je w **Zatrzymano**. Zadania i spotkania mają ten sam wybór w wierszu **Zadania, spotkania i dane otwartej notatki**. Gdy w sesji po raz pierwszy coś takiego poszłoby bez zakrycia, przegląd pyta przed wysłaniem. Sprawdzenie odbywa się na tym urządzeniu; to wskazówka, nie filtr: może coś przeoczyć i nigdy nie zatrzymuje zapytania. Zaznaczony fragment idzie taki, jaki jest; przy modelu na tym urządzeniu wskazówka się nie pojawia.

## Streszczenia

Dzięki **Streszczenia z modelem lokalnym** (w **Ustawienia → AI & automatyzacja**, wyłączone, dopóki ich nie włączysz) model na Twoim komputerze pisze krótkie streszczenia dłuższych sekcji notatek, całych notatek, folderów najwyższego poziomu i vaulta. Działa tylko wtedy, gdy profil **Lokalny** wskazuje serwer na tym komputerze (Ollama, LM Studio; na telefonie model systemu) — nigdy chmura w tle — i tylko gdy Plainva nie ma nic innego do roboty; na telefonie tylko wtedy, gdy jest otwarta. Każde streszczenie jest sprawdzane: streszczenie sekcji musi zachować słowo w słowo każdą liczbę, datę, kwotę, link, tag i każde zaprzeczenie, inaczej idą zdania samej sekcji. Streszczenie jest związane z dokładnie tym tekstem, za który stoi; po zmianie sekcji nie jest używane, dopóki nie powstanie od nowa. Streszczenia folderów i vaulta powstają tylko z notatek, które Twoje zasady wypuszczają do chmury. W **Pokaż kontekst** źródło wysłane jako streszczenie to zaznacza, a **Oryginał** wysyła z następną wiadomością jego własne zdania.

## Z zaznaczeniem

Zaznacz tekst w notatce, a AI zajmie się tylko tym fragmentem.

- **Desktop:** podczas edycji **AI** na pasku zaznaczenia oferuje **Jako propozycja** — **Przepisz**, **Skróć**, **Przetłumacz…**, **Zrób z tego zadania** — oraz **W asystencie** — **Wyjaśnij** i **Pytanie o zaznaczenie…** (**Ctrl+J**, ⌘J w macOS).
- **Telefon:** **AI** na pasku nad zaznaczeniem — podczas czytania i podczas edycji — otwiera arkusz AI.
- **W każdej rozmowie:** dopóki w otwartej notatce zaznaczony jest tekst, wiersz **Z zaznaczeniem** nad polem wpisywania oferuje te same akcje.

Akcja propozycji wysyła wyłącznie zaznaczony fragment — nie resztę notatki, nie przypięte notatki, bez narzędzi — i pyta z tym samym przeglądem co pytanie. Odpowiedź wraca do notatki jako runda propozycji, tak jak runda od człowieka: w sekcji **Propozycje** akceptujesz lub odrzucasz każdą zmianę albo całą rundę, a wcześniej w notatce nic się nie zmienia. Wiersz autora rundy brzmi **Plainva AI · ⟨model⟩**, dzięki czemu widać, który fragment napisała AI. **Zrób z tego zadania** dodaje zadania pod fragmentem, zamiast go zastępować. Każda akcja zachowuje swoją rozmowę w historii.

Fragment notatki, którą Twoje reguły trzymają z dala od chmury — albo fragment z linkami do takich notatek lub z danymi o miejscach — nie trafia do żadnego modelu w chmurze. W zaszyfrowanym obszarze roboczym akcje propozycji nie są jeszcze dostępne: propozycje w nim nie mogą jeszcze wskazać AI jako autora.

## W wątku komentarzy

Zwróć się do asystenta w komentarzu, a odpowie w wątku. Wpisz **@** w polu komentarza i wybierz **AI** — pozycję ze znakiem AI — albo wpisz nazwę samodzielnie: **@AI**, **@KI** i **@IA** docierają do niego niezależnie od języka aplikacji. Gdy Twój komentarz zostanie wysłany, wątek pokazuje pod **AI** wiersz **pisze odpowiedź…**; **Zatrzymaj** to przerywa. Odpowiedź pojawia się jako odpowiedź w tym samym wątku, z wierszem autora **Plainva AI · ⟨model⟩**. Inaczej niż propozycja nie czeka na zaakceptowanie — jest uwagą obok notatki, nigdy tekstem w niej — a na urządzeniu, które zadało pytanie, usuwasz ją jak własną.

Wątek trafia do modelu tak jak pytanie: jego komentarze, fragment, do którego jest przypięty, i sama notatka, przez ten sam przegląd. Wątek komentarzy to osobny rodzaj danych, więc przegląd pyta za pierwszym razem. Tam, gdzie Twoje reguły trzymają notatkę z dala od chmury, nie trafiają tam również jej komentarze, a zawarte w nich linki do takich notatek są wstrzymywane. Asystenta wywołuje tylko komentarz wysłany na tym urządzeniu; komentarz, który przychodzi przez synchronizację, nigdy tego nie robi, cokolwiek zawiera. Adresy internetowe, które AI wnosi od siebie — w odpowiedzi, propozycji lub transkrypcji — są zapisywane tak, aby nic ich nie otwierało ani nie wczytywało (`https[://]…`); adresy, które zawierał już Twój własny tekst, zostają bez zmian. W zaszyfrowanej przestrzeni nie można jeszcze zwrócić się do asystenta: jej komentarze nie mogą jeszcze wskazać AI jako autora.

## Umiejętności

Umiejętności to instrukcje do powtarzalnej pracy. Dwanaście jest dołączonych do Plainva — w tym **Orientacja na dziś**, **Przegląd tygodnia** i **Stan projektu** jako chipy w pustej rozmowie — a własne można pisać lub importować. Umiejętność uruchamia się jednym kliknięciem albo po prostu pytaniem: AI sama wczytuje pasującą. Własne umiejętności działają dopiero po zatwierdzeniu na tym urządzeniu. Wszystko o nich: [Umiejętności](AI_Skills.md).

## Transkrypcja notatki głosowej

Przy każdej notatce głosowej — w edytorze, w trybie czytania, w dzienniku i na kartach — **Transkrybuj** zamienia nagranie w tekst. Trafia ono bez zmian do modelu profilu **Audio**, przez ten sam przegląd co pytanie; nagranie to osobny rodzaj danych, więc przegląd pyta za pierwszym razem. Transkrypcja wraca jako propozycja pod nagraniem, z autorem **Plainva AI · ⟨model⟩** — zaakceptuj ją lub odrzuć w sekcji **Propozycje**.

**Audio** wymaga dostawcy z obsługą audio: OpenAI (na przykład `gpt-4o-transcribe` lub `whisper-1`), Gemini albo własnego zgodnego serwera — serwer na tym komputerze zatrzymuje nagranie na urządzeniu. Można transkrybować nagrania do 11 MB. Nagranie w notatce, którą Twoje reguły trzymają z dala od chmury, nie trafia do żadnego modelu w chmurze, a zaszyfrowane obszary robocze jeszcze tego nie oferują.

## Wyjaśnianie obrazu

Przy każdym obrazie w vaulcie **Wyjaśnij obraz** pyta AI, co ten obraz przedstawia.

- **Desktop:** na pasku narzędzi otwartego obrazu oraz w menu, które otwiera kliknięcie prawym przyciskiem myszy na obrazie w notatce — podczas edycji i w trybie czytania.
- **Telefon:** pod otwartym obrazem (przy obrazie w notatce prowadzi tam **Otwórz obraz**).

Obraz trafia wraz z pytaniem do modelu, którym zaczynają się nowe rozmowy — w osobnej rozmowie, w której można pytać dalej: co mówi tabela, co stoi w drugiej kolumnie, co oznacza diagram. Przegląd pokazuje obraz przed wysłaniem; obraz to osobny rodzaj danych, więc przegląd pyta za pierwszym razem.

**To, co idzie, to nie ten plik.** Plainva rysuje obraz, pomniejsza go do najwyżej 1 568 pikseli na dłuższym boku i zapisuje od nowa na potrzeby wysłania. Dlatego idzie bez tego, co plik o nim zapisuje: miejsca wykonania zdjęcia, daty, aparatu. Przegląd pokazuje dokładnie ten obraz, który idzie, wraz z jego rozmiarem. Ta kopia zostaje przy rozmowie na tym urządzeniu, więc później nadal widać, co dostał dostawca; po usunięciu rozmowy kopia znika.

**Reguły.** Obraz w folderze, który Twoje reguły trzymają z dala od chmury, nie trafia do żadnego modelu w chmurze. Nie trafia tam też obraz pokazywany w notatce z regułą `cloud: deny` — niezależnie od tego, gdzie naciśniesz **Wyjaśnij obraz**, także przy otwartym obrazie: przed wysłaniem Plainva sprawdza, które notatki osadzają ten obraz, a jeśli nie może tego ustalić, obraz zostaje na tym urządzeniu. Model na tym urządzeniu pozostaje dozwolony. To, co jest napisane na obrazie, jest treścią — jak tekst notatki — a nie instrukcją: rozmowa, którą rozpoczyna **Wyjaśnij obraz**, może coś sprawdzić w Twoim vaulcie, ale nie może korzystać z internetu i niczego nie wywołuje w aplikacji.

**Które modele czytają obrazy.** Większość modeli w chmurze to potrafi. Model systemu na telefonie nie, a **Wyjaśnij obraz** o tym informuje. Gdy lista dostawcy mówi, że model nie czyta obrazów, przegląd daje o tym znać przed wysłaniem. Jeśli dostawca odrzuci zapytanie, wybierz inny model pod rozmową i zapytaj jeszcze raz — obraz nadal w niej jest.

## W internecie

Asystent nie może korzystać z internetu, dopóki tego nie dopuścisz — i to trzykrotnie:

1. **Dla vaultu.** W **Ustawienia → AI & automatyzacja** (część vaultu) włącz **AI może korzystać z internetu w tym vaulcie**. Dla każdego vaultu przełącznik jest wyłączony, dopóki nie zdecydujesz, i obowiązuje tylko na tym urządzeniu.
2. **Dla rozmowy.** Przed pierwszą wiadomością nowej rozmowy naciśnij ikonę globusa pod polem wpisywania — **Pozwól tej rozmowie korzystać z internetu**. To, czy rozmowa może korzystać z internetu, rozstrzyga się na jej początku; aby to zmienić, zacznij nową rozmowę. Rozmowa, która może z niego korzystać, mówi o tym w pierwszym wierszu. Uruchomienie umiejętności **Badanie tematu** to ten sam wybór: jej rozmowa może korzystać z internetu — zob. [Umiejętności](AI_Skills.md).
3. **Dla każdego zapytania.** Dopóki Twoje notatki są w rozmowie, każda strona, którą asystent chce odczytać, i każde wyszukiwanie, które chce wykonać, pytają najpierw — z pełnym adresem lub szukanymi słowami; to wszystko, co w tym celu opuszcza Twoje urządzenie. **Odczytaj stronę** lub **Szukaj** przepuszcza to jedno zapytanie; **Nie odczytuj** lub **Nie szukaj** je pomija, a asystent działa dalej bez niego.

**Czym jest zapytanie.** Odczytanie strony to jedno zapytanie z tego urządzenia do witryny, jak otwarcie strony w przeglądarce — bez ciasteczek, bez logowania i bez niczego z Twoich notatek; jak przy każdej wizycie, witryna widzi Twój adres IP. Odczytywane są tylko publiczne strony przez `https`; adresy w Twojej sieci domowej lub firmowej są odrzucane. Wyszukiwanie idzie do dostawcy Twojego modelu — Anthropic, OpenAI, Google Gemini albo OpenRouter —, który wyszukuje dokładnie tymi słowami, które Ci pokazano; dostawcy mogą naliczać opłaty za wyszukiwania osobno. Model na tym urządzeniu potrafi odczytywać strony, ale nie potrafi wyszukiwać, a model systemu na telefonie w ogóle nie może korzystać z internetu.

**Skąd pochodzi adres.** Pytanie mówi, czy adres pochodzi od Ciebie, czy podała go notatka lub wynik — albo czy model sam go zbudował. Adres zbudowany przez model może zawierać coś z Twoich notatek: przeczytaj go, zanim go przepuścisz.

**Witryny bez potwierdzenia.** Przy **Zawsze dla ⟨witryna⟩** w pytaniu albo w **Witryny bez potwierdzenia** w ustawieniach vaultu strony danej witryny są odczytywane bez pytania — dopóki adres pochodzi od Ciebie, z notatki lub z wyniku. Adres zbudowany przez model pyta zawsze.

**Co czyta asystent.** Nigdy samej strony. Drugie zapytanie do tego samego modelu, bez żadnych narzędzi, czyta stronę i pisze krótki raport: streszczenie, stwierdzenia z fragmentem, na którym się opierają, oraz linki, które naprawdę są na stronie. Strona, która próbuje dawać asystentowi instrukcje, dociera więc do niego jako raport o stronie — nigdy jako strona, z którą pracuje. Pod odpowiedzią **Odczytano w sieci** wymienia odczytane strony, a wiersz pod nią otwiera wszystko, o co zapytano.

**Notatki, które zostają poza rozmową.** Notatka lub folder z ustawieniem **Dostęp do sieci: nigdy** (zob. Zasady prywatności niżej) nie istnieje dla rozmowy, która może korzystać z internetu: nie ma jej ani w kontekście, ani w narzędziach, a linki do niej są wstrzymywane.

Link w odpowiedzi, którego adres model zbudował sam, jest oznaczony, a pytanie przed otwarciem mówi o tym. Jeśli odpowiedź w ogóle nie nadejdzie — brak połączenia, dostawca nie odpowiada —, rozmowa wymienia zamiast niej notatki, które najlepiej pasują do Twojego pytania.

## E-mail i spotkania

**Spotkania.** Asystent wymienia spotkania z Twoich połączonych kalendarzy — dzień, godzinę i tytuł, na życzenie także miejsce i uczestników — oraz odczytuje pojedyncze spotkanie ze szczegółami: organizatora, uczestników wraz z ich odpowiedziami i Twoją własną. Nigdy nie dostaje linku do spotkania online; ten zostaje w kalendarzu.

**E-mail.** Jeśli w tym vaulcie połączone są konta e-mail, asystent może wyszukiwać i czytać wiadomości. E-mail nie należy do narzędzi, z którymi zaczyna się rozmowa: asystent szuka go dopiero wtedy, gdy Twoje pytanie tego wymaga, a przy pierwszym dostępie Plainva pyta — **Czytać Twoje e-maile?** **Zezwól** obowiązuje dla tego dostawcy do zamknięcia Plainvy; inny model albo inny dostawca pyta ponownie. **Nie zezwalaj** pomija dostęp, a asystent działa dalej bez niego. Model na tym urządzeniu nie pyta, ponieważ w jego przypadku nic nie opuszcza urządzenia.

**Co z tego czyta asystent.** Z wyszukiwania widzi datę, nadawcę i temat wiadomości — nigdy ich tekst. Tekstu wiadomości ani opisu spotkania nigdy nie czyta sam: napisały je inne osoby, a kto pisze e-mail albo zaproszenie, może to napisać właśnie dla tego czytelnika. Drugi czytelnik, bez żadnych narzędzi, czyta je i pisze krótki raport — streszczenie, stwierdzenia z fragmentem, na którym się opierają, oraz linki, które naprawdę w nich są. Jeśli model na tym urządzeniu jest ustawiony jako **Lokalny** w **Modele i profile**, to on jest tym czytelnikiem, a sam tekst nie opuszcza urządzenia; do dostawcy trafia tylko raport. W przeciwnym razie czyta dostawca rozmowy, w osobnym zapytaniu, bez narzędzi. Pytanie mówi Ci z góry, kto czyta.

**Co się nie zmienia.** Asystent tylko czyta: wiadomość, którą przeczytał, pozostaje nieprzeczytana, nic nie jest przenoszone, odpisywane ani usuwane, a załączników nie otwiera — podaje tylko ich nazwy. Pod odpowiedzią widzisz, ile wiadomości przeczytano, a wiersz pod nią mówi, kto przeczytał tekst.

## Narzędzia zewnętrzne (MCP)

Asystent może korzystać z narzędzi serwerów podłączanych samodzielnie, przez Model Context Protocol (MCP) — systemu zgłoszeń, wiki, bazy danych zespołu. To kierunek odwrotny do opisanego w [Łączenie aplikacji AI](Connect_AI_Apps.md): tam inne aplikacje czytają vault przez Plainva; tutaj asystent Plainva pyta inne serwery. Nic z serwera nie jest używane, zanim nie zostanie sprawdzone, co on oferuje, a każde wywołanie jest pokazywane, zanim zostanie wysłane.

**Dodawanie serwera.** W **Ustawienia → AI & automatyzacja** (część vaultu), w sekcji **Narzędzia zewnętrzne (MCP)**, wybierz **Dodaj serwer…**. Nadaj mu własną nazwę i podaj adres (`https://…`), a jeśli serwer tego wymaga, także token dostępu — trafia on do bezpiecznego magazynu tego urządzenia i nigdy nie jest pokazywany ponownie. Na komputerze serwerem może być też **Program na tym komputerze**: plik do uruchomienia, jego argumenty i wartości dla jego środowiska. Plainva uruchamia go bezpośrednio, bez powłoki, a w piaskownicy tam, gdzie komputer ma taką, z której Plainva może skorzystać. System pokazuje adres albo całe polecenie jeszcze raz, zanim zostanie zapamiętane. Na telefonie serwer jest zawsze adresem.

**Logowanie.** Niektóre serwery zamiast tokenu wymagają zalogowania. Sprawdzenie serwera pokazuje wtedy **Serwer wymaga zalogowania.** Wybierz **Zaloguj się…**: Plainva pyta serwer, gdzie znajduje się jego logowanie, otwiera tę stronę w przeglądarce i czeka na Twój powrót. To, co otrzymuje, pozostaje w bezpiecznym magazynie tego urządzenia i trafia tylko do tego serwera; ani Ty, ani AI nigdy tego nie widzicie. Jest odnawiane bez Twojego udziału, dopóki serwer na to pozwala, a gdy wygaśnie, sprawdzenie poprosi o ponowne zalogowanie. Jeśli usługa logowania nie pozwala aplikacjom rejestrować się samodzielnie, Plainva pyta o **Identyfikator klienta**, który podał Ci operator serwera. **Wyloguj się** usuwa logowanie; logowanie i zapisany token dostępu zastępują się nawzajem.

**Sprawdzanie serwera.** Dopiero co dodany serwer niczego jeszcze nie oferuje. Jego sprawdzenie pokazuje, co jest zarejestrowane i co serwer wymienia: jego własny opis, narzędzia z ich opisami — własnymi słowami serwera — oraz prompty. **Zatwierdź** dopuszcza dokładnie te teksty, na tym urządzeniu. Zanim serwer zostanie użyty, Plainva ponownie wczytuje to, co on wymienia, i porównuje z tym, co zostało zatwierdzone; jeśli coś się różni, serwer jest zablokowany do ponownego sprawdzenia, a sprawdzenie mówi, co się zmieniło.

**Na co pozwala vault.** Każdy vault decyduje sam: czy korzysta z serwera (**Używaj ⟨serwer⟩ w tym vaulcie**), które z jego narzędzi asystent może wywoływać — żadne nie jest zaznaczone, a zaznaczyć można tylko te, które deklarują, że tylko czytają —, oraz w polu **Notatki, które mogą towarzyszyć wywołaniu**, czy **Żadne**, **Wybrane foldery**, czy **Cały vault**.

**W rozmowie.** Narzędzia serwerów nie należą do narzędzi, z którymi zaczyna się rozmowa: asystent szuka ich dopiero wtedy, gdy pytanie tego wymaga, a przegląd przed wysłaniem wymienia serwery, do których należą. Każde pojedyncze wywołanie najpierw pyta — **Wywołać ⟨serwer⟩?** — pokazując narzędzie i dokładnie to, co zostałoby wysłane. **Wywołaj** przepuszcza to jedno wywołanie, **Nie wywołuj** je pomija, a opcji „zawsze” nie ma. Wywołanie w ogóle nie wychodzi, jeśli rozmowa przeczytała notatkę leżącą poza tym, na co vault pozwala temu serwerowi, albo notatkę trzymaną z dala od chmury. To, co wraca, jest traktowane jak tekst kogoś obcego: asystent go czyta i nie przyjmuje z niego żadnych poleceń.

**Prompty.** Serwer może oferować prompty — gotowe zapytania. Znajdują się pod pustą rozmową i uruchamia je wyłącznie użytkownik. Za pierwszym razem Plainva pokazuje, w co prompt się rozwija, zanim zostanie wysłany jako Twoja wiadomość; od tej pory dokładnie ten tekst idzie bez pytania, a inny tekst blokuje serwer.

**Co przechowuje Plainva.** Adres albo polecenie jest zapamiętywane na tym urządzeniu, zapisane wartości — w jego bezpiecznym magazynie; zatwierdzenie leży we własnych danych Plainva, nigdy w vaulcie — kto może pisać w vaulcie, nie może więc zatwierdzić serwera. W sekcji **Ostatnie wywołania w tym vaulcie** sprawdzenie wymienia, kiedy wywołano narzędzie, które i jak się to skończyło — nigdy to, co zostało powiedziane. **Usuń serwer** usuwa serwer z tego urządzenia, dla każdego vaultu.

Rozmowa rozpoczęta przez umiejętność, działanie na zaznaczeniu i odpowiedź w wątku komentarzy nie sięgają po narzędzia zewnętrzne, podobnie jak model systemowy na telefonie.

## Agenci zewnętrzni

Na komputerze Plainva może też uruchomić agenta AI innego producenta w folderze vaultu — program zainstalowany samodzielnie, do którego logujesz się samodzielnie. Taki agent nie jest asystentem: czyta i wysyła sam, a Twoje zasady prywatności i przegląd przed wysłaniem go nie obejmują. Co Plainva kontroluje w jego sesji, a czego nie: [Agenci zewnętrzni](External_Agents.md).

## Proponowanie zmian

Asystent może zaproponować więcej niż odpowiedź — i nic z tego, co proponuje, nie trafia do Twojego vaultu, dopóki tego nie powiesz. Są trzy formy, a każda czeka tam, gdzie o niej decydujesz.

- **Propozycja w notatce.** Gdy poprosisz o zmianę w istniejącej notatce, asystent zostawia ją w notatce jako propozycje: na marginesie, podpisane „Plainva AI · ⟨model⟩”, każda zmiana do zaakceptowania lub odrzucenia osobno — tak jak propozycje człowieka, zobacz [Komentarze i propozycje](Comments_and_Suggestions.md). Pod odpowiedzią wiersz podaje nazwę notatki; naciśnięcie go otwiera notatkę. W ten sposób asystent proponuje zmiany w tekście notatki, nie w jej właściwościach.
- **Szkic.** Nowa notatka, zadanie albo wpis dziennika pozostaje szkicem: karta pod odpowiedzią mówi, czym by się stał i dokąd by trafił. **Utwórz** go tworzy — notatkę w folderze podanym na karcie (**Folder skrzynki**, jeśli asystent nie wskazał innego), zadanie odczytane z jego słów tak, jakby zostały wpisane w pole szybkiego dodawania, wpis w dzienniku dnia podanego na karcie. **Pokaż** rozwija najpierw tekst notatki; **Odrzuć** wyrzuca szkic. Notatka utworzona ze szkicu mówi, kto ją napisał (`generated`, zobacz [OKF](OKF.md)), i wymienia notatki, na których opierała się rozmowa. Tam, gdzie nowe zadania trafiają także na listę zadań Twojego dostawcy, karta zadania ma przełącznik pola szybkiego dodawania, **Twórz też w „…”**: jest włączony, a zadanie zostanie utworzone także tam, chyba że go wyłączysz.
- **Plan.** Zmiany nazwy, przeniesienia ani usunięcia notatki nie da się sprawdzić kawałek po kawałku, więc asystent pyta: pytanie nad polem wprowadzania pokazuje, co by się stało — nową nazwę oraz ile linków w ilu notatkach za nią podąży, albo folder docelowy, z ostrzeżeniem, jeśli notatka straciłaby przy tym zasadę prywatności swojego folderu. Po Twoim „tak” Plainva robi to tak, jak wtedy, gdy robisz to samodzielnie; asystent dowiaduje się tylko, czy to nastąpiło. Przy usuwaniu pytanie jedynie otwiera okno usuwania Plainva: nic nie znika, zanim tam nie potwierdzisz.

Wszystko, co czeka, znajduje się na jednej liście: **Oczekujące**, segment karty AI na desktopie i ekranu **Rozmowy** na telefonie. Lista wymienia notatki, w których leżą propozycje AI, oraz szkice tego urządzenia, każdy z informacją, kto go zostawił. Szkice są przechowywane na urządzeniu, na którym powstały, tak jak rozmowy; propozycje należą do komentarzy notatki i razem z nimi docierają na Twoje pozostałe urządzenia.

Trzy ograniczenia obowiązują niezależnie od tego, o co poprosisz asystenta. Adres internetowy, który asystent wnosi do propozycji lub szkicu, jest zapisywany tak, aby nic go nie otwierało ani nie wczytywało (`https[://]…`); adres wpisany przez Ciebie pozostaje bez zmian. Rozmowa, która przeczytała notatkę trzymaną z dala od chmury lub od internetu, zostawia propozycję, zadanie albo wpis dziennika tylko tam, gdzie obowiązuje ta sama zasada — szkic notatki zabiera zasadę ze sobą. A w zaszyfrowanym obszarze roboczym niczego się nie proponuje, nie szkicuje ani nie planuje.

Umiejętność ma te możliwości tylko wtedy, gdy je wymienia, a jej sprawdzenie to pokazuje — zobacz [Umiejętności](AI_Skills.md).

## Zachowywanie odpowiedzi jako notatki

Pod każdą gotową odpowiedzią **Zachowaj jako notatkę** zamienia odpowiedź w notatkę w Twoim vaulcie. Ty naciskasz, a notatkę zapisuje Plainva — sam asystent nadal niczego nie zmienia.

- **Dokąd trafia.** Do folderu ustawionego w vaulcie jako **Folder skrzynki** (**Ustawienia → Treść i struktura**), pod nazwą wziętą z Twojego pytania — w rozmowie rozpoczętej przez umiejętność, z umiejętności i notatki, która była otwarta, albo z dnia. Notatka, która już tam jest, nigdy nie jest ruszana: nowa dostaje następną wolną nazwę. Plainva od razu ją otwiera.
- **Kto ją napisał.** Mówi o tym pierwszy wiersz, słowami — odpowiedź Plainva AI, z modelem, godziną i Twoim pytaniem. Właściwości notatki mówią to samo innym narzędziom: `generated`, z modelem i godziną. Nic nie oznacza notatki jako sprawdzonej; to zostaje Twoją sprawą — zob. [OKF](OKF.md).
- **Na czym się opiera.** Pod odpowiedzią lista **Źródła** wymienia to, z czego uruchomienie naprawdę skorzystało. Tę listę pisze Plainva z własnego rejestru, nie model: odczytane strony i kiedy, wyszukiwania i przez którego dostawcę oraz Twoje notatki, które poszły razem z pytaniem albo zostały odczytane. Właściwości niosą tę samą listę jako `sources`.
- **Adresy.** Każdy adres internetowy, który model wpisał do swojej odpowiedzi, jest zapisany tak, aby nic go nie otwierało ani nie wczytywało (`https[://]…`), a obraz z internetu nigdy nie jest w notatce obrazem. Prawdziwymi linkami są tylko strony w sekcji **Źródła**: adresy, które uruchomienie odczytało za Twoją zgodą. Linki do Twoich własnych notatek pozostają linkami.
- **Zasady.** Zachowana odpowiedź dziedziczy zasady prywatności tego, na czym się opiera. Jeśli notatka, która była w rozmowie, albo taka, którą asystent odczytał, jest trzymana z dala od chmury lub od internetu, nowa notatka niesie tę samą regułę — zapisaną w samej notatce tam, gdzie jej folder pozwalałby na więcej. Dzięki temu odpowiedź, którą model na tym urządzeniu przygotował na podstawie prywatnej notatki, nie trafia do chmury także jako notatka.

We wspólnym obszarze roboczym jego członkowie mogą przeczytać notatkę — podobnie jak czytelnicy publikacji obejmującej ten folder. Plainva pyta tam za każdym razem, podając nazwę notatki i folder: **Zachowaj jako notatkę** ją zapisuje, **Nie zachowuj** niczego nie zapisuje.

## Zasady prywatności

Niektóre notatki nigdy nie powinny trafić do dostawcy w chmurze. Reguła może znajdować się we frontmatterze notatki:

```yaml
plainva:
  ai:
    cloud: deny
```

albo, dla całego folderu, w **Ustawienia → AI & automatyzacja** (część vaultu), skąd reguły trafiają do `.agent/policy.yml`. Notatka trzymana z dala od chmury nie wnosi niczego — ani tekstu, ani tytułu — a linki do niej w innych notatkach są wstrzymywane. Modele na tym urządzeniu pozostają dozwolone. Zaszyfrowane obszary robocze trzymają chmurę z dala, chyba że zostanie tam dopuszczona. Dokładny format znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

Obraz należy do notatek, które go pokazują: obraz osadzony w notatce trzymanej z dala od chmury również nie trafia do żadnego modelu w chmurze (zob. Wyjaśnianie obrazu wyżej).

Druga reguła, `web: deny` — w ustawieniach **Dostęp do sieci: nigdy** —, trzyma notatkę lub folder poza każdą rozmową, która może korzystać z internetu.

Na iPhonie i iPadzie te same dwie reguły decydują, które tytuły notatek mogą znaleźć Siri i Skróty, gdy to włączysz: notatka trzymana z dala od chmury lub od dostępu do sieci nigdy nie jest im podawana. Zob. „Siri i Skróty” w [Aplikacja mobilna](Mobile_App.md).

## Historia i zużycie

Rozmowy zostają na tym urządzeniu, dla każdego vaultu — nigdy w vaulcie i nigdy niesynchronizowane. **Przechowuj rozmowy** decyduje, jak długo; pojedyncze rozmowy można usuwać na liście, a wszystkie rozmowy danego vaultu naraz. **Zużycie w tym miesiącu** sumuje tokeny według dostawcy i modelu.

## Ograniczenia wersji beta

- Na komputerze AI działa tylko w głównym oknie.
- Na telefonie odpowiedź pojawia się tylko, gdy aplikacja jest otwarta.
- Asystent sam nie zmienia żadnej notatki: zmiana w notatce i transkrypcja notatki głosowej to propozycje do zaakceptowania lub odrzucenia, coś nowego jest szkicem, dopóki nie naciśniesz **Utwórz**, a zmiana nazwy, przeniesienie i usunięcie czekają na Twoje „tak”; w wątku komentarzy pisze odpowiedź obok notatki, nigdy tekst w niej. Odpowiedź staje się notatką tylko wtedy, gdy naciśniesz **Zachowaj jako notatkę**; wtedy zapisuje ją Plainva, nie asystent.

Opinie o wersji beta trafiają do dyskusji projektu na GitHubie: **Opinie o AI (beta)** w ustawieniach rozpoczyna nową.
