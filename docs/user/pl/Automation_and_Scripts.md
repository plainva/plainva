# Automatyzacja i skrypty

Stan na: 2026-07-15

Plainva nie ma systemu wtyczek, który uruchamiałby cudzy kod. Zamiast tego interfejsem rozszerzeń jest sam vault: Twoje notatki to zwykły Markdown, bazy danych to zwykły YAML (`.base`), a [konwencje OKF](OKF.md) nadają każdemu plikowi przewidywalną strukturę. Wszystko, co potrafi czytać i zapisywać pliki — skrypt powłoki, program w Pythonie, narzędzie CLI, zaplanowane zadanie czy agent AI — może rozszerzać, generować lub reorganizować Twój vault bez żadnego API specyficznego dla Plainva.

Ta strona wyjaśnia, jak robić to **bezpiecznie**. Dokładny format każdego pliku na poziomie bajtów jest udokumentowany osobno w [Dokumentacji formatu plików](File_Format_Reference.md); ta strona jest praktycznym uzupełnieniem: zasady, przebieg pracy i to, co przekazać asystentowi AI.

## Dlaczego pliki zamiast piaskownicy wtyczek

- **Bezpieczeństwo.** System wtyczek z kodem oznacza uruchomienie cudzego programu wewnątrz Twojego edytora, z dostępem do Twoich notatek. Zwykłe pliki nie wymagają takiego zaufania: skrypt dotyka tylko folderu, na który go wskażesz, z normalnymi uprawnieniami Twojego systemu operacyjnego.
- **Trwałość.** Format przeżywa aplikację. Plik Markdown wygenerowany skryptem pięć lat temu wciąż otwiera się dziś — w Plainva, w Obsidian, w dowolnym edytorze tekstu. Nie ma żadnego API wtyczek, które mogłoby zostać wycofane.
- **Format jest kontraktem.** Ponieważ format na dysku jest otwarty i udokumentowany, „API” jest stabilne i możliwe do zbadania. Możesz je porównywać (diff), wersjonować w Git i analizować.

Jeśli chcesz czegoś, czego Plainva nie robi od razu po wyjęciu z pudełka, nie czekasz na wtyczkę — piszesz mały skrypt działający na plikach.

## Bezpieczne odczytywanie vaultu

Wszystko to tekst UTF-8:

- **Notatki (`.md`)** — opcjonalny blok frontmatter YAML (między dwiema liniami `---` na samej górze) zawiera właściwości; po nim następuje treść Markdown. Sparsuj frontmatter dowolną biblioteką YAML.
- **Bazy danych (`.base`)** — zwykły YAML opisujący widoki na notatki. *Wartości* nigdy nie znajdują się w `.base` — mieszkają we frontmatter notatek.
- **Struktura** — tagi to `#tag` w treści lub `tags:` we frontmatter; linki to `[[Note]]` (linki wiki) lub `[text](path.md)`. Zadania to elementy listy `- [ ]` / `- [x]`.

Odczyt nigdy nie wymaga ostrożności — plików tekstowych nie da się „uszkodzić” przez samo ich czytanie. Poniższe zasady dotyczą wyłącznie *zapisu*.

## Bezpieczne zapisywanie do vaultu

Trzymaj się tych zasad, a Plainva (i Obsidian) przyjmą Twoje zmiany bez problemów. Plainva obserwuje folder vaultu: zewnętrzny zapis jest wykrywany i automatycznie ponownie indeksowany, zwykle w ciągu sekundy.

1. **Zapisuj UTF-8 bez BOM, z zakończeniami linii LF.** Narzędzia Windows, które domyślnie używają UTF-16 lub CRLF, tworzą pliki, które Plainva traktuje jako zmienione przy każdej synchronizacji.
2. **Zapisuj atomowo.** Zapisz do pliku tymczasowego w tym samym folderze, a następnie zmień jego nazwę na docelową (rename). Notatka zapisana w połowie (na przykład po awarii) jest gorsza niż brak zmiany. Sama Plainva zapisuje w ten sposób każdą notatkę.
3. **Zachowaj frontmatter OKF i nieznane klucze.** Podczas przepisywania notatki zachowaj `type` i `okf_version`, a kluczy frontmatter, których nie rozpoznajesz, nigdy nie usuwaj — muszą przetrwać cykl odczytu/zapisu bez zmian. Nie „porządkuj” kluczy, których nie rozumiesz.
4. **Nigdy nie dotykaj `.plainva/`.** Ten folder przechowuje lokalny na urządzeniu indeks Plainva, kopie zapasowe, przypięcia grafu i stan synchronizacji. Nie jest częścią Twojej treści — Twoje skrypty nigdy nie powinny do niego zapisywać, synchronizować go ani dodawać do commitów Git.
5. **Przestrzegaj zasad `.base`.** Plik `.base` używa tylko czterech kluczy najwyższego poziomu Obsidian (`filters`, `formulas`, `properties`, `views`); każdy widok potrzebuje `name`; filtry są jednokorzeniowe. Wszystkie dane specyficzne dla Plainva znajdują się pod zagnieżdżonymi podkluczami `plainva:`. Pełny kontrakt, wraz z przykładem dwustronnych relacji, znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md#databases-base).
6. **Nie walcz z edytorem.** Jeśli notatka jest otwarta *i* ma niezapisane zmiany w Plainva, lepiej nie przepisywać jej w tym samym momencie ze skryptu. Plainva ma mechanizm rozwiązywania konfliktów jako siatkę bezpieczeństwa, ale najczystszą drogą jest pozwolić aplikacji zapisać jako pierwszej (albo edytować notatki, które akurat nie są otwarte).

## Wzorce

Kilka typowych zadań — wszystkie to zwykłe operacje na plikach:

- **Masowe tworzenie notatek** — generuj pliki `.md` z blokiem frontmatter OKF (`type`, `okf_version` oraz własnymi właściwościami) i treścią Markdown. Plainva indeksuje je w miarę pojawiania się.
- **Generatory notatek dziennych lub raportów** — zaplanowany skrypt, który zapisuje datowaną notatkę w Twoim folderze notatek dziennych, wypełnioną danymi z innego źródła.
- **Przeglądy właściwości** — odczytaj frontmatter każdej notatki, przekształć pole, zapisz z powrotem (atomowo, zachowując nieznane klucze).
- **Eksport / publikacja** — odczytaj vault i wyrenderuj go do HTML, statycznej strony lub PDF. Tylko odczyt — bez zasad, o które trzeba dbać.
- **Utrzymanie linków** — przeskanuj ponownie linki `[[Note]]` i `tags:`, a następnie wygeneruj raport lub napraw je na miejscu.

Tam, gdzie to możliwe, twórz skrypty idempotentne: dwukrotne uruchomienie nie powinno duplikować treści.

## Przekazywanie vaultu asystentowi AI

Agent AI z dostępem do odczytu i zapisu folderu vaultu to dokładnie ten przypadek, dla którego powstał ten projekt. Aby działał poprawnie:

1. **Podaj mu [Dokumentację formatu plików](File_Format_Reference.md).** Jest napisana z myślą o czytelniku maszynowym: kontrakt frontmatter OKF, serializacja właściwość→YAML, pełny schemat `.base` wraz z twardymi zasadami Obsidian, kontrakt `index.md` oraz zasady bezpieczeństwa — wszystko, czego agent potrzebuje, aby edytować pliki bez ich psucia.
2. **Wskaż mu folder vaultu, nie folder `.plainva/`.** Jasno określ, że `.plainva/` jest niedostępny.
3. **Proś o atomowe, minimalne edycje.** Agent, który przepisuje całą notatkę, aby zmienić jedną właściwość, powinien zachować resztę frontmatter i treści dosłownie bez zmian.

Ponieważ kontrakt jest dokumentem, a nie żywym API, te same instrukcje działają z każdym asystentem, offline czy online.

## Podsumowanie zasad bezpieczeństwa

- UTF-8, bez BOM, LF.
- Zapisuj atomowo (plik tymczasowy + rename).
- Zachowaj `type`, `okf_version` i nieznane klucze.
- Nigdy nie zapisuj do `.plainva/`.
- `.base`: cztery klucze najwyższego poziomu, nazwane widoki, jednokorzeniowe filtry, podklucze `plainva:` na wszystko inne.
- Vault jest obserwowany — zewnętrzne zmiany pojawiają się w Plainva automatycznie.

## Zobacz też

- [Dokumentacja formatu plików](File_Format_Reference.md) — dokładny format każdego pliku na dysku
- [OKF](OKF.md) — Open Knowledge Format, który nadaje plikom przewidywalną strukturę
- [Bazy danych (.base)](Databases_Base.md) — jak działają widoki `.base`
