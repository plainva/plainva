import {
  EMBEDDING_MODELS,
  FIRST_RUN_SECTIONS,
  QUERY_SECTIONS,
  embeddingPackageBytes,
  type BudgetKey,
  type EmbeddingModelSpec,
  type EmbeddingProgress,
  type ModelFailure,
  type SemanticSource,
} from "@plainva/core";
import { aiFailureText } from "./aiSettingsModel";
import type { EngineState, MeasurementReport, UnusedEmbeddings } from "./localEmbeddings";

/**
 * What the settings say about search by meaning (plan KI-Harness P2a-4/P2a-5,
 * mockup chapter 10), derived once for both shells — the desktop card and the
 * phone's rows only draw it. Every catalog model is offered, and any model of
 * an own provider; the hints explain what was measured, nothing is excluded.
 */

type T = (key: string, options?: Record<string, unknown>) => string;

/** Why search by meaning does not compute, in words the reader can act on. */
export function semanticFailureText(t: T, engine: Extract<EngineState, { kind: "failed" }>): string {
  const target = engine.source.kind === "provider" ? engine.source.target : null;
  const provider = target?.provider.label ?? "";
  switch (engine.reason) {
    case "check":
      return t("ai.semantic.checkFailed");
    case "runtime":
      return t("ai.semantic.runtimeMissing");
    case "load":
      return t("ai.semantic.loadFailed", { reason: engine.detail });
    case "no-model":
      return t("ai.semantic.providerUnset");
    case "no-route":
      return t("ai.semantic.noRoute", { provider });
    case "encrypted":
      return t("ai.semantic.encrypted");
    case "provider":
      return engine.failure ? aiFailureText(t, engine.failure, provider, target?.model) : t("ai.semantic.loadFailed", { reason: engine.detail });
  }
}

/** Why the last run stopped: the provider's word where it gave one, the error otherwise. */
export function semanticRunFailureText(t: T, source: SemanticSource, failure: ModelFailure | null, detail: string): string {
  const target = source.kind === "provider" ? source.target : null;
  return failure ? aiFailureText(t, failure, target?.provider.label ?? "", target?.model) : t("ai.semantic.runFailed", { reason: detail });
}

/** Who computes while search by meaning is on. */
export function semanticReadyLine(t: T, source: SemanticSource): string {
  if (source.kind === "package") return t("ai.semantic.ready", { model: source.spec.name });
  return t("ai.semantic.readyProvider", { provider: source.target?.provider.label ?? "", model: source.target?.model ?? "" });
}

/** How far the vectors are, and how many notes the rules keep from a cloud. */
export function semanticProgressLine(t: T, progress: EmbeddingProgress, locale: string): string {
  const number = new Intl.NumberFormat(locale);
  const line = t("ai.semantic.progress", { done: number.format(progress.current), total: number.format(progress.total - progress.withheld) });
  return progress.withheld ? `${line} · ${t("ai.semantic.progressWithheld", { count: progress.withheld })}` : line;
}

/** "Granite R2 large (323 MB) · vectors of 2 other models" */
export function semanticUnusedLine(t: T, unused: UnusedEmbeddings, locale: string): string {
  const parts = unused.packages.map((spec) => `${spec.name} (${formatBytes(embeddingPackageBytes(spec), locale)})`);
  if (unused.spaces.length) parts.push(t("ai.semantic.unusedSpaces", { count: unused.spaces.length }));
  return parts.join(" · ");
}

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
          : t("ai.semantic.hintSlow"),
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

export interface MeasurementRow {
  key: BudgetKey;
  label: string;
  /** "6 minutes (budget 30 minutes)" */
  line: string;
  ok: boolean;
}

/** The device check's result as rows: what was measured, the value, the budget, whether it holds. */
export function measurementRows(t: T, report: MeasurementReport, locale: string): MeasurementRow[] {
  const number = new Intl.NumberFormat(locale);
  const seconds = (value: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 1 }).format(value);
  const millis = (value: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", unitDisplay: "short", maximumFractionDigits: 0 }).format(value);
  return report.checks.map((check) => {
    const [label, value, budget] =
      check.key === "firstRun"
        ? [t("ai.semantic.budgetFirstRun", { sections: number.format(FIRST_RUN_SECTIONS) }), formatDuration(check.value, locale), formatDuration(check.budget, locale)]
        : check.key === "changedNote"
          ? [t("ai.semantic.budgetChangedNote"), seconds(check.value), seconds(check.budget)]
          : check.key === "query"
            ? [t("ai.semantic.budgetQuery", { sections: number.format(QUERY_SECTIONS) }), millis(check.value), millis(check.budget)]
            : check.key === "memory"
              ? [t("ai.semantic.budgetMemory"), formatBytes(check.value, locale), formatBytes(check.budget, locale)]
              : [t("ai.semantic.budgetDownload"), formatBytes(check.value, locale), formatBytes(check.budget, locale)];
    return { key: check.key, label, line: t("ai.semantic.budgetLine", { value, budget }), ok: check.ok };
  });
}

/** The same as plain text, for the clipboard: the device and engine first, then one line per budget. */
export function measurementText(t: T, report: MeasurementReport, locale: string): string {
  const head = report.device === "desktop" ? t("ai.semantic.measuredDesktop") : t("ai.semantic.measuredPhone");
  return [
    `${head} ${report.measurement.engine} · ${report.at}`,
    ...measurementRows(t, report, locale).map((row) => `${row.ok ? "✓" : "✗"} ${row.label}: ${row.line} — ${row.ok ? t("ai.semantic.budgetOk") : t("ai.semantic.budgetOver")}`),
  ].join("\n");
}
