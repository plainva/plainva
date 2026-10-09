# Umiejętności (Beta)

Stan na: 2026-10-09

Umiejętność to zestaw instrukcji do pracy, która się powtarza: przygotowanie spotkania, porządkowanie zadań, przegląd tygodnia. Plainva ma dwanaście wbudowanych, a własne można pisać samodzielnie. Umiejętności korzystają z otwartego formatu Agent Skills — folderu z plikiem `SKILL.md` — dlatego działają też w innych aplikacjach AI, które czytają ten format.

## Korzystanie z umiejętności

Umiejętność uruchamia się jednym kliknięciem: jako chip w pustej rozmowie (trzy najczęściej używane), w sekcji **Umiejętności** na karcie AI, na telefonie w **Rozmowy → Umiejętności** albo z palety poleceń. Rozmowa działa wtedy z umiejętnością: jej instrukcje idą razem z nią, a ona używa tylko narzędzi i folderów, które wymienia.

Można też po prostu zapytać. W każdej rozmowie AI zna nazwy i opisy aktywnych umiejętności i wczytuje jedną, gdy pytanie pasuje — wystarczy „przygotuj moje następne spotkanie”.

## Umiejętności dołączone do Plainva

| Umiejętność | Co robi |
|---|---|
| **Orientacja na dziś** | Co jest dziś ważne: zadania z terminem, spotkania i ostatnio zmieniane notatki. |
| **Przegląd tygodnia** | Ostatnie siedem dni i nadchodzący tydzień, z trzema propozycjami. |
| **Stan projektu** | Cel, postęp, otwarte punkty i następny krok projektu. |
| **Przygotowanie spotkania** | Przygotowuje spotkanie na podstawie wcześniejszych notatek i otwartych punktów albo podsumowuje je po fakcie. |
| **Przegląd zadań** | Porządkuje otwarte zadania: co teraz, co może poczekać, co odpuścić. |
| **Badanie tematu** | Bada pytanie w internecie i w Twoich notatkach, z podaniem każdego źródła. |
| **E-mail i kalendarz** | Przegląda ostatnie e-maile i nadchodzące spotkania: co wymaga odpowiedzi, co przygotować, jakie zadania z tego wynikają. |
| **Pisanie i redakcja** | Streszcza, skraca lub przepisuje notatkę — jako tekst do przejęcia. |
| **Dbanie o wiedzę** | Znajduje notatki, które mówią to samo, są nieaktualne lub z niczym niepołączone. |
| **Porządkowanie linków** | Sprawdza linki notatki: prowadzące donikąd, brakujące, jednokierunkowe. |
| **Kontrola prywatności** | Znajduje to, co z notatki powinno zostać na tym urządzeniu, i proponuje regułę. |
| **Refleksja** | Spogląda razem z użytkownikiem na notatki z dnia lub tygodnia — życzliwie, nigdy z diagnozą. |

Wszystkie tylko czytają: żadna nie zmienia notatki ani niczego nie wysyła. Tylko **Badanie tematu** korzysta z internetu i tylko **E-mail i kalendarz** czyta Twoje e-maile — zob. niżej. Kontrola prywatności i Refleksja są przeznaczone dla modelu na tym urządzeniu; przy modelu w chmurze mówi o tym podgląd wysyłki. Każdą umiejętność można wyłączyć w sekcji **Umiejętności** — przełącznik obowiązuje dla tego vaultu na tym urządzeniu. **Utwórz własną wersję** kopiuje jedną z nich do vaultu, gdzie można ją zmienić.

## W internecie i w Twoich e-mailach

**Badanie tematu** to jedyna dołączona do Plainva umiejętność, która korzysta z internetu. Jej uruchomienie to Twój wybór dla jej rozmowy, tak jak ikona globusa pod polem wpisywania: tam, gdzie włączysz **AI może korzystać z internetu w tym vaulcie**, wyszukuje i czyta strony — a dopóki Twoje notatki są w rozmowie, każda strona i każde wyszukiwanie nadal pytają najpierw, jak opisano w sekcji **W internecie** na stronie [Asystent AI](AI_Assistant.md). Tam, gdzie przełącznik jest wyłączony, bada tylko Twoje notatki i mówi o tym. To samo dotyczy sytuacji, gdy AI sama wczytuje umiejętność w rozmowie rozpoczętej bez internetu.

**E-mail i kalendarz** czyta e-maile przez to samo pytanie co każda rozmowa: za pierwszym razem **Czytać Twoje e-maile?** Nigdy sama nie czyta tekstu wiadomości; raport o niej pisze drugi czytelnik, bez narzędzi. Jedno i drugie opisuje strona [Asystent AI](AI_Assistant.md).

Własna umiejętność korzysta z internetu tylko wtedy, gdy jej wiersz `allowed-tools` wymienia `web_search` lub `fetch_url`. **Sprawdź i zatwierdź** pokazuje wtedy, zanim ją zatwierdzisz: **Korzysta z internetu tam, gdzie dopuścisz to dla tego vaultu.** Umiejętność, która nie wymienia żadnych narzędzi, nigdy nie przynosi internetu ze sobą.

Uruchomienie testowe nigdy nie korzysta z internetu i nigdy nie pyta: e-maile, których nie wolno mu było czytać w tej sesji, pozostają nieprzeczytane.

## Proponowanie zmian

Własna umiejętność proponuje zmiany tylko wtedy, gdy jej wiersz `allowed-tools` wymienia przeznaczone do tego narzędzia: `propose_edit` i `set_property` dla propozycji w tekście i we właściwościach notatki, `create_note`, `create_entry`, `create_task` i `add_journal_entry` dla szkiców, `rename_note`, `move_note` i `delete_note` dla planów. **Sprawdź i zatwierdź** wymienia wtedy każde z nich i pokazuje: **Może proponować zmiany, zostawiać szkice i przedstawiać plany. W vaulcie nic się nie zmienia, dopóki nie zaakceptujesz, nie utworzysz lub nie potwierdzisz.** Umiejętność, która nie wymienia żadnych narzędzi, niczego nie proponuje — nic nie zyskuje też umiejętność zatwierdzona wcześniej — a uruchomienie testowe niczego nie zostawia. Czym są te trzy formy: **Proponowanie zmian** w [Asystent AI](AI_Assistant.md).

## Własne umiejętności

**Nowa umiejętność** prosi o nazwę, opis — na jego podstawie AI wybiera umiejętność — i instrukcje. Plainva zapisuje je jako `.agent/skills/<nazwa>/SKILL.md` w vaulcie, gdzie podróżują z nim jak każda notatka. **Edytuj** otwiera plik jak notatkę.

**Importuj…** przyjmuje umiejętność jako plik `.zip` lub `.skill`. Zanim cokolwiek zostanie zapisane, Plainva ją sprawdza: dokładnie jedna umiejętność w formacie, żadna ścieżka poza jej folderem, limity rozmiaru. Podaje licencję, skrypty, których nie uruchomi, i narzędzia, których nie ma. Ukryte pliki — o nazwach zaczynających się od kropki — nie są częścią umiejętności i są pomijane.

## Nic nie działa przed zatwierdzeniem

Umiejętność w vaulcie, która jest nowa lub zmieniona — przez synchronizację, import albo edycję na tym lub innym urządzeniu — nie działa, dopóki nie zostanie zatwierdzona **na tym urządzeniu**. Takie umiejętności czekają na górze sekcji **Umiejętności** w **Czekają na zatwierdzenie** oraz w **Ustawienia → AI & automatyzacja** (część vaultu). **Sprawdź i zatwierdź** pokazuje, co umiejętność może robić, co się zmieniło od ostatniego zatwierdzenia, jej instrukcje, pliki i miejsce. Zatwierdzenie obowiązuje dokładnie tę wersję; każda zmiana je znosi. Zatwierdzenia są przechowywane na tym urządzeniu, nigdy w vaulcie.

To samo dotyczy pliku `AGENTS.md` na najwyższym poziomie vaultu: po zatwierdzeniu jego stałe instrukcje trafiają do każdej nowej rozmowy. Ani umiejętność, ani `AGENTS.md` nie może uchylić reguł prywatności, a umiejętność nigdy nie dostaje więcej, niż ma rozmowa — może to tylko zawęzić. Reguła dodana w pamięci albo zaakceptowana ze szkicu AI to kolejny wiersz tego pliku; zob. [Pamięć](AI_Memory.md).

## Sprawdzanie umiejętności z modelem

Umiejętność może mieć scenariusze testowe: wiadomość, która ją uruchamia, i to, co robi dobre uruchomienie. Dołączone umiejętności je mają; dla własnych zapisz je w `tests/scenarios.json` w folderze umiejętności:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` wymienia narzędzia, których używa dobre uruchomienie, oraz te, których nie wolno mu ruszać; `cites` — notatki, które wymienia jego odpowiedź; `never` — tekst, który nie może się w niej pojawić. Umiejętność ma najwyżej osiem scenariuszy.

**Sprawdź z ⟨model⟩** — na dole sekcji **Umiejętności** albo w menu umiejętności — uruchamia scenariusze z modelem, którego użyłaby nowa rozmowa. Nic nie startuje samo: okno najpierw mówi, ile scenariuszy i z jakim modelem zostałoby uruchomionych, a Ty ustawiasz **Limit** w dolarach amerykańskich; sprawdzanie kończy się między dwoma scenariuszami, gdy zostanie osiągnięty. Jeśli cena modelu nie jest znana, sprawdzanie kończy się po stałej liczbie tokenów; model na tym urządzeniu nie potrzebuje limitu.

Każdy scenariusz to zwykłe uruchomienie swojej umiejętności: czyta vault jak uruchomienie ręczne, przechodzi przez ten sam przegląd przed wysłaniem, liczy się do Twojego zużycia i zostawia swoją rozmowę w historii, gdzie zastępuje ją jego następne uruchomienie. Potem każdy scenariusz pokazuje wynik słowami, a wiersz umiejętności mówi, jak poszło jej ostatnie uruchomienie. Wynik dotyczy jednego modelu i jednej wersji umiejętności: gdy wybierzesz inny model albo zmienisz umiejętność, wiersz to powie, zamiast pokazywać wynik, który już się nie liczy. Niektóre dołączone scenariusze pytają o notatki z testowego vaultu Plainvy; w Twoim vaulcie nie mają zastosowania, a okno liczy je osobno, zamiast uznawać je za niezaliczone.

## Uczenie się z rozmowy

Rozmowa może coś po sobie zostawić: fakt, który warto znać, regułę albo umiejętność, która nie poszła wystarczająco daleko. Poleceniem **Naucz się z tej rozmowy** — w menu rozmowy na liście i pod jej ostatnią odpowiedzią — możesz o to poprosić. Nic nie czyta Twoich rozmów w tle.

Okno dialogowe najpierw mówi, co by się stało: rozmowa trafia jeszcze raz do modelu, który ją prowadził, i do żadnego innego — czyli Twój tekst i odpowiedzi, z nazwami użytych narzędzi. Nic z tego, co zwróciło narzędzie, nie jest dołączane, a notatki również nie. Jeśli w rozmowie uruchomiono własną umiejętność, jej instrukcje są dołączane, aby można było zaproponować lepszą wersję. Przycisk **Naucz się** uruchamia przegląd, a ten kosztuje jedno zapytanie.

Wracają szkice, a przy każdym z nich widnieje **Dowód** podany przez przegląd; nic z tego nie obowiązuje, dopóki tego nie zaakceptujesz. O wpisie do pamięci i o regule decydujesz na ich kartach, jak opisano na stronie [Pamięć](AI_Memory.md). Szkic umiejętności ma zamiast tego przycisk **Sprawdź**.

Rozmowa, która czytała treść ze strony internetowej, z e-maila lub z narzędzia zewnętrznego, proponuje tylko wpisy do pamięci: to, co napisał ktoś obcy, nie staje się regułą ani umiejętnością. To samo dotyczy rozmowy opartej na notatkach trzymanych z dala od chmury lub od internetu, a wpisy z niej niosą tę regułę. Rozmowa prowadzona z modelem na tym urządzeniu jest przeglądana na tym urządzeniu.

### Akceptowanie propozycji dla umiejętności

Przycisk **Sprawdź** pokazuje wiersz po wierszu, co by się zmieniło, oraz to, co umiejętność może robić — a to zostaje bez zmian: propozycja zmienia instrukcje umiejętności i nic więcej. Narzędzi, folderów i limitów umiejętności nigdy nie ustawia model. Okno mówi też, czy bieżąca wersja została sprawdzona, ile więcej lub mniej kosztuje jedno uruchomienie i z której rozmowy pochodzi propozycja. Przycisk **Przeredaguj** zamienia porównanie w pole, w którym możesz pisać.

Przycisk **Zaakceptuj** zapisuje nową wersję i zatwierdza ją na tym urządzeniu, ponieważ właśnie tu została Ci pokazana. Na Twoich pozostałych urządzeniach umiejętność czeka wtedy na własne zatwierdzenie, jak po każdej zmianie. Nowa umiejętność z propozycji zaczyna od ustawień domyślnych Plainva: czyta i pokazuje, niczego nie zmienia. Propozycja nigdy nie przepisuje umiejętności zaimportowanej przez Ciebie ani umiejętności dołączonych do Plainva.

### Wersje pod obserwacją i droga powrotna

Wersja, która pochodzi z propozycji, jest obserwowana przez trzy uruchomienia, a wiersz umiejętności je zlicza. Jeśli uruchomienie nie kończy się odpowiedzią, sekcja umiejętności wymienia tę umiejętność pod nagłówkiem **Wersje pod obserwacją** i oferuje dwie możliwości: **Wróć do poprzedniej wersji** albo **Zachowaj**. Nic nie wraca samo.

Polecenie **Wcześniejsze wersje…** w menu umiejętności pokazuje to, co historia wersji vaultu zachowuje z pliku umiejętności. Okno zestawia wybraną przez Ciebie wersję z umiejętnością w obecnej postaci — jej wiersze i to, co może robić — i ostrzega, gdy wcześniejsza wersja może robić więcej. Przycisk **Przywróć tę wersję** zapisuje ją z powrotem i zatwierdza na tym urządzeniu. Wersje są przechowywane na tym urządzeniu.

W przypadku umiejętności zmienionej w inny sposób — przez synchronizację albo edycję na innym urządzeniu — przycisk **Sprawdź i zatwierdź** pokazuje to samo pod nagłówkiem **W porównaniu z zatwierdzoną wersją**: które narzędzia doszły, a które odpadły, a także foldery i limit.

Pod nagłówkiem **Czego się nauczono** sekcja umiejętności otwiera plik `.agent/logs/learning.md`: po jednym wierszu dla każdej umiejętności i każdej reguły zaakceptowanej z propozycji, z dniem i rozmową. Plik podróżuje razem z Twoim vaultem.

## Co trafia do dostawcy

Podgląd wysyłki wymienia w **Instrukcje**, co idzie razem z prośbą: umiejętność rozmowy, listę umiejętności, które AI może wczytać, oraz `AGENTS.md`. Gdy instrukcje z vaultu po raz pierwszy trafiają do chmury, podgląd pojawia się ponownie. Niewidoczne znaki w umiejętności nigdy nie trafiają do modelu.

## Ograniczenia wersji beta

Umiejętność nie uruchamia własnych skryptów; małe programy, które czytają Twój vault, opisuje strona [Skrypty](AI_Scripts.md). Własne umiejętności nie są oferowane aplikacjom AI połączonym przez serwer MCP; tylko te dołączone do Plainva.
