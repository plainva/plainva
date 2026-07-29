import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

/** Polish template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */

const PARA_STRINGS_PL: ParaStrings = {
  name: "PARA",
  description: "Projekty, Obszary, Zasoby, Archiwum — porządek według bliskości do działania (Tiago Forte).",
  folders: {
    projects: "Projekty",
    tasks: "Zadania",
    areas: "Obszary",
    resources: "Zasoby",
    archive: "Archiwum",
    templates: "Szablony",
  },
  folderHints: {
    projects: "Przedsięwzięcia z jasnym celem i terminem zakończenia (Projekty.base).",
    tasks: "Pojedyncze kolejne kroki — każde wskazuje na swój projekt (Zadania.base).",
    areas: "Trwałe obszary odpowiedzialności bez terminu zakończenia.",
    resources: "Tematy, materiały i informacje do wyszukiwania.",
    archive: "To, co ukończone lub nieaktywne, z pozostałych folderów.",
  },
  welcome: {
    file: "Witaj.md",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    title: "Witaj",
    intro:
      "Ten vault jest zorganizowany według metody PARA (Tiago Forte): treści są porządkowane według bliskości do działania, a nie według tematu. Przykłady poniżej to prawdziwe notatki — zmieniaj je, przenoś, usuwaj je.",
    outro:
      "Otwórz bazy danych, aby zobaczyć projekty według statusu, przypisywać im zadania i łączyć je z obszarami — ukończona praca trafia do Archiwum, a linki i przeglądy index.md Plainva aktualizuje automatycznie.",
  },
  welcomeSections: { databases: "Twoje bazy danych", start: "Od czego zacząć" },
  baseFiles: { projects: "Projekty.base", tasks: "Zadania.base", areas: "Obszary.base" },
  keys: { status: "status", area: "obszar", due: "termin", tasks: "zadania", project: "projekt", projects: "projekty" },
  options: {
    projectStatus: ["Zaplanowane", "Aktywne", "Oczekuje", "Ukończone"],
    taskStatus: ["Otwarte", "W trakcie", "Ukończone"],
  },
  views: { table: "Tabela", byStatus: "Według statusu" },
  templates: {
    project: { file: "Projekt.md", body: "# {{title}}\n\n## Cel\n\n## Kolejne kroki\n\n- [ ] \n" },
    task: { file: "Zadanie.md", body: "# {{title}}\n\n## Notatki\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Zespół",
        body: "Obszar to trwała odpowiedzialność bez terminu zakończenia. Projekty łączą się z nim przez właściwość Obszar — tabela w Obszary.base odzwierciedla je z powrotem.",
      },
      { title: "Finanse", body: "Księgowość, umowy, ubezpieczenia. Działa dalej, nawet gdy żaden projekt nie jest otwarty." },
      { title: "Zdrowie", body: "Wszystko, co wymaga trwałej uwagi zamiast mieć koniec." },
    ],
    projects: [
      {
        title: "Rozliczenie podatkowe 2026",
        body: "Projekt ma jasny cel i przewidywalny koniec. Ten jest zaplanowany, ale jeszcze nie rozpoczęty — dlatego znajduje się w pierwszej kolumnie tablicy.",
        props: { status: "Zaplanowane", obszar: "[[Finanse]]", termin: "{{today+45}}" },
      },
      {
        title: "Przeprowadzka do nowego biura",
        body: "Przykład aktywnego projektu: poniższe zadania wskazują tutaj przez właściwość Projekt, a Projekty.base odzwierciedla je z powrotem w kolumnie Zadania.\n\n- [ ] Zapisać cel projektu\n- [ ] Ustalić kolejny krok",
        props: { status: "Aktywne", obszar: "[[Zespół]]", termin: "{{today+21}}" },
      },
      {
        title: "Program na plecy",
        body: "Czeka na coś poza Twoją kontrolą — tutaj na termin wizyty. Właśnie do tego służy trzecia kolumna.",
        props: { status: "Oczekuje", obszar: "[[Zdrowie]]", termin: "{{today+10}}" },
      },
      {
        title: "Relaunch strony internetowej",
        body: "Ukończony. Zakończony projekt pozostaje widoczny, dopóki nie przeniesiesz go do Archiwum — baza danych podąża za plikiem.",
        props: { status: "Ukończone", obszar: "[[Zespół]]", termin: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Zebrać oferty firm przeprowadzkowych",
        body: "Zadanie to pojedynczy, konkretny kolejny krok.",
        props: { status: "Otwarte", projekt: "[[Przeprowadzka do nowego biura]]", termin: "{{today+3}}" },
      },
      {
        title: "Sprawdzić okres wypowiedzenia starych pomieszczeń",
        body: "Rozpoczęte, ale jeszcze nieukończone — środkowa kolumna tablicy.",
        props: { status: "W trakcie", projekt: "[[Przeprowadzka do nowego biura]]", termin: "{{today+1}}" },
      },
      {
        title: "Uzgodnić plan pomieszczeń z zespołem",
        body: "Przeciągnij kartę do innej kolumny tablicy: Plainva zapisze nowy status w notatce.",
        props: { status: "W trakcie", projekt: "[[Przeprowadzka do nowego biura]]", termin: "{{today+7}}" },
      },
      {
        title: "Posortować rachunki",
        body: "Należy do projektu, który jeszcze się nie rozpoczął — to dozwolone i często przydatne.",
        props: { status: "Otwarte", projekt: "[[Rozliczenie podatkowe 2026]]", termin: "{{today+14}}" },
      },
      {
        title: "Umówić wizytę u fizjoterapeuty",
        body: "Ukończone. Zadanie pozostaje notatką; zmienił się tylko jego status.",
        props: { status: "Ukończone", projekt: "[[Program na plecy]]", termin: "{{today-2}}" },
      },
      {
        title: "Przekierować starą domenę",
        body: "Ostatni krok ukończonego projektu.",
        props: { status: "Ukończone", projekt: "[[Relaunch strony internetowej]]", termin: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Lista kontrolna przeprowadzki biura",
        body: "Zasoby to materiały do wyszukiwania — bez celu, bez terminu zakończenia. Celowo nie znajdują się w żadnej bazie danych: nie wszystko musi mieć wiersze i kolumny.\n\n- [ ] Zmiana adresu w banku i u ubezpieczyciela\n- [ ] Zmierzyć sieć i drukarki",
      },
      {
        title: "Czym PARA różni się od folderów",
        body: "PARA porządkuje według bliskości do działania: projekty się kończą, obszary trwają, zasoby są materiałem referencyjnym, archiwum to wszystko inne. Przenoś notatkę między folderami, gdy tylko zmieni się jej rola.",
      },
    ],
    archive: [
      {
        title: "Targi 2025",
        body: "Tak wygląda notatka zarchiwizowana: zwykła notatka, tylko w innym folderze. Nic nie ginie — po prostu nie pojawia się już w aktywnych bazach danych.",
      },
    ],
  },
};

const GTD_STRINGS_PL: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — skrzynka odbiorcza, zadania, projekty, materiały referencyjne i lista Kiedyś/Może.",
  folders: {
    inbox: "Skrzynka odbiorcza",
    tasks: "Zadania",
    projects: "Projekty",
    reference: "Materiały referencyjne",
    someday: "Kiedyś Może",
    templates: "Szablony",
  },
  folderHints: {
    inbox: "Miejsce zbiorcze dla wszystkiego, co nowe — opróżniaj regularnie.",
    tasks: "Pojedyncze kolejne działania — uporządkowane według statusu i kontekstu (Zadania.base).",
    projects: "Wszystko, co wymaga więcej niż jednego kroku (Projekty.base).",
    reference: "Materiały do wyszukiwania, bez wymaganego działania.",
    someday: "Pomysły i przedsięwzięcia na później.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    intro:
      "Ten vault działa według Getting Things Done (David Allen): wszystko trafia najpierw do skrzynki odbiorczej, a stamtąd jest przetwarzane na konkretne zadania i projekty. Przykłady poniżej to prawdziwe notatki — przetwarzaj je, przenoś je, usuwaj je.",
    outro:
      "W Zadania.base przypisujesz każde zadanie do projektu przez właściwość Projekt; Projekty.base pokazuje wtedy w kolumnie Zadania automatycznie, co należy do danego projektu. Cotygodniowy przegląd utrzymuje niezawodność systemu.",
  },
  welcomeSections: { databases: "Twoje bazy danych", start: "Od czego zacząć" },
  baseFiles: { tasks: "Zadania.base", projects: "Projekty.base" },
  keys: { status: "status", context: "kontekst", project: "projekt", due: "termin", tasks: "zadania" },
  options: {
    taskStatus: ["Skrzynka", "Następne", "Oczekuje", "Kiedyś", "Zrobione"],
    context: ["@Dom", "@Praca", "@Sprawunki", "@Telefon"],
    projectStatus: ["Aktywny", "Oczekuje", "Kiedyś", "Zrobione"],
  },
  views: { table: "Tabela", byStatus: "Według statusu", byContext: "Według kontekstu" },
  templates: {
    task: { file: "Zadanie.md", body: "# {{title}}\n\n## Notatki\n\n- [ ] \n" },
    project: { file: "Projekt.md", body: "# {{title}}\n\n## Pożądany rezultat\n\n## Kolejne kroki\n\n- [ ] \n" },
  },
  review: {
    title: "Przegląd tygodniowy",
    description: "Lista kontrolna cotygodniowego przeglądu GTD.",
    body: "- [ ] Doprowadzić skrzynkę odbiorczą do zera\n- [ ] Przejrzeć listę projektów i sprawdzić kolejne działania\n- [ ] Przejrzeć listę Kiedyś Może\n- [ ] Spojrzeć na kalendarz najbliższych dwóch tygodni",
  },
  samples: {
    projects: [
      {
        title: "Remont kuchni",
        body: "Pożądany rezultat: co jest prawdą, gdy to się skończy? W GTD wszystko, co wymaga więcej niż jednego kroku, jest projektem — także to, co nie wydaje się nim być.",
        props: { status: "Aktywny" },
      },
      {
        title: "Przegląd samochodu",
        body: "Czeka na kogoś innego — tutaj na oddzwonienie z warsztatu. Dlatego ten projekt znajduje się w drugiej kolumnie tablicy.",
        props: { status: "Oczekuje" },
      },
      {
        title: "Nauka hiszpańskiego",
        body: "Kiedyś, może. Znajduje się w systemie, żeby przestał zaprzątać Twoją głowę — ale w tej chwili nie wymaga uwagi.",
        props: { status: "Kiedyś" },
      },
      {
        title: "Posortować dokumenty podatkowe",
        body: "Ukończony. Zakończony projekt pozostaje widoczny, dopóki go nie uporządkujesz — baza danych podąża za plikiem.",
        props: { status: "Zrobione" },
      },
    ],
    tasks: [
      {
        title: "Zebrać pomysły",
        body: "Dopiero co trafiło do skrzynki odbiorczej i nie zostało jeszcze przetworzone. Przy następnym przeglądzie to zadanie dostanie kontekst i projekt.",
        props: { status: "Skrzynka" },
      },
      {
        title: "Zmierzyć kuchnię",
        body: "Zadanie to pojedynczy, konkretny kolejny krok. Przez właściwość Projekt należy do remontu.",
        props: { status: "Następne", kontekst: "@Dom", projekt: "[[Remont kuchni]]", termin: "{{today+2}}" },
      },
      {
        title: "Sprawdzić ofertę stolarza",
        body: "Przeciągnij kartę do innej kolumny tablicy: Plainva zapisze nowy status w notatce.",
        props: { status: "Następne", kontekst: "@Praca", projekt: "[[Remont kuchni]]", termin: "{{today+5}}" },
      },
      {
        title: "Oddzwonić do warsztatu",
        body: "Czeka na kogoś innego. Kontekst @Telefon zbiera wszystko, co możesz załatwić od razu, gdy tylko masz telefon pod ręką.",
        props: { status: "Oczekuje", kontekst: "@Telefon", projekt: "[[Przegląd samochodu]]" },
      },
      {
        title: "Poszukać kursu językowego w okolicy",
        body: "Należy do projektu odłożonego na kiedyś i czeka razem z nim. To też jest decyzja — tylko przeciwko robieniu tego teraz.",
        props: { status: "Kiedyś", kontekst: "@Sprawunki", projekt: "[[Nauka hiszpańskiego]]" },
      },
      {
        title: "Zeskanować ubiegłoroczne rachunki",
        body: "Ukończone. Zadanie pozostaje notatką; zmienił się tylko jego status.",
        props: { status: "Zrobione", kontekst: "@Dom", projekt: "[[Posortować dokumenty podatkowe]]", termin: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "Dwa pytania GTD",
        body: "Materiały referencyjne to treści bez wymaganego działania — celowo nie znajdują się w żadnej bazie danych.\n\nPrzetwarzając skrzynkę odbiorczą, odpowiadasz na dwa pytania: czy da się to zrobić? A jeśli tak — jaki jest ten jeden, konkretny kolejny krok? Wszystko inne to materiał referencyjny, coś na kiedyś albo kosz.",
      },
    ],
    someday: [
      {
        title: "Album ze zdjęciami z zeszłego lata",
        body: "Kiedyś nie znaczy nigdy, znaczy nie teraz. Podczas cotygodniowego przeglądu przeglądasz tę listę — to, co przyciągnie Twoją uwagę dwa razy, staje się projektem.",
      },
    ],
  },
};

const ZK_STRINGS_PL: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Jedna myśl na notatkę, gęsto powiązane — notatki ulotne, z lektury i trwałe (Luhmann).",
  folders: {
    fleeting: "Notatki ulotne",
    literature: "Notatki z lektury",
    permanent: "Notatki trwałe",
    templates: "Szablony",
  },
  folderHints: {
    fleeting: "Szybkie, surowe myśli — ulotne, przetwarzane później.",
    literature: "Streszczenia przeczytanych treści własnymi słowami, ze źródłem.",
    permanent: "Dopracowane, trwałe idee — jedna na notatkę, mocno powiązane.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    intro:
      "Ten vault działa według metody Zettelkasten (Niklas Luhmann): jedna myśl na notatkę — połączenia powstają dzięki linkom, a nie hierarchii folderów. Zettelki poniżej odwołują się do siebie nawzajem; podążaj za nimi, a potem zobacz graf.",
    outro:
      "W Lektura.base prowadzisz swoje źródła według statusu czytania; Notatki.base łączy notatki trwałe przez właściwość Źródło z lekturą, z której pochodzą.",
  },
  welcomeSections: { databases: "Twoje bazy danych", start: "Od czego zacząć" },
  baseFiles: { literature: "Lektura.base", slips: "Notatki.base" },
  keys: { author: "autor", year: "rok", kind: "rodzaj", status: "status", url: "url", slips: "notatki", source: "zrodlo" },
  options: {
    kind: ["Książka", "Artykuł", "Wideo", "Podcast", "Strona WWW"],
    status: ["Do przeczytania", "Przeczytane", "Przetworzone"],
  },
  views: { table: "Tabela", byStatus: "Według statusu" },
  templates: {
    literature: { file: "Notatka z lektury.md", body: "# {{title}}\n\n## Streszczenie\n\n## Źródło\n" },
    slip: { file: "Notatka trwała.md", body: "# {{title}}\n\nJedna myśl, pełnymi zdaniami.\n\n## Powiązane notatki\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Jedna myśl na notatkę",
        body: "Notatka trwała zawiera dokładnie jedną myśl, zapisaną pełnymi zdaniami i własnymi słowami. Tylko wtedy można ją później wykorzystać w innym kontekście bez sięgania do oryginału.\n\nDalej: [[Link zamiast segregowania]] i [[Pisanie to myślenie]].",
        props: { zrodlo: ["[[Luhmann - Komunikacja z kartoteką]]"] },
      },
      {
        title: "Link zamiast segregowania",
        body: "Folder zmusza każdą notatkę do trafienia dokładnie do jednej szuflady. Link pozwala jej znajdować się w tylu kontekstach, do ilu należy — dlatego kartoteka zyskuje na wartości z czasem, zamiast stawać się nieogarniętą.\n\nPrzeciwieństwo: [[Jedna myśl na notatkę]]. Praktyczna konsekwencja: [[Notatka wejściowa]].",
        props: { zrodlo: ["[[Luhmann - Komunikacja z kartoteką]]"] },
      },
      {
        title: "Pisanie to myślenie",
        body: "Jeśli potrafisz zapisać myśl własnymi słowami, zrozumiałeś ją; jeśli nie potrafisz, jeszcze jej nie zrozumiałeś. Przekształcenie notatki z lektury w notatkę trwałą to więc nie przepisywanie — to właściwa praca.\n\nZobacz też [[Jedna myśl na notatkę]].",
        props: { zrodlo: ["[[Ahrens - Jak robić dobre notatki]]"] },
      },
      {
        title: "Notatka wejściowa",
        body: "Kartoteka potrzebuje drzwi. Notatka wejściowa zbiera linki do wątków, nad którymi właśnie pracujesz — nie zastępuje spisu treści, sama jest notatką, która wciąż się zmienia.\n\nWątki: [[Link zamiast segregowania]] · [[Pisanie to myślenie]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Komunikacja z kartoteką",
        body: "Podsumuj przeczytaną treść własnymi słowami i zapisz źródło. Notatki trwałe odwołują się tutaj przez właściwość Źródło — kolumna Notatki pokazuje, które z nich.",
        props: { autor: "Niklas Luhmann", rok: 1981, rodzaj: "Artykuł", status: "Przetworzone" },
      },
      {
        title: "Ahrens - Jak robić dobre notatki",
        body: "Przeczytane, ale jeszcze nie przekształcone w notatki trwałe. Właśnie do tego służy status: przy następnym spojrzeniu pokazuje, gdzie praca została przerwana.",
        props: { autor: "Sönke Ahrens", rok: 2017, rodzaj: "Książka", status: "Przeczytane" },
      },
      {
        title: "Podcast o robieniu notatek",
        body: "Jeszcze nie przeczytane — ani wysłuchane. Na tablicy to źródło znajduje się w pierwszej kolumnie, dopóki go nie ruszysz.",
        props: { rodzaj: "Podcast", status: "Do przeczytania" },
      },
    ],
    fleeting: [
      {
        title: "Notatki ze spaceru",
        body: "Notatki ulotne to surowy materiał: naskrobane, niekompletne, krótkotrwałe. Przetworzenie zamienia je w notatkę trwałą — albo w nic, i to też jest w porządku.\n\n- Pomysł: odniesienia są cenniejsze niż foldery\n- Sprawdzić: czy ten cytat Luhmanna jest dokładny?",
      },
    ],
  },
};

const ACE_STRINGS_PL: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Kalendarz i Działania — praca z wiedzą skupiona wokół MOC, według Nicka Milo.",
  folders: { atlas: "Atlas", calendar: "Kalendarz", efforts: "Działania" },
  folderHints: {
    atlas: "Mapy Twojej wiedzy — MOC i notatki przeglądowe.",
    calendar: "Treści powiązane z czasem — notatki dzienne, dzienniki, podsumowania.",
    efforts: "Działania — wszystko, nad czym aktywnie pracujesz.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    intro:
      "Ten vault wykorzystuje schemat ACE z „Linking Your Thinking” (Nick Milo): wiedza jest łączona za pomocą Maps of Content (MOC) zamiast głębokiego zagnieżdżania. Wszystko poniżej jest połączone z notatką Home — przejdź przez linki, a potem spójrz na graf.",
    outro:
      "Zacznij w Atlasie od notatki Home i stamtąd twórz linki do swojej wiedzy. MOC to tylko notatka: może rosnąć, dzielić się i znowu zniknąć.",
  },
  welcomeSections: { start: "Od czego zacząć" },
  home: {
    title: "Home",
    description: "Twoja nadrzędna Map of Content.",
    lead: "Notatka Home to punkt wejścia: połącz tutaj najważniejsze Maps of Content i bieżące działania. Żaden folder tego nie potrafi — folder może umieścić notatkę tylko w jednym miejscu.",
    mapsHeading: "Mapy",
    effortsHeading: "Bieżące działania",
  },
  maps: [
    {
      title: "Pisanie MOC",
      body: "Map of Content zbiera to, co należy do danego tematu, i porządkuje to własnymi słowami. Nie zastępuje spisu treści — to Twoje spojrzenie na temat, w danym momencie.",
      leads: "Stąd dalej:",
    },
    {
      title: "Ogród MOC",
      body: "MOC może też wskazywać poza Atlas: ta mapa prowadzi do trwającego działania. Właśnie to krzyżowe łączenie jest sednem sprawy.",
      leads: "Stąd dalej:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Dlaczego mapy zamiast folderów",
        body: "Folder odpowiada na pytanie „gdzie to jest?”. Mapa odpowiada na pytanie „co do siebie należy i dlaczego?” — a ta sama notatka może znajdować się na kilku mapach.\n\nPowrót do mapy: [[Pisanie MOC]].",
      },
    ],
    efforts: [
      {
        title: "Zbudować podwyższoną grządkę",
        body: "Działanie (Effort) to coś, nad czym pracujesz właśnie teraz — z przewidywalnym końcem. Celowo nie znajduje się w Atlasie: Atlas jest dla tego, co trwa.\n\n- [ ] Ustalić wymiary\n- [ ] Kupić drewno\n\nNależy do [[Ogród MOC]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Treści powiązane z czasem trafiają do folderu Kalendarz: notatki dzienne, podsumowania, wszystko, co jest związane z datą, a nie z tematem.\n\nDziś obejrzano: [[Dlaczego mapy zamiast folderów]].",
      },
    ],
  },
};

const JD_STRINGS_PL: JdStrings = {
  name: "Johnny.Decimal",
  description: "Ponumerowane obszary i kategorie (10-19 / 11 / 11.01) dla pewnej odnajdywalności.",
  folders: {
    system: "00-09 System",
    systemIndex: "00 Indeks",
    personal: "10-19 Prywatne",
    finance: "11 Finanse",
    health: "12 Zdrowie",
    work: "20-29 Praca",
    projects: "21 Projekty",
    meetings: "22 Spotkania",
  },
  folderHints: {
    system: "Zarządzanie samym systemem — indeks i konwencje.",
    personal: "Przykładowy obszar dla tematów prywatnych.",
    work: "Przykładowy obszar dla tematów zawodowych.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    intro:
      "Ten vault jest zorganizowany według Johnny.Decimal: maksymalnie dziesięć obszarów (10-19, 20-29, …), maksymalnie dziesięć kategorii na obszar (11, 12, …) — a każda notatka otrzymuje identyfikator taki jak 11.01. Poniższe przykłady pokazują, jak to wygląda.",
    outro:
      "Zmień nazwy obszarów i kategorii zgodnie ze swoimi tematami — celowo ograniczona głębokość (obszar → kategoria → identyfikator) to sedno tej metody. Numer nigdy nie zostaje przydzielony ponownie, nawet jeśli notatka zniknie.",
  },
  welcomeSections: { start: "Od czego zacząć" },
  index: {
    id: "00.00",
    title: "Indeks",
    description: "Indeks Johnny.Decimal: wszystkie numery w jednym miejscu.",
    lead: "Prowadź tutaj listę wszystkich obszarów, kategorii i identyfikatorów. Kto szuka numeru, patrzy najpierw tutaj — jeśli nie ma go w indeksie, nie istnieje.",
  },
  samples: [
    {
      id: "11.01",
      title: "Budżet domowy",
      body: "Pierwsza notatka w kategorii 11 dostaje 01 — następna 02, i tak dalej. Numer zostaje przy notatce, nawet jeśli ją przemianujesz.",
    },
    {
      id: "21.01",
      title: "Relaunch strony internetowej",
      body: "Także cały projekt dostaje dokładnie jeden numer. Wszystko, co do niego należy, odwołuje się do tego numeru zamiast znikać w osobnym podfolderze.",
    },
    {
      id: "22.01",
      title: "Kick-off strony internetowej",
      body: "Notatki ze spotkań są osobną kategorią, żeby nie zapychały numeru projektu. Ta należy do [[21.01 Relaunch strony internetowej]].",
    },
  ],
};

const JOURNAL_STRINGS_PL: JournalStrings = {
  name: "Journal",
  description: "Notatki dzienne z gotowym szablonem i bazą dziennika — notatki dzienne skonfigurowane od razu.",
  folders: { journal: "Dziennik", templates: "Szablony" },
  folderHints: {
    journal: "Twoje notatki dzienne, jedna na dzień.",
    templates: "Szablony nowych notatek — szablon notatki dziennej jest już skonfigurowany.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    description: "Punkt startowy i krótki przewodnik po tym vaulcie.",
    intro:
      "Ten vault jest przygotowany do codziennego pisania: notatki dzienne trafiają do folderu Dziennik i powstają na podstawie szablonu z folderu Szablony. Dwa przykładowe dni już tu są — dzisiaj i wczoraj.",
    outro:
      "Otwórz kalendarz w prawym pasku bocznym i kliknij dzień, aby utworzyć kolejną notatkę dzienną. Dziennik.base pokazuje Twoje wpisy jako tabelę i w kalendarzu — z datą, nastrojem i słowami kluczowymi.",
  },
  welcomeSections: { databases: "Twoje bazy danych", start: "Od czego zacząć" },
  baseFile: "Dziennik.base",
  keys: { date: "data", mood: "nastroj", tags: "slowa" },
  moods: ["Dobry", "Neutralny", "Zły", "Produktywny", "Zmęczony"],
  views: { table: "Tabela", calendar: "Kalendarz" },
  template: {
    file: "Notatka dzienna.md",
    description: "Szablon nowych notatek dziennych — {{date}}, {{time}} i {{title}} są zastępowane.",
    body: "# {{title}}\n\n## Notatki\n\n## Zadania\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Produktywny",
      tags: ["praca", "pisanie"],
      body: "Tak wygląda wpis. Nastrój i słowa kluczowe znajdują się w frontmatter — dzięki temu Dziennik.base może po nich sortować i filtrować bez podwójnego utrzymywania danych.\n\n## Notatki\n\n- Kalendarz w prawym pasku bocznym prowadzi do dowolnego dnia.\n\n## Zadania\n\n- [x] Napisać pierwszą notatkę dzienną\n- [ ] Wrócić jutro",
    },
    {
      offset: -1,
      mood: "Zmęczony",
      tags: ["codzienność"],
      body: "Krótki wpis też jest wpisem. Z czasem interesujący nie jest pojedynczy dzień, lecz ich ciąg — do tego służy tabela posortowana według daty.\n\n## Notatki\n\n- Niewiele zrobione, za to wcześniejszy koniec pracy.",
    },
  ],
};

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_PL),
    buildZettelkasten(ZK_STRINGS_PL),
    buildAce(ACE_STRINGS_PL),
    buildJd(JD_STRINGS_PL),
    buildGtd(GTD_STRINGS_PL),
    buildJournal(JOURNAL_STRINGS_PL),
  ];
}
