import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultImportRegistry } from '@plainva/core';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/ui/src/locales');
const everyLocale = () =>
  readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -'.json'.length), JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8'))] as const);

/**
 * The wizard reads what a source needs off the adapter, not off its id.
 *
 * Before this, `notion_api` was spelled out in six places in the wizard — so a
 * second API source would have been handed a file picker and a "choose a file
 * first" error nobody could satisfy, and it would have borrowed Notion's
 * instructions for creating a credential. These are the properties the wizard
 * relies on; a new adapter that forgets them fails here, not in front of a user.
 */
describe('what an import source declares about its input', () => {
  const sources = defaultImportRegistry.list();

  it('every source says how it is fed', () => {
    for (const source of sources) {
      const kind = source.inputKind ?? 'files';
      expect(['files', 'api'], `${source.id} declares an unknown inputKind`).toContain(kind);
    }
  });

  it('a file source offers at least one dialog, and only real ones', () => {
    for (const source of sources.filter((s) => (s.inputKind ?? 'files') === 'files')) {
      const modes = source.pickModes ?? ['files'];
      expect(modes.length, `${source.id} offers no way to pick anything`).toBeGreaterThan(0);
      for (const mode of modes) {
        expect(['files', 'folder'], `${source.id} asks for a dialog that does not exist`).toContain(mode);
      }
    }
  });

  it('an API source brings its own credential wording and link', () => {
    for (const source of sources.filter((s) => s.inputKind === 'api')) {
      expect(source.credentials, `${source.id} is an API source without credentials`).toBeDefined();
      expect(source.credentials!.url).toMatch(/^https:\/\//);
      // The prefix, not the finished strings: the wizard appends .label,
      // .step1..3, .open and .notStored to it. A typo here would put raw key
      // names on the screen, so the block has to exist in every language.
      const guideKey = source.credentials!.guideKey;
      expect(guideKey).toMatch(/^import\./);
      const [, blockKey] = guideKey.split('.');
      for (const [lang, bundle] of everyLocale()) {
        const block = bundle.import?.[blockKey];
        expect(block, `${lang} has no ${guideKey} block for ${source.id}`).toBeDefined();
        for (const part of ['label', 'step1', 'step2', 'step3', 'open', 'notStored']) {
          expect(typeof block[part], `${lang}: ${guideKey}.${part}`).toBe('string');
        }
      }
    }
    // And it never asks for files, because there are none to ask for.
    for (const source of sources.filter((s) => s.inputKind === 'api')) {
      expect(source.pickModes, `${source.id} is remote but offers a file dialog`).toBeUndefined();
    }
  });
});
