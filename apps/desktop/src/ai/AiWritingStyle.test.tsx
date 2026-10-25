// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { STYLE_EXAMPLES_MAX, type EgressManifest, type StyleFeature } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiSendOverview, EMPTY_STYLE_STATE, styleFeatureText, styleOutcomeText, styleView, type AiStyleState } from "@plainva/ui";

/**
 * The writing style as both shells show it (plan KI-Harness P9-3, mockup
 * chapter 27): one model for the memory's section — each feature with the
 * numbers it rests on, the examples, what was taken out — and the send
 * overview's row and count of what a rule kept.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

const FEATURES: StyleFeature[] = [
  { key: "sentences", value: "short", unit: "words", length: 9 },
  { key: "paragraphs", value: "short", sentences: 1 },
  { key: "lists", value: "lists", share: 38 },
  { key: "headings", value: "headings", wordsPerHeading: 120 },
  { key: "address", value: "informal", language: "de", informal: 14, formal: 0 },
  { key: "emphasis", value: "none", count: 0, words: 1240 },
  { key: "emoji", value: "rare", count: 1, words: 1240 },
  { key: "exclamations", value: "rare", count: 1, sentences: 80 },
  { key: "dashes", value: "none", count: 0, sentences: 80 },
];

const state = (over: Partial<AiStyleState> = {}): AiStyleState => ({
  ...EMPTY_STYLE_STATE,
  available: true,
  examples: [
    { path: "Journal/Wochennotiz 41.md", title: "Wochennotiz 41", missing: false, deny: [] },
    { path: "Finanzen/Gehälter 2026.md", title: "Gehälter 2026", missing: false, deny: ["cloud"] },
  ],
  measured: FEATURES,
  features: FEATURES,
  words: 1240,
  ...over,
});

describe("the writing style's section", () => {
  it("says each feature with the numbers it rests on, in the reader's language", async () => {
    await i18n.changeLanguage("de");
    const rows = styleView(t, state(), "de").rows.map((row) => `${row.label} — ${row.desc}`);
    expect(rows).toEqual([
      "Kurze Sätze — im Mittel 9 Wörter je Satz",
      "Kurze Absätze — im Mittel 1 Satz je Absatz",
      "Schreibt gern in Listen — 38 % der Zeilen sind Listenpunkte",
      "Gliedert mit Überschriften — eine Überschrift auf rund 120 Wörter",
      "Spricht Leute mit „du“ an — „du“ 14-mal, „Sie“ nie",
      "Ohne Fettdruck — 0 fette Stellen in 1.240 Wörtern",
      "Selten Emojis — 1 Emoji in 1.240 Wörtern",
      "Kaum Ausrufezeichen — 1 Ausrufezeichen in 80 Sätzen",
      "Keine Gedankenstriche — 0 Gedankenstriche in 80 Sätzen",
    ]);
    await i18n.changeLanguage("en");
    expect(styleFeatureText(t, { key: "address", value: "formal", language: "fr", informal: 1, formal: 9 }, "en")).toEqual({ label: "Addresses people as “vous”", desc: "“tu” once, “vous” 9 times" });
    expect(styleFeatureText(t, { key: "sentences", value: "long", unit: "chars", length: 52 }, "en")).toEqual({ label: "Long sentences", desc: "about 52 characters per sentence" });
  });

  it("says why there is nothing to show, names what was taken out, and knows when the examples are full", async () => {
    await i18n.changeLanguage("en");
    expect(styleView(t, { ...EMPTY_STYLE_STATE, available: true }, "en").empty).toBe("No examples yet. Choose notes you wrote yourself: this device measures from them how you write.");
    expect(styleView(t, state({ measured: [], features: [], tooShort: true }), "en").empty).toBe("The examples are too short to measure anything yet. Choose more of your notes.");
    const gone = state({ examples: [{ path: "A.md", title: "A", missing: true, deny: [] }], measured: [], features: [] });
    expect(styleView(t, gone, "en").empty).toBe("The examples are too short to measure anything yet. Choose more of your notes.");
    expect(styleView(t, state({ measured: [], features: [] }), "en").empty).toBe("Nothing in the examples stands out clearly enough to measure.");
    // Everything taken out is no "nothing stands out": the rows are gone, the way back is not.
    const out = styleView(t, state({ features: [], removed: ["address", "dashes"] }), "en");
    expect([out.empty, out.removed]).toEqual([null, ["Form of address", "Dashes"]]);
    expect(styleView(t, state(), "en").summary).toBe("2 examples · 9 features");
    const full = Array.from({ length: STYLE_EXAMPLES_MAX }, (_, i) => ({ path: `N${i}.md`, title: `N${i}`, missing: false, deny: [] }));
    expect(styleView(t, state({ examples: full }), "en").full).toBe(true);
    expect(styleView(t, state(), "en").full).toBe(false);
  });

  it("says why an example was not taken", async () => {
    await i18n.changeLanguage("en");
    expect(styleOutcomeText(t, { ok: true })).toBeNull();
    expect(styleOutcomeText(t, { ok: false, reason: "full" })).toBe(`There are ${STYLE_EXAMPLES_MAX} examples already — remove one before you choose another.`);
    expect(styleOutcomeText(t, { ok: false, reason: "not-note" })).toBe("Only notes can be examples.");
    expect(styleOutcomeText(t, { ok: false, reason: "duplicate" })).toBe("This note is an example already.");
  });
});

const manifest = (style: EgressManifest["style"]): EgressManifest => ({
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [{ path: "Projects/Offer.md", title: "Offer", tier: "evidence", chars: 800, reasons: ["pinned"] }],
  dataClasses: style && style.features > 0 ? ["situation", "notes", "style"] : ["situation", "notes"],
  folders: ["Projects"],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
  excluded: [],
  estimatedTokens: 1700,
  tools: ["search_vault"],
  web: false,
  ...(style ? { style } : {}),
});

const text = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

describe("the send overview with the writing style", () => {
  it("has a row for it, counts what a rule kept, and names it as the kind that is new", async () => {
    await i18n.changeLanguage("en");
    const container = mount(
      <AiSendOverview manifest={manifest({ features: 5, examples: 3, withheld: 1, tokens: 60 })} growth={[{ kind: "dataClass", dataClass: "style" }]} onSend={() => {}} onCancel={() => {}} />,
    );
    expect(text(container, "ai-overview-style")).toBe("5 features · 3 examples");
    expect(container.textContent).toContain("1 writing-style example your rules block");
    expect(container.textContent).toContain("your writing style");
  });

  it("has no row where nothing of it goes — and still says that a rule kept the examples", async () => {
    await i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest({ features: 0, examples: 0, withheld: 2, tokens: 0 })} onSend={() => {}} onCancel={() => {}} />);
    expect(container.querySelector('[data-testid="ai-overview-style"]')).toBeNull();
    expect(container.textContent).toContain("2 writing-style examples your rules block");
    const none = mount(<AiSendOverview manifest={manifest(undefined)} onSend={() => {}} onCancel={() => {}} />);
    expect(none.textContent).not.toContain("writing-style");
  });
});
