# Agenci zewnętrzni (Beta)

Stan na: 2026-10-07

Agent zewnętrzny to program AI innego producenta — agent zainstalowany samodzielnie na komputerze, do którego logujesz się samodzielnie, z własną subskrypcją lub kluczem. Plainva może uruchomić takiego agenta w folderze vaultu i pokazać jego sesję na karcie AI. To część eksperymentalnych funkcji AI i działa tylko na komputerze.

Agent zewnętrzny nie jest asystentem Plainva. [Asystent AI](AI_Assistant.md) wysyła tylko to, co pokazał jego przegląd, i nigdy to, co zatrzymują Twoje zasady prywatności. Agent czyta i wysyła sam. Ta strona mówi, co Plainva kontroluje w takiej sesji — a czego nie.

## Czego Plainva nie kontroluje

- **Program.** Agent to cudzy program. Działa na tym komputerze z Twoimi uprawnieniami, w folderze vaultu, i nie jest niczym odgrodzony: może czytać i zmieniać wszystko, co Ty możesz czytać i zmieniać.
- **Co czyta i wysyła.** Sam czyta pliki — także notatki trzymane z dala od chmury — i wysyła to, co wybierze, do własnej usługi. Twoje zasady prywatności i przegląd przed wysłaniem go nie obejmują i nic nie pyta, zanim wyśle.
- **Co sam zapisuje.** Zmiana, którą agent wprowadza sam, jest w vaulcie od razu, bez propozycji. Sesja mówi o tym, gdy agent zgłosi taką zmianę; zmiany, której nie zgłosi, Plainva nie widzi.
- **Jego logowanie.** Agent loguje się sam. Plainva nigdy nie widzi jego danych logowania i żadnych nie przechowuje.

Uruchamiaj agenta tylko w vaulcie, którego zawartość może trafić do usługi agenta.

## Co Plainva kontroluje

- **Własne narzędzia.** Tam, gdzie włączono **Pozwól aplikacjom AI na tym komputerze czytać ten vault**, narzędzia Plainva są oferowane agentowi — te same, co każdej aplikacji z [Łączenie aplikacji AI](Connect_AI_Apps.md): tylko foldery, na które zezwolisz, nigdy notatka trzymana z dala od chmury, i tylko do odczytu.
- **O czego odczyt agent prosi Plainva.** Notatka trzymana z dala od chmury i własne foldery Plainva nie są wydawane. Agent się o tym dowiaduje, i Ty też.
- **O czego zapis agent prosi Plainva.** Nic nie jest zapisywane. Zmiana w notatce staje się rundą propozycji pod nazwą agenta, a nowa notatka czeka, aż ją utworzysz.
- **Bez terminala.** Plainva nie oferuje agentowi własnego terminala.

## Dodawanie agenta

1. Zainstaluj agenta samodzielnie, tak jak opisuje to jego producent, i zaloguj się do niego w jego własnym programie.
2. Otwórz **Ustawienia → AI & automatyzacja** (część aplikacji). W sekcji **Agenci zewnętrzni** napis **Znaleziono na tym komputerze** oznacza agentów, których Plainva zna z nazwy i znajduje zainstalowanych; **Dodaj** dodaje jednego z nich. Dla każdego innego programu, który mówi protokołem Agent Client Protocol, wybierz **Dodaj agenta…** w sekcji **Inny agent** i wypełnij pola **Nazwa**, **Program** oraz **Argumenty, po jednym w wierszu**.
3. System pokazuje całe polecenie jeszcze raz, zanim zostanie zapamiętane.

Plainva nie instaluje żadnego agenta i żadnego nie pobiera. Uruchamia dokładnie ten program, który został potwierdzony, bezpośrednio i bez powłoki. Polecenie jest zapamiętywane na tym urządzeniu, nigdy w vaulcie. **Usuń** sprawia, że Plainva zapomina, jak uruchomić agenta; sam program i jego logowanie zostają bez zmian.

## Rozpoczynanie sesji

Otwórz kartę AI i wybierz **Agent**. Zanim cokolwiek się uruchomi, **Zanim uruchomisz: ⟨agent⟩** wylicza, co agent robi sam i co kontroluje Plainva, oraz mówi, czy narzędzia Plainva zostaną zaoferowane. **Rozpocznij sesję** uruchamia program agenta w folderze vaultu. Przy pierwszym uruchomieniu agenta w danym vaulcie od otwarcia Plainva system pyta jeszcze raz i pokazuje folder oraz całe polecenie.

Naraz działa jedna sesja i należy ona do vaultu, w którym została rozpoczęta: **Zakończ sesję** zatrzymuje program agenta, a zamknięcie vaultu lub Plainva również. Dopóki sesja trwa, jej pierwszy wiersz mówi, kim jest agent i że Twoje zasady prywatności go nie dotyczą. W zaszyfrowanym obszarze roboczym nie uruchamia się żadnego agenta.

## Logowanie

Agent, który nie jest zalogowany, mówi o tym, a sesja pokazuje **⟨agent⟩ wymaga zalogowania** wraz ze sposobami, które agent podaje. Zależnie od agenta wybór jednego z nich otwiera okno terminala z własnym programem agenta albo agent sam prowadzi do swojego logowania. Plainva czeka, a potem uruchamia agenta od nowa. Tam, gdzie nie da się otworzyć terminala, Plainva pokazuje polecenie do wykonania we własnym terminalu; potem wybierz **Spróbuj ponownie**. Plainva nie widzi niczego z logowania.

## W sesji

Wpisz, co agent ma zrobić. Otwarta notatka jest agentowi wskazywana — jej nazwa i położenie, nie jej tekst — chyba że usuniesz ją nad polem wpisywania; notatka trzymana z dala od chmury nigdy nie jest wskazywana. Sesja pokazuje, co mówi agent, jego plan i każdy z jego kroków, z plikami vaultu, które wymienia.

Gdy agent chce Twojej zgody na jakiś krok, pokazuje to **⟨agent⟩ pyta**. Słowa pochodzą od agenta, a do wyboru jest to, co agent oferuje — **Zezwól**, **Zawsze zezwalaj**, **Odrzuć**, **Zawsze odrzucaj**. Twoja odpowiedź trafia tylko do agenta: to, co zrobi po zgodzie, jest jego sprawą, a „zawsze” to obietnica, której dotrzymuje agent, nie Plainva.

**Zatrzymaj** kończy odpowiedź, nad którą agent pracuje.

## Co zapisuje agent

**Przez Plainva.** Zmiana, którą agent przekazuje Plainva, nigdy nie jest zapisywana w notatce. Gdy odpowiedź agenta jest gotowa, każda notatka, którą zmienił, ma jedną rundę propozycji, podpisaną **⟨nazwa⟩ (agent zewnętrzny)**: w sekcji **Propozycje** akceptujesz lub odrzucasz każdą zmianę albo całą rundę, tak jak przy rundzie od człowieka. Notatka, której jeszcze nie ma, pojawia się w sekcji **Nowe notatki od agenta**. **Utwórz** ją zapisuje — oznaczoną `generated`, z agentem jako autorem — a **Odrzuć** ją porzuca. Adresy internetowe przyniesione przez agenta są zapisywane tak, aby nic ich nie otwierało ani nie ładowało (`https[://]…`).

Plainva nie przyjmuje wszystkiego: tylko notatki Markdown, tylko ich tekst, a nie ich właściwości, żadnej notatki, która niesie reguły AI lub pola zaufania, niczego, co jest trzymane z dala od chmury, i nie więcej niż 150 zmian w jednej notatce naraz. O tym, czego nie przyjęła, mówi sesja, a agent się o tym dowiaduje.

**Samodzielnie.** Agent może też sam zapisywać pliki, jak każdy program. Gdy zgłosi taką zmianę, sesja mówi **Agent sam zmienił ⟨notatka⟩: zmiana jest w vaulcie bez propozycji.** Którą drogę wybierze agent, tego Plainva nie może obiecać: zależy to od agenta i od tego, jak jest skonfigurowany. W ustawieniach każdy agent pokazuje, co ostatnio zaobserwowano na tym komputerze — ile zmian przyszło przez Plainva, a ile zapisał sam.

## Co Plainva zachowuje

- **Na tym urządzeniu:** potwierdzone polecenie, Twoją nazwę agenta i to, co ostatnio zaobserwowano z jego zmian — we własnych danych Plainva, nigdy w vaulcie.
- **Dla vaultu:** **Ostatnie sesje w tym vaulcie** podaje, kiedy odbyła się sesja, z którym agentem oraz ile było wiadomości, zmian przez Plainva i zmian własnych — nigdy to, co zostało powiedziane.
- **Nie samą sesję:** to, co powiedzieliście Ty i agent, znika po zamknięciu sesji. To, co agent zachowuje po swojej stronie, jest sprawą agenta.

Jeśli program agenta zakończy się sam, sesja o tym mówi, a **Pokaż jego ostatnie wiersze** pokazuje koniec tego, co program wypisał.

## Ograniczenia

- Tylko na komputerze i tylko w głównym oknie. Na telefonie jest własny asystent Plainva.
- Nie w zaszyfrowanym obszarze roboczym.
- Jedna sesja naraz i bez historii: zakończonej sesji nie da się otworzyć ponownie.
- Własnych trybów, modeli i poleceń agenta nie da się wybrać z Plainva i nie można wysyłać mu obrazów.
- Jak dotąd wypróbowano to tylko z własnym agentem testowym Plainva. Którzy agenci tu działają i którzy przekazują swoje zmiany Plainva, okazuje się przy próbie — opinie są mile widziane.
