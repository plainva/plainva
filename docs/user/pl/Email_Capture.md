# Przechwytywanie e-maili

Stan na: 2026-07-20

Plainva może czytać Twoją skrzynkę pocztową, aby wydobyć wiedzę z e-maili do Twojego vaulta — a od wersji 0.4.0 także pisać i wysyłać wiadomości. Nacisk pozostaje na **przechwytywaniu** wiadomości jako notatek; skrzynka połączona przez **IMAP** jest do przechwytywania wyłącznie odczytywana (nic się w niej nie zmienia, nawet znaczniki nieprzeczytanych), o ile nie skonfigurujesz wysyłania.

> **Eksperymentalne.** Klient pocztowy komunikuje się z prawdziwymi zewnętrznymi kontami (IMAP/SMTP oraz Microsoft), których nie da się przećwiczyć w automatycznych testach Plainva. Działa i jest używany codziennie, ale traktuj go jako wersję zapoznawczą: zachowaj kopię zapasową i zgłaszaj, proszę, wszystko, co wygląda nietypowo.

## Łączenie skrzynki pocztowej

**Ustawienia → Twój vault → Konta w chmurze → Połącz konto…** i wybierz dostawcę:

- **Microsoft** — dla Outlook.com i Microsoft 365: w kroku wyboru usług zaznacz **E-mail** (na życzenie razem z **Pliki** i **Kalendarz i zadania** — jedno konto, jedno logowanie) i zaloguj się bezpośrednio w przeglądarce, całkowicie bez hasła aplikacji i bez IMAP. Plainva korzysta w tym celu z centralnej rejestracji aplikacji Plainva (własny identyfikator aplikacji możesz opcjonalnie podać w szczegółach konta). Czytanie skrzynki, przechwytywanie i **bezpośrednie wysyłanie** odbywają się przez logowanie Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — dedykowane kafelki: adres e-mail plus **hasło aplikacji**, serwery są już wypełnione (przy większości tych kafelków w tym samym kroku można też zaznaczyć **Kalendarz i zadania** — jedno hasło aplikacji dla wszystkich wybranych usług). Asystent za każdym razem linkuje oficjalną instrukcję dostawcy dotyczącą tworzenia hasła aplikacji.
- **Serwer e-mail (IMAP)** — dla wszystkich innych dostawców: host, port i hasło lub **hasło aplikacji**. Gotowe ustawienia wstępne obejmują dostawców z całego świata — od **web.de**/**GMX** i **T-Online**, przez **Orange**, **Libero**, **WP**, **Seznam** i **Comcast**, po **QQ Mail**, **NetEase**, **Naver** i **Yahoo! JAPAN**; lista **Dostawca** ma do tego linię wyszukiwania, a wpisanie adresu automatycznie wybiera pasujące ustawienie wstępne. Tam, gdzie dostawca ma swoje osobliwości, asystent informuje o tym tuż pod formularzem: niektórzy wymagają **hasła aplikacji** lub **kodu autoryzacyjnego** zamiast hasła konta, u innych trzeba najpierw włączyć IMAP w ustawieniach dostawcy — zawsze z linkiem do oficjalnej instrukcji. Dla Gmaila to `imap.gmail.com`, port `993`, z hasłem aplikacji z [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (wymaga uwierzytelniania dwuskładnikowego) — bez OAuth, bez weryfikacji; asystent sam zwraca na to uwagę przy adresach Gmail. **Skrzynek Outlook.com** nie da się już połączyć przez IMAP z hasłem (Microsoft wyłączył tę drogę) — ustawienie wstępne wskazuje na kafelek **Microsoft**. **Proton Mail** działa tylko przez lokalnie uruchomiony, płatny Proton Mail Bridge (ma własne ustawienie wstępne). Do bezpośredniego wysyłania można podać host SMTP.

Łączenie sprawdza logowanie, zanim cokolwiek zostanie zapisane; dane dostępowe trafiają do pęku kluczy Twojego systemu operacyjnego. Połączone skrzynki i ustawienia przechwytywania znajdziesz później w obszarze **E-mail**: ustawienie **Folder e-mail** określa, gdzie są przechowywane przechwycone e-maile (domyślnie `Mail`).

## Czytanie poczty

Otwórz kartę e-mail przez lewy pasek akcji (ikona koperty) lub paletę poleceń (**Otwórz e-mail**). Lista pokazuje Twoją skrzynkę odbiorczą od najnowszych (nieprzeczytane pogrubione, **Wczytaj więcej** doładowuje kolejne). Wybranie wiadomości otwiera ją w **przeglądarce w piaskownicy**:

- **Zdalna zawartość jest blokowana** — piksele śledzące, zdalne obrazy i moduły ładujące style są usuwane i liczone („Zablokowano zdalną zawartość (n)”). Wyświetlane są tylko samodzielnie osadzone obrazy inline. **Pokaż obrazy** obok licznika jednorazowo odsłania obrazy https danej wiadomości; **Zawsze wczytuj zdalne obrazy** w ustawieniach poczty zamienia to w stałą zgodę. Uwaga: wczytanie zdalnych obrazów pozwala nadawcy zobaczyć Twój adres IP oraz moment otwarcia wiadomości — dlatego domyślnie zawartość jest blokowana.
- Linki są pokazywane jako zwykły tekst i nie są klikalne w przeglądarce.
- Skrypty i formularze nigdy się nie uruchamiają. Wiadomość jest renderowana w izolowanej ramce z restrykcyjną polityką treści.

Załączniki są wyświetlane z nazwą i rozmiarem; oryginalny plik `.eml` (poniżej) zawiera je w całości.

## Przenoszenie wiadomości do vaulta

Trzy przyciski przy każdej wiadomości:

- **Zapisz jako notatkę** — tworzy notatkę w folderze e-mail (`RRRR-MM-DD Temat.md`) z nadawcą i datą we frontmatter oraz tekstem wiadomości w postaci zwykłego tekstu pod nagłówkiem tematu. Przechwycenie tej samej wiadomości po raz drugi otwiera istniejącą notatkę zamiast ją duplikować.
- **+ .eml** — dodatkowo zapisuje surowy oryginał obok notatki i go linkuje. Plik `.eml` zawiera wszystko, łącznie z załącznikami, i otwiera się w dowolnym programie pocztowym.
- **→ Zadanie** — tworzy wpis w Twojej [domyślnej bazie zadań](Tasks.md) z tematem jako tytułem, dzisiejszą datą jako terminem i wstępnie ustawionym statusem otwarte.

## Pisanie i wysyłanie

Gdy tylko konto może wysyłać — konto **Microsoft** albo konto **IMAP** ze skonfigurowanym **hostem SMTP** — możesz pisać i wysyłać wiadomości z Plainva:

- **Napisz** (w karcie e-mail) otwiera pływające okno z opisanymi wierszami **Od / Do / DW / UDW**. Wpisz adres i naciśnij Enter lub przecinek, aby zamienić go w chip; **DW/UDW** pojawiają się na żądanie. Treść to edytor Markdown z paskiem narzędzi formatowania i menu poleceń „/".
- **Odpowiedz**, **Odpowiedz wszystkim** i **Przekaż dalej** przy dowolnej wiadomości otwierają to samo okno z zacytowanym oryginałem i wstępnie wypełnionymi odbiorcami; przekazanie zabiera ze sobą załączniki.
- **Wyślij** wychodzi przez SMTP (konta IMAP) lub Microsoft Graph (konta Microsoft).
- **Ta notatka e-mailem** (menu `⋮` notatki lub paleta poleceń) rozpoczyna wiadomość z bieżącą notatką w załączniku lub wstawioną jako tekst.

## Przekazanie notatki bez klienta pocztowego

Nie musisz wysyłać z poziomu Plainva. To działa dla dowolnej notatki i nie wymaga SMTP:

- **Odpowiedz jako notatka** (przy wiadomości): tworzy notatkę zaadresowaną do nadawcy (`to:` we frontmatter) z zacytowanym oryginałem — napisz swoją odpowiedź w Plainva.
- **Zapisz notatkę jako szkic w skrzynce** (paleta poleceń, przy dowolnej otwartej notatce): zapisuje notatkę jako **szkic we własnej skrzynce** przez IMAP — wybierz konto, odbiorcę i folder szkiców, a potem otwórz swój zwykły program pocztowy, sprawdź i wyślij stamtąd. Formatowanie jest zachowane.
- **Wyślij notatkę e-mailem (mailto)** (paleta poleceń): otwiera Twój domyślny program pocztowy z notatką jako zwykłym tekstem (długie notatki są skracane).
- **Kopiuj notatkę jako tekst e-maila** (paleta poleceń): umieszcza notatkę w schowku z formatowaniem — wklej ją w dowolnym edytorze wiadomości.
