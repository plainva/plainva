# Dziennik

Stan na: 2026-09-20

Dziennik to szybki sposób na zapisanie czegoś bez otwierania notatki: myśl, telefon, zdanie o dniu. Każdy wpis to zwykły wiersz listy z godziną — `- 14:05 Router stoi w piwnicy` — pod nagłówkiem **dzisiejszej notatki dziennej**. Nie ma nowego formatu pliku ani bazy danych: wpisy żyją w Twoich notatkach dziennych, czytelne w dowolnym edytorze i zgodne z wtyczkami Obsidian do prowadzenia dziennika (Thino, Knomo).

## Pisanie wpisu

Jedno pole, jeden **Enter**. Godzinę stempluje Plainva; Ty wpisujesz tylko tekst. Tagi, linki i drugi wiersz po prostu dopisujesz — tekst to zwykły Markdown.

- **Na komputerze:** `Ctrl+Shift+J` otwiera pole **Wpis dziennika** z dowolnego miejsca w Plainvie. To samo pole znajduje się w menu **＋** paska bocznego, w palecie poleceń i w menu zasobnika systemowego (**Wpis dziennika**). `Enter` zapisuje, `Shift+Enter` zaczyna nowy wiersz, `Esc` odrzuca.
- **Na telefonie:** przycisk **＋** oferuje **Wpis dziennika**; ekran dziennika ma własny przycisk pióra. Długie przytrzymanie ikony aplikacji również oferuje **Wpis dziennika** — na Androidzie jako skrót aplikacji, na iOS jako szybka akcja. `Enter` pozostaje tam złamaniem wiersza; **Zapisz wpis** zapisuje.
- **Z arkusza udostępniania (telefon):** wybierz Plainva i zaznacz **Do dziennika** — tekst i link stają się wpisem, udostępnione pliki trafiają do folderu załączników i zostają osadzone.
- **Ze zdjęciem:** pole na telefonie ma przycisk **Dodaj zdjęcie**; na komputerze wklejasz obraz ze schowka do pola. Zdjęcie trafia tam, gdzie inne załączniki, i zostaje osadzone we wpisie.

Jeśli dzisiejsza notatka dzienna jeszcze nie istnieje, zostaje utworzona po drodze — z Twojego szablonu notatki dziennej, bez zadawania jego pytań. Po zapisaniu komunikat mówi **Wpis zapisany** i oferuje **Cofnij**.

Pole ma dwa rodzaje, **Zadanie** i **Dziennik**. **Zadanie** przekazuje to, co wpisałeś, do [widoku zadań](Tasks.md), gdzie zadanie powstaje w zwykły sposób. Chip **Jako zadanie** to coś innego: zostawia wpis w dzienniku i nadaje mu pole wyboru (`- [ ] 14:05 Zamów część zamienną`), dzięki czemu pojawia się też w widoku zadań pod **Z notatek**.

## Widok dziennika

**Otwórz dziennik** (pasek akcji na komputerze, **Obszary** na telefonie lub paleta poleceń) pokazuje wszystkie dni jako jeden strumień: najnowszy dzień na górze, w obrębie dnia najpierw najnowszy wpis. Linki się otwierają, tagi są pigułkami, osadzony obraz pokazuje się jako podgląd, a długi wpis jest zwinięty — **Więcej** go otwiera.

- **Szukaj i filtruj:** pole wyszukiwania przeszukuje wczytane dni; chipy **Wszystkie**, **Tylko zadania** i najczęstsze tagi zawężają strumień. Kliknięcie tagu we wpisie filtruje według niego.
- **Starsze dni:** Plainva wczytuje ostatnie 14 dni, które mają wpisy. **Wczytaj starsze** pobiera kolejny odcinek; **Przejdź do dnia** otwiera wybór daty, w którym dni z wpisami są oznaczone, i wczytuje tak daleko wstecz, jak sięga wybrany dzień.
- **Otwórz notatkę** w nagłówku dnia otwiera tę notatkę dzienną; kliknięcie wpisu otwiera notatkę w tej linii.
- **Pola wyboru** wpisów zadań można odhaczyć bezpośrednio w strumieniu. Zachowują się tak jak w widoku zadań, wraz z datą ukończenia i kolejnym wystąpieniem zadania powtarzającego się.

Każdy wpis ma menu (kliknięcie prawym przyciskiem lub **⋯** na komputerze; **⋯**, długie przytrzymanie lub przesunięcie na telefonie): **Edytuj** zmienia tekst na miejscu i zachowuje godzinę, **Kopiuj** kopiuje tekst, **Zamień na zadanie** dodaje pole wyboru, a **Zamień z powrotem na wpis** je usuwa, **Pokaż w notatce** przeskakuje do wiersza, **Usuń** usuwa wpis — z **Cofnij** w komunikacie, który następuje potem.

Wpisy pojedynczego dnia pojawiają się też tam, gdzie patrzysz na ten dzień: pod kalendarzem w prawym pasku bocznym na komputerze (dla dnia otwartej notatki dziennej, w przeciwnym razie dla dziś) oraz na ekranie **Dzisiaj** na telefonie dla wybranego dnia. Oba mają małe pole, które zapisuje dokładnie w tym dniu, a **Wszystkie dni** prowadzi do strumienia.

## Jak wpis jest przechowywany

```markdown
## Journal

- 09:12 Zadzwoniłem do warsztatu #klient
- [ ] 10:30 Zamów część zamienną
- 14:05 Router stoi w piwnicy
  Klucz jest u pani Berger.
```

- Wpisy są dopisywane na końcu sekcji, więc plik czyta się chronologicznie; widok pokazuje najnowszy na górze.
- Nagłówek to domyślnie **Journal** i można go zmienić dla każdego vaulta w **Ustawienia → Vault → Treść i struktura** (**Nagłówek dziennika**; na telefonie w **Ustawienia → Treść i struktura**). Jego poziom nie ma znaczenia. Jeśli nagłówek nie istnieje, Plainva dodaje `## Journal` na końcu notatki. Zmiana ustawienia nie zmienia nazwy istniejących nagłówków.
- Plainva odczytuje też `- 14:05:30 Tekst` (z sekundami) oraz wpisy z polem wyboru, i kontynuuje listę tak, jak zapisuje ją Twoja notatka (`-`, `*` lub `+`, z pustymi liniami między wpisami lub bez nich). Istniejące wiersze nigdy nie są przeformatowywane.
- Zmiana, której nie da się bezpiecznie umieścić — na przykład dlatego, że blok kodu w sekcji nigdy nie został zamknięty — jest odrzucana z komunikatem, a pole zachowuje Twój tekst.

Dokładny format znajdziesz w [Dokumentacji formatu plików](File_Format_Reference.md).

## Dwa urządzenia jednocześnie

Jeśli dwa urządzenia dodają wpisy do tej samej notatki dziennej, zanim się zsynchronizują, to **nie jest konfliktem**: Plainva scala wpisy według godziny, a każda linia obu urządzeń zostaje zachowana. Dotyczy to też sytuacji, gdy oba urządzenia utworzyły notatkę dnia niezależnie od siebie. Każda inna jednoczesna zmiana notatki jest obsługiwana tak samo ostrożnie jak dotychczas (zobacz [Zgodność synchronizacji](Sync_Compatibility.md)).

## Globalne szybkie zapisywanie (komputer, opcjonalnie)

W **Ustawienia → Uruchamianie i zachowanie → Globalne szybkie zapisywanie** możesz włączyć **Zapisuj z dowolnego miejsca systemowym skrótem klawiszowym**. Skrót — domyślnie `Ctrl+Alt+J` (`Cmd+Option+J` na macOS) — otwiera wtedy małe okno z polem wpisu, nawet gdy z przodu jest inna aplikacja, dopóki Plainva działa (także w zasobniku systemowym). `Enter` zapisuje wpis w dzisiejszej notatce dziennej vaulta otwartego w Plainvie i zamyka okno; `Esc` odrzuca.

- **Zmień** rejestruje nowy skrót: naciśnij żądaną kombinację z `Ctrl`, `Alt` lub klawiszem Windows/Command. **Przywróć domyślny** przywraca wartość domyślną.
- Jeśli inna aplikacja już używa tego skrótu albo system go nie akceptuje, Plainva mówi to pod przełącznikiem, zamiast zostawiać skrót, który nic nie robi.
- Pod **Wayland** (Linux) system nie daje aplikacjom skrótu systemowego; Plainva mówi to i niczego nie rejestruje. Wpis w zasobniku systemowym i `Ctrl+Shift+J` prowadzą do tego samego pola.
- Skrót należy do urządzenia i nie jest częścią profilu ustawień.
