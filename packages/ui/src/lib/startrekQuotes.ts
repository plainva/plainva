/*
 * Star Trek quote catalogue for the LCARS easter egg (hailing-frequencies
 * dialog, opened by 5 quick clicks on the title-bar logo). Each recognised
 * line unlocks the LCARS theme plus ONE collectible palette variant — quote
 * ids and LCARS variant ids (services/theme.ts) match 1:1.
 *
 * These are CANONICAL lines, not translations: the German entries are the
 * actual dub lines (verified against Memory Alpha (de) et al., 2026-07-04) —
 * e.g. "Engage!" was dubbed "Energie!", the Vulcan salute has THREE dub
 * readings, and Picard's defiant shout is "Da sind vier Lichter!". Every
 * language list is accepted regardless of the app language (originals always
 * work), and `xx` marks language-neutral lines (Klingon).
 *
 * Deliberately NOT in the i18n JSONs: quotes are canonical data, not UI
 * copy. Adding an app language may add a `<lang>: [...]` list per quote —
 * with real dub lines only, never fresh translations. Extending the list
 * means: new entry here + matching variant in LCARS_VARIANTS + variant
 * palette in themes/lcars.css + label key `themes.variants.<id>` in ALL
 * locales (docs/engineering/Theme_Platform.md).
 */

export interface StarTrekQuote {
  /** Matches the LCARS variant id in services/theme.ts — except for
   * theme-unlocking quotes (see `unlocksTheme`), whose id is free. */
  id: string;
  /** Where the line is from (for code readers). */
  source: string;
  /** Accepted spoken lines per language code; "xx" = language-neutral. */
  lines: Record<string, string[]>;
  /** When set, the line unlocks this WHOLE theme instead of an LCARS palette
   * variant (e.g. "hello-computer" → win95). Such quotes are not part of the
   * 13-variant LCARS collection. */
  unlocksTheme?: string;
}

export const STAR_TREK_QUOTES: StarTrekQuote[] = [
  {
    id: "make-it-so",
    source: "Picard (TNG); dub also used \"Machen Sie's so\"",
    lines: {
      en: ["Make it so"],
      de: ["Machen Sie es so", "Machen Sie's so"],
    },
  },
  {
    id: "live-long",
    source: "Vulcan salute (Spock); the dub used three readings over the years",
    lines: {
      en: ["Live long and prosper"],
      de: [
        "Lebe lang und in Frieden",
        "Lebe lange und in Frieden",
        "Lebe lang und erfolgreich",
        "Lebe lange und erfolgreich",
        "Langes Leben und Frieden",
      ],
      // Verified dub renderings (2026-07-04): Memory Alpha / Wikipedia language
      // editions + Wikiquote. es has separate Spain and Latin-America readings.
      fr: ["Longue vie et prospérité"],
      es: ["Larga vida y prosperidad", "Ten una larga y próspera vida"],
      it: ["Lunga vita e prosperità"],
      pt: ["Vida longa e próspera"],
      ja: ["長寿と繁栄を"],
    },
  },
  {
    id: "engage",
    source: "Picard (TNG); famously dubbed \"Energie!\"",
    lines: {
      en: ["Engage"],
      de: ["Energie"],
    },
  },
  {
    id: "resistance",
    source: "The Borg",
    lines: {
      en: ["Resistance is futile"],
      de: ["Widerstand ist zwecklos"],
    },
  },
  {
    id: "tea",
    source: "Picard's replicator order (TNG)",
    lines: {
      en: ["Tea. Earl Grey. Hot."],
      de: ["Tee. Earl Grey. Heiß."],
    },
  },
  {
    id: "fascinating",
    source: "Spock (TOS)",
    lines: {
      en: ["Fascinating"],
      de: ["Faszinierend"],
    },
  },
  {
    id: "space-frontier",
    source: "Opening narration",
    lines: {
      en: ["Space, the final frontier"],
      de: ["Der Weltraum, unendliche Weiten"],
      // Verified opening-narration dubs (2026-07-04): fr is the Québec/Sonolab
      // version aired in France; ja is Wakayama Genzō's TOS narration.
      fr: ["Espace, frontière de l'infini"],
      es: ["El espacio, la última frontera"],
      it: ["Spazio, ultima frontiera"],
      pt: ["Espaço, a fronteira final"],
      ja: ["宇宙、それは人類に残された最後の開拓地である"],
    },
  },
  {
    id: "hailing",
    source: "Uhura (TOS) — yes, answering the prompt with itself counts",
    lines: {
      en: ["Hailing frequencies open"],
      de: ["Grußfrequenzen geöffnet", "Grußfrequenzen offen", "Grußfrequenzen sind offen"],
    },
  },
  {
    id: "beam-me-up",
    source: "Folk-canonical — never said verbatim on screen",
    lines: {
      en: ["Beam me up, Scotty"],
      de: ["Beam mich hoch, Scotty", "Scotty, beam mich hoch"],
    },
  },
  {
    id: "darmok",
    source: "Tamarian (TNG \"Darmok\")",
    lines: {
      en: ["Darmok and Jalad at Tanagra"],
      de: ["Darmok und Jalad auf Tanagra"],
    },
  },
  {
    id: "qapla",
    source: "Klingon — success!",
    lines: {
      xx: ["Qapla'", "Qapla"],
    },
  },
  {
    id: "four-lights",
    source: "Picard (TNG \"Chain of Command\"); dub line is \"Da sind vier Lichter!\"",
    lines: {
      en: ["There are four lights"],
      de: ["Da sind vier Lichter", "Es gibt vier Lichter"],
    },
  },
  {
    id: "red-alert",
    source: "All hands — activates the alert palette",
    lines: {
      en: ["Red alert"],
      de: ["Roter Alarm"],
    },
  },
  {
    id: "hello-computer",
    source:
      "Scotty to the mouse (Star Trek IV: The Voyage Home); dub line \"Hallo Computer\" — unlocks the retro desktop theme instead of an LCARS variant",
    unlocksTheme: "win95",
    lines: {
      // Normalisation strips punctuation, so "Hello, computer" matches too.
      en: ["Hello computer"],
      de: ["Hallo Computer"],
    },
  },
];

/**
 * Normalises a spoken line for matching: NFKC, lower-case, unified
 * apostrophes, punctuation stripped, whitespace collapsed, ß→ss. Umlauts are
 * KEPT (ö ≠ oe) — `transliterate` additionally folds them so both spellings
 * of e.g. "Grußfrequenzen geöffnet" are accepted. The punctuation class also
 * covers Spanish inverted marks and the CJK marks NFKC leaves alone (。、「」…);
 * fullwidth forms (！？：，) are already folded to ASCII by NFKC.
 */
export function normalizeQuote(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/ß/g, "ss")
    .replace(/[.,;:!?"„“”‚«»…()\-–—¡¿。、・「」『』《》〈〉【】〔〕〜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Han/Hiragana/Katakana — CJK lines carry no canonical spaces, so matching
 * additionally tries a space-free form for them. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** ä→ae / ö→oe / ü→ue fallback so umlaut-free typing matches too. */
function transliterate(normalized: string): string {
  return normalized.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
}

let matchIndex: Map<string, string> | null = null;

function buildIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const quote of STAR_TREK_QUOTES) {
    for (const lines of Object.values(quote.lines)) {
      for (const line of lines) {
        const norm = normalizeQuote(line);
        index.set(norm, quote.id);
        index.set(transliterate(norm), quote.id);
        if (CJK_RE.test(norm)) index.set(norm.replace(/ /g, ""), quote.id);
      }
    }
  }
  return index;
}

/**
 * Returns the quote id for a recognised line (any language, any variant),
 * or null. Exact match after normalisation — deliberately no fuzzy matching,
 * a hailing frequency does not guess.
 */
export function matchStarTrekQuote(input: string): string | null {
  if (!matchIndex) matchIndex = buildIndex();
  const norm = normalizeQuote(input);
  if (!norm) return null;
  const candidates = [norm, transliterate(norm)];
  if (CJK_RE.test(norm)) candidates.push(norm.replace(/ /g, ""));
  for (const candidate of candidates) {
    const hit = matchIndex.get(candidate);
    if (hit) return hit;
  }
  return null;
}
