# Asystent AI (Beta)

Stan na: 2026-09-30

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

1. W **AI & automatyzacja** wybierz **Dodaj dostawcę** i wskaż jednego z nich. Każdy wpis niesie krótką uwagę o swoich warunkach — na przykład, że w bezpłatnym dostępie Google dane wejściowe mogą czytać ludzie.
2. Wpisz klucz przyciskiem **Wpisz klucz**. Klucz trafia do bezpiecznego magazynu tego urządzenia; Plainva nigdy nie pokazuje go ponownie — ani AI, ani na ekranie.
3. **Przetestuj połączenie** wczytuje własną listę modeli dostawcy. Jeśli się nie powiedzie, komunikat mówi dlaczego (odrzucony klucz, brak połączenia, nieznany model).

Taki **serwer kompatybilny z OpenAI** dodaje się, podając jego adres. Plainva pyta jeszcze raz przed dodaniem, w oknie systemu operacyjnego, i wysyła tylko na potwierdzony adres. Zwykłe `http` działa tylko dla serwera na tym urządzeniu; wszystko inne wymaga `https`.

Jeśli nie masz jeszcze klucza: model na tym komputerze (Ollama, LM Studio) nic nie kosztuje, a konsola każdego dostawcy wydaje klucze.

## Modele i profile

Cztery profile — **Szybki**, **Zrównoważony**, **Silny** i **Lokalny** — służą do przypisania modeli. Dla każdego wybierz dostawcę i model, z listy dostawcy albo wpisując identyfikator modelu dokładnie tak, jak nazywa go dostawca. **Domyślny dla nowych rozmów** decyduje, którym profilem zaczyna się nowa rozmowa. Plainva nie ogłasza żadnego modelu „najlepszym”.

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
- **Notatki, które mogą mieć znaczenie:** znalezione po Twoich słowach, po linkach otwartej notatki i po tym, co niedawno otwierano lub zmieniano. Najpierw decydują Twoje zasady prywatności; oceniane są wyłącznie notatki, na które pozwalają. Kilka idzie jako sekcje — nie całe notatki —, inne tylko z tytułem i fragmentem wyszukiwania albo samą nazwą; asystent doczytuje je, gdy tego potrzebuje.

Notatka, którą rozmowa już zawiera i która od tamtej pory się nie zmieniła, jest wymieniana, a nie wysyłana ponownie. Miejsca z dziennika i wartości nastroju nigdy nie są wysyłane same z siebie.

## Zanim cokolwiek zostanie wysłane

Pierwsze zapytanie w sesji pokazuje przegląd: dokąd idzie (dostawca i model), które notatki i która część każdej z nich, co jeszcze idzie (zaznaczenie, spotkania, zadania), co zostało zatrzymane i w przybliżeniu ile tokenów. **Wyślij** wysyła; **Anuluj** nie wysyła niczego i oddaje Twoje słowa do pola wpisywania; − obok notatki ją pomija. W zakresie, który zatwierdzono, kolejne zapytania idą bez pytania. Przegląd wraca za każdym razem, gdy zakres rośnie: inny model lub dostawca, nowy rodzaj danych, notatki z innego folderu, nowe narzędzia albo znacznie większe zapytanie. Model na tym urządzeniu nigdy nie pyta.

Aby widzieć przegląd przed każdym zapytaniem, włącz **Pytaj przed każdym zapytaniem** — w samym przeglądzie albo w **Ustawienia → AI & automatyzacja**, w sekcji **Wysyłanie**.

Wiersz pod każdą odpowiedzią otwiera przegląd tego, co z nią poszło. Jeśli odpowiedź nie cytuje żadnej z wysłanych notatek, mówi o tym komunikat nad tym wierszem; wtedy sprawdź odpowiedź w notatkach.

## Pokaż kontekst

Oko pod polem wpisywania, **Pokaż kontekst**, pokazuje, co zabrałoby następne zapytanie — zanim wyjdzie, dla wybranego teraz modelu. Przy każdej notatce: dlaczego została wybrana (otwarta teraz, przypięta, pasuje do Twoich słów, połączona, wkrótce termin …), która część idzie i w przybliżeniu ile tokenów. Każdą notatkę można

- pominąć w następnym zapytaniu (**Przywróć** ją przywraca),
- przypiąć do rozmowy,
- zachować na tym urządzeniu na stałe: to wpisuje do notatki regułę `cloud: deny` (zob. niżej).

Notatki zatrzymywane przez Twoje reguły też są wymienione, żeby było wiadomo, czego brakuje; nigdy nie są oceniane ani wysyłane. **Wyślij z tym kontekstem** wysyła to, co wpisano. W szerokiej karcie AI widok zostaje otwarty jako kolumna obok rozmowy.

## Z zaznaczeniem

Zaznacz tekst w notatce, a AI zajmie się tylko tym fragmentem.

- **Desktop:** podczas edycji **AI** na pasku zaznaczenia oferuje **Jako propozycja** — **Przepisz**, **Skróć**, **Przetłumacz…**, **Zrób z tego zadania** — oraz **W asystencie** — **Wyjaśnij** i **Pytanie o zaznaczenie…** (**Ctrl+J**, ⌘J w macOS).
- **Telefon:** **AI** na pasku nad zaznaczeniem — podczas czytania i podczas edycji — otwiera arkusz AI.
- **W każdej rozmowie:** dopóki w otwartej notatce zaznaczony jest tekst, wiersz **Z zaznaczeniem** nad polem wpisywania oferuje te same akcje.

Akcja propozycji wysyła wyłącznie zaznaczony fragment — nie resztę notatki, nie przypięte notatki, bez narzędzi — i pyta z tym samym przeglądem co pytanie. Odpowiedź wraca do notatki jako runda propozycji, tak jak runda od człowieka: w sekcji **Propozycje** akceptujesz lub odrzucasz każdą zmianę albo całą rundę, a wcześniej w notatce nic się nie zmienia. Wiersz autora rundy brzmi **Plainva AI · ⟨model⟩**, dzięki czemu widać, który fragment napisała AI. **Zrób z tego zadania** dodaje zadania pod fragmentem, zamiast go zastępować. Każda akcja zachowuje swoją rozmowę w historii.

Fragment notatki, którą Twoje reguły trzymają z dala od chmury — albo fragment z linkami do takich notatek lub z danymi o miejscach — nie trafia do żadnego modelu w chmurze. W zaszyfrowanym obszarze roboczym akcje propozycji nie są jeszcze dostępne: propozycje w nim nie mogą jeszcze wskazać AI jako autora.

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
- Asystent sam niczego nie zmienia: proponuje zmiany tylko w zaznaczonym fragmencie, jako propozycje do zaakceptowania lub odrzucenia.
