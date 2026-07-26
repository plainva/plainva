# Import z innej aplikacji

Stan na: 2026-07-26

Plainva potrafi przenieść notatki z innych aplikacji do notatek. Import zawsze zapisuje dane w vaulcie, który masz aktualnie otwarty, w podfolderze o nazwie, którą wybierasz — dzięki temu nigdy nie dotyka reszty Twojego vaultu, a zaimportowany folder możesz później przenieść lub usunąć jak każdy inny folder.

**Import odbywa się na komputerze.** Aplikacja mobilna nie potrafi importować: zaimportuj notatki na komputerze, a trafią na Twój telefon przez synchronizację, jak każdy inny plik.

## Rozpoczynanie importu

Dwa sposoby:

- **Paleta poleceń** (`Mod+P`) → **Importuj z innej aplikacji...**
- **Kliknij prawym przyciskiem folder** w drzewie plików → **Importuj z innej aplikacji...**

Kreator ma trzy kroki: wybierz aplikację, z której przechodzisz, wybierz pliki eksportu (albo podaj token Notion) i nazwij folder docelowy. Następnie zobaczysz podgląd z liczbą notatek i baz danych oraz listą wszystkiego, czego dany import nie potrafi przenieść. Nic nie zostaje zapisane, dopóki nie naciśniesz **Rozpocznij import**.

## Co możesz zaimportować

| Źródło | Co wybierasz | Co zostaje przeniesione |
|---|---|---|
| **Notion (API)** | Token integracji | Strony, hierarchia folderów, bazy danych z wierszami, relacje, 21 typów właściwości |
| **Notion (eksport ZIP)** | Plik ZIP lub rozpakowany folder | Strony i struktura folderów. Bazy danych są tworzone **puste** |
| **Evernote (ENEX)** | Jeden lub więcej plików `.enex` | Notatki, tagi, listy kontrolne, daty utworzenia/aktualizacji |
| **Google Keep (Takeout)** | Plik ZIP z Google Takeout lub pliki `.json` | Notatki, listy kontrolne, etykiety jako tagi, kolor, przypięte/zarchiwizowane |
| **Simplenote** | Wyeksportowany plik `.json` | Aktywne notatki i ich tagi |
| **Logseq** | Twój folder grafu | Pliki, skopiowane bez zmian |
| **Folder Markdown / ZIP** | Folder, pliki lub ZIP | Pliki `.md` i ich struktura folderów |

Importera Obsidian nie ma — i nie jest też potrzebny. Plainva otwiera vault Obsidian bezpośrednio: **Otwórz vault** i wskaż folder.

## Notion w szczegółach

Notion to jedyne źródło, w którym te dwie ścieżki znacząco się różnią.

**Z tokenem integracji (zalecane).** Token utwórz na `notion.so/my-integrations`. Następnie otwórz w Notion każdą stronę, którą chcesz zaimportować, kliknij **„..."** w prawym górnym rogu → **Połączenia** i dodaj swoją integrację — Notion udostępnia tylko strony, które zostały wyraźnie połączone z Twoją integracją.

Przez API Plainva widzi strukturę, a nie tylko tekst:

- Hierarchia stron staje się strukturą folderów.
- Każda baza danych staje się plikiem `.base` oraz folderem z **jedną notatką na wiersz**.
- **Relacje stają się linkami wiki** między tymi notatkami, w obu kierunkach.
- Mapowanych jest 21 typów właściwości — wybór, status, wielokrotny wybór, data, liczba, pole wyboru, URL, e-mail, telefon, formuła, rollup, relacja, osoby, unikalny identyfikator i inne.
- Widoki tabeli, tablicy, kalendarza i listy są generowane na podstawie schematu bazy danych.
- Bazy danych osadzone na stronie stają się aktywnymi osadzeniami `![[Database.base]]`.

**Z eksportu ZIP.** Działa offline i nie wymaga tokena, ale eksport z Notion nie zawiera ani schematu baz danych, ani identyfikatorów stron. Strony i ich foldery zostają przeniesione; bazy danych są tworzone jako **puste** pliki `.base`, o czym informuje też raport. Jeśli Twoje bazy danych mają znaczenie, użyj ścieżki przez API.

## Czego import nie przenosi

Każdy import podaje swoje ograniczenia w podglądzie, a potem ponownie w raporcie. Najważniejsze z nich:

- **Załączniki i obrazy nie są importowane.** Z archiwów ZIP odczytywane są tylko pliki tekstowe; załączniki z Evernote i obrazy z Keep pozostają pominięte.
- **Bardzo długie strony Notion** są odczytywane w całości, ale treść zagnieżdżona w rozwijanych blokach, kolumnach lub podlistach nie jest uwzględniana.
- **Pliki Logseq są kopiowane bez zmian** — właściwości `key:: value` oraz odwołania do bloków nie są konwertowane na właściwości ani linki Plainva.
- **Kosz Simplenote** jest pomijany.
- **Eksporty ZIP z Notion** tworzą puste bazy danych (patrz wyżej).

## Nic nie zostaje nadpisane

Import zapisuje dane w otwartym vaulcie, dlatego został zaprojektowany tak, aby był nieniszczący:

- Jeśli nazwa notatki jest już zajęta, zaimportowana notatka zostaje **ponumerowana** (`Meeting (2).md`) zamiast zastępować istniejącą. Dotyczy to również sytuacji, gdy dwie notatki źródłowe mają tę samą nazwę.
- Zaimportowane notatki otrzymują zwykły frontmatter OKF (`type`, `okf_version`), dzięki czemu zachowują się jak każda inna notatka Plainva w filtrach i widokach `.base`.
- Nic poza docelowym podfolderem nie zostaje zmienione.

Jeśli wolisz, aby import był całkowicie oddzielny, utwórz najpierw nowy vault (**Nowy vault** na ekranie powitalnym) i zaimportuj do niego.

## Raport importu

Każde uruchomienie zapisuje **raport importu** do folderu docelowego. Zawiera on:

- liczbę zaimportowanych notatek i baz danych,
- co ten import w ogóle nie potrafi przenieść,
- wszystko, co dotarło **niekompletnie** albo zostało **pominięte**, wraz z powodem,
- oraz każdy plik wraz z jego statusem.

Raport jest rzetelnym zapisem przebiegu importu — jeśli coś zostało obcięte lub pominięte, pojawia się w nim, zamiast zostać po cichu policzone jako sukces. Warto go przeczytać, zanim usuniesz eksport.

## Powiązane strony

- [Bazy danych (.base)](Databases_Base.md) — co dzieje się z zaimportowanymi bazami danych Notion
- [OKF](OKF.md) — frontmatter, jaki otrzymują zaimportowane notatki
- [Pierwsze kroki](Getting_Started.md) — tworzenie osobnego vaultu na potrzeby importu
