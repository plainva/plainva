import { describe, expect, it, vi } from "vitest";

// The 1:1 id check imports theme.ts, which pulls STORE_KEY from VaultContext —
// mock both so no real Tauri store is touched at module load.
vi.mock("../contexts/VaultContext", () => ({ STORE_KEY: "test-settings.json" }));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) },
}));

import { STAR_TREK_QUOTES, matchStarTrekQuote, normalizeQuote } from "./startrekQuotes";
import { AVAILABLE_THEMES, LCARS_VARIANTS } from "./theme";

describe("normalizeQuote", () => {
  it("lower-cases, strips punctuation and collapses whitespace", () => {
    expect(normalizeQuote("  Make   it SO!!! ")).toBe("make it so");
    expect(normalizeQuote("Tea. Earl Grey. Hot.")).toBe("tea earl grey hot");
  });

  it("folds ß to ss but keeps umlauts", () => {
    expect(normalizeQuote("Tee. Earl Grey. Heiß.")).toBe("tee earl grey heiss");
    expect(normalizeQuote("Grußfrequenzen geöffnet.")).toBe("grussfrequenzen geöffnet");
  });

  it("unifies apostrophe variants", () => {
    expect(normalizeQuote("Qapla’")).toBe("qapla'");
    expect(normalizeQuote("Machen Sie’s so")).toBe("machen sie's so");
  });

  it("strips Spanish inverted marks and CJK punctuation (fullwidth folds via NFKC)", () => {
    expect(normalizeQuote("¡Fascinante!")).toBe("fascinante");
    expect(normalizeQuote("¿Fascinante?")).toBe("fascinante");
    expect(normalizeQuote("「宇宙、それは最後のフロンティア。」")).toBe("宇宙 それは最後のフロンティア");
    expect(normalizeQuote("红色警报！")).toBe("红色警报");
  });
});

describe("matchStarTrekQuote", () => {
  it("matches every catalogued line of every language", () => {
    for (const quote of STAR_TREK_QUOTES) {
      for (const lines of Object.values(quote.lines)) {
        for (const line of lines) {
          expect(matchStarTrekQuote(line), `line "${line}"`).toBe(quote.id);
        }
      }
    }
  });

  it("is case-, punctuation- and whitespace-insensitive", () => {
    expect(matchStarTrekQuote("make it so")).toBe("make-it-so");
    expect(matchStarTrekQuote("MAKE IT SO!")).toBe("make-it-so");
    expect(matchStarTrekQuote("  machen sie es so  ")).toBe("make-it-so");
    expect(matchStarTrekQuote("ENERGIE!!!")).toBe("engage");
  });

  it("accepts German lines regardless of app language (cross-language)", () => {
    expect(matchStarTrekQuote("Da sind vier Lichter!")).toBe("four-lights");
    expect(matchStarTrekQuote("Es gibt vier Lichter!")).toBe("four-lights");
    expect(matchStarTrekQuote("Widerstand ist zwecklos.")).toBe("resistance");
    expect(matchStarTrekQuote("Roter Alarm")).toBe("red-alert");
  });

  it("accepts umlaut-free typing via transliteration", () => {
    expect(matchStarTrekQuote("Grussfrequenzen geoeffnet")).toBe("hailing");
    expect(matchStarTrekQuote("Tee, Earl Grey, heiss")).toBe("tea");
  });

  it("accepts all three dub readings of the Vulcan salute", () => {
    expect(matchStarTrekQuote("Lebe lang und in Frieden")).toBe("live-long");
    expect(matchStarTrekQuote("Lebe lang und erfolgreich")).toBe("live-long");
    expect(matchStarTrekQuote("Langes Leben und Frieden")).toBe("live-long");
  });

  it("recognises Scotty's line to the mouse in both languages (win95 unlock)", () => {
    expect(matchStarTrekQuote("Hello, computer!")).toBe("hello-computer");
    expect(matchStarTrekQuote("hallo computer")).toBe("hello-computer");
    expect(matchStarTrekQuote("Hallo, Computer?")).toBe("hello-computer");
  });

  it("rejects near-misses, supersets and noise — a hailing frequency does not guess", () => {
    expect(matchStarTrekQuote("")).toBeNull();
    expect(matchStarTrekQuote("   ")).toBeNull();
    expect(matchStarTrekQuote("make it so please")).toBeNull();
    expect(matchStarTrekQuote("resistance")).toBeNull();
    expect(matchStarTrekQuote("hello world")).toBeNull();
    expect(matchStarTrekQuote("Es gibt fünf Lichter")).toBeNull();
  });
});

describe("catalogue consistency", () => {
  it("variant-quote ids and LCARS variant ids match 1:1 (theme-unlock quotes excluded)", () => {
    const quoteIds = STAR_TREK_QUOTES.filter((q) => !q.unlocksTheme).map((q) => q.id).sort();
    const variantIds = LCARS_VARIANTS.map((v) => v.id).sort();
    expect(quoteIds).toEqual(variantIds);
  });

  it("theme-unlock quotes point at a gated registry theme", () => {
    const gated = STAR_TREK_QUOTES.filter((q) => q.unlocksTheme);
    expect(gated.map((q) => q.id)).toEqual(["hello-computer"]);
    for (const q of gated) {
      const def = AVAILABLE_THEMES.find((t) => t.id === q.unlocksTheme);
      expect(def, `theme ${q.unlocksTheme} missing`).toBeTruthy();
      expect(def!.unlock).toBe("easteregg");
    }
  });

  it("has no duplicate accepted lines across quotes", () => {
    const seen = new Map<string, string>();
    for (const quote of STAR_TREK_QUOTES) {
      for (const lines of Object.values(quote.lines)) {
        for (const line of lines) {
          const norm = normalizeQuote(line);
          expect(seen.has(norm), `"${line}" duplicates ${seen.get(norm)}`).toBe(false);
          seen.set(norm, quote.id);
        }
      }
    }
  });
});
