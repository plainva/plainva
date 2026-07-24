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
   * Attempts auto-detection of the appropriate importer for a given input payload/path/file.
   */
  async detect(input: any): Promise<ImportSource | null> {
    for (const source of this.sources.values()) {
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
