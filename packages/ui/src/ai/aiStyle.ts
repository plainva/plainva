import { STYLE_ADDRESS_WORDS, STYLE_EXAMPLES_MAX, STYLE_FEATURE_KEYS, type AiPolicyDimension, type StyleFeature, type StyleFeatureKey } from "@plainva/core";
import type { AiFileStore } from "./aiStores";

/**
 * The user's writing style on this device (plan KI-Harness P9-3, ADR 0035):
 * which notes are its examples, and which features the user took out. In the
 * app's data for this vault on this device, never in the vault — nothing of
 * it syncs, and no file in the vault could change it: the style of another
 * device is chosen there.
 *
 * What the features are is never stored: the device measures them again
 * whenever they are shown or used, so they follow the examples as those
 * change.
 */
export interface StylePrefs {
  /** Vault paths of the notes the user chose as examples, in the order chosen. */
  examples: string[];
  removed: StyleFeatureKey[];
}

export const EMPTY_STYLE_PREFS: StylePrefs = { examples: [], removed: [] };

export interface StylePrefStore {
  load(): Promise<StylePrefs>;
  save(prefs: StylePrefs): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The prefs as they were stored; a file that is missing or damaged chooses nothing. */
export function readStylePrefs(raw: string | null): StylePrefs {
  if (raw === null) return EMPTY_STYLE_PREFS;
  try {
    const value = JSON.parse(raw) as { version?: unknown; examples?: unknown; removed?: unknown };
    if (value.version !== 1) return EMPTY_STYLE_PREFS;
    const examples = Array.isArray(value.examples) ? value.examples.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 2000) : [];
    const removed = Array.isArray(value.removed) ? STYLE_FEATURE_KEYS.filter((key) => (value.removed as unknown[]).includes(key)) : [];
    return { examples: [...new Set(examples)].slice(0, STYLE_EXAMPLES_MAX), removed };
  } catch {
    return EMPTY_STYLE_PREFS;
  }
}

export function createStylePrefStore(files: AiFileStore, vaultKey: string): StylePrefStore {
  if (!SAFE_ID.test(vaultKey)) throw new Error("invalid vault key");
  const path = `${vaultKey}/style.json`;
  return {
    load: async () => readStylePrefs(await files.read(path).catch(() => null)),
    save: (prefs) => files.write(path, JSON.stringify({ version: 1, examples: prefs.examples.slice(0, STYLE_EXAMPLES_MAX), removed: prefs.removed })),
  };
}

/** One example as the view shows it. */
export interface StyleExample {
  path: string;
  title: string;
  /** The note is not there any more: it measures nothing until the user takes it out or it comes back. */
  missing: boolean;
  /** The note's rules that keep it from some readers: a reader it is kept from gets none of its features. */
  deny: AiPolicyDimension[];
}

/** The writing style as both shells show it, and as the composer offers it. */
export interface AiStyleState {
  /** This shell keeps a style for the open vault. */
  available: boolean;
  examples: StyleExample[];
  /** Every feature the examples show, the ones the user took out included. */
  measured: StyleFeature[];
  removed: StyleFeatureKey[];
  /** What goes into a conversation where the user chooses the style — before the rules of its reader. */
  features: StyleFeature[];
  /** The examples hold too little text to measure. */
  tooShort: boolean;
  words: number;
}

export const EMPTY_STYLE_STATE: AiStyleState = { available: false, examples: [], measured: [], removed: [], features: [], tooShort: false, words: 0 };

/** Why a choice of the writing style was not made. */
export type StyleRefusal = "no-vault" | "not-note" | "duplicate" | "full" | "failed";
export type StyleOutcome = { ok: true } | { ok: false; reason: StyleRefusal };

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Why an example was not taken, in the reader's words; null where it was. */
export function styleOutcomeText(t: Translate, outcome: StyleOutcome): string | null {
  if (outcome.ok) return null;
  switch (outcome.reason) {
    case "not-note":
      return t("ai.style.notNote");
    case "duplicate":
      return t("ai.style.duplicate");
    case "full":
      return t("ai.style.full", { max: STYLE_EXAMPLES_MAX });
    case "no-vault":
    case "failed":
      return t("ai.style.failed");
  }
}

/** A feature in the reader's words: what it says, and the numbers it rests on. */
export function styleFeatureText(t: Translate, feature: StyleFeature, language: string): { label: string; desc: string } {
  const number = new Intl.NumberFormat(language);
  const times = (count: number) => (count === 0 ? t("ai.style.never") : t("ai.style.times", { count, n: number.format(count) }));
  switch (feature.key) {
    case "sentences": {
      const label = feature.value === "short" ? t("ai.style.feature.sentencesShort") : feature.value === "long" ? t("ai.style.feature.sentencesLong") : t("ai.style.feature.sentencesMedium");
      const desc = feature.unit === "chars" ? t("ai.style.desc.chars", { count: feature.length, n: number.format(feature.length) }) : t("ai.style.desc.words", { count: feature.length, n: number.format(feature.length) });
      return { label, desc };
    }
    case "paragraphs":
      return {
        label: feature.value === "short" ? t("ai.style.feature.paragraphsShort") : t("ai.style.feature.paragraphsLong"),
        desc: t("ai.style.desc.paragraphs", { count: feature.sentences, n: number.format(feature.sentences) }),
      };
    case "lists":
      return {
        label: feature.value === "lists" ? t("ai.style.feature.lists") : t("ai.style.feature.prose"),
        desc: t("ai.style.desc.lists", { share: number.format(feature.share) }),
      };
    case "headings":
      return feature.value === "headings"
        ? { label: t("ai.style.feature.headings"), desc: t("ai.style.desc.headings", { words: number.format(feature.wordsPerHeading) }) }
        : { label: t("ai.style.feature.noHeadings"), desc: t("ai.style.desc.noHeadings", { words: number.format(feature.words) }) };
    case "address": {
      const said = STYLE_ADDRESS_WORDS[feature.language];
      return {
        label: t("ai.style.feature.address", { word: feature.value === "informal" ? said.informal : said.formal }),
        desc: t("ai.style.desc.address", { informal: said.informal, formal: said.formal, informalTimes: times(feature.informal), formalTimes: times(feature.formal) }),
      };
    }
    case "emphasis":
      return {
        label: feature.value === "none" ? t("ai.style.feature.noBold") : t("ai.style.feature.bold"),
        desc: t("ai.style.desc.bold", { count: feature.count, n: number.format(feature.count), words: number.format(feature.words) }),
      };
    case "emoji":
      return {
        label: feature.value === "none" ? t("ai.style.feature.noEmoji") : feature.value === "rare" ? t("ai.style.feature.emojiRare") : t("ai.style.feature.emojiOften"),
        desc: t("ai.style.desc.emoji", { count: feature.count, n: number.format(feature.count), words: number.format(feature.words) }),
      };
    case "exclamations":
      return {
        label: feature.value === "rare" ? t("ai.style.feature.exclamationsRare") : t("ai.style.feature.exclamationsOften"),
        desc: t("ai.style.desc.exclamations", { count: feature.count, n: number.format(feature.count), sentences: number.format(feature.sentences) }),
      };
    case "dashes":
      return {
        label: feature.value === "dashes" ? t("ai.style.feature.dashes") : t("ai.style.feature.noDashes"),
        desc: t("ai.style.desc.dashes", { count: feature.count, n: number.format(feature.count), sentences: number.format(feature.sentences) }),
      };
  }
}

/** A feature's name, whatever it measured: for the list of what the user took out. */
export function styleFeatureName(t: Translate, key: StyleFeatureKey): string {
  switch (key) {
    case "sentences":
      return t("ai.style.name.sentences");
    case "paragraphs":
      return t("ai.style.name.paragraphs");
    case "lists":
      return t("ai.style.name.lists");
    case "headings":
      return t("ai.style.name.headings");
    case "address":
      return t("ai.style.name.address");
    case "emphasis":
      return t("ai.style.name.emphasis");
    case "emoji":
      return t("ai.style.name.emoji");
    case "exclamations":
      return t("ai.style.name.exclamations");
    case "dashes":
      return t("ai.style.name.dashes");
  }
}

export interface StyleFeatureRow {
  key: StyleFeatureKey;
  label: string;
  desc: string;
}

/** What the style section of both shells shows: the examples, the features with their numbers, and what was taken out. */
export interface StyleView {
  examples: StyleExample[];
  rows: StyleFeatureRow[];
  /** The names of what the user took out, for one line with the way back. */
  removed: string[];
  /** Said instead of rows, where there are none: no examples yet, too little text, or nothing that stands out. */
  empty: string | null;
  /** "3 examples · 5 features" — the phone's summary and the overview's line. */
  summary: string;
  full: boolean;
}

export function styleView(t: Translate, state: AiStyleState, language: string): StyleView {
  const rows = state.features.map((feature) => ({ key: feature.key, ...styleFeatureText(t, feature, language) }));
  const present = state.examples.filter((example) => !example.missing).length;
  const empty = state.examples.length === 0 ? t("ai.style.empty") : present === 0 || state.tooShort ? t("ai.style.tooShort") : rows.length === 0 && state.measured.length === 0 ? t("ai.style.nothing") : null;
  return {
    examples: state.examples,
    rows,
    removed: state.removed.map((key) => styleFeatureName(t, key)),
    empty,
    summary: [t("ai.style.examplesCount", { count: state.examples.length }), t("ai.style.featuresCount", { count: state.features.length })].join(" · "),
    full: state.examples.length >= STYLE_EXAMPLES_MAX,
  };
}
