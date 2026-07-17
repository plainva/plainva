# Przechwytywanie e-maili

Stan na: 2026-07-18

Plainva może czytać Twoją skrzynkę pocztową — i tylko czytać — aby wydobyć wiedzę z e-maili do Twojego vaulta. To celowo **nie** jest klient pocztowy: połączenie odbywa się przez IMAP w trybie tylko do odczytu, w skrzynce nic się nie zmienia (nawet znaczniki nieprzeczytanych), a Plainva nigdy sam nie wysyła poczty.

## Łączenie skrzynki pocztowej

**Ustawienia → Vault → Kalendarz i konta → E-mail (IMAP, tylko do odczytu) → Dodaj konto…**: host, port i **hasło aplikacji**. Dla Gmaila to `imap.gmail.com`, port `993`, z hasłem aplikacji z [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (wymaga uwierzytelniania dwuskładnikowego) — bez OAuth, bez weryfikacji. Łączenie sprawdza logowanie, zanim cokolwiek zostanie zapisane; hasło trafia do pęku kluczy Twojego systemu operacyjnego. Ustawienie **Folder e-mail** określa, gdzie są przechowywane przechwycone e-maile (domyślnie `Mail`).

## Czytanie poczty

Otwórz kartę e-mail przez lewy pasek akcji (ikona koperty) lub paletę poleceń (**Otwórz e-mail**). Lista pokazuje Twoją skrzynkę odbiorczą od najnowszych (nieprzeczytane pogrubione, **Wczytaj więcej** doładowuje kolejne). Wybranie wiadomości otwiera ją w **przeglądarce w piaskownicy**:

- **Zdalna zawartość jest blokowana** — piksele śledzące, zdalne obrazy i moduły ładujące style są usuwane i liczone („Zablokowano zdalną zawartość (n)”). Wyświetlane są tylko samodzielnie osadzone obrazy inline.
- Linki są pokazywane jako zwykły tekst i nie są klikalne w przeglądarce.
- Skrypty i formularze nigdy się nie uruchamiają. Wiadomość jest renderowana w izolowanej ramce z restrykcyjną polityką treści.

Załączniki są wyświetlane z nazwą i rozmiarem; oryginalny plik `.eml` (poniżej) zawiera je w całości.

## Przenoszenie wiadomości do vaulta

Trzy przyciski przy każdej wiadomości:

- **Zapisz jako notatkę** — tworzy notatkę w folderze e-mail (`RRRR-MM-DD Temat.md`) z nadawcą i datą we frontmatter oraz tekstem wiadomości w postaci zwykłego tekstu pod nagłówkiem tematu. Przechwycenie tej samej wiadomości po raz drugi otwiera istniejącą notatkę zamiast ją duplikować.
- **+ .eml** — dodatkowo zapisuje surowy oryginał obok notatki i go linkuje. Plik `.eml` zawiera wszystko, łącznie z załącznikami, i otwiera się w dowolnym programie pocztowym.
- **→ Zadanie** — tworzy wpis w Twojej [domyślnej bazie zadań](Tasks.md) z tematem jako tytułem, dzisiejszą datą jako terminem i wstępnie ustawionym statusem otwarte.

## Wyprowadzanie treści — bez wysyłania

Plainva nigdy nie używa SMTP. Zamiast tego:

- **Odpowiedz jako notatka** (przy wiadomości): tworzy notatkę zaadresowaną do nadawcy (`to:` we frontmatter) z zacytowanym oryginałem — napisz swoją odpowiedź w Plainva.
- **Zapisz notatkę jako szkic w skrzynce** (paleta poleceń, przy dowolnej otwartej notatce): zapisuje notatkę jako **szkic we własnej skrzynce** przez IMAP — wybierz konto, odbiorcę i folder szkiców, a potem otwórz swój zwykły program pocztowy, sprawdź i wyślij stamtąd. Formatowanie jest zachowane.
- **Wyślij notatkę e-mailem (mailto)** (paleta poleceń): otwiera Twój domyślny program pocztowy z notatką jako zwykłym tekstem (długie notatki są skracane).
- **Kopiuj notatkę jako tekst e-maila** (paleta poleceń): umieszcza notatkę w schowku z formatowaniem — wklej ją w dowolnym edytorze wiadomości.
