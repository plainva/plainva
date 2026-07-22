# Bezpieczeństwo i udostępnianie

Ostatni przegląd: 2026-07-22

Plainva pozostawia vault jako czytelne pliki na urządzeniu, a kopię w chmurze zapisuje jako nieprzezroczyste szyfrowane obiekty. Po połączeniu konta otwórz **Ustawienia → vault → Bezpieczeństwo i udostępnianie**.

## Konfiguracja

1. Wybierz nazwy właściciela i urządzenia. Klucze pozostają w systemowym magazynie albo, gdy go brak, pod lokalnym hasłem.
2. Zapisz plik `.pvrecovery`, przechowuj kod osobno i wpisz dwie wskazane grupy. Do odzyskania potrzebne są oba elementy; żaden nie zawiera danych chmury.
3. Aktywuj workspace. Plainva publikuje podpisaną politykę i szyfruje wszystkie pliki do `.pvws/`. Lokalny vault pozostaje czytelny, a migracja wznawia się po przerwach.

Stary tekst jawny pozostaje obok `.pvws/` podczas migracji. Można go jawnie usunąć dopiero przy stanie **Chroniony**; pliki lokalne nie są usuwane.

Zmiany offline pozostają w trwałej kolejce. Usunięcia wymagają podpisanych tombstone, a równoległe zmiany są zachowane jako kopie `.CONFLICT-…`. Dodatkowe urządzenia, odzyskiwanie, zespoły i slices pojawią się później.
