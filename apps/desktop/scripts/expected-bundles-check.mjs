// `node apps/desktop/scripts/expected-bundles-check.mjs <leg> [--list] [--target <dir>]`
// Fails unless every file of expected-bundles.mjs exists and is not empty;
// with --list it prints the paths (relative to the target directory) instead.
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appVersion, expectedBundles } from './expected-bundles.mjs';

const args = process.argv.slice(2);
const leg = args[0];
const at = args.indexOf('--target');
const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const target = at >= 0 ? resolve(args[at + 1]) : join(tauriDir, 'target');
const files = expectedBundles(leg, appVersion(tauriDir));

if (args.includes('--list')) {
  for (const file of files) console.log(file);
} else {
  const missing = files.filter((file) => {
    try {
      return statSync(join(target, file)).size === 0;
    } catch {
      return true;
    }
  });
  if (missing.length) {
    for (const file of missing) console.error(`::error::missing or empty after the build: ${file}`);
    process.exit(1);
  }
  console.log(`All ${files.length} files of ${leg} are there:\n${files.join('\n')}`);
}
