// `node apps/desktop/scripts/package-entry-check.mjs linux <root> [--appimage] <label>`
// `node apps/desktop/scripts/package-entry-check.mjs mac <Plainva.app> <label>`
// Fails unless the extracted package starts the app and carries the helper
// (package-entry.mjs).
import { checkLinuxTree, checkMacApp, HELPER, MAIN, partSizes } from './package-entry.mjs';

const [kind, path, ...rest] = process.argv.slice(2);
const appimage = rest.includes('--appimage');
const label = rest.filter((a) => a !== '--appimage')[0] ?? path;

let problems;
if (kind === 'linux') problems = checkLinuxTree(path, { appimage });
else if (kind === 'mac') problems = checkMacApp(path);
else {
  console.error(`::error::unknown package kind: ${kind}`);
  process.exit(2);
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${label}: ${problem}`);
  process.exit(1);
}
console.log(`${label}: starts ${MAIN}, carries ${HELPER}`);
for (const { path: part, bytes } of partSizes(path)) console.log(`  ${part}: ${bytes} bytes (${(bytes / 1048576).toFixed(2)} MiB)`);
