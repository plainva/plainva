/**
 * In-memory diagnostics ring buffer (P4.2). Collects ERROR-level events —
 * sync failures, error toasts, uncaught errors — WITHOUT any note content, so
 * an export is safe to attach to a bug report. Vault-relative file paths may
 * appear in messages; the export header says so.
 */

export interface DiagEntry {
  ts: number;
  source: string;
  message: string;
}

const MAX_ENTRIES = 200;
const entries: DiagEntry[] = [];

export function logDiagnostic(source: string, message: string): void {
  const text = message.length > 500 ? `${message.slice(0, 500)}…` : message;
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
}

export function formatDiagnosticsExport(info: DiagnosticsAppInfo): string {
  const lines = [
    "# Plainva Diagnose-Export",
    "",
    `- App: ${info.appVersion}`,
    `- Tauri: ${info.tauriVersion}`,
    `- WebView: ${info.webView ?? "-"}`,
    `- OS: ${info.os}`,
    `- Sprache: ${info.language}`,
    `- Exportiert: ${new Date().toISOString()}`,
    "",
    "Hinweis: Enthält KEINE Notizinhalte; Fehlermeldungen können Vault-relative Dateipfade enthalten.",
    "",
    "## Ereignisse (neueste zuletzt)",
    "",
  ];
  if (entries.length === 0) {
    lines.push("(keine aufgezeichneten Fehler in dieser Sitzung)");
  }
  for (const e of entries) {
    lines.push(`- ${new Date(e.ts).toISOString()} [${e.source}] ${e.message}`);
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
