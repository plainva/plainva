# Bezpieczeństwo i udostępnianie

## Centrum bezpieczeństwa, ponowne szyfrowanie i publikowane slices

**Bezpieczeństwo i udostępnianie** ma dwa poziomy. **Przegląd** (pierwszy poziom) pokazuje stan ochrony, **Zakończ migrację**, gdy pozostają resztki tekstu jawnego, **Usuń połączenie z zaszyfrowaną chmurą** oraz dwie karty otwierające drugi poziom — **Urządzenia i odzyskiwanie** i **Udostępnij innym**. Na drugim poziomie nawigacja po obszarach zastępuje lewą kolumnę ustawień, pogrupowana w **Twój dostęp** (Urządzenia, odzyskiwanie) i **Udostępnianie** (Członkowie, grupy, wycinki, publikacje); **‹ Przegląd** wraca do pierwszego poziomu. Widoczne akcje pozostają dostępne: akcja otwiera wymagany vault, połączenie, konfigurację lub odblokowanie. Cofnięcie dostępu może uruchomić wznawialne pełne szyfrowanie. Vault Slice tworzysz przez **Szczegóły → Zawartość → Uprawnienia → Przegląd**. Publikacje zewnętrzne są osobnym szyfrowanym workspace, a projekcja usuwa prywatne właściwości, wykluczone linki i osadzenia. Wydanie publiczne wymaga niezależnego audytu i testów Android/iOS na urządzeniach.

Ostatni przegląd: 2026-07-23

Plainva pozostawia vault jako czytelne pliki na urządzeniu, a kopię w chmurze zapisuje jako nieprzezroczyste szyfrowane obiekty. Po połączeniu konta otwórz **Ustawienia → vault → Bezpieczeństwo i udostępnianie**.

## Konfiguracja

1. Wybierz nazwy właściciela i urządzenia. Klucze pozostają w systemowym magazynie albo, gdy go brak, pod lokalnym hasłem.
2. Zapisz plik `.pvrecovery` i przechowuj wyświetlony kod osobno. Każdy blok ma widoczny numer grupy; wpisz wartości dwóch wyróżnionych grup, aby potwierdzić czytelność kopii. Do odzyskania potrzebne są oba elementy; żaden nie zawiera danych chmury.
3. Aktywuj workspace. Plainva publikuje podpisaną politykę i szyfruje wszystkie pliki do `.pvws/`. Lokalny vault pozostaje czytelny, a migracja wznawia się po przerwach.

Stary tekst jawny pozostaje obok `.pvws/` podczas migracji. Można go jawnie usunąć dopiero przy stanie **Chroniony**; pliki lokalne nie są usuwane.

Zmiany offline pozostają w trwałej kolejce. Usunięcia wymagają podpisanych tombstone, a równoległe zmiany są zachowane jako kopie `.CONFLICT-…`.

## Urządzenia i odzyskiwanie

Aby dodać **własne** drugie urządzenie, otwórz **Urządzenia i odzyskiwanie → Urządzenia → Dodaj kolejne urządzenie**: Plainva pokazuje kod zaproszenia powiązany z Twoim własnym członkostwem — **nie** tworzy nowego członka. Wklej go na drugim urządzeniu (**Bezpieczeństwo i udostępnianie → dołącz**) i zatwierdź na urządzeniu, które już należy; najpierw porównaj odcisk na obu urządzeniach. Aby zamiast tego dołączyć inną osobę, użyj **Udostępnij innym → Członkowie → Zaproś osobę** (patrz niżej). Usunięte urządzenie nie może podpisywać nowych ważnych zmian. Zaproszenie i prośba o sparowanie dołączającego urządzenia są też pokazywane jako skanowalne kody QR — na urządzeniu mobilnym **Zeskanuj zaproszenie** odczytuje kod aparatem zamiast wklejać tekst.

Odzyskiwanie znajduje się w **Urządzenia i odzyskiwanie → Odzyskiwanie**, podzielone na **Bieżący stan** (czy zapisano pakiet odzyskiwania oraz odcisk workspace) i **Proces odzyskiwania**. Jeśli utracisz wszystkie urządzenia, wybierz tam **Odzyskaj dostęp** i otwórz plik `.pvrecovery` osobno przechowywanym kodem; Plainva tworzy nowe urządzenie właściciela, może unieważnić utracone urządzenia i nie przepisuje obiektów treści. **Odnów odzyskiwanie** zastępuje stary zestaw odzyskiwania za pomocą podwójnie podpisanego łańcucha kotwiczącego. Zapisz nowy plik i kod ponownie osobno; stary zestaw jest potem nieważny.

## Członkowie, role i slices

Właściciele i administratorzy mogą zapraszać członków, tworzyć grupy i ograniczać rolę do całego workspace, slice lub jednego obiektu. Editor edytuje, Commenter komentuje, Reader tylko czyta, a Contributor tylko tworzy w przydzielonym zakresie. Kontrola następuje przed zapisem lokalnym i ponownie przed podpisaniem, także dla importu, odzyskiwania, automatyzacji i działań AI.

Slice obejmuje folder, wybór lub regułę dynamiczną po ścieżce, typie, tagach i właściwościach. Zawsze użyj **Podgląd** przed publikacją. Nieuprawnione obiekty nie są materializowane ani dodawane do wyszukiwania, grafu lub podglądu.

## Komentarze, wersje i kwarantanna

Komentarze i znaczniki rozwiązania są szyfrowane i podpisane. **Historia wersji** czyta szyfrowane rewizje i przywraca wersję jako nową podpisaną zmianę lub kopię. Nieprawidłowy artefakt zdalny trafia do **Integralność i lokalne forki**: ponów, wyeksportuj ciphertext, oznacz naprawiony lub zignoruj. Nie blokuje pozostałej synchronizacji, a zdalny brak nigdy nie oznacza usunięcia.

## Prawidłowe usuwanie zaszyfrowanego vaulta

Gdy nie potrzebujesz już zaszyfrowanego vaulta, wycofaj go w Plainva **zanim** usuniesz folder w chmurze. Kolejność ma znaczenie: zabezpieczenie fail-closed utrzymuje synchronizację zatrzymaną, jeśli kopia w chmurze zniknie, gdy Plainva wciąż oczekuje zaszyfrowanego połączenia — chroni Cię to przed napastnikiem, który zdejmuje szyfrowanie, aby wymusić tekst jawny.

1. Otwórz **Ustawienia → vault → Security & Sharing**.
2. W przeglądzie, na karcie **Szyfrowanie**, wybierz **Usuń połączenie z zaszyfrowaną chmurą**. Plainva usuwa lokalne klucze i dane workspace na tym urządzeniu i ponownie otwiera vault jako zwykły vault. (Jest to działanie lokalne dla urządzenia; globalne "zniesienie szyfrowania", które przepisuje także kopię w chmurze z powrotem na tekst jawny, to osobne działanie dodane później.)
3. Dopiero teraz usuń folder w chmurze (obiekty `.pvws/`) u swojego dostawcy, jeśli chcesz się go pozbyć. Plainva nie usuwa za Ciebie zaszyfrowanych obiektów w chmurze.

Jeśli kopię w chmurze już usunięto i synchronizacja kończy się teraz błędem "brak workspace" lub "brak manifestu", rozwiązaniem jest ten sam reset, oferowany tam, gdzie pojawia się błąd:

- W przypadku zaszyfrowanego **workspace** otwórz **Security & Sharing**. Status pokazuje błąd z notatką o odzyskiwaniu; na karcie **Szyfrowanie** wybierz **Usuń połączenie z zaszyfrowaną chmurą**, aby zresetować workspace na tym urządzeniu i przywrócić działanie synchronizacji.
- W przypadku **połączenia synchronizacji** z szyfrowaną treścią kliknij status synchronizacji, aby otworzyć okno błędu synchronizacji, i wybierz **Zresetuj szyfrowanie**. Ten przycisk pojawia się tylko wtedy, gdy zdalne dane szyfrowania są brakujące lub nieprawidłowe.

Obie akcje są jawne i potwierdzane. Plainva nigdy po cichu nie obniża zaszyfrowanego połączenia do tekstu jawnego i żadna z akcji nie usuwa plików lokalnych. Jeśli w chmurze wciąż znajduje się zaszyfrowana treść, której naprawdę chcesz, zamiast tego anuluj — reset wznowiłby synchronizację w tekście jawnym.

Usunięcie vaulta za pomocą **Zapomnij dane aplikacji** (Splash → usuń vault → zapomnij także dane aplikacji) czyści również te znaczniki szyfrowania, więc vault usunięty w ten sposób nie pozostawia niczego, co mogłoby zablokować późniejsze ponowne połączenie.
