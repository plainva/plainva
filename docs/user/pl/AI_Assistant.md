# Asystent AI (Beta)

Stan na: 2026-10-01

Plainva potrafi odpowiadać na pytania o notatki za pomocą wybranego modelu AI. Czyta vault, przywołuje notatki, z których korzystała, otwiera notatki oraz widoki i proponuje zmiany w zaznaczonym fragmencie jako propozycje — sama nigdy nie zmienia notatki. Asystent jest **eksperymentalny** i wyłączony, dopóki nie zostanie włączony, osobno na każdym urządzeniu.

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

Otwarta notatka jest dołączana automatycznie; można ją usunąć z kontekstu jej ✕, jeśli trzeba. **Przypnij notatkę…** dodaje kolejne notatki. Asystent potrafi też sam czegoś poszukać: przeszukuje vault, czyta notatki i ich sekcje, bazy danych, linki zwrotne i powiązane notatki, wyświetla listę zadań, spotkań oraz notatek niedawno otwartych lub zmienionych, a także otwiera notatki i widoki. Nie potrafi niczego zmienić, utworzyć ani usunąć.

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

## Umiejętności

Trzy umiejętności uruchamiają częste pytania jednym kliknięciem: **Orientacja na dziś** (co jest dziś ważne: zadania z terminem, spotkania i ostatnio zmieniane notatki), **Przegląd tygodnia** (ostatnie siedem dni i nadchodzący tydzień) oraz **Stan projektu** (cel, postęp, otwarte punkty i następny krok projektu z otwartej notatki). Znajdują się jako chipy w pustej rozmowie, w sekcji **Umiejętności** na karcie AI — na telefonie w **Rozmowy** — oraz w palecie poleceń. Umiejętność wysyła swoje pytanie jako wiadomość użytkownika: w jego języku, widoczną w rozmowie jak wszystko, co zostało wpisane, i przez ten sam przegląd. Następnie asystent wyszukuje informacje swoimi zwykłymi narzędziami.

## Transkrypcja notatki głosowej

Przy każdej notatce głosowej — w edytorze, w trybie czytania, w dzienniku i na kartach — **Transkrybuj** zamienia nagranie w tekst. Trafia ono bez zmian do modelu profilu **Audio**, przez ten sam przegląd co pytanie; nagranie to osobny rodzaj danych, więc przegląd pyta za pierwszym razem. Transkrypcja wraca jako propozycja pod nagraniem, z autorem **Plainva AI · ⟨model⟩** — zaakceptuj ją lub odrzuć w sekcji **Propozycje**.

**Audio** wymaga dostawcy z obsługą audio: OpenAI (na przykład `gpt-4o-transcribe` lub `whisper-1`), Gemini albo własnego zgodnego serwera — serwer na tym komputerze zatrzymuje nagranie na urządzeniu. Można transkrybować nagrania do 11 MB. Nagranie w notatce, którą Twoje reguły trzymają z dala od chmury, nie trafia do żadnego modelu w chmurze, a zaszyfrowane obszary robocze jeszcze tego nie oferują.

## Zasady prywatności

Niektóre notatki nigdy nie powinny trafić do dostawcy w chmurze. Reguła może znajdować się we frontmatterze notatki:

```yaml
plainva:
  ai:
    cloud: deny
```

albo, dla całego folderu, w **Ustawienia → AI & automatyzacja** (część vaultu), skąd reguły trafiają do `.agent/policy.yml`. Notatka trzymana z dala od chmury nie wnosi niczego — ani tekstu, ani tytułu — a linki do niej w innych notatkach są wstrzymywane. Modele na tym urządzeniu pozostają dozwolone. Zaszyfrowane obszary robocze trzymają chmurę z dala, chyba że zostanie tam dopuszczona. Dokładny format znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

## Historia i zużycie

Rozmowy zostają na tym urządzeniu, dla każdego vaultu — nigdy w vaulcie i nigdy niesynchronizowane. **Przechowuj rozmowy** decyduje, jak długo; pojedyncze rozmowy można usuwać na liście, a wszystkie rozmowy danego vaultu naraz. **Zużycie w tym miesiącu** sumuje tokeny według dostawcy i modelu.

## Ograniczenia wersji beta

- Na komputerze AI działa tylko w głównym oknie.
- Na telefonie odpowiedź pojawia się tylko, gdy aplikacja jest otwarta.
- Asystent sam niczego nie zmienia: proponuje zmiany w zaznaczonym fragmencie i transkrypcje notatek głosowych, jako propozycje do zaakceptowania lub odrzucenia.

Opinie o wersji beta trafiają do dyskusji projektu na GitHubie: **Opinie o AI (beta)** w ustawieniach rozpoczyna nową.
