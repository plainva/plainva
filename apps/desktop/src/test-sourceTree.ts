import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The files the source-scan guards read, read from disk once and shared
 * (Befunde 2026-09-24, Z2).
 *
 * Some two dozen guards scan the same trees — the code of both shells and
 * both packages, the user guide, the locale bundles — each by itself, and
 * several read the same files again in test after test. Unloaded a scan costs
 * a fraction of a second. Under a loaded commit hook, though, opening the
 * ~1 300 shipped files one by one took 10 to 26 seconds while listing the
 * trees still took half a second: the guards timed out at 20 s
 * (cascadeParents, storedValueCompare, localeParity) or had their timeouts
 * raised to 30 s, with nothing real to wait for.
 *
 * So a tree is still listed on every call — that stays cheap, and it is what
 * makes a new, changed or removed file visible — but a file's text comes from
 * a snapshot as long as its size and modification time are the ones recorded
 * with it. Only new and changed files are read from disk; the snapshot is then
 * rewritten for the next guard, in this run or the next. Within one test file
 * the texts are also kept in memory, and `sourceFile` answers from them.
 */

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The four code roots: both shells and both shared packages. */
export const CODE_ROOTS: readonly string[] = ["packages/core/src", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];

export interface SourceText {
  /** Repository-relative path with forward slashes. */
  rel: string;
  text: string;
}

const IS_TEST = /\.(test|spec)\.tsx?$/;

/** Which files of a tree a guard reads, by file name. */
const KINDS = {
  /** TypeScript that ships: `.ts`/`.tsx` without `.test`/`.spec`. */
  shipped: (name: string) => /\.tsx?$/.test(name) && !IS_TEST.test(name),
  /** Test files: `.test`/`.spec` `.ts`/`.tsx`. */
  tests: (name: string) => IS_TEST.test(name),
  /** All TypeScript, tests included. */
  code: (name: string) => /\.tsx?$/.test(name),
  /** Everything that holds source text: TypeScript, CSS and JSON. */
  text: (name: string) => /\.(ts|tsx|css|json)$/.test(name),
  /** Stylesheets. */
  css: (name: string) => /\.css$/.test(name),
  /** JSON: the locale bundles, Tauri's capabilities. */
  json: (name: string) => /\.json$/.test(name),
  /** Markdown: the user guide. */
  markdown: (name: string) => /\.md$/.test(name),
} as const;
export type SourceKind = keyof typeof KINDS;

/** Never part of a scanned tree: installs, build output and dot folders. */
const SKIP = (entry: string) => entry === "node_modules" || entry === "dist" || entry === "target" || entry.startsWith(".");

interface Entry extends SourceText {
  /** Size and modification time the text was read at. */
  stamp: string;
}

const memo = new Map<string, readonly SourceText[]>();
/** Every repository file this test file has read so far, by path. */
const known = new Map<string, string>();

/**
 * Every file of the given kind under the roots (repository-relative), in path
 * order. `base` and `cache` exist for the helper's own test.
 */
export function sourceTexts(
  roots: readonly string[],
  kind: SourceKind,
  base: string = REPO,
  cache: string = join(REPO, "node_modules", ".cache", "plainva-scan-guards"),
): readonly SourceText[] {
  const texts = roots.flatMap((root) => rootTexts(base, cache, root, kind));
  if (base === REPO) for (const { rel, text } of texts) known.set(rel, text);
  return texts;
}

/** Every shipped source file under the roots — by default the four code roots. */
export function shippedSources(roots: readonly string[] = CODE_ROOTS): readonly SourceText[] {
  return sourceTexts(roots, "shipped");
}

/** `sourceTexts` by repository-relative path, for guards that look files up. */
export function sourceMap(roots: readonly string[], kind: SourceKind): ReadonlyMap<string, string> {
  return new Map(sourceTexts(roots, kind).map(({ rel, text }) => [rel, text]));
}

/**
 * One file by its repository-relative path, read at most once per test file:
 * from a tree this file has already scanned, else from disk. Several guards
 * look at the same few files from test after test — the vault context six
 * times, one stylesheet in four checks. A missing file throws, as a read does.
 */
export function sourceFile(rel: string): string {
  let text = known.get(rel);
  if (text === undefined) {
    text = readFileSync(join(REPO, rel), "utf8");
    known.set(rel, text);
  }
  return text;
}

function rootTexts(base: string, cache: string, root: string, kind: SourceKind): readonly SourceText[] {
  const listed: Array<{ rel: string; abs: string; stamp: string }> = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a root this checkout does not have
    }
    for (const entry of entries) {
      if (SKIP(entry)) continue;
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (KINDS[kind](entry)) listed.push({ rel: relative(base, abs).replace(/\\/g, "/"), abs, stamp: `${stat.size}:${stat.mtimeMs}` });
    }
  };
  walk(join(base, root));
  listed.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const key = createHash("sha1").update(`${base}\n${kind}\n${listed.map((f) => `${f.rel}\t${f.stamp}`).join("\n")}`).digest("hex");
  const inMemory = memo.get(key);
  if (inMemory) return inMemory;

  const snapshot = join(cache, `${kind}-${createHash("sha1").update(`${base}\n${root}`).digest("hex").slice(0, 16)}.json`);
  const recorded = new Map<string, Entry>();
  try {
    for (const entry of (JSON.parse(readFileSync(snapshot, "utf8")) as { files: Entry[] }).files) recorded.set(entry.rel, entry);
  } catch {
    // no snapshot yet, or an unreadable one: every file is read from disk
  }
  let fromDisk = 0;
  const entries: Entry[] = listed.map((f) => {
    const previous = recorded.get(f.rel);
    if (previous && previous.stamp === f.stamp) return previous;
    fromDisk++;
    return { rel: f.rel, stamp: f.stamp, text: readFileSync(f.abs, "utf8") };
  });
  const texts = entries.map(({ rel, text }) => ({ rel, text }));
  memo.set(key, texts);

  if (fromDisk > 0 || recorded.size !== entries.length) {
    try {
      // Written aside and renamed, so a guard in another worker reads either
      // the old snapshot or the new one, never half of one.
      mkdirSync(cache, { recursive: true });
      const temp = `${snapshot}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ files: entries }));
      renameSync(temp, snapshot);
    } catch {
      // the snapshot only saves time; the texts in hand are complete
    }
  }
  return texts;
}
