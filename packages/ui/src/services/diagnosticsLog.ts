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

const SECRET_FIELD = "password|passwd|app[_-]?password|pass|secret|client[_-]?id|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|authorization|signature";
/**
 * URL query parameters that carry a credential, redacted only in a query or a
 * fragment (after `?`, `&` or `#`, also percent-encoded inside another URL):
 * Google's `key`, an OAuth `code`, an Azure SAS `sig`, an S3 presigned URL's
 * signature, credential and session token. A "status code=403" in prose is no
 * credential and stays.
 */
const SECRET_QUERY = "key|code|sig|x-amz-signature|x-amz-credential|x-amz-security-token";
/** Request headers that carry an API key on their own line. */
const SECRET_HEADER = "x-goog-api-key|x-api-key|api-key|ocp-apim-subscription-key";
/** A quoted string, an escaped quote inside it included. */
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;

/** Best-effort redaction before diagnostic text enters the in-memory buffer.
 * The exporter never reads credential stores; this additionally protects
 * against provider/library errors that echo a request field or URL userinfo. */
export function redactDiagnosticText(input: string): string {
  return input
    .replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[REDACTED]@")
    // An AWS signature header carries its signature among commas: the whole value goes.
    .replace(/(authorization\s*[:=]\s*)AWS4-HMAC-SHA256\s+[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, "$1[REDACTED]")
    // A cookie header: every cookie on the line.
    .replace(/(\b(?:set-)?cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(new RegExp(`(["']?\\b(?:${SECRET_FIELD})["']?\\s*[:=]\\s*)(?:${QUOTED})`, "gi"), "$1\"[REDACTED]\"")
    .replace(new RegExp(`((?:^|[?&#\\s,;])(?:${SECRET_FIELD})\\s*=\\s*)(?!"\\[REDACTED\\]")[^&\\s,;]+`, "gi"), "$1[REDACTED]")
    // `token: 1//0g…` without quotes; a value this long is no word of prose ("first pass: 3 files" stays).
    .replace(new RegExp(`((?:^|[\\s,;{(])(?:${SECRET_FIELD})\\s*:\\s*)(?!"\\[REDACTED\\]")[^\\s,;&"'}]{8,}`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`([?&#](?:${SECRET_QUERY})=)[^&\\s,;#"']+`, "gi"), "$1[REDACTED]")
    // The same inside a URL that is itself percent-encoded (`%3Fsig%3D…%26`).
    .replace(new RegExp(`((?:%3F|%26|%23|[?&#])(?:${SECRET_QUERY}|${SECRET_FIELD})%3D)(?:(?!%26|%23)[^&\\s,;#"'])+`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`(\\b(?:${SECRET_HEADER})\\s*:\\s*)[^\\s,;]+`, "gi"), "$1[REDACTED]")
    // A bearer token on its own, without the header's name (a provider's error that quotes it).
    .replace(/(\bbearer\s+)[\w.~+/-]+=*/gi, "$1[REDACTED]")
    // A JSON web token on its own (an id_token carries the address it was issued to).
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]*/g, "[REDACTED]")
    // A Dropbox token on its own (`sl.` or `sl.u.` and a long run of token characters).
    .replace(/(?<![\w.])sl\.(?=[\w.-]{20})[\w-]+(?:\.[\w-]+)*/g, "[REDACTED]")
    // IMAP and SMTP sign-in lines a server or library echoes: `a1 LOGIN user pass`, quoted or not; `AUTH PLAIN <base64>`.
    .replace(new RegExp(`(\\b[A-Za-z]?\\d+\\s+LOGIN\\s+)(?:${QUOTED}|\\S+)\\s+(?:${QUOTED}|\\S+)`, "gi"), "$1[REDACTED]")
    .replace(/(\bAUTH(?:ENTICATE)?\s+(?:PLAIN|LOGIN|XOAUTH2)\s+)\S+/gi, "$1[REDACTED]")
    // An e-mail address (an IMAP or SMTP reply that names the mailbox, a WebDAV
    // path with the user's name), also quoted-printable (`=40`) and
    // percent-encoded (`%40`) for `@`: whose it is belongs in no bug report.
    .replace(/(?<![\w.%+-])[\w.%+-]+(?:@|=40|%40)[\w-]+(?:\.[\w-]+)+/gi, "[email]");
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

/**
 * How the system ended the app once (release list F51), as the export carries
 * it: kept on the device and handed out only in the export the person shares
 * and on the phone's diagnostics screen.
 */
export interface DiagnosticsProcessExit {
  /** ISO time of the exit. */
  at: string;
  /** memory-limiter, low-memory, excessive-resources, crash, anr, user, other. */
  kind: string;
  /** The system's own words, scrubbed (`scrubExitText`). */
  description?: string;
  /** The build that ran then, where the platform keeps it. */
  build?: string;
  /** A crash: the exception's class, never its message. */
  exception?: string;
  /** Frame lines, scrubbed, at most `EXIT_MAX_FRAMES`. */
  frames?: string[];
}

/** The most exits an export carries, and the most frames and characters of each. */
export const EXIT_MAX_RECORDS = 10;
export const EXIT_MAX_FRAMES = 32;
const EXIT_MAX_LINE = 200;

/**
 * A text from the system or a frame line, without what could name a person's
 * files, accounts or places: a URL, a mail address and a path are replaced
 * (a native library keeps its file name - `libc.so` names no note), and the
 * line is cut to a fixed length. Applied before an exit is kept and again
 * when it is exported.
 */
export function scrubExitText(text: string): string {
  const cleaned = text
    .replace(/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/(?<![^\s@<>()])[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "<email>")
    .replace(/(?:~|\.{1,2})?(?:\/[^\s/:()"']+)+\/?/g, (path) => {
      const name = path.split("/").filter(Boolean).pop() ?? "";
      return /\.so(?:\.\d+)*$/.test(name) ? name : "<path>";
    })
    .replace(/[A-Za-z]:\\(?:[^\s\\:()"']+\\?)+/g, "<path>")
    // A file name without a folder: what a vault holds, by its ending.
    .replace(/(?<![^\s/\\:()"'<>])[^\s/\\:()"'<>]+\.(?:md|markdown|txt|canvas|base|csv|json|pdf|png|jpe?g|gif|webp|heic|svg|mp3|m4a|wav|mp4|mov|docx?|xlsx?|pptx?|zip|eml|ics)\b/gi, "<file>");
  return cleaned.length > EXIT_MAX_LINE ? `${cleaned.slice(0, EXIT_MAX_LINE)}…` : cleaned;
}

/**
 * Whether a text could name something of the person's: a URL, a mail
 * address, a path or a file name. A component name of the app itself
 * (`com.plainva.app/com.plainva.app.MainActivity`) is no path.
 */
function namesSomethingPrivate(text: string): boolean {
  const withoutComponents = text.replace(/(?<![\w.])[a-z]\w*(?:\.\w+)+\/[\w.$]+/gi, "component");
  return /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\//i.test(withoutComponents)
    || /\S@\S/.test(withoutComponents)
    || /\//.test(withoutComponents)
    || /[A-Za-z]:\\/.test(withoutComponents)
    // A file's ending - but not a package name: `org.json.JSONTokener` goes on with `.J`.
    || /\.(?:md|markdown|txt|canvas|base|csv|json|pdf|png|jpe?g|gif|webp|heic|svg|mp3|m4a|wav|mp4|mov|docx?|xlsx?|pptx?|zip|eml|ics)\b(?!\.\w)/i.test(withoutComponents);
}

/**
 * The system's descriptions an export carries: only these known shapes, and
 * only while they name nothing of the person's (release list F51, second
 * review: cutting out what looked like a path left words of folder and file
 * names standing). Anything else is dropped whole; the exit keeps its kind.
 */
const KNOWN_DESCRIPTIONS = [
  /^MemoryLimiter:\w+$/,
  /^Input dispatching timed out\b/i,
  /^(?:user request after error|remove task|stop app|crash|anr|low memory|lmk)\b/i,
  /^excessive (?:cpu|resource)/i,
  /^Namespace [A-Z_]+, Code 0x[0-9a-f]+/i,
  /^\d+(?:\.\d+)? s$/,
];

/** A frame in one of the shapes the plugins write; anything else is dropped. */
const KNOWN_FRAMES = [
  // Android, from an ANR's dump: `main: at a.B.c(B.java:12)`. The source in brackets is any name
  // without a path character - `String.java:3052`, `Native method` as the dump writes it,
  // `unavailable:0`, `D8$$SyntheticClass:0`, the WebView's `chromium-...aab-stable-...:94`.
  /^(?:(?:main|CapacitorPlugins): )?at [\w$.<>-]+\((?:[\w$.-]+(?::-?\d+)?|Native [Mm]ethod|Unknown Source(?::\d+)?)\)$/,
  // Android, from the app's crash handler: `at a.B.c:12`.
  /^at [\w$.<>-]+:(?:\d+|\?)$/,
  // Android, a native frame with its library's name only.
  /^(?:(?:main|CapacitorPlugins): )?native: #\d+ pc [0-9a-f]+ +[\w.+-]+\.so(?:\.\d+)*(?: \([^()/@]*\))*$/,
  // iOS, MetricKit: `Plainva +12345`.
  /^[\w.+-][\w .+-]* \+-?\d+$/,
];

function knownDescription(text: string): string | undefined {
  const trimmed = text.trim();
  if (namesSomethingPrivate(trimmed) || !KNOWN_DESCRIPTIONS.some((shape) => shape.test(trimmed))) return undefined;
  return trimmed.length > EXIT_MAX_LINE ? `${trimmed.slice(0, EXIT_MAX_LINE)}…` : trimmed;
}

function knownFrame(frame: string): string | undefined {
  // A native library keeps its file name - `libc.so` names no note - and loses its folder.
  const shortened = frame.replace(/(?<!\S)(?:\/[^\s/:()"']+)+\/([^\s/:()"']+\.so(?:\.\d+)*)/g, "$1").trim();
  // Known shape, and nothing in it that could name something of the person's (a file name, a path).
  return KNOWN_FRAMES.some((shape) => shape.test(shortened)) && !namesSomethingPrivate(shortened) ? shortened.slice(0, EXIT_MAX_LINE) : undefined;
}

/** One exit as kept: only what is known to name nothing of the person's, bounded. */
export function boundedProcessExit(exit: DiagnosticsProcessExit): DiagnosticsProcessExit {
  const out: DiagnosticsProcessExit = { at: exit.at, kind: exit.kind };
  // A crash's description can be its exception's message, which carries what the app was handling: never kept.
  if (exit.description && exit.kind !== "crash") {
    const description = knownDescription(exit.description);
    if (description) out.description = description;
  }
  if (exit.build && /^[\w.() -]{1,40}$/.test(exit.build)) out.build = exit.build;
  if (exit.exception && /^[\w$., -]{1,120}$/.test(exit.exception) && !namesSomethingPrivate(exit.exception)) out.exception = exit.exception;
  const frames = (exit.frames ?? []).slice(0, EXIT_MAX_FRAMES).map(knownFrame).filter((frame): frame is string => frame !== undefined);
  if (frames.length) out.frames = frames;
  return out;
}

export interface DiagnosticsAppInfo {
  appVersion: string;
  tauriVersion: string;
  /** Rendering engine, e.g. "Chromium 124.0.0.0" (P4.1). */
  webView?: string;
  os: string;
  language: string;
  conflicts?: readonly import("@plainva/core").ConflictDiagnostic[];
  /** How the system ended the app lately (the phone; a desktop OS keeps no such record). */
  processExits?: readonly DiagnosticsProcessExit[];
  /** iOS: the system's daily counts of exits by cause, without a time of day (a memory kill has no diagnostic of its own). */
  dailyExits?: readonly { day: string; memory: number; other: number }[];
  /** The phone: the largest bridge messages per plugin method, this run and the one before (`bridgeMeter.ts`). */
  bridgePeaks?: readonly { startedAt: string; peaks: readonly { call: string; direction: string; size: number; at: string }[] }[];
  /** The phone: sizes of what it reads at start - its own files, the index, its largest tables. Numbers only. */
  storageSizes?: readonly (readonly [string, string])[];
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
  if (info.processExits) {
    lines.push("", "## How the system ended the app (newest first; no paths, no content)", "");
    if (info.processExits.length === 0) lines.push("(none recorded)");
    for (const raw of info.processExits.slice(0, EXIT_MAX_RECORDS)) {
      const exit = boundedProcessExit(raw);
      const facts = [exit.kind, exit.build ? `build ${exit.build}` : null, exit.exception ?? null].filter(Boolean).join(", ");
      lines.push(`- ${exit.at} ${facts}${exit.description ? `: ${exit.description}` : ""}`);
      if (exit.frames?.length) lines.push("  ```", ...exit.frames.map((frame) => `  ${frame}`), "  ```");
    }
  }
  if (info.bridgePeaks) {
    lines.push("", "## Largest bridge messages (per plugin method; sizes only, from 64 KB)", "");
    for (const [index, run] of info.bridgePeaks.slice(0, 2).entries()) {
      lines.push(`- ${index === 0 ? "This run" : "The run before"}, from ${scrubExitText(run.startedAt)}:${run.peaks.length === 0 ? " none" : ""}`);
      for (const peak of run.peaks.slice(0, 12)) {
        lines.push(`  - ${scrubExitText(peak.call).slice(0, 80)} ${peak.direction === "in" ? "in" : "out"} ${Number(peak.size) || 0} at ${scrubExitText(peak.at)}`);
      }
    }
  }
  if (info.storageSizes?.length) {
    lines.push("", "## Sizes of what the app reads at start (numbers only)", "");
    for (const [label, value] of info.storageSizes.slice(0, 24)) lines.push(`- ${scrubExitText(label).slice(0, 60)}: ${scrubExitText(value).slice(0, 120)}`);
  }
  if (info.dailyExits?.length) {
    lines.push("", "## Daily counts of exits by the system (per day, no time of day)", "");
    for (const day of info.dailyExits.slice(0, 7)) {
      lines.push(`- ${String(day.day).slice(0, 10)}: ${Number(day.memory) || 0} memory, ${Number(day.other) || 0} other`);
    }
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
