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
  | 'amplenote'
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
  | 'reflect'
  | 'tiddlywiki'
  | 'tana'
  | 'remnote'
  | 'html_folder';

export type ImportFamily = 'markdown' | 'json' | 'opml' | 'xml' | 'api';

/**
 * A toggle a source offers in the wizard.
 *
 * Only keys that a shipped importer actually reads may appear here — an option
 * that changes nothing is worse than no option at all.
 */
export type ImportOptionKey = 'preserveTimestamps' | 'includeTrashed';

/**
 * One option as the wizard renders it.
 *
 * The core has no i18n runtime, so a definition carries nothing but its stable
 * `key`; the shell translates `import.options.<key>` and its hint. That keeps a
 * new adapter a single file: it declares what it understands, and the wizard
 * renders it without knowing the source.
 */
export interface ImportOptionDef {
  key: ImportOptionKey;
  /** What the wizard pre-selects; `preserveTimestamps` is on, trash is off (G5). */
  defaultValue: boolean;
}

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
  viewPinboard: string;
  /** Recorded per attachment that was unpacked but not carried into the vault. */
  skippedAttachment: string;
  /** Recorded when one entry threw and the run carried on without it. */
  entryFailed: string;
  /** Recorded when the run itself stopped early; the report is written anyway. */
  runStopped: string;
  /** Recorded when the user stopped the run — a decision, not a failure. */
  runCancelled: string;
  /** Recorded when the same note was exported into two folders and imported once. */
  skippedDuplicate: string;
  /** Recorded per tiddler that is the wiki's own machinery rather than writing. */
  skippedTiddlyNonNote: string;
  /** Recorded per note that was left behind because it sits in the source's trash. */
  skippedTrashed: string;
  /** Heading of the report section that says how to undo the whole import. */
  reportUndoHeading: string;
  /** Undo for a subfolder import — the folder name is appended by the writer. */
  reportUndoFolder: string;
  /** Undo when the import created its own vault: delete that vault's folder. */
  reportUndoVault: string;
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
  /** Recorded when Roam block references were replaced by the text they pointed at. */
  degradedRoamBlockRefs: string;
  /** Recorded on a database whose row list the API stopped answering partway through. */
  degradedNotionRowsTruncated: string;
  /** Recorded when an HTML table or code block was flattened into plain text. */
  degradedHtmlStructure: string;
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
  viewPinboard: 'Pinboard',
  skippedAttachment: 'attachment — not imported',
  entryFailed: 'could not be imported',
  runStopped: 'the import stopped early — everything up to this point was written',
  runCancelled: 'you stopped the import — everything up to this point was written and can be deleted with the folder',
  skippedDuplicate: 'the same note is in the export twice — imported once, as',
  skippedTiddlyNonNote:
    'not a note — images, stylesheets and the wiki’s own configuration tiddlers are not imported.',
  skippedTrashed: 'in the trash — not imported',
  reportUndoHeading: 'Undoing this import',
  reportUndoFolder: 'Everything from this import is in one folder. Delete it and the import is undone:',
  reportUndoVault:
    'This import created its own vault. Delete that folder and the import is undone — nothing outside it was touched.',
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
  degradedRoamBlockRefs:
    'Block references were replaced by the text they pointed at — Plainva links notes, not blocks, so the reference itself is gone.',
  degradedNotionRowsTruncated:
    'Not all rows of this database could be loaded — Notion stopped answering partway through. Importing it again brings the rest.',
  degradedHtmlStructure:
    'A table or code block on this page was flattened into plain text — the HTML converter does not carry their structure over.',
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
  /**
   * Lets the user stop a running import.
   *
   * A large Notion workspace is minutes of sequential requests, and there was
   * no way out of it. Aborting is not a failure: the adapters stop between
   * entries, and the report still describes everything that already landed in
   * the vault — the folder is the undo.
   */
  signal?: AbortSignal;
  /** Attachment folder name, defaults to "Attachments" */
  attachmentsFolder?: string;
  /** Optional active IVaultAdapter instance to write files directly to disk */
  vaultAdapter?: any;
  /** Optional custom fetch function (e.g. Tauri plugin-http fetch) to bypass webview CORS */
  httpFetch?: typeof fetch;
  /**
   * Reads the bytes of an extracted archive entry (`UnpackedFile.sourcePath`).
   *
   * The extractor puts every entry in a temp folder, but core cannot reach the
   * file system — so without this the importers could see that an attachment
   * exists and still not carry it over. The shell supplies the reader; where it
   * is missing, attachments are reported as skipped rather than silently lost.
   */
  readSourceBytes?: (sourcePath: string) => Promise<Uint8Array | null>;
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
  
  /**
   * How specific this importer's `detect` is; higher is probed first.
   *
   * Auto-detection is a first-match-wins walk, and several sources legitimately
   * accept "a folder of Markdown". Without an order the winner would depend on
   * registration order, which is not a property anyone can reason about.
   * Sources that recognise their own signature (a Notion ID in the path, a
   * Logseq `journals/` folder, an ENEX document) rank above the generic
   * Markdown fallback, which sits last on purpose.
   */
  readonly detectPriority?: number;

  /**
   * Toggles this source understands, rendered generically by the wizard.
   *
   * Declared here rather than in the wizard so a new adapter stays one file.
   * Every entry must be read by this importer (or by the writer on its behalf):
   * the wizard renders whatever it finds, so a stale key would become a switch
   * that visibly does nothing.
   */
  readonly options?: readonly ImportOptionDef[];

  /**
   * Where this source's data comes from.
   *
   * `files` (the default) — an export lying on disk; the wizard asks for it
   * with the OS file dialog. `api` — a live service behind a credential; the
   * wizard asks for the credential instead and never demands a file.
   *
   * Declared here, not branched on in the wizard: `notion_api` used to be
   * spelled out in six places there, so the next API source would have been
   * handed a file picker and an "choose a file first" error nobody could
   * satisfy. It also decides whether the preview may re-run `analyze` when a
   * switch is flipped — for a remote source that is a network round trip per
   * click, which is why an API source keeps its numbers instead.
   */
  readonly inputKind?: 'files' | 'api';

  /**
   * Which OS dialogs make sense for this source (`inputKind: 'files'` only).
   *
   * A native dialog is EITHER a file picker OR a folder picker — every desktop
   * platform decides that when it opens. A source that accepts both therefore
   * gets two buttons; one that only ever means a directory (a Logseq graph)
   * gets one, and cannot be sent looking for a file that does not exist.
   * Order is the order the buttons appear in.
   */
  readonly pickModes?: readonly ('files' | 'folder')[];

  /**
   * How the user obtains the credential (`inputKind: 'api'` only).
   *
   * `guideKey` is an i18n key prefix: `<guideKey>.label`, `.step1`…`.step3`,
   * `.open` and `.notStored`. Each API source brings its own block, because
   * "create an internal integration" is Notion's wording, not a universal one.
   */
  readonly credentials?: {
    readonly url: string;
    readonly guideKey: string;
    /**
     * The API host this source talks to, as a bare origin.
     *
     * Declared because one shell has to ask permission before it may reach a
     * host at all: the phone routes every request through a native bridge with
     * an origin allowlist, and a host nobody registered is simply refused. The
     * desktop's HTTP plugin has no such gate and ignores this.
     *
     * On the adapter rather than in the wizard for the same reason as
     * `inputKind`: the second API source must not need an edit in a screen to
     * be able to make its first request.
     */
    readonly apiOrigin?: string;
  };

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
