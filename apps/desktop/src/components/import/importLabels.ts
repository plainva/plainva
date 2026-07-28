import type { TFunction } from 'i18next';
import { DEFAULT_IMPORT_LABELS, type ImportLabels } from '@plainva/core';

/**
 * Builds the strings the import engine writes into the user's vault.
 *
 * The core has no i18n runtime, so the shell resolves them here. Each key falls
 * back to its English default, which keeps a missing translation readable
 * instead of leaking a raw key into someone's notes.
 */
export function buildImportLabels(t: TFunction): ImportLabels {
  const pick = (key: string, fallback: string): string =>
    t(`import.report.${key}`, { defaultValue: fallback }) as string;
  const limit = (key: string, fallback: string): string =>
    t(`import.limits.${key}`, { defaultValue: fallback }) as string;

  const d = DEFAULT_IMPORT_LABELS;

  return {
    reportTitle: pick('title', d.reportTitle),
    reportDate: pick('date', d.reportDate),
    reportDuration: pick('duration', d.reportDuration),
    reportNotes: pick('notes', d.reportNotes),
    reportAttachments: pick('attachments', d.reportAttachments),
    reportDatabases: pick('databases', d.reportDatabases),
    reportDegraded: pick('degraded', d.reportDegraded),
    reportSkipped: pick('skipped', d.reportSkipped),
    reportLimitsHeading: pick('limitsHeading', d.reportLimitsHeading),
    reportIncompleteHeading: pick('incompleteHeading', d.reportIncompleteHeading),
    reportFilesHeading: pick('filesHeading', d.reportFilesHeading),
    statusImported: pick('statusImported', d.statusImported),
    statusSkipped: pick('statusSkipped', d.statusSkipped),
    statusDegraded: pick('statusDegraded', d.statusDegraded),
    renamedToAvoidOverwrite: pick('renamed', d.renamedToAvoidOverwrite),
    viewTable: t('database.viewTable', { defaultValue: d.viewTable }) as string,
    viewList: t('database.viewList', { defaultValue: d.viewList }) as string,
    viewBoard: t('database.viewBoard', { defaultValue: d.viewBoard }) as string,
    viewCalendar: t('database.viewCalendar', { defaultValue: d.viewCalendar }) as string,
    skippedAttachment: limit('skippedAttachment', d.skippedAttachment),
    entryFailed: pick('entryFailed', d.entryFailed),
    runStopped: pick('runStopped', d.runStopped),
    runCancelled: pick('runCancelled', d.runCancelled),
    skippedTrashed: pick('skippedTrashed', d.skippedTrashed),
    reportUndoHeading: pick('undoHeading', d.reportUndoHeading),
    reportUndoFolder: pick('undoFolder', d.reportUndoFolder),
    reportUndoVault: pick('undoVault', d.reportUndoVault),
    limitBinaryFilesInZip: limit('binaryInZip', d.limitBinaryFilesInZip),
    limitEvernoteAttachments: limit('evernoteAttachments', d.limitEvernoteAttachments),
    limitNotionFileDatabaseRows: limit('notionFileRows', d.limitNotionFileDatabaseRows),
    limitLogseqVerbatim: limit('logseqVerbatim', d.limitLogseqVerbatim),
    limitSimplenoteTrashed: limit('simplenoteTrashed', d.limitSimplenoteTrashed),
    limitKeepAttachments: limit('keepAttachments', d.limitKeepAttachments),
    limitKeepTrashed: limit('keepTrashed', d.limitKeepTrashed),
    degradedNotionBlockLimit: limit('notionBlockLimit', d.degradedNotionBlockLimit),
    degradedNotionNestedBlocks: limit('notionNestedBlocks', d.degradedNotionNestedBlocks),
    degradedBaseSerializer: limit('baseSerializer', d.degradedBaseSerializer),
  };
}
