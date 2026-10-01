# Umiejętności (Beta)

Stan na: 2026-10-01

Umiejętność to zestaw instrukcji do pracy, która się powtarza: przygotowanie spotkania, porządkowanie zadań, przegląd tygodnia. Plainva ma dziesięć wbudowanych, a własne można pisać samodzielnie. Umiejętności korzystają z otwartego formatu Agent Skills — folderu z plikiem `SKILL.md` — dlatego działają też w innych aplikacjach AI, które czytają ten format.

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
| **Pisanie i redakcja** | Streszcza, skraca lub przepisuje notatkę — jako tekst do przejęcia. |
| **Dbanie o wiedzę** | Znajduje notatki, które mówią to samo, są nieaktualne lub z niczym niepołączone. |
| **Porządkowanie linków** | Sprawdza linki notatki: prowadzące donikąd, brakujące, jednokierunkowe. |
| **Kontrola prywatności** | Znajduje to, co z notatki powinno zostać na tym urządzeniu, i proponuje regułę. |
| **Refleksja** | Spogląda razem z użytkownikiem na notatki z dnia lub tygodnia — życzliwie, nigdy z diagnozą. |

Wszystkie tylko czytają: żadna nie zmienia notatki, niczego nie wysyła ani nie korzysta z internetu. Kontrola prywatności i Refleksja są przeznaczone dla modelu na tym urządzeniu; przy modelu w chmurze mówi o tym podgląd wysyłki. Każdą umiejętność można wyłączyć w sekcji **Umiejętności** — przełącznik obowiązuje dla tego vaultu na tym urządzeniu. **Utwórz własną wersję** kopiuje jedną z nich do vaultu, gdzie można ją zmienić.

## Własne umiejętności

**Nowa umiejętność** prosi o nazwę, opis — na jego podstawie AI wybiera umiejętność — i instrukcje. Plainva zapisuje je jako `.agent/skills/<nazwa>/SKILL.md` w vaulcie, gdzie podróżują z nim jak każda notatka. **Edytuj** otwiera plik jak notatkę.

**Importuj…** przyjmuje umiejętność jako plik `.zip` lub `.skill`. Zanim cokolwiek zostanie zapisane, Plainva ją sprawdza: dokładnie jedna umiejętność w formacie, żadna ścieżka poza jej folderem, limity rozmiaru. Podaje licencję, skrypty, których nie uruchomi, i narzędzia, których nie ma.

## Nic nie działa przed zatwierdzeniem

Umiejętność w vaulcie, która jest nowa lub zmieniona — przez synchronizację, import albo edycję na tym lub innym urządzeniu — nie działa, dopóki nie zostanie zatwierdzona **na tym urządzeniu**. Takie umiejętności czekają na górze sekcji **Umiejętności** w **Czekają na zatwierdzenie** oraz w **Ustawienia → AI & automatyzacja** (część vaultu). **Sprawdź i zatwierdź** pokazuje, co umiejętność może robić, co się zmieniło od ostatniego zatwierdzenia, jej instrukcje, pliki i miejsce. Zatwierdzenie obowiązuje dokładnie tę wersję; każda zmiana je znosi. Zatwierdzenia są przechowywane na tym urządzeniu, nigdy w vaulcie.

To samo dotyczy pliku `AGENTS.md` na najwyższym poziomie vaultu: po zatwierdzeniu jego stałe instrukcje trafiają do każdej nowej rozmowy. Ani umiejętność, ani `AGENTS.md` nie może uchylić reguł prywatności, a umiejętność nigdy nie dostaje więcej, niż ma rozmowa — może to tylko zawęzić.

## Co trafia do dostawcy

Podgląd wysyłki wymienia w **Instrukcje**, co idzie razem z prośbą: umiejętność rozmowy, listę umiejętności, które AI może wczytać, oraz `AGENTS.md`. Gdy instrukcje z vaultu po raz pierwszy trafiają do chmury, podgląd pojawia się ponownie. Niewidoczne znaki w umiejętności nigdy nie trafiają do modelu.

## Ograniczenia wersji beta

Umiejętności nie uruchamiają skryptów, a te, które potrzebują internetu lub poczty, pojawią się później. Własne umiejętności nie są oferowane aplikacjom AI połączonym przez serwer MCP; tylko te dołączone do Plainva.
