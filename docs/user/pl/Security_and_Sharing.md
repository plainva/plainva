# Bezpieczeństwo i udostępnianie

> **Eksperymentalne — jeszcze nie zweryfikowane niezależnie.** Zaszyfrowane workspace'y są udostępniane jako wersja zapoznawcza. Projekt kryptograficzny nie został jeszcze poddany niezależnemu audytowi, a testy na dwóch urządzeniach na prawdziwym sprzęcie z Androidem i iOS wciąż trwają. Wypróbuj tę funkcję, ale zachowaj kopię zapasową wszystkiego, czego nie możesz stracić, i nie polegaj na niej jeszcze w przypadku materiałów, które naprawdę muszą być chronione.

## Centrum bezpieczeństwa, ponowne szyfrowanie i publikowane slices

**Bezpieczeństwo i udostępnianie** ma dwa poziomy. **Przegląd** (pierwszy poziom) pokazuje stan ochrony, **Zakończ migrację**, gdy pozostają resztki tekstu jawnego, **Usuń połączenie z zaszyfrowaną chmurą** oraz dwie karty otwierające drugi poziom — **Urządzenia i odzyskiwanie** i **Udostępnij innym**. Na drugim poziomie nawigacja po obszarach zastępuje lewą kolumnę ustawień, pogrupowana w **Twój dostęp** (Urządzenia, odzyskiwanie) i **Udostępnianie** (Członkowie, grupy, wycinki, publikacje); **‹ Przegląd** wraca do pierwszego poziomu. Widoczne akcje pozostają dostępne: akcja otwiera wymagany vault, połączenie, konfigurację lub odblokowanie. Cofnięcie dostępu może uruchomić wznawialne pełne szyfrowanie. Vault Slice tworzysz przez **Szczegóły → Zawartość → Uprawnienia → Przegląd**. Publikacje zewnętrzne są osobnym szyfrowanym workspace, a projekcja usuwa prywatne właściwości, wykluczone linki i osadzenia. Wydanie publiczne wymaga niezależnego audytu i testów Android/iOS na urządzeniach.

Ostatni przegląd: 2026-08-20

Plainva pozostawia vault jako czytelne pliki na urządzeniu, a kopię w chmurze zapisuje jako nieprzezroczyste szyfrowane obiekty. Po połączeniu konta otwórz **Ustawienia → vault → Bezpieczeństwo i udostępnianie**.

Na telefonie sekcja najpierw podaje rzeczywisty stan tego sejfu: **Tylko na tym urządzeniu** bez połączenia z chmurą, **To połączenie nie jest zaszyfrowane** przy zwykłym sejfie w chmurze — **Skonfiguruj szyfrowanie** przeprowadza tam te same trzy kroki co na komputerze (tożsamość → plik odzyskiwania i kod → aktywacja z wznawialnym postępem) — albo kroki dołączania, gdy w połączeniu znajduje się zaszyfrowany obszar roboczy.

## Konfiguracja

1. Wybierz nazwy właściciela i urządzenia. Klucze pozostają w systemowym magazynie albo, gdy go brak, pod lokalnym hasłem.
2. Zapisz plik `.pvrecovery` i przechowuj wyświetlony kod osobno. Każdy blok ma widoczny numer grupy; wpisz wartości dwóch wyróżnionych grup, aby potwierdzić czytelność kopii. Do odzyskania potrzebne są oba elementy; żaden nie zawiera danych chmury.
3. Aktywuj workspace. Plainva publikuje podpisaną politykę i szyfruje wszystkie pliki do `.pvws/`. Lokalny vault pozostaje czytelny, a migracja wznawia się po przerwach.

Stary tekst jawny pozostaje obok `.pvws/` podczas migracji. Można go jawnie usunąć dopiero przy stanie **Chroniony**; pliki lokalne nie są usuwane.

Zmiany offline pozostają w trwałej kolejce. Usunięcia wymagają podpisanych tombstone, a równoległe zmiany są zachowane jako kopie `.CONFLICT-…`.

## W codziennej pracy

Zmiany wprowadzone offline pozostają w trwałej kolejce. Każda zmiana jest podpisana; samo usunięcie po stronie zdalnej nigdy nie kasuje pliku lokalnego, ale podpisany nagrobek już tak. Równoległe zmiany offline są zachowywane jako kopie `.CONFLICT-…`. **Zablokuj** usuwa klucze workspace’u z bieżącej sesji; **Odblokuj** korzysta z pęku kluczy systemu lub lokalnego hasła.

## Urządzenia i odzyskiwanie

Aby dodać **własne** drugie urządzenie, otwórz **Urządzenia i odzyskiwanie → Urządzenia → Dodaj kolejne urządzenie**: Plainva pokazuje kod zaproszenia powiązany z Twoim własnym członkostwem — **nie** tworzy nowego członka. Wklej go na drugim urządzeniu (**Bezpieczeństwo i udostępnianie → dołącz**) i zatwierdź na urządzeniu, które już należy; najpierw porównaj odcisk na obu urządzeniach. Aby zamiast tego dołączyć inną osobę, użyj **Udostępnij innym → Członkowie → Zaproś osobę** (patrz niżej). Usunięte urządzenie nie może podpisywać nowych ważnych zmian. Zaproszenie i prośba o sparowanie dołączającego urządzenia są też pokazywane jako skanowalne kody QR — na urządzeniu mobilnym **Zeskanuj zaproszenie** odczytuje kod aparatem zamiast wklejać tekst.

Usunięcie urządzenia lub członka wiąże się z dwoma możliwymi kosztami, a telefon oferuje oba. **Tylko na przyszłość** natychmiast kończy dostęp do nowych kluczy i działa szybko. **Zaszyfruj wszystko na nowo** przepisuje też wszystko, co jest już zaszyfrowane; to długa praca, trwa w tle i wznawia się sama po ponownym uruchomieniu — karta stanu liczy w tym czasie obiekty. Żadna z opcji nie może cofnąć tego, co druga strona już pobrała, dlatego pytanie mówi o tym, zanim dokonasz wyboru. Nigdy nie możesz usunąć urządzenia, które akurat trzymasz w ręku: zablokowałoby to dostęp z tego urządzenia, zostawiając Ci tylko pakiet odzyskiwania.

Odzyskiwanie znajduje się w **Urządzenia i odzyskiwanie → Odzyskiwanie**, podzielone na **Bieżący stan** (czy zapisano pakiet odzyskiwania oraz odcisk workspace) i **Proces odzyskiwania**. Jeśli utracisz wszystkie urządzenia, wybierz tam **Odzyskaj dostęp** i otwórz plik `.pvrecovery` osobno przechowywanym kodem; Plainva tworzy nowe urządzenie właściciela, może unieważnić utracone urządzenia i nie przepisuje obiektów treści. **Odnów odzyskiwanie** zastępuje stary zestaw odzyskiwania za pomocą podwójnie podpisanego łańcucha kotwiczącego. Zapisz nowy plik i kod ponownie osobno; stary zestaw jest potem nieważny. Plainva pyta wcześniej, bo plik, który masz w ręku, przestaje w tym momencie działać.

## Członkowie, role i slices

Właściciele i administratorzy mogą zapraszać członków, tworzyć grupy i ograniczać rolę do całego workspace, slice lub jednego obiektu. Editor edytuje, Commenter komentuje, Reader tylko czyta, a Contributor tylko tworzy w przydzielonym zakresie. Kontrola następuje przed zapisem lokalnym i ponownie przed podpisaniem, także dla importu, odzyskiwania, automatyzacji i działań AI.

Własność może przejść na innego aktywnego członka. Otwórz **Udostępnij innym → Członkowie** (na telefonie: sekcja **Team**) i wybierz **Przekaż własność** przy tej osobie. Potrzebny jest do tego bieżący plik odzyskiwania i jego kod, ponieważ własność i zestaw odzyskiwania przemieszczają się razem: Plainva najpierw tworzy zastępczy pakiet odzyskiwania i przekazuje go dopiero po tym, jak go zapiszesz. Przekaż ten plik i nowy kod nowemu właścicielowi osobnymi kanałami — Ty zostajesz Adminem, a ta osoba jest potem jedynym Ownerem.

Slice obejmuje folder, wybór lub regułę dynamiczną po ścieżce, typie, tagach i właściwościach. Zawsze użyj **Podgląd** przed publikacją. Nieuprawnione obiekty nie są materializowane ani dodawane do wyszukiwania, grafu lub podglądu.

## Komentarze, wersje i kwarantanna

Komentarze i znaczniki rozwiązania są szyfrowane i podpisane. **Historia wersji** czyta szyfrowane rewizje i przywraca wersję jako nową podpisaną zmianę lub kopię. Nieprawidłowy artefakt zdalny trafia do **Integralność i lokalne forki**: ponów, wyeksportuj ciphertext, oznacz naprawiony lub zignoruj. Nie blokuje pozostałej synchronizacji, a zdalny brak nigdy nie oznacza usunięcia.

## Prawidłowe usuwanie zaszyfrowanego vaulta

Gdy nie potrzebujesz już zaszyfrowanego vaulta, wycofaj go w Plainva **zanim** usuniesz folder w chmurze. Kolejność ma znaczenie: zabezpieczenie fail-closed utrzymuje synchronizację zatrzymaną, jeśli kopia w chmurze zniknie, gdy Plainva wciąż oczekuje zaszyfrowanego połączenia — chroni Cię to przed napastnikiem, który zdejmuje szyfrowanie, aby wymusić tekst jawny.

1. Otwórz **Ustawienia → vault → Security & Sharing**.
2. W przeglądzie, na karcie **Szyfrowanie**, wybierz **Usuń połączenie z zaszyfrowaną chmurą**. Plainva usuwa lokalne klucze i dane workspace na tym urządzeniu i ponownie otwiera vault jako zwykły vault. (To działanie dotyczy tylko tego urządzenia: kopia w chmurze pozostaje zaszyfrowana. Jeśli chcesz ją z powrotem jako tekst jawny, służy do tego **Zniesienie szyfrowania** — zobacz akapit poniżej.)
3. Dopiero teraz usuń folder w chmurze (obiekty `.pvws/`) u swojego dostawcy, jeśli chcesz się go pozbyć. Plainva nie usuwa za Ciebie zaszyfrowanych obiektów w chmurze.

Na telefonie ten sam krok znajduje się w tym samym miejscu, z jedną różnicą: potwierdzasz go, wpisując nazwę vaulta. Reszta jest identyczna — lokalne klucze i dane workspace znikają, vault otwiera się ponownie jako zwykły vault, a zaszyfrowane obiekty w chmurze pozostają, dopóki sam ich nie usuniesz. Działa to bez połączenia, bo nic w tym nie jest zdalne.

Aby zamiast tego **całkowicie zdjąć szyfrowanie i zachować vault w chmurze jako zwykłe pliki**, wybierz **Zdejmij szyfrowanie** na tej samej karcie **Szyfrowanie**: Plainva ponownie otwiera vault jako zwykły vault w chmurze i ponownie przesyła wszystkie Twoje notatki do tej samej chmury jako pliki tekstem jawnym, a następnie przestaje szyfrować. Pliki lokalne nigdy nie są zmieniane i nic nie jest usuwane; stary zaszyfrowany folder `.pvws/` pozostaje, dopóki nie usuniesz go u swojego dostawcy (Plainva nie może usunąć za Ciebie tych niezmiennych obiektów). Najpierw potwierdź ostrzeżenie — notatki opuszczają zaszyfrowany magazyn jako tekst jawny.

Jeśli kopię w chmurze już usunięto i synchronizacja kończy się teraz błędem "brak workspace" lub "brak manifestu", rozwiązaniem jest ten sam reset, oferowany tam, gdzie pojawia się błąd:

- W przypadku zaszyfrowanego **workspace** otwórz **Security & Sharing**. Status pokazuje błąd z notatką o odzyskiwaniu; na karcie **Szyfrowanie** wybierz **Usuń połączenie z zaszyfrowaną chmurą**, aby zresetować workspace na tym urządzeniu i przywrócić działanie synchronizacji.
- W przypadku **połączenia synchronizacji** z szyfrowaną treścią kliknij status synchronizacji, aby otworzyć okno błędu synchronizacji, i wybierz **Zresetuj szyfrowanie**. Ten przycisk pojawia się tylko wtedy, gdy zdalne dane szyfrowania są brakujące lub nieprawidłowe.

Obie akcje są jawne i potwierdzane. Plainva nigdy po cichu nie obniża zaszyfrowanego połączenia do tekstu jawnego i żadna z akcji nie usuwa plików lokalnych. Jeśli w chmurze wciąż znajduje się zaszyfrowana treść, której naprawdę chcesz, zamiast tego anuluj — reset wznowiłby synchronizację w tekście jawnym.

Usunięcie vaulta za pomocą **Zapomnij dane aplikacji** (Splash → usuń vault → zapomnij także dane aplikacji) czyści również te znaczniki szyfrowania, więc vault usunięty w ten sposób nie pozostawia niczego, co mogłoby zablokować późniejsze ponowne połączenie.
