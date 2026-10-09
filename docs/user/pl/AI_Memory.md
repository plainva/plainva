# Pamięć (Beta)

Stan na: 2026-10-09

Pamięć przechowuje to, co AI powinna wiedzieć o Tobie i Twojej pracy bez przypominania: czym się zajmujesz, jakie odpowiedzi lubisz, kim są Twoi klienci. To dwa pliki w Twoim vaulcie. Nic nie trafia do pamięci bez Twojego „tak”, a każdy wpis możesz przeczytać, zmienić i usunąć.

## Dwa miejsca

Zawartość miejsca **Zawsze dołączane** trafia do każdej nowej rozmowy. Pisz tam krótko: mieści się 2000 znaków, a pasek pokazuje, ile z nich już zajęto. Wpis, który już się nie mieści, jest oznaczony jako **Brak miejsca — niedołączany** — jest zapisany, ale nie idzie razem z rozmową. Wpisy są dołączane w kolejności, w jakiej stoją, więc to, co najważniejsze, powinno być na górze; kolejność zmieniasz w pliku.

Zawartość miejsca **Do sprawdzenia** nie idzie razem z rozmową. AI zagląda tam, gdy pytanie może zależeć od czegoś, co wcześniej od Ciebie usłyszała, a w rozmowie widać **Przeszukiwanie pamięci**. To miejsce na to, co ważne tylko czasem: warunki jednego klienta, decyzja i jej powód.

## Otwieranie pamięci

Na desktopie wybierz **Pamięć** na karcie AI, obok **Umiejętności**. Na telefonie to **Rozmowy → Pamięć**. Tam prowadzi także **Ustawienia → AI & automatyzacja** (część vaultu): **Otwórz pamięć** w **Umiejętności i pamięć**.

## Samodzielne dodawanie wpisu

**Nowy wpis** prosi o trzy rzeczy: tekst — jedna rzecz na wpis, jeden wiersz do 500 znaków —, miejsce (**Zawsze dołączane** albo **Do sprawdzenia**) i decyzję, czy zaznaczyć **Tylko modele na tym urządzeniu**. Zaznacz to przy wszystkim, o czym żaden model w chmurze nie powinien się dowiedzieć.

Przycisk ⋯ przy wpisie — na telefonie dotknięcie wpisu — oferuje **Edytuj**, przeniesienie go do drugiego miejsca (**Zawsze dołączaj** albo **Tylko do sprawdzenia**) i **Usuń**.

## Prośba do AI o zapamiętanie

Powiedz to w rozmowie: „Zapamiętaj, że rozliczam się stawką dzienną, a nie godzinową.” AI przygotowuje szkic wpisu; sama nigdy go nie zapisuje. Pod jej odpowiedzią karta **Szkic · Wpis pamięci** pokazuje cały tekst. Wybierz miejsce, potem **Zapamiętaj** — albo **Odrzuć**. Szkic czeka w **Oczekujące**, dopóki o nim nie zdecydujesz, a pamięć pokazuje, ile szkiców czeka.

„Zapomnij, że …” działa tak samo: na karcie widnieje **Szkic · Usunięcie z pamięci**, a **Usuń** usuwa wpis. Gdy powiesz AI, że coś się zmieniło, karta pokazuje pod **Zastępuje**, którego wpisu miejsce zajmie nowe sformułowanie.

## Reguła nie jest wpisem pamięci

„Zawsze odpowiadaj po niemiecku” to nic, co AI ma wiedzieć — to coś, co ma robić. Taka reguła nie trafia do pamięci: staje się wierszem w **Instrukcje vaultu** (`AGENTS.md`), które każdy model dostaje jako instrukcję. Dodaj ją przez **Dodaj regułę** w **Reguły dla AI** albo poproś o to AI; na karcie widnieje wtedy **Szkic · Reguła dla AI** z przyciskiem **Dodaj jako regułę**.

Podobnie jak wszystkie instrukcje, plik musi zostać zatwierdzony na każdym urządzeniu, zanim tam zacznie obowiązywać (zob. [Umiejętności](AI_Skills.md)). Reguła dodana na urządzeniu, na którym plik był już zatwierdzony, obowiązuje tam od razu; Twoje pozostałe urządzenia najpierw Cię pytają.

## Prywatność

- Wpis może nieść własną regułę: **Nie do modeli w chmurze**, **Nie w rozmowach z internetem**. Model na tym urządzeniu dostaje każdy wpis.
- Wpis, który AI przygotowała w rozmowie, w której czytała notatki objęte zasadą prywatności, dostaje te same reguły — karta mówi: **Wpis otrzymuje zasady prywatności notatek, na których opierała się ta rozmowa.** To, co pochodzi z notatki, która musi zostać na tym urządzeniu, nie dociera do chmury przez pamięć.
- Twoje [zasady prywatności](AI_Assistant.md) obejmują także oba pliki: reguła folderu dla `.agent/` trzyma całą pamięć z dala od chmury.
- Przegląd wysyłki ma wiersz **Pamięć** — ile wpisów idzie razem — i liczy w **Zatrzymano** wpisy, które zatrzymują Twoje reguły. Nigdy nie wymienia żadnego wpisu.
- Dla AI wpis jest informacją, a nie instrukcją: zdanie w pamięci nie daje jej żadnych uprawnień.
- Rozmowa zachowuje pamięć, z którą została rozpoczęta. Usunięty wpis nie trafia do żadnej nowej rozmowy; rozmowy, które już się rozpoczęły, zachowują to, co dostały.

## Wyłączanie

Przełącznik **Używaj pamięci na tym urządzeniu** jest włączony, dopóki go nie wyłączysz. Po wyłączeniu rozmowa na tym urządzeniu nic z pamięci nie dostaje i nic do niej nie dodaje. Pliki zostają bez zmian, a każde urządzenie decyduje samo.

## Dwa pliki

`.agent/active_memory.md` (zawsze dołączany) i `.agent/MEMORY.md` (do sprawdzenia) to zwykły Markdown. Każdy wpis jest elementem listy, a nagłówki grupują wpisy. To, co Plainva wie o wpisie, jest zapisane w komentarzu za nim:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` i `by` mówią, kiedy wpis został dodany i czy pochodzi od Ciebie, czy z zaakceptowanego szkicu, `source` podaje nazwę rozmowy, z której pochodzi szkic, a `deny` zawiera reguły wpisu (`cloud`, `web`). Pliki możesz edytować w dowolnym edytorze. W Plainva każdy z nich otwiera **Otwórz plik**.

Plainva niczego nie zgaduje. Wpis z uszkodzonym komentarzem jest oznaczony jako **Reguły nieczytelne — nie trafia do żadnego modelu**, dopóki nie naprawisz komentarza lub nie dodasz wpisu od nowa. Tekst ukryty w komentarzu lub w niewidocznych znakach nigdy nie jest wysyłany; wpis pokazuje wtedy, ile ukrytych części pominięto. Plik mieści co najwyżej 2000 wpisów i 256 KB.
