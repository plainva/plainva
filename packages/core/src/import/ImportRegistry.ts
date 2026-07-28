import { ImportSource, ImportSourceId } from './ImportTypes.js';

/**
 * Registry for all available PKM Import Sources in Plainva.
 */
export class ImportRegistry {
  private sources = new Map<ImportSourceId, ImportSource>();

  register(source: ImportSource): void {
    this.sources.set(source.id, source);
  }

  get(id: ImportSourceId): ImportSource | undefined {
    return this.sources.get(id);
  }

  list(): ImportSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * The sources in detection order: most specific first.
   *
   * Several sources legitimately accept "a folder of Markdown", so a
   * first-match-wins walk over insertion order would make the answer depend on
   * the order `index.ts` happens to register them in. `detectPriority` states
   * the specificity instead; ties keep registration order (a stable sort).
   */
  probeOrder(): ImportSource[] {
    return Array.from(this.sources.values()).sort(
      (a, b) => (b.detectPriority ?? 0) - (a.detectPriority ?? 0)
    );
  }

  /**
   * Picks the importer that best fits a selection.
   *
   * Returns `null` when nothing recognised the input — the wizard then leaves
   * the user's own choice alone rather than guessing.
   */
  async detect(input: any): Promise<ImportSource | null> {
    for (const source of this.probeOrder()) {
      try {
        if (await source.detect(input)) {
          return source;
        }
      } catch {
        // Ignore detection errors in individual sources and continue probing
      }
    }
    return null;
  }
}

/** Global default registry instance */
export const defaultImportRegistry = new ImportRegistry();
