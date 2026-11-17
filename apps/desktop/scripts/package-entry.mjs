// What a built package starts. Since 0.9.0 every package carries two
// programs: the app (plainva-desktop, Cargo.toml `default-run`) and the MCP
// helper (plainva-mcp, a console program). The Tauri CLI picks the main
// binary from `default-run`; this checks it in what was built, not in the
// CLI's source: the helper is in the package, and every entry a user or the
// system starts (a .desktop Exec line, CFBundleExecutable) names the app.
//
// The checks here read an extracted package tree; check-package-entry.sh
// extracts the Linux and macOS packages and calls package-entry-check.mjs,
// check-package-entry.ps1 does the same for the MSI and NSIS installers.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const MAIN = 'plainva-desktop';
export const HELPER = 'plainva-mcp';

const executable = (path) => {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

/**
 * The command line an Exec key of a .desktop file runs, as words — read the
 * way the Desktop Entry Specification says a launcher reads it: only the
 * [Desktop Entry] group (a [Desktop Action …] group has an Exec of its own),
 * spaces around `=` allowed, the string escapes (\s, \n, \t, \r, \\) undone
 * first, then double-quoted words with their backslash escapes. A leading
 * `env NAME=value …` (also `-u NAME`, `-i`) is a launcher's own way of
 * starting the program and is read through, so the first word is the
 * program itself.
 *
 * Returns `{ words }`, or `{ error }` with the reason for what is not read:
 * no Exec key in the group, an unclosed quote, an `env` option that changes
 * what the next word means (`-C dir`, `-S …`) or `env` without a program.
 *
 * Note: the AppRun wrapper of an AppImage (AppImageKit) takes the FIRST
 * `Exec=` line of the file, in whatever group. This reads the one of
 * [Desktop Entry], as desktop launchers do; where an AppImage's .desktop file
 * would put a different Exec first, the real AppImage start of
 * check-package-entry.sh (through AppRun) catches it.
 */
export function desktopCommand(text) {
  let group = null;
  let value;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      group = line;
      continue;
    }
    const m = /^Exec\s*=\s*(.*)$/.exec(line);
    if (m && group === '[Desktop Entry]') {
      value = m[1];
      break;
    }
  }
  if (value === undefined) return { error: 'no Exec key in its [Desktop Entry] group' };
  value = value.replace(/\\([sntr\\])/g, (_, c) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' })[c]);
  const words = [];
  let word = null;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === '\\' && i + 1 < value.length) word += value[++i];
      else if (c === '"') quoted = false;
      else word += c;
    } else if (c === '"') {
      quoted = true;
      word ??= '';
    } else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? '') + c;
  }
  if (quoted) return { error: `its Exec value has an unclosed quote: ${value}` };
  if (word !== null) words.push(word);
  if (!words.length) return { error: 'its Exec value is empty' };
  if (basename(words[0]) === 'env') {
    words.shift();
    while (words.length) {
      const w = words[0];
      if (w === '-u' || w === '--unset') words.splice(0, 2);
      else if (w.startsWith('--unset=') || w === '-i' || w === '--ignore-environment' || w === '-' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) words.shift();
      else if (w.startsWith('-')) return { error: `its Exec runs env with the option ${w}, which this check does not read` };
      else break;
    }
    if (!words.length) return { error: 'its Exec runs env without a program' };
  }
  return { words };
}

/** The program the Exec key of a .desktop file starts (its first word, without a path), or undefined. */
export function desktopExec(text) {
  const { words } = desktopCommand(text);
  return words ? basename(words[0]) : undefined;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const entity = (whole, e) => {
  if (e[0] !== '#') return XML_ENTITIES[e.toLowerCase()];
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  // Not a code point (e.g. &#99999999;): kept as written, never a crash.
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
};

/**
 * A <key>…</key><string>…</string> pair of an XML property list, the value
 * exactly as written (a plist string keeps its spaces) with entities
 * decoded; `''` for an empty `<string/>`, undefined without the key.
 */
export function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = new RegExp(`<key>${escaped}</key>\\s*(?:<string>([^<]*)</string>|<string\\s*/>)`).exec(xml);
  if (!raw) return undefined;
  return (raw[1] ?? '').replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, entity);
}

/**
 * An Info.plist as XML. A binary property list (`bplist00`, what Xcode and
 * `plutil -convert binary1` write) is converted with plutil where there is
 * one (macOS); elsewhere it is reported, not guessed at.
 */
export function readPlist(path, convert = (file) => execFileSync('plutil', ['-convert', 'xml1', '-o', '-', file], { encoding: 'utf8' })) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 6).toString('latin1') !== 'bplist') return { xml: bytes.toString('utf8') };
  try {
    return { xml: convert(path) };
  } catch (error) {
    return { error: `Contents/Info.plist is a binary property list and plutil could not read it (${String(error?.message ?? error).split('\n')[0]})` };
  }
}

const desktopFiles = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.desktop')).map((f) => join(dir, f));
  } catch {
    return [];
  }
};

/**
 * An extracted deb, rpm or AppImage (squashfs-root). Returns the problems
 * found; empty means the package starts the app and carries the helper.
 */
export function checkLinuxTree(root, { appimage = false } = {}) {
  const problems = [];
  for (const program of [MAIN, HELPER]) {
    if (!executable(join(root, 'usr/bin', program))) problems.push(`usr/bin/${program} is missing or not executable`);
  }
  // The AppImage's AppRun starts what the .desktop file at its root names;
  // deb and rpm install theirs under usr/share/applications.
  const entries = [...desktopFiles(join(root, 'usr/share/applications')), ...(appimage ? desktopFiles(root) : [])];
  if (!entries.length) problems.push('no .desktop file');
  for (const file of entries) {
    const rel = file.slice(root.length + 1);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      // A dangling link or a folder named *.desktop: reported, never a crash.
      problems.push(`${rel} cannot be read (${e?.code ?? e})`);
      continue;
    }
    const { words, error } = desktopCommand(text);
    if (error) problems.push(`${rel}: ${error}`);
    else if (basename(words[0]) !== MAIN) problems.push(`${rel} starts ${basename(words[0])}, not ${MAIN}`);
  }
  if (appimage && !executable(join(root, 'AppRun'))) problems.push('AppRun is missing or not executable');
  return problems;
}

/** A built Plainva.app: CFBundleExecutable is the app, and the helper is next to it. */
export function checkMacApp(app, { convert } = {}) {
  const problems = [];
  let read;
  try {
    read = readPlist(join(app, 'Contents/Info.plist'), convert);
  } catch {
    return ['Contents/Info.plist is missing'];
  }
  if (read.error) return [read.error];
  const plist = read.xml;
  const bundleExecutable = plistString(plist, 'CFBundleExecutable');
  if (bundleExecutable === undefined) problems.push(`CFBundleExecutable is not set, not ${MAIN}`);
  else if (bundleExecutable === '') problems.push(`CFBundleExecutable is empty, not ${MAIN}`);
  else if (bundleExecutable !== MAIN) problems.push(`CFBundleExecutable is ${bundleExecutable}, not ${MAIN}`);
  for (const program of [MAIN, HELPER]) {
    if (!executable(join(app, 'Contents/MacOS', program))) problems.push(`Contents/MacOS/${program} is missing or not executable`);
  }
  return problems;
}

const walk = (dir) => {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

/**
 * The parts that are new in 0.9.0, by size: the app, the helper and the ONNX
 * Runtime library, wherever the package puts them. For the record of a run,
 * not a check.
 */
export function partSizes(root) {
  const names = new Set([MAIN, HELPER, `${MAIN}.exe`, `${HELPER}.exe`]);
  return walk(root)
    .filter((file) => names.has(basename(file)) || /^(lib)?onnxruntime[.\w]*\.(so|dylib|dll)([.\d]*)$/.test(basename(file)))
    .map((file) => ({ path: relative(root, file), bytes: statSync(file).size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
