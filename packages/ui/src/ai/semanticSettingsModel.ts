import { EMBEDDING_MODELS, embeddingPackageBytes, type EmbeddingModelSpec } from "@plainva/core";

/**
 * What the settings say about search by meaning (plan KI-Harness P2a-4,
 * mockup chapter 10), derived once for both shells — the desktop card and the
 * phone's rows only draw it. Every catalog model is offered; the hints explain
 * what was measured, nothing is excluded.
 */

type T = (key: string, options?: Record<string, unknown>) => string;

/** A text of one sections' worth, in bytes: the vault's size divided by it gives a reference count. */
const BYTES_PER_SECTION = 1000;

/** Sizes as the reader's language writes them: "118 MB", "1.2 GB". */
export function formatBytes(bytes: number, locale: string): string {
  const gigabytes = bytes / 1e9;
  if (gigabytes >= 1) return new Intl.NumberFormat(locale, { style: "unit", unit: "gigabyte", maximumFractionDigits: 1 }).format(gigabytes);
  const megabytes = bytes / 1e6;
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: megabytes < 10 ? 1 : 0 }).format(megabytes);
}

/** A duration in minutes, or hours from an hour and a half on. */
export function formatDuration(minutes: number, locale: string): string {
  if (minutes >= 90) return new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "long", maximumFractionDigits: 1 }).format(minutes / 60);
  return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "long", maximumFractionDigits: 0 }).format(Math.max(1, Math.round(minutes)));
}

export interface SemanticModelRow {
  spec: EmbeddingModelSpec;
  /** "118 MB · Apache-2.0" */
  line: string;
  hint: string;
}

export function semanticModelRows(t: T, locale: string): SemanticModelRow[] {
  return EMBEDDING_MODELS.map((spec) => ({
    spec,
    // Two values and a separator: nothing in it to translate.
    line: `${formatBytes(embeddingPackageBytes(spec), locale)} · ${spec.licence.spdx}`,
    hint:
      spec.hint === "recommended"
        ? t("ai.semantic.hintRecommended")
        : spec.hint === "precise"
          ? t("ai.semantic.hintPrecise")
          : t("ai.semantic.hintSlowOnPhones"),
  }));
}

export interface LoadFacts {
  title: string;
  size: string;
  source: string;
  sourceNote: string;
  licence: string;
  licenceUrl: string;
  space: string | null;
  /** Set when the package does not fit into the free space. */
  spaceShort: string | null;
  duration: string;
}

/**
 * What the load dialog states before anything is fetched: size and its parts,
 * source and version, licence, free space, and a reference duration for this
 * vault — measured on the spike's laptop, so a reference, not a promise.
 */
export function loadFacts(t: T, spec: EmbeddingModelSpec, locale: string, vault: { noteBytes: number }, freeBytes: number | null): LoadFacts {
  const total = embeddingPackageBytes(spec);
  const sections = Math.max(1, Math.round(vault.noteBytes / BYTES_PER_SECTION));
  const minutes = sections / spec.referenceChunksPerSecond / 60;
  const number = new Intl.NumberFormat(locale);
  return {
    title: t("ai.semantic.loadTitle", { model: spec.name }),
    size: t("ai.semantic.sizeParts", {
      total: formatBytes(total, locale),
      model: formatBytes(spec.model.bytes, locale),
      vocabulary: formatBytes(spec.tokenizer.bytes + spec.tokenizerConfig.bytes, locale),
    }),
    source: t("ai.semantic.sourceLine", { repo: spec.repo, revision: spec.revision.slice(0, 7) }),
    sourceNote: t("ai.semantic.sourceChecked"),
    licence: spec.licence.spdx,
    licenceUrl: spec.licence.url,
    space: freeBytes === null ? null : formatBytes(freeBytes, locale),
    spaceShort: freeBytes !== null && freeBytes < total * 1.1 ? t("ai.semantic.spaceShort", { needed: formatBytes(total, locale) }) : null,
    duration: t("ai.semantic.durationLine", { sections: number.format(sections), time: formatDuration(minutes, locale) }),
  };
}
