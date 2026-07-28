/**
 * Core type definitions for Plainva's PKM Import Engine.
 *
 * Imports notes, checklists and database folders (`.base`) into a dedicated
 * subfolder of the vault that is currently open.
 *
 * `ImportSourceId` reserves identifiers for sources we intend to support; the
 * sources that actually ship are the ones registered in `index.ts`. Only those
 * appear in the wizard, and only those may be described as supported.
 */

export type ImportSourceId =
  | 'obsidian'
  | 'notion_api'
  | 'notion_file'
  | 'evernote'
  | 'google_keep'
  | 'logseq'
  | 'simplenote'
  | 'generic_markdown'
  | 'joplin'
  | 'bear'
  | 'capacities'
  | 'notesnook'
  | 'supernotes'
  | 'heptabase'
  | 'upnote'
  | 'craft'
  | 'anytype'
  | 'standard_notes'
  | 'workflowy'
  | 'dynalist'
  | 'roam_research'
  | 'trilium'
  | 'reflect';

export type ImportFamily = 'markdown' | 'json' | 'opml' | 'xml' | 'api';

/**
 * One file handed to an importer — an archive entry, or a file the user picked.
 *
 * An archive is unpacked natively, so entries that are not text now reach the
 * importers too (they never did while the webview decoded text only). Such an
 * entry carries `isText: false` and an empty `content`; its bytes stay on disk
 * at `sourcePath`. An importer must report it instead of writing it out — an
 * empty file in the user's vault would be worse than an honest "skipped".
 */
export interface UnpackedFile {
  relativePath: string;
  content: string;
  /** Omitted means text: payloads assembled in code are always text. */
  isText?: boolean;
  /** Size of the entry in bytes, independent of how much text was decoded. */
  byteSize?: number;
  /** Absolute path of the extracted file, when it came out of an archive. */
  sourcePath?: string;
  /** Last modification of the source file in epoch milliseconds, when known. */
  mtimeMs?: number;
}

/** Whether an entry's `content` actually holds this file's text. */
export function isTextEntry(file: Pick<UnpackedFile, 'isText'>): boolean {
  return file.isText !== false;
}

/**
 * When a source note was created and last changed, in epoch milliseconds.
 *
 * Every source carries this in its own shape (Keep in microseconds, Notion as
 * ISO, ENEX as a compact UTC stamp); the adapters normalize to this one so the
 * writer has a single thing to stamp.
 */
export interface SourceTimestamps {
  createdMs?: number;
  modifiedMs?: number;
}

/**
 * Localized strings the import engine writes into the user's vault.
 *
 * The core has no i18n runtime, so the shell passes the translated strings in.
 * Every field has an English fallback in `DEFAULT_IMPORT_LABELS`, which is what
 * tests and non-UI callers get.
 */
export interface ImportLabels {
  reportTitle: string;
  reportDate: string;
  reportDuration: string;
  reportNotes: string;
  reportAttachments: string;
  reportDatabases: string;
  reportDegraded: string;
  reportSkipped: string;
  reportLimitsHeading: string;
  reportIncompleteHeading: string;
  reportFilesHeading: string;
  statusImported: string;
  statusSkipped: string;
  statusDegraded: string;
  renamedToAvoidOverwrite: string;
  /** Names of the views generated for an imported database — these land in the user's `.base` file. */
  viewTable: string;
  viewList: string;
  viewBoard: string;
  viewCalendar: string;
  /** Recorded per attachment that was unpacked but not carried into the vault. */
  skippedAttachment: string;
  /** Recorded when one entry threw and the run carried on without it. */
  entryFailed: string;
  /** Recorded when the run itself stopped early; the report is written anyway. */
  runStopped: string;
  /** Recorded per note that was left behind because it sits in the source's trash. */
  skippedTrashed: string;
  /** Structural limits reported per source. */
  limitBinaryFilesInZip: string;
  limitEvernoteAttachments: string;
  limitNotionFileDatabaseRows: string;
  limitLogseqVerbatim: string;
  limitSimplenoteTrashed: string;
  limitKeepAttachments: string;
  limitKeepTrashed: string;
  /** Recorded on a Notion page whose block list was cut off by the API page size. */
  degradedNotionBlockLimit: string;
  /** Recorded when nested Notion blocks (toggles, columns, sub-lists) were not descended into. */
  degradedNotionNestedBlocks: string;
  /** Recorded when a `.base` had to be written as raw JSON because no serializer was supplied. */
  degradedBaseSerializer: string;
}

export const DEFAULT_IMPORT_LABELS: ImportLabels = {
  reportTitle: 'Import report',
  reportDate: 'Date',
  reportDuration: 'Duration',
  reportNotes: 'Notes imported',
  reportAttachments: 'Attachments imported',
  reportDatabases: 'Databases imported',
  reportDegraded: 'Imported incompletely',
  reportSkipped: 'Skipped',
  reportLimitsHeading: 'What this importer cannot carry over',
  reportIncompleteHeading: 'Needs your attention',
  reportFilesHeading: 'All files',
  statusImported: 'IMPORTED',
  statusSkipped: 'SKIPPED',
  statusDegraded: 'INCOMPLETE',
  renamedToAvoidOverwrite: 'renamed so an existing note was not overwritten',
  viewTable: 'Table',
  viewList: 'List',
  viewBoard: 'Board',
  viewCalendar: 'Calendar',
  skippedAttachment: 'attachment — not imported',
  entryFailed: 'could not be imported',
  runStopped: 'the import stopped early — everything up to this point was written',
  skippedTrashed: 'in the trash — not imported',
  limitBinaryFilesInZip:
    'Attachments (images, PDFs) inside the archive are not imported — they are listed here and stay in your export.',
  limitEvernoteAttachments: 'Evernote attachments (images, PDFs) are not imported.',
  limitNotionFileDatabaseRows:
    'From a Notion file export, databases are created empty. Use the API import to bring their rows across.',
  limitLogseqVerbatim:
    'Logseq files are copied unchanged — `key:: value` properties and block references are not converted.',
  limitSimplenoteTrashed: 'Notes in the Simplenote trash were not imported.',
  limitKeepAttachments: 'Images attached to Google Keep notes are not imported.',
  limitKeepTrashed: 'Notes in the Google Keep trash were not imported.',
  degradedNotionBlockLimit:
    'Only the first part of this page was imported — very long Notion pages are truncated.',
  degradedNotionNestedBlocks:
    'Content nested inside toggles, columns or sub-lists was not imported.',
  degradedBaseSerializer:
    'This database was written in a raw format and may need to be re-saved in Plainva once.',
};

export interface ImportOptions {
  /** Target root folder of the vault */
  targetVaultPath: string;
  /** Optional subfolder prefix within the vault (e.g. "Import Keep 2026-07-24") */
  targetSubfolder?: string;
  /**
   * Whether to stamp newly imported notes with OKF metadata (type + okf_version).
   * Defaults to ON — imported notes are ordinary Plainva notes.
   */
  stampOkfMetadata?: boolean;
  /** Whether to preserve file modified timestamps (mtime) */
  preserveTimestamps?: boolean;
  /**
   * Whether notes the source keeps in its trash come across too.
   *
   * Default OFF (maintainer decision G5): someone who deleted a note in Keep
   * decided against it, and an import that quietly resurrects it makes the new
   * vault worse than the old one. The skipped notes are still named in the
   * report, so the decision is visible rather than silent.
   */
  includeTrashed?: boolean;
  /** Attachment folder name, defaults to "Attachments" */
  attachmentsFolder?: string;
  /** Optional active IVaultAdapter instance to write files directly to disk */
  vaultAdapter?: any;
  /** Optional custom fetch function (e.g. Tauri plugin-http fetch) to bypass webview CORS */
  httpFetch?: typeof fetch;
  /** Translated strings for everything written into the vault; English when omitted. */
  labels?: ImportLabels;
  /**
   * Entries the shell's archive extractor refused before any importer saw them
   * (oversized, symlink, unsafe path). They belong in the report: it is the
   * record the user keeps, and a skip that only ever showed in the preview
   * would be lost the moment the wizard closes. `reason` is already localized.
   */
  archiveSkipped?: Array<{ relativePath: string; reason: string }>;
  /**
   * Serializes a `.base` config to its on-disk form.
   *
   * The canonical serializer lives in `@plainva/ui` (it enforces Obsidian's
   * top-level key rules and the `note.` property prefix), which core cannot
   * import. The shell passes it in so generated databases go through exactly
   * the same writer as ones created in the app. Without it, importers fall
   * back to JSON and mark the database as degraded.
   */
  serializeBase?: (config: any) => string;
}

export interface ImportPlan {
  sourceId: ImportSourceId;
  sourceName: string;
  totalNotes: number;
  totalAttachments: number;
  totalDatabases: number;
  totalChecklists: number;
  warnings: string[];
  requiredSpaceBytes: number;
  estimatedDurationSec: number;
}

export interface ImportReportItem {
  path: string;
  /**
   * `imported` — carried over in full.
   * `degraded` — written, but content was lost (truncated page, dropped attachment).
   * `skipped`  — not written at all.
   *
   * Adapters must record the honest status: a partial import may never look complete.
   */
  status: 'imported' | 'skipped' | 'degraded';
  details?: string;
}

export interface ImportReport {
  sourceId: ImportSourceId;
  sourceName: string;
  startedAt: string;
  durationMs: number;
  importedNotesCount: number;
  importedAttachmentsCount: number;
  importedDatabasesCount: number;
  /** Files that were written but lost content. */
  degradedCount: number;
  /** Source content that was not written at all. */
  skippedCount: number;
  reportPath: string;
  items: ImportReportItem[];
  summaryMarkdown: string;
}

export interface ImportSource {
  readonly id: ImportSourceId;
  readonly name: string;
  readonly family: ImportFamily;
  readonly description: string;
  
  /** Automatically sniffs an input payload/file to determine if this importer handles it */
  detect(input: any): Promise<boolean>;
  
  /** Analyzes input files/payload to build an ImportPlan preview before executing */
  analyze(input: any, opts: ImportOptions): Promise<ImportPlan>;
  
  /** Executes the full import process and generates an ImportReport */
  run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport>;
}
