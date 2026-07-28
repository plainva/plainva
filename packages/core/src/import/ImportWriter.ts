import { ensureOkfFrontmatter } from '../frontmatter-surgical.js';
import { ImportLabels, ImportOptions, ImportReport, ImportReportItem, ImportSourceId } from './ImportTypes.js';

/**
 * Shared write path for every import adapter.
 *
 * Three guarantees the adapters must never re-implement:
 *
 * 1. **A note is never overwritten.** Importing runs into the vault the user
 *    already has open, so a colliding file name would silently destroy their
 *    work. Colliding targets are numbered (`Note (2).md`) instead.
 * 2. **The report is honest.** Content that was dropped or truncated is
 *    recorded as `skipped`/`degraded` and surfaces in the report, so a partial
 *    import can never present itself as a complete one.
 * 3. **Imported notes are OKF documents.** Markdown gets the `type` +
 *    `okf_version` frontmatter every other Plainva write path stamps, so
 *    `.base` type filters see imported notes like any other note.
 */
export class ImportWriter {
  private readonly items: ImportReportItem[] = [];
  private readonly takenPaths = new Set<string>();
  private readonly ensuredFolders = new Set<string>();
  private readonly limitations: string[] = [];

  private notes = 0;
  private attachments = 0;
  private databases = 0;

  constructor(
    private readonly opts: ImportOptions,
    private readonly labels: ImportLabels
  ) {
    for (const entry of opts.archiveSkipped ?? []) {
      this.items.push({ path: entry.relativePath, status: 'skipped', details: entry.reason });
    }
  }

  /** Vault-relative prefix every write is placed under (may be empty). */
  get prefix(): string {
    return this.opts.targetSubfolder ? `${this.opts.targetSubfolder}/` : '';
  }

  private get adapter(): any | undefined {
    return this.opts.vaultAdapter;
  }

  /** Creates the target subfolder once, before the first write. */
  async ensureRoot(): Promise<void> {
    const root = this.prefix.replace(/\/$/, '');
    if (root) await this.ensureFolder(root);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || this.ensuredFolders.has(folder)) return;
    this.ensuredFolders.add(folder);
    if (!this.adapter) return;
    try {
      await this.adapter.createFolder(folder);
    } catch {
      // Directory already exists — createFolder is idempotent for our purposes.
    }
  }

  /**
   * Resolves a collision-free vault path for `relativePath`.
   *
   * Checks both the paths this run already claimed and what is on disk, so two
   * same-named source notes cannot overwrite each other either.
   */
  private async claimPath(relativePath: string): Promise<{ path: string; renamed: boolean }> {
    const full = `${this.prefix}${relativePath}`;
    const dot = full.lastIndexOf('.');
    const slash = full.lastIndexOf('/');
    const hasExt = dot > slash;
    const stem = hasExt ? full.slice(0, dot) : full;
    const ext = hasExt ? full.slice(dot) : '';

    let candidate = full;
    let counter = 1;
    // Cap the search so a pathological vault cannot spin here forever; the
    // suffix stays unique because the counter keeps climbing.
    while (counter < 1000 && (this.takenPaths.has(candidate) || (await this.pathExists(candidate)))) {
      counter += 1;
      candidate = `${stem} (${counter})${ext}`;
    }

    this.takenPaths.add(candidate);
    return { path: candidate, renamed: candidate !== full };
  }

  private async pathExists(path: string): Promise<boolean> {
    if (!this.adapter || typeof this.adapter.exists !== 'function') return false;
    try {
      return await this.adapter.exists(path);
    } catch {
      return false;
    }
  }

  /**
   * Writes an imported Markdown note: collision-safe, OKF-stamped, recorded.
   *
   * `details` describes content that could not be carried over; passing it
   * marks the note `degraded` rather than `imported`.
   */
  async writeNote(
    relativePath: string,
    content: string,
    options: { type?: string; details?: string } = {}
  ): Promise<string> {
    const { path, renamed } = await this.claimPath(relativePath);

    let body = content;
    if (this.opts.stampOkfMetadata !== false) {
      body = ensureOkfFrontmatter(content, { type: options.type ?? 'note' }).content;
    }

    await this.writeToDisk(path, body);
    this.notes += 1;

    const notes: string[] = [];
    if (options.details) notes.push(options.details);
    if (renamed) notes.push(this.labels.renamedToAvoidOverwrite);

    this.items.push({
      path,
      status: options.details ? 'degraded' : 'imported',
      details: notes.length > 0 ? notes.join(' · ') : undefined,
    });

    return path;
  }

  /** Writes a non-note file (e.g. a generated `.base`) without OKF stamping. */
  async writeFile(
    relativePath: string,
    content: string,
    kind: 'attachment' | 'database' = 'attachment',
    details?: string
  ): Promise<string> {
    const { path, renamed } = await this.claimPath(relativePath);
    await this.writeToDisk(path, content);

    if (kind === 'database') this.databases += 1;
    else this.attachments += 1;

    const notes: string[] = [];
    if (details) notes.push(details);
    if (renamed) notes.push(this.labels.renamedToAvoidOverwrite);

    this.items.push({
      path,
      status: details ? 'degraded' : 'imported',
      details: notes.length > 0 ? notes.join(' · ') : undefined,
    });

    return path;
  }

  private async writeToDisk(path: string, content: string): Promise<void> {
    if (!this.adapter) return;
    const slash = path.lastIndexOf('/');
    if (slash > 0) await this.ensureFolder(path.substring(0, slash));
    await this.adapter.writeTextFile(path, content);
  }

  /** Records source content that was not imported at all. */
  recordSkipped(path: string, details: string): void {
    this.items.push({ path, status: 'skipped', details });
  }

  /** Records content that was imported, but not in full. */
  recordDegraded(path: string, details: string): void {
    this.items.push({ path, status: 'degraded', details });
  }

  /**
   * Records a structural limit of this importer (e.g. "attachments are never
   * imported"). Listed once in the report, independent of the file count.
   */
  noteLimitation(text: string): void {
    if (!this.limitations.includes(text)) this.limitations.push(text);
  }

  get skippedCount(): number {
    return this.items.filter((i) => i.status === 'skipped').length;
  }

  get degradedCount(): number {
    return this.items.filter((i) => i.status === 'degraded').length;
  }

  /** Writes `Import report.md` and assembles the ImportReport. */
  async finish(source: { id: ImportSourceId; name: string }, startTime: number): Promise<ImportReport> {
    const durationMs = Date.now() - startTime;
    const l = this.labels;
    const statusLabel: Record<ImportReportItem['status'], string> = {
      imported: l.statusImported,
      skipped: l.statusSkipped,
      degraded: l.statusDegraded,
    };

    const lines: string[] = [
      `# ${l.reportTitle} (${source.name})`,
      '',
      `- **${l.reportDate}:** ${new Date(startTime).toISOString()}`,
      `- **${l.reportDuration}:** ${Math.round(durationMs / 1000)}s`,
      `- **${l.reportNotes}:** ${this.notes}`,
    ];
    if (this.attachments > 0) lines.push(`- **${l.reportAttachments}:** ${this.attachments}`);
    if (this.databases > 0) lines.push(`- **${l.reportDatabases}:** ${this.databases}`);
    if (this.degradedCount > 0) lines.push(`- **${l.reportDegraded}:** ${this.degradedCount}`);
    if (this.skippedCount > 0) lines.push(`- **${l.reportSkipped}:** ${this.skippedCount}`);

    if (this.limitations.length > 0) {
      lines.push('', `## ${l.reportLimitsHeading}`, '');
      lines.push(...this.limitations.map((text) => `- ${text}`));
    }

    const incomplete = this.items.filter((i) => i.status !== 'imported');
    if (incomplete.length > 0) {
      lines.push('', `## ${l.reportIncompleteHeading}`, '');
      lines.push(
        ...incomplete.map(
          (item) => `- **${statusLabel[item.status]}** — ${item.path}${item.details ? `: ${item.details}` : ''}`
        )
      );
    }

    lines.push('', `## ${l.reportFilesHeading}`, '');
    lines.push(
      ...this.items.map(
        (item) => `- [${statusLabel[item.status]}] ${item.path}${item.details ? ` — ${item.details}` : ''}`
      )
    );

    const summaryMarkdown = lines.join('\n');

    // The report itself is claimed like any other file, so a second import into
    // the same folder keeps the earlier report instead of replacing it.
    const { path: reportPath } = await this.claimPath('Import report.md');
    await this.writeToDisk(reportPath, summaryMarkdown);

    return {
      sourceId: source.id,
      sourceName: source.name,
      startedAt: new Date(startTime).toISOString(),
      durationMs,
      importedNotesCount: this.notes,
      importedAttachmentsCount: this.attachments,
      importedDatabasesCount: this.databases,
      degradedCount: this.degradedCount,
      skippedCount: this.skippedCount,
      reportPath,
      items: this.items,
      summaryMarkdown,
    };
  }
}
