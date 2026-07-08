import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

/** Polish template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    {
      id: "para",
      name: "PARA",
      description: "Projekty, Obszary, Zasoby, Archiwum — porządek według bliskości do działania (Tiago Forte).",
      folders: ["Projekty", "Zadania", "Obszary", "Zasoby", "Archiwum", "Szablony"],
      bases: [
        defineBase({
          path: "Projekty.base",
          sourceFolder: "Projekty",
          columns: [
            { key: "status", input: "status", options: ["Zaplanowane", "Aktywne", "Oczekuje", "Ukończone"] },
            { key: "obszar", input: "relation", relationBase: "Obszary.base", relationLimit: "one" },
            { key: "termin", input: "date" },
            { key: "zadania", reverseOf: { base: "Zadania.base", property: "projekt" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Według statusu", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Szablony/Projekt.md",
        }),
        defineBase({
          path: "Zadania.base",
          sourceFolder: "Zadania",
          columns: [
            { key: "status", input: "status", options: ["Otwarte", "W trakcie", "Ukończone"] },
            { key: "projekt", input: "relation", relationBase: "Projekty.base", relationLimit: "one" },
            { key: "termin", input: "date" },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Według statusu", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Szablony/Zadanie.md",
        }),
        defineBase({
          path: "Obszary.base",
          sourceFolder: "Obszary",
          columns: [{ key: "projekty", reverseOf: { base: "Projekty.base", property: "obszar" } }],
          views: [{ name: "Tabela", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault jest zorganizowany według metody PARA (Tiago Forte): treści są porządkowane według bliskości do działania, a nie według tematu.",
            [
              { name: "Projekty", description: "Przedsięwzięcia z jasnym celem i terminem zakończenia (Projekty.base)." },
              { name: "Zadania", description: "Pojedyncze kolejne kroki — każde wskazuje na swój projekt (Zadania.base)." },
              { name: "Obszary", description: "Trwałe obszary odpowiedzialności bez terminu zakończenia." },
              { name: "Zasoby", description: "Tematy, materiały i informacje do wyszukiwania." },
              { name: "Archiwum", description: "To, co ukończone lub nieaktywne, z pozostałych folderów." },
            ],
            "Otwórz bazy danych Projekty.base, Zadania.base i Obszary.base, aby oglądać projekty według statusu, przypisywać im zadania i łączyć je z obszarami — ukończone elementy trafiają do Archiwum, a linki oraz przeglądy index.md Plainva aktualizuje automatycznie."
          ),
        },
        {
          path: "Projekty/Przykładowy projekt.md",
          description: "Przykład notatki projektowej.",
          properties: { status: "Aktywne", obszar: "[[Przykładowy obszar]]" },
          body: "# Przykładowy projekt\n\nProjekt ma jasny cel i przewidywalny koniec. Zapisz tutaj cel, kolejne kroki i wyniki.\n\n- [ ] Zapisać cel projektu\n- [ ] Ustalić kolejny krok\n",
        },
        {
          path: "Zadania/Przykładowe zadanie.md",
          description: "Przykład zadania powiązanego z projektem.",
          properties: { status: "Otwarte", projekt: "[[Przykładowy projekt]]" },
          body: "# Przykładowe zadanie\n\nZadanie to pojedynczy, konkretny kolejny krok. Przez właściwość Projekt należy do Przykładowego projektu.\n",
        },
        {
          path: "Obszary/Przykładowy obszar.md",
          description: "Przykład obszaru odpowiedzialności.",
          body: "# Przykładowy obszar\n\nObszar to trwała odpowiedzialność bez terminu zakończenia — na przykład „Zdrowie” albo „Finanse”. Projekty łączą się z nim przez właściwość Obszar.\n",
        },
        {
          path: "Szablony/Projekt.md",
          properties: { status: "Zaplanowane" },
          body: "# {{title}}\n\n## Cel\n\n## Kolejne kroki\n\n- [ ] \n",
        },
        {
          path: "Szablony/Zadanie.md",
          properties: { status: "Otwarte" },
          body: "# {{title}}\n\n## Notatki\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Szablony" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Jedna myśl na notatkę, gęsto powiązane — notatki ulotne, z lektury i trwałe (Luhmann).",
      folders: ["Notatki ulotne", "Notatki z lektury", "Notatki trwałe", "Szablony"],
      bases: [
        defineBase({
          path: "Lektura.base",
          sourceFolder: "Notatki z lektury",
          columns: [
            { key: "autor", input: "text" },
            { key: "rok", input: "number" },
            { key: "rodzaj", input: "select", options: ["Książka", "Artykuł", "Wideo", "Podcast", "Strona WWW"] },
            { key: "status", input: "status", options: ["Do przeczytania", "Przeczytane", "Przetworzone"] },
            { key: "url", input: "url" },
            { key: "notatki", reverseOf: { base: "Notatki.base", property: "zrodlo" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Według statusu", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Szablony/Notatka z lektury.md",
        }),
        defineBase({
          path: "Notatki.base",
          sourceFolder: "Notatki trwałe",
          columns: [{ key: "zrodlo", input: "relation", relationBase: "Lektura.base" }],
          views: [{ name: "Tabela", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault działa według metody Zettelkasten (Niklas Luhmann): jedna myśl na notatkę — połączenia powstają dzięki linkom, a nie hierarchii folderów.",
            [
              { name: "Notatki ulotne", description: "Szybkie, surowe myśli — ulotne, przetwarzane później." },
              { name: "Notatki z lektury", description: "Streszczenia przeczytanych treści własnymi słowami, ze źródłem." },
              { name: "Notatki trwałe", description: "Dopracowane, trwałe idee — jedna na notatkę, mocno powiązane." },
            ],
            "W Lektura.base prowadzisz swoje źródła według statusu czytania; Notatki.base łączy notatki trwałe przez właściwość Źródło z lekturą, z której pochodzą."
          ),
        },
        {
          path: "Notatki trwałe/Przykładowa notatka.md",
          description: "Przykład notatki trwałej.",
          properties: { zrodlo: ["[[Przykładowa notatka z lektury]]"] },
          body: "# Przykładowa notatka\n\nNotatka trwała zawiera dokładnie jedną myśl, zapisaną pełnymi zdaniami i własnymi słowami.\n\nŁącz powiązane notatki bezpośrednio w tekście — tak rośnie sieć idei.\n",
        },
        {
          path: "Notatki z lektury/Przykładowa notatka z lektury.md",
          description: "Przykład notatki z lektury.",
          properties: { autor: "Niklas Luhmann", rok: 1992, rodzaj: "Książka", status: "Przeczytane" },
          body: "# Przykładowa notatka z lektury\n\nStreść własnymi słowami to, co przeczytałeś, i zapisz źródło. Notatki trwałe wskazują na tę notatkę z lektury przez właściwość Źródło.\n",
        },
        {
          path: "Szablony/Notatka z lektury.md",
          properties: { status: "Do przeczytania" },
          body: "# {{title}}\n\n## Streszczenie\n\n## Źródło\n",
        },
      ],
      settings: { templateFolder: "Szablony" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Kalendarz i Działania — praca z wiedzą skupiona wokół MOC, według Nicka Milo.",
      folders: ["Atlas", "Kalendarz", "Działania"],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault wykorzystuje schemat ACE z „Linking Your Thinking” (Nick Milo): wiedza jest łączona za pomocą Maps of Content (MOC) zamiast głębokiego zagnieżdżania.",
            [
              { name: "Atlas", description: "Mapy Twojej wiedzy — MOC i notatki przeglądowe." },
              { name: "Kalendarz", description: "Treści powiązane z czasem — notatki dzienne, dzienniki, podsumowania." },
              { name: "Działania", description: "Wszystko, nad czym aktywnie pracujesz." },
            ],
            "Zacznij w Atlasie od notatki Home i stamtąd twórz linki do swojej wiedzy."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Twoja nadrzędna Map of Content.",
          body: "# Home\n\nNotatka Home to punkt wejścia: połącz tutaj najważniejsze Maps of Content i bieżące działania.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Ponumerowane obszary i kategorie (10-19 / 11 / 11.01) dla pewnej odnajdywalności.",
      folders: [
        "00-09 System",
        "00-09 System/00 Indeks",
        "10-19 Prywatne",
        "10-19 Prywatne/11 Finanse",
        "10-19 Prywatne/12 Zdrowie",
        "20-29 Praca",
        "20-29 Praca/21 Projekty",
        "20-29 Praca/22 Spotkania",
      ],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault jest zorganizowany według Johnny.Decimal: maksymalnie dziesięć obszarów (10-19, 20-29, …), maksymalnie dziesięć kategorii na obszar (11, 12, …) — a każda notatka otrzymuje identyfikator taki jak 11.01.",
            [
              { name: "00-09 System", description: "Zarządzanie samym systemem — indeks i konwencje." },
              { name: "10-19 Prywatne", description: "Przykładowy obszar dla tematów prywatnych." },
              { name: "20-29 Praca", description: "Przykładowy obszar dla tematów zawodowych." },
            ],
            "Zmień nazwy obszarów i kategorii zgodnie ze swoimi tematami — celowo ograniczona głębokość (obszar → kategoria → identyfikator) to sedno tej metody."
          ),
        },
        {
          path: "00-09 System/00 Indeks/00.00 Indeks.md",
          description: "Indeks Johnny.Decimal: wszystkie numery w jednym miejscu.",
          body: "# 00.00 Indeks\n\nProwadź tutaj listę wszystkich obszarów, kategorii i identyfikatorów. Kto szuka numeru, patrzy najpierw tutaj.\n\n## 10-19 Prywatne\n\n- 11 Finanse\n- 12 Zdrowie\n\n## 20-29 Praca\n\n- 21 Projekty\n- 22 Spotkania\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — skrzynka odbiorcza, zadania, projekty, materiały referencyjne i lista Kiedyś/Może.",
      folders: ["Skrzynka odbiorcza", "Zadania", "Projekty", "Materiały referencyjne", "Kiedyś Może", "Szablony"],
      bases: [
        defineBase({
          path: "Zadania.base",
          sourceFolder: "Zadania",
          columns: [
            { key: "status", input: "status", options: ["Skrzynka", "Następne", "Oczekuje", "Kiedyś", "Zrobione"] },
            { key: "kontekst", input: "select", options: ["@Dom", "@Praca", "@Sprawunki", "@Telefon"] },
            { key: "projekt", input: "relation", relationBase: "Projekty.base", relationLimit: "one" },
            { key: "termin", input: "date" },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Według statusu", type: "board", groupBy: "status" },
            { name: "Według kontekstu", type: "board", groupBy: "kontekst" },
          ],
          newItemTemplate: "Szablony/Zadanie.md",
        }),
        defineBase({
          path: "Projekty.base",
          sourceFolder: "Projekty",
          columns: [
            { key: "status", input: "status", options: ["Aktywny", "Oczekuje", "Kiedyś", "Zrobione"] },
            { key: "zadania", reverseOf: { base: "Zadania.base", property: "projekt" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Według statusu", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Szablony/Projekt.md",
        }),
      ],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault działa według Getting Things Done (David Allen): wszystko trafia najpierw do skrzynki odbiorczej, a stamtąd jest przetwarzane na konkretne zadania i projekty.",
            [
              { name: "Skrzynka odbiorcza", description: "Miejsce zbiorcze dla wszystkiego, co nowe — opróżniaj regularnie." },
              { name: "Zadania", description: "Pojedyncze kolejne działania — uporządkowane według statusu i kontekstu (Zadania.base)." },
              { name: "Projekty", description: "Wszystko, co wymaga więcej niż jednego kroku (Projekty.base)." },
              { name: "Materiały referencyjne", description: "Materiały do wyszukiwania, bez wymaganego działania." },
              { name: "Kiedyś Może", description: "Pomysły i przedsięwzięcia na później." },
            ],
            "W Zadania.base przypisujesz każde zadanie do projektu przez właściwość Projekt; Projekty.base pokazuje wtedy w kolumnie Zadania automatycznie, co należy do danego projektu. Cotygodniowy przegląd utrzymuje niezawodność systemu."
          ),
        },
        {
          path: "Przegląd tygodniowy.md",
          description: "Lista kontrolna cotygodniowego przeglądu GTD.",
          body: "# Przegląd tygodniowy\n\n- [ ] Doprowadzić skrzynkę odbiorczą do zera\n- [ ] Przejrzeć listę projektów i sprawdzić kolejne działania\n- [ ] Przejrzeć listę Kiedyś Może\n- [ ] Spojrzeć na kalendarz najbliższych dwóch tygodni\n",
        },
        {
          path: "Projekty/Przykładowy projekt.md",
          description: "Przykład notatki projektowej GTD.",
          properties: { status: "Aktywny" },
          body: "# Przykładowy projekt\n\nPożądany rezultat: jak wygląda „gotowe”?\n\nKolejne działanie:\n\n- [ ] Zapisać jedno, konkretne kolejne działanie\n",
        },
        {
          path: "Zadania/Przykładowe zadanie.md",
          description: "Przykład zadania powiązanego z projektem.",
          properties: { status: "Następne", kontekst: "@Praca", projekt: "[[Przykładowy projekt]]" },
          body: "# Przykładowe zadanie\n\nZadanie to pojedyncze, konkretne kolejne działanie. Przez właściwość Projekt należy do Przykładowego projektu.\n",
        },
        {
          path: "Zadania/Zebrać pomysły.md",
          description: "Przykład świeżej pozycji w skrzynce odbiorczej.",
          properties: { status: "Skrzynka" },
          body: "# Zebrać pomysły\n\nDopiero co trafiło do skrzynki odbiorczej i nie zostało jeszcze przetworzone. Przy następnym przeglądzie to zadanie dostanie kontekst i projekt.\n",
        },
        {
          path: "Szablony/Zadanie.md",
          properties: { status: "Skrzynka" },
          body: "# {{title}}\n\n## Notatki\n\n- [ ] \n",
        },
        {
          path: "Szablony/Projekt.md",
          properties: { status: "Aktywny" },
          body: "# {{title}}\n\n## Pożądany rezultat\n\n## Kolejne kroki\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Szablony" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "Notatki dzienne z gotowym szablonem i bazą dziennika — notatki dzienne skonfigurowane od razu.",
      folders: ["Dziennik", "Szablony"],
      bases: [
        defineBase({
          path: "Dziennik.base",
          sourceFolder: "Dziennik",
          columns: [
            { key: "data", input: "date" },
            { key: "nastroj", input: "select", options: ["Dobry", "Neutralny", "Zły", "Produktywny", "Zmęczony"] },
            { key: "slowa", input: "tags" },
          ],
          views: [
            { name: "Tabela", type: "table", sort: [{ property: "data", direction: "DESC" }] },
            { name: "Kalendarz", type: "calendar", dateField: "data" },
          ],
        }),
      ],
      notes: [
        {
          path: "Witaj.md",
          description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
          body: welcomeBody(
            "Witaj",
            "Ten vault jest przygotowany do codziennego pisania: notatki dzienne trafiają do folderu Dziennik i powstają na podstawie szablonu z folderu Szablony.",
            [
              { name: "Dziennik", description: "Twoje notatki dzienne, jedna na dzień." },
              { name: "Szablony", description: "Szablony nowych notatek — szablon notatki dziennej jest już skonfigurowany." },
            ],
            "Otwórz kalendarz w prawym pasku bocznym i kliknij dzień, aby utworzyć pierwszą notatkę dzienną. Dziennik.base pokazuje Twoje wpisy jako tabelę i w kalendarzu — z datą, nastrojem i słowami kluczowymi."
          ),
        },
        {
          path: "Szablony/Notatka dzienna.md",
          description: "Szablon nowych notatek dziennych — {{date}}, {{time}} i {{title}} są zastępowane.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { data: "{{date}}" },
          body: "# {{title}}\n\n## Notatki\n\n## Zadania\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Dziennik", templateFolder: "Szablony", dailyNoteTemplate: "Notatka dzienna.md" },
    },
  ];
}
