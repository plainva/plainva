/**
 * In-memory diagnostics ring buffer (P4.2). Collects ERROR-level events —
 * sync failures, error toasts, uncaught errors — WITHOUT any note content, so
 * an export is safe to attach to a bug report. Vault-relative file paths may
 * appear in messages; the export header says so.
 */
import { formatBuildLine } from "../lib/buildInfo";

export interface DiagEntry {
  ts: number;
  source: string;
  message: string;
}

const MAX_ENTRIES = 200;
const entries: DiagEntry[] = [];

const SECRET_FIELD = "password|pass|secret|client[_-]?id|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|authorization";

/** Best-effort redaction before diagnostic text enters the in-memory buffer.
 * The exporter never reads credential stores; this additionally protects
 * against provider/library errors that echo a request field or URL userinfo. */
export function redactDiagnosticText(input: string): string {
  return input
    .replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, "$1[REDACTED]")
    .replace(new RegExp(`(["']?(?:${SECRET_FIELD})["']?\\s*[:=]\\s*)["'][^"']*["']`, "gi"), "$1\"[REDACTED]\"")
    .replace(new RegExp(`((?:^|[?&\\s,;])(?:${SECRET_FIELD})\\s*=\\s*)[^&\\s,;]+`, "gi"), "$1[REDACTED]");
}

export function logDiagnostic(source: string, message: string): void {
  const safe = redactDiagnosticText(message);
  const text = safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
  const last = entries[entries.length - 1];
  // Collapse identical repeats (a failing 15-s sync would flood the buffer).
  if (last && last.source === source && last.message === text) {
    last.ts = Date.now();
    return;
  }
  entries.push({ ts: Date.now(), source, message: text });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function getDiagnostics(): readonly DiagEntry[] {
  return entries;
}

/** Test helper. */
export function clearDiagnosticsForTests(): void {
  entries.length = 0;
}

export interface DiagnosticsAppInfo {
  appVersion: string;
  tauriVersion: string;
  /** Rendering engine, e.g. "Chromium 124.0.0.0" (P4.1). */
  webView?: string;
  os: string;
  language: string;
  conflicts?: readonly import("@plainva/core").ConflictDiagnostic[];
}

/**
 * The export is a technical document for the (English) issue tracker, not UI
 * text: its headings stay English whatever the app language, like the error
 * lines it collects. Reporters paste it into issues as is (#105 carried a
 * German export under an English UI).
 */
export function formatDiagnosticsExport(info: DiagnosticsAppInfo): string {
  const lines = [
    "# Plainva diagnostics export",
    "",
    `- App: ${info.appVersion}`,
    `- Build: ${formatBuildLine() || "-"}`,
    `- Tauri: ${info.tauriVersion}`,
    `- WebView: ${info.webView ?? "-"}`,
    `- OS: ${info.os}`,
    `- Language: ${info.language}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
    "Note: contains NO note content; error messages may contain vault-relative file paths.",
    "",
    "## Events (newest last)",
    "",
  ];
  if (entries.length === 0) {
    lines.push("(no errors recorded in this session)");
  }
  for (const e of entries) {
    lines.push(`- ${new Date(e.ts).toISOString()} [${e.source}] ${e.message}`);
  }
  if (info.conflicts?.length) {
    // An explicit projection keeps note text and extra local metadata out.
    const conflicts = info.conflicts.map(({ at, pathHash, adapter, writer, diskHash, expectedLocalHash, baseSource, wasWrittenByUs, normalizationOnly, differentLineEndings, differentBom, differentFinalNewline }) =>
      ({ at, pathHash, adapter, writer, diskHash, expectedLocalHash, baseSource, wasWrittenByUs, normalizationOnly, differentLineEndings, differentBom, differentFinalNewline }));
    lines.push("", "## Local conflict diagnostics (no file names or note content)", "", "```json", redactDiagnosticText(JSON.stringify(conflicts, null, 2)), "```");
  }
  return lines.join("\n") + "\n";
}

let installed = false;

/** Captures uncaught errors/rejections into the buffer (idempotent). */
export function installGlobalDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    logDiagnostic("window.error", e.message || String(e.error ?? "unknown error"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    logDiagnostic("unhandledrejection", reason instanceof Error ? reason.message : String(reason));
  });
}
