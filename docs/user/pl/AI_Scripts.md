# Skrypty (Beta)

Stan na: 2026-10-08

Skrypt to mały program do tego, co model robi słabo, a program wykonuje za każdym razem tak samo: liczenia, sortowania, porównywania, sumowania. Pisze się go w JavaScript. Działa w zamkniętej piaskownicy wewnątrz Plainva: nie może otworzyć pliku, sięgnąć do sieci ani czekać na późniejszą chwilę. Wywołuje tylko te narzędzia, które są dla niego zaznaczone: czytają one Twój vault tak samo jak narzędzia AI albo zostawiają propozycję, o której decydujesz Ty. Skrypt sam niczego nie zmienia.

## Uruchamianie skryptu

Twoje skrypty znajdują się w sekcji **Umiejętności** na karcie AI — na telefonie w **Rozmowy → Umiejętności** — w grupie **Skrypty**. Wybranie **Uruchom** otwiera okno skryptu: wpisz to, o co skrypt pyta, i naciśnij **Uruchom**. Gdy skrypt działa, widać każde narzędzie, które wywołuje, a przycisk **Zatrzymaj** kończy jego pracę. Potem okno pokazuje **Wywołania**, **Wynik** — który można skopiować — i **Dziennik**, a także to, ile przebieg zużył ze swoich limitów.

Przebieg uruchomiony tutaj zostaje na tym urządzeniu: nic z niego nie trafia do modelu, dlatego czyta też notatki, które trzymasz z dala od chmury. **Przebieg próbny** wywołuje narzędzia, które czytają, a wywołanie, które coś by pokazało w aplikacji albo zostawiło propozycję, tylko zapisuje.

## W rozmowie

W zwykłej rozmowie AI może znaleźć Twoje aktywne skrypty i uruchomić jeden z nich, gdy pasuje do pytania; krok w rozmowie nazywa się wtedy **Uruchamianie skryptu „word-count”**. Skrypt czyta tylko to, co wolno czytać tej rozmowie: notatka trzymana z dala od chmury zostaje na urządzeniu, a każda notatka, którą skrypt czyta, liczy się do tego, co przeczytał przebieg. To, co zwraca, trafia do modelu jako dane, nigdy jako instrukcje. Skrypty nie są oferowane ani rozmowie uruchomionej z umiejętnością, ani aplikacji AI połączonej przez serwer MCP.

## Proponowanie zmian

Skryptowi można też dać narzędzia do proponowania. Narzędzia **Proponowanie zmian w notatce** i **Proponowanie wartości właściwości** zostawiają propozycję na marginesie notatki; narzędzia **Przygotowywanie szkicu notatki**, **Przygotowywanie szkicu wpisu bazy danych**, **Przygotowywanie szkicu zadania** i **Przygotowywanie szkicu wpisu dziennika** zostawiają szkic. Jedno i drugie jest podpisane nazwą skryptu, a w Twoim vaulcie nic się nie zmienia, dopóki nie zaakceptujesz propozycji lub nie utworzysz szkicu — dokładnie tak jak przy propozycji AI. Po przebiegu okno wymienia je w sekcji **Propozycje i szkice**; przebieg uruchomiony jako **Przebieg próbny** niczego nie zostawia.

To, co skrypt przeczytał, decyduje o tym, gdzie wolno mu zapisywać: propozycje i szkice, które opierają się na notatce trzymanej z dala od chmury, mogą trafić tylko tam, gdzie obowiązuje ta sama zasada. W rozmowie skrypt, który proponuje, jest oferowany AI tylko tam, gdzie sama rozmowa może proponować, a to, co skrypt tam zostawia, jest podpisane nazwą modelu tej rozmowy.

## Pisanie skryptu

**Nowy skrypt** otwiera formularz z polami:

- **Nazwa** — małe litery, cyfry i łączniki; staje się nazwą folderu.
- **Opis** — do czego służy skrypt; po tym rozpoznajecie go Ty i AI.
- **Narzędzia** — zaznacz, co skrypt może wywoływać: w grupie **Odczyt** to, co czyta, w grupie **Proponowanie** to, co zostawia propozycję lub szkic. Nic innego dla niego nie istnieje.
- **Dane wejściowe** — o co skrypt pyta przy starcie: nazwa, rodzaj (tekst, liczba albo tak lub nie) i to, czy odpowiedź jest wymagana.
- **Limity** — sekundy obliczeń, wywołania narzędzi i pamięć.
- **Kod** — program.

**Utwórz i zatwierdź** zapisuje skrypt w Twoim vaulcie jako `.agent/scripts/<name>/` — pliki `manifest.json` i `main.js` — i zatwierdza go na tym urządzeniu. W menu skryptu **Edytuj** otwiera ten sam formularz; **Zapisz i zatwierdź** zastępuje pliki.

Kod to ciało funkcji. `input` zawiera dane wejściowe pod ich nazwami, `tools.<name>(…)` wywołuje narzędzie i czeka na jego odpowiedź, `return` zwraca wynik, a `console.log(…)` zapisuje wiersz w dzienniku przebiegu:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

Językiem jest JavaScript w wersji ES2020. Nie ma `fetch`, timera, `import` ani dostępu do plików, a to, co skrypt zwraca, musi być danymi, które da się zapisać jako JSON. Narzędzie, które odrzuci wywołanie — na przykład gdy notatka nie istnieje albo rozmowa nie może jej czytać — zgłasza błąd, który skrypt może przechwycić.

## Co zwraca narzędzie

**Co zwraca narzędzie** w formularzu otwiera tę stronę. Każde narzędzie przyjmuje jeden obiekt i jeden zwraca; `cursor` przyjmuje wartość `next` z poprzedniego wywołania i kontynuuje jego listę.

| Narzędzie | Przekazujesz | Otrzymujesz |
|---|---|---|
| `search_vault` — **Przeszukiwanie vaultu** | `query`; opcjonalnie `folder`, `limit` (do 25), `cursor` | `results`: lista obiektów `{ title, path, snippet }`; `next` |
| `read_note` — **Odczytywanie notatki** | `path`; opcjonalnie `section`, `maxChars` (od 200 do 20 000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Odczytywanie konspektu** | `path` | `path`; `properties`: nazwa i wartość; `sections`: lista obiektów `{ level, text, section }` |
| `query_base` — **Odczytywanie bazy danych** | `base`, czyli ścieżka pliku `.base`; opcjonalnie `view`, `limit` (do 50), `cursor` | `base`, `view`, `views`; `rows`: lista obiektów `{ title, path, properties }`; `next` |
| `get_tasks` — **Odczytywanie zadań** | opcjonalnie `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (do 50), `cursor` | `tasks`: lista obiektów `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Czytanie linków zwrotnych** | `path`; opcjonalnie `limit` (do 50), `cursor` | `path`; `notes`: lista obiektów `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Podążanie za linkami** | `path`; opcjonalnie `depth` (1 lub 2), `limit` (do 50) | `path`; `notes`: lista obiektów `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Przeglądanie ostatnich notatek** | opcjonalnie `kind` (`opened` lub `edited`), `limit` (do 20) | `kind`; `notes`: lista obiektów `{ title, path, at }` |
| `get_calendar` — **Czytanie spotkań** | `from` i `to` jako `YYYY-MM-DD`; opcjonalnie `details`, `limit` (do 100) | `events`: lista obiektów `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Korzystanie z aplikacji** | `id`, polecenie aplikacji, np. `open-note`, `show-in-graph` lub `open-calendar`; opcjonalnie `args` z `path`, `section` lub `date` | `done`, `command` |
| `propose_edit` — **Proponowanie zmian w notatce** | `path`; `edits`, czyli lista obiektów `{ find, replace }`, albo `append`; opcjonalnie `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Proponowanie wartości właściwości** | `path`, `key`, `value`; opcjonalnie `note` | `proposed`, `path`, `property` |
| `create_note` — **Przygotowywanie szkicu notatki** | `title`, `content`; opcjonalnie `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Przygotowywanie szkicu wpisu bazy danych** | `base`, `title`; opcjonalnie `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Przygotowywanie szkicu zadania** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Przygotowywanie szkicu wpisu dziennika** | `text`; opcjonalnie `task` | `drafted`, `kind` |

## Limity

Limity skryptu są zapisane w jego manifeście. Formularz ustawia trzy z nich:

| Limit | Domyślnie | Zakres |
|---|---|---|
| **Sekundy obliczeń** | 5 | od 1 do 30 |
| **Wywołania narzędzi** | 20 | od 0 do 50 |
| **Pamięć w MB** | 32 | od 8 do 128 |

Liczy się tylko czas obliczeń skryptu, a nie czas, który zajmuje narzędzie. Skrypt, który przekroczy limit, zostaje zakończony; okno mówi, o który limit chodziło, a zakończony skrypt niczego nie zwraca. Argumenty jednego wywołania i wynik mogą mieć najwyżej po 64 KB.

## Nic nie działa przed zatwierdzeniem

Skrypt w vaulcie, który jest nowy lub zmieniony — przez synchronizację albo zapis przez inny program — nie działa, dopóki nie zostanie zatwierdzony **na tym urządzeniu**. Czeka na górze sekcji **Umiejętności** w **Czekają na zatwierdzenie**. **Sprawdź i zatwierdź** pokazuje **Co może robić**, **Limity**, **Dane wejściowe** i cały **Kod** oraz mówi, czy kod daje się odczytać jako JavaScript; kodu, którego nie da się odczytać, nie można zatwierdzić.

Po wybraniu **Zatwierdź** to urządzenie podpisuje dokładnie te pliki. Klucz do tego powstaje na tym urządzeniu i leży w jego pęku kluczy. Każda zmiana pliku znosi zatwierdzenie, a na każdym z Twoich innych urządzeń skrypt czeka na własne zatwierdzenie — zatwierdzenia nie da się przenieść z jednego urządzenia na drugie. W menu skryptu **Wycofaj zatwierdzenie** cofa je, a **Pokaż kod** pokazuje okno sprawdzania jeszcze raz.

## Ograniczenia wersji beta

Skrypt proponuje i zostawia szkice; nigdy nie zmienia nazwy notatki, nie przenosi jej ani nie usuwa, nie pisze też e-maili i nie tworzy spotkań. Umiejętność nie może uruchomić skryptu, a własny folder `scripts/` umiejętności nie jest uruchamiany. E-maile, internet i narzędzia zewnętrznych serwerów nie są dostępne dla skryptów.
