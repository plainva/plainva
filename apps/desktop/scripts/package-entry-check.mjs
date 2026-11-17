// `node apps/desktop/scripts/package-entry-check.mjs linux <root> [--appimage] <label>`
// `node apps/desktop/scripts/package-entry-check.mjs mac <Plainva.app> <label>`
// `node apps/desktop/scripts/package-entry-check.mjs exec <file.desktop>` prints
// the program its Exec key starts (the first word, as the launcher reads it).
// Fails unless the extracted package starts the app and carries the helper
// (package-entry.mjs). A failure it names itself marks $PLAINVA_REPORTED (when
// set), so check-package-entry.sh does not name it a second time; a crash
// leaves no mark and is named there.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkLinuxTree, checkMacApp, desktopCommand, HELPER, MAIN, partSizes } from './package-entry.mjs';

const reported = () => {
  if (process.env.PLAINVA_REPORTED) writeFileSync(process.env.PLAINVA_REPORTED, '');
};

const [kind, path, ...rest] = process.argv.slice(2);
if (kind === 'exec') {
  const { words, error } = desktopCommand(readFileSync(path, 'utf8'));
  if (error) {
    console.error(`::error::${path}: ${error}`);
    reported();
    process.exit(1);
  }
  console.log(words[0]);
  process.exit(0);
}
const appimage = rest.includes('--appimage');
const label = rest.filter((a) => a !== '--appimage')[0] ?? path;

let problems;
if (kind === 'linux') problems = checkLinuxTree(path, { appimage });
else if (kind === 'mac') problems = checkMacApp(path);
else {
  console.error(`::error::unknown package kind: ${kind}`);
  reported();
  process.exit(2);
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${label}: ${problem}`);
  reported();
  process.exit(1);
}
console.log(`${label}: starts ${MAIN}, carries ${HELPER}`);
for (const { path: part, bytes } of partSizes(path)) console.log(`  ${part}: ${bytes} bytes (${(bytes / 1048576).toFixed(2)} MiB)`);
