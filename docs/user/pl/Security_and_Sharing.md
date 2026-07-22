# Bezpieczeństwo i udostępnianie

Ostatni przegląd: 2026-07-22

Plainva pozostawia vault jako czytelne pliki na urządzeniu, a kopię w chmurze zapisuje jako nieprzezroczyste szyfrowane obiekty. Po połączeniu konta otwórz **Ustawienia → vault → Bezpieczeństwo i udostępnianie**.

## Konfiguracja

1. Wybierz nazwy właściciela i urządzenia. Klucze pozostają w systemowym magazynie albo, gdy go brak, pod lokalnym hasłem.
2. Zapisz plik `.pvrecovery`, przechowuj kod osobno i wpisz dwie wskazane grupy. Do odzyskania potrzebne są oba elementy; żaden nie zawiera danych chmury.
3. Aktywuj workspace. Plainva publikuje podpisaną politykę i szyfruje wszystkie pliki do `.pvws/`. Lokalny vault pozostaje czytelny, a migracja wznawia się po przerwach.

Stary tekst jawny pozostaje obok `.pvws/` podczas migracji. Można go jawnie usunąć dopiero przy stanie **Chroniony**; pliki lokalne nie są usuwane.

Zmiany offline pozostają w trwałej kolejce. Usunięcia wymagają podpisanych tombstone, a równoległe zmiany są zachowane jako kopie `.CONFLICT-…`.

## Urządzenia i odzyskiwanie

Nowe urządzenie mobilne tworzy żądanie QR/kodu. Wpisz krótki kod na zatwierdzonym komputerze i porównaj odciski przed potwierdzeniem. Usunięte urządzenie nie może podpisywać nowych zmian. Po utracie wszystkich urządzeń **Odzyskaj dostęp** tworzy nowe urządzenie właściciela z pliku `.pvrecovery` i osobnego kodu bez przepisywania treści. **Odnów odzyskiwanie** kotwiczy nową, podwójnie podpisaną tożsamość i unieważnia stary zestaw.

## Członkowie, role i slices

Właściciele i administratorzy mogą zapraszać członków, tworzyć grupy i ograniczać rolę do całego workspace, slice lub jednego obiektu. Editor edytuje, Commenter komentuje, Reader tylko czyta, a Contributor tylko tworzy w przydzielonym zakresie. Kontrola następuje przed zapisem lokalnym i ponownie przed podpisaniem, także dla importu, odzyskiwania, automatyzacji i działań AI.

Slice obejmuje folder, wybór lub regułę dynamiczną po ścieżce, typie, tagach i właściwościach. Zawsze użyj **Podgląd** przed publikacją. Nieuprawnione obiekty nie są materializowane ani dodawane do wyszukiwania, grafu lub podglądu.

## Komentarze, wersje i kwarantanna

Komentarze i znaczniki rozwiązania są szyfrowane i podpisane. **Historia wersji** czyta szyfrowane rewizje i przywraca wersję jako nową podpisaną zmianę lub kopię. Nieprawidłowy artefakt zdalny trafia do **Integralność i lokalne forki**: ponów, wyeksportuj ciphertext, oznacz naprawiony lub zignoruj. Nie blokuje pozostałej synchronizacji, a zdalny brak nigdy nie oznacza usunięcia.
