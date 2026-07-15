# Podręcznik użytkownika Plainva

Stan na: 2026-07-06

To tłumaczenie zostało wygenerowane automatycznie — poprawki są mile widziane.

Plainva to edytor vaultów Markdown: Twoje notatki to zwykłe pliki Markdown w folderze (nazywanym „vault") na Twoim komputerze — bez silosu baz danych, bez wymuszonego konta w chmurze. Ten podręcznik wyjaśnia, jak pracować z Plainva i jak działają formaty plików.

## Spis treści

| Strona | Czego dotyczy |
|---|---|
| [Pierwsze kroki](Getting_Started.md) | Otwieranie lub tworzenie vaultu, interfejs, tryby edytora, karty i podział widoku |
| [Notatki i Markdown](Notes_and_Markdown.md) | Jak działają pliki Markdown: pisanie, formatowanie, właściwości (frontmatter), ikony, linki, szablony, obrazy |
| [Bazy danych (.base)](Databases_Base.md) | Wyświetlanie notatek jako bazy danych — widoki, filtry, właściwości, relacje, nowe wpisy (podobnie do Notion, ale w oparciu o pliki) |
| [OKF](OKF.md) | Open Knowledge Format: `type`, `okf_version`, zarządzanie index.md i opcjonalna konwersja vaultu |
| [Dokumentacja formatu plików](File_Format_Reference.md) | Dokładny format każdego pliku vaultu na dysku — dla narzędzi, skryptów lub AI edytujących notatki i pliki `.base` bezpośrednio |
| [Automatyzacja i skrypty](Automation_and_Scripts.md) | Rozszerzanie Plainva bez wtyczek: jak skrypty, narzędzia CLI i agenci AI bezpiecznie czytają i zapisują vault |
| [Backup i historia wersji](Backups_and_Versioning.md) | Automatyczne wersje plików, przywracanie (również usuniętych plików) i codzienne kopie zapasowe ZIP całego vaultu |
| [Aplikacja mobilna](Mobile_App.md) | Plainva na Androidzie i iOS: układ, edycja, bazy danych, synchronizacja i siatka bezpieczeństwa |
| [Konfiguracja synchronizacji](Sync_Setup.md) | Krok po kroku dla każdego dostawcy: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Zgodność synchronizacji](Sync_Compatibility.md) | Które usługi działają już dziś — bezpośrednio, przez WebDAV lub przez klienta desktopowego dostawcy |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Konfigurowanie synchronizacji Google Drive z własnymi danymi dostępowymi |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Konfigurowanie synchronizacji OneDrive i Dropbox z własną rejestracją aplikacji |
| [Wyszukiwanie](Search.md) | Wyszukiwanie pełnotekstowe, szybkie przełączanie, znajdź i zamień, tagi |
| [Zadania](Tasks.md) | Widok zadań z całego vaultu: każde pole wyboru we wszystkich Twoich notatkach, z filtrami statusu/tagu/folderu/terminu i przełączaniem jednym kliknięciem |
| [Graf](Graph.md) | Graf kontekstowy, mapa sejfu z trybem porządkowania i podróżą w czasie, graf jako widok bazy danych |
| [Skróty klawiszowe](Keyboard_Shortcuts.md) | Wszystkie skróty klawiszowe w jednym miejscu |
| [FAQ i rozwiązywanie problemów](FAQ.md) | Najczęstsze pytania: zgodność z Obsidian, pliki konfliktów, kopie zapasowe i więcej |

## Zasady podstawowe

- **Twoje pliki należą do Ciebie.** Vault to zwykły folder z plikami Markdown. Można go w każdej chwili otworzyć, skopiować lub zapisać w dowolnym innym programie.
- **Czysty Markdown jako format kanoniczny.** Nawet dodatkowe funkcje (właściwości, ikony, bazy danych) są zapisywane w otwartych, czytelnych formatach tekstowych.
- **Zgodność z Obsidian.** Istniejące vaulty Obsidian nigdy nie są uszkadzane ani przeformatowywane; Obsidian może otworzyć każdy plik utworzony przez Plainva.
