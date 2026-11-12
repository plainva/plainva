/**
 * In-memory diagnostics ring buffer (P4.2). Collects ERROR-level events —
 * sync failures, error toasts, uncaught errors — WITHOUT any note content, so
 * an export is safe to attach to a bug report. Vault-relative file paths may
 * appear in messages; the export header says so.
 */
import { formatBuildLine } from "../lib/buildInfo";
import { readIndexDiagnostics, type IDatabaseAdapter } from "@plainva/core";

export interface DiagEntry {
  ts: number;
  source: string;
  message: string;
}

const MAX_ENTRIES = 200;
const entries: DiagEntry[] = [];

const SECRET_FIELD = "password|pass|secret|client[_-]?id|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|authorization";
/**
 * URL query parameters that carry a credential, redacted only in a query
 * (after `?` or `&`): Google's `key`, an OAuth `code`, an Azure SAS `sig`, an
 * S3 presigned URL's signature, credential and session token. A "status
 * code=403" in prose is no credential and stays.
 */
const SECRET_QUERY = "key|code|sig|x-amz-signature|x-amz-credential|x-amz-security-token";
/** Request headers that carry an API key on their own line. */
const SECRET_HEADER = "x-goog-api-key|x-api-key|api-key|ocp-apim-subscription-key";

/** Best-effort redaction before diagnostic text enters the in-memory buffer.
 * The exporter never reads credential stores; this additionally protects
 * against provider/library errors that echo a request field or URL userinfo. */
export function redactDiagnosticText(input: string): string {
  return input
    .replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, "$1[REDACTED]")
    .replace(new RegExp(`(["']?(?:${SECRET_FIELD})["']?\\s*[:=]\\s*)["'][^"']*["']`, "gi"), "$1\"[REDACTED]\"")
    .replace(new RegExp(`((?:^|[?&\\s,;])(?:${SECRET_FIELD})\\s*=\\s*)[^&\\s,;]+`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`([?&](?:${SECRET_QUERY})=)[^&\\s,;]+`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`(\\b(?:${SECRET_HEADER})\\s*:\\s*)[^\\s,;]+`, "gi"), "$1[REDACTED]")
    // A bearer token on its own, without the header's name (a provider's error that quotes it).
    .replace(/(\bbearer\s+)[\w.~+/-]+=*/gi, "$1[REDACTED]")
    // A Dropbox access token on its own (`sl.` and a long run of token characters).
    .replace(/(?<![\w.])sl\.[\w-]{20,}/g, "[REDACTED]")
    // IMAP and SMTP sign-in lines a server or library echoes: `a1 LOGIN user pass`, `AUTH PLAIN <base64>`.
    .replace(/(\b[A-Za-z]?\d+\s+LOGIN\s+)\S+\s+\S+/gi, "$1[REDACTED]")
    .replace(/(\bAUTH(?:ENTICATE)?\s+(?:PLAIN|LOGIN|XOAUTH2)\s+)\S+/gi, "$1[REDACTED]")
    // An e-mail address (an IMAP or SMTP reply that names the mailbox), also
    // quoted-printable (`=40` for `@`): whose it is belongs in no bug report.
    .replace(/(?<![\w.%+-])[\w.%+-]+(?:@|=40)[\w-]+(?:\.[\w-]+)+/g, "[email]");
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

/**
 * What the index recorded about itself (`readIndexDiagnostics`: a kind and a
 * count, no path, no text), into this buffer — called by both shells right
 * after the vault's database is opened, so the export carries it.
 */
export async function logIndexDiagnostics(db: IDatabaseAdapter): Promise<void> {
  for (const diagnostic of await readIndexDiagnostics(db)) {
    logDiagnostic("index", `${diagnostic.kind}: the full-text index was built anew after a failed numbering (${diagnostic.count}×)`);
  }
}

/** The line of each repeated report, by what it reports: the count goes on the line, not a new line. */
const counted = new WeakMap<DiagEntry, { base: string; count: number }>();

/**
 * Like `logDiagnostic`, but a report that repeats anywhere in the buffer —
 * the same source and message, with other lines in between — counts on its
 * first line ("… (3×)") instead of taking a line each: an index pass that
 * fails the same way for a thousand files leaves one line.
 */
export function logDiagnosticCounted(source: string, message: string): void {
  const safe = redactDiagnosticText(message);
  const base = safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const seen = counted.get(entry);
    if (entry.source !== source || !seen || seen.base !== base) continue;
    seen.count += 1;
    entry.ts = Date.now();
    entry.message = `${base} (${seen.count}×)`;
    return;
  }
  const entry: DiagEntry = { ts: Date.now(), source, message: base };
  counted.set(entry, { base, count: 1 });
  entries.push(entry);
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
