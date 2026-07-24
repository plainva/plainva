/**
 * Core type definitions for Plainva's PKM Import Engine.
 * 
 * Supports importing notes, attachments, checklists, and database folders (.base)
 * from ~25 PKM apps into either a brand-new vault or a dedicated subfolder in
 * an existing vault.
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

export interface ImportOptions {
  /** Target root folder of the vault */
  targetVaultPath: string;
  /** Optional subfolder prefix within the vault (e.g. "Import Keep 2026-07-24") */
  targetSubfolder?: string;
  /** Whether to stamp newly imported notes with OKF metadata (type + okf_version) */
  stampOkfMetadata?: boolean;
  /** Whether to preserve file modified timestamps (mtime) */
  preserveTimestamps?: boolean;
  /** Attachment folder name, defaults to "Attachments" */
  attachmentsFolder?: string;
  /** Optional active IVaultAdapter instance to write files directly to disk */
  vaultAdapter?: any;
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
