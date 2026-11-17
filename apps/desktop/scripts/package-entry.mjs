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

/** The program an Exec= line of a .desktop file starts (its first word, without a path). */
export function desktopExec(text) {
  const line = text.split('\n').find((l) => l.startsWith('Exec='));
  if (!line) return undefined;
  const value = line.slice('Exec='.length).trim();
  const first = value.startsWith('"') ? value.slice(1, value.indexOf('"', 1)) : value.split(/\s+/)[0];
  return basename(first);
}

/** A <key>…</key><string>…</string> pair of an XML property list. */
export function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1];
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
export function checkMacApp(app) {
  const problems = [];
  let plist;
  try {
    plist = readFileSync(join(app, 'Contents/Info.plist'), 'utf8');
  } catch {
    return ['Contents/Info.plist is missing'];
  }
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
