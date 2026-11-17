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
 * spaces around `=` allowed, the string escapes (\\s, \\n, \\t, \\r, \\\\) undone
 * first, then double-quoted words with their backslash escapes. A leading
 * `env NAME=value …` is a launcher's own way of starting the program and is
 * read through, so the first word is the program itself.
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
  if (value === undefined) return undefined;
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
  if (word !== null) words.push(word);
  if (basename(words[0] ?? '') === 'env') {
    words.shift();
    while (words.length) {
      if (words[0] === '-u' || words[0] === '--unset') words.splice(0, 2);
      else if (words[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      else break;
    }
  }
  return words.length ? words : undefined;
}

/** The program the Exec key of a .desktop file starts (its first word, without a path). */
export function desktopExec(text) {
  const words = desktopCommand(text);
  return words ? basename(words[0]) : undefined;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** A top-level <key>…</key><string>…</string> pair of an XML property list, entities decoded. */
export function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*(?:<string>([^<]*)</string>|<string\\s*/>)`).exec(xml);
  if (!raw) return undefined;
  return (raw[1] ?? '').trim().replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()],
  );
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
    const exec = desktopExec(readFileSync(file, 'utf8'));
    if (exec !== MAIN) problems.push(`${file.slice(root.length + 1)} starts ${exec ?? 'nothing'}, not ${MAIN}`);
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
  if (bundleExecutable !== MAIN) problems.push(`CFBundleExecutable is ${bundleExecutable ?? 'not set'}, not ${MAIN}`);
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
