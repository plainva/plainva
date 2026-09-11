// Store release notes from the What's New catalog.
//
// Google Play ("What's new") and TestFlight ("What to Test") each take a short
// text per locale. Writing those by hand for ten languages at every cut would
// be a third copy of what the app already ships: the highlight TITLES in
// `packages/ui/src/locales/<lang>.json` and their order, version and
// experimental flags in `packages/ui/src/lib/whatsNew.ts`. This script derives
// the store texts from exactly those two sources, so the release definition of
// done (catalog entry + locale keys) is all it takes.
//
//   node apps/mobile/scripts/store-whatsnew.mjs <out-dir>
//
// writes one file per locale in the layout r0adkll/upload-google-play expects
// (`whatsnew-en-US`, `whatsnew-de-DE`, …). The TestFlight script reads the same
// directory and maps the file names to App Store Connect locales.
//
// Play caps a release note at 500 characters; the script fails the build when a
// language crosses it rather than letting Play reject the upload later.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWhatsNewBlogUrl } from "../../../packages/ui/src/lib/releaseBlog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

/** App language -> Play locale (file suffix). */
export const PLAY_LOCALES = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  ja: "ja-JP",
  nl: "nl-NL",
  pl: "pl-PL",
  "pt-BR": "pt-BR",
  "zh-CN": "zh-CN",
};

export const PLAY_LIMIT = 500;

/**
 * Reads the FIRST catalog entry of `whatsNew.ts` without executing TypeScript:
 * version, release date, and the experimental flag per highlight, in order.
 */
export function parseCatalog(source) {
  const start = source.indexOf("WHATS_NEW_CATALOG");
  if (start < 0) throw new Error("whatsNew.ts: no WHATS_NEW_CATALOG");
  const version = /version:\s*"([^"]+)"/.exec(source.slice(start))?.[1];
  if (!version) throw new Error("whatsNew.ts: first entry has no version");
  const block = /highlights:\s*\[([\s\S]*?)\]/.exec(source.slice(start))?.[1];
  if (!block) throw new Error("whatsNew.ts: first entry has no highlights");
  const highlights = [];
  for (const m of block.matchAll(/\{([^}]*)\}/g)) {
    highlights.push({ experimental: /experimental:\s*true/.test(m[1]) });
  }
  if (highlights.length === 0) throw new Error("whatsNew.ts: first entry lists no highlights");
  // Limit optional metadata to the first release; a hotfix without a blog
  // must not borrow the previous release's URL.
  const first = source.slice(start).split(/\bversion\s*:/)[1];
  const blogUrl = /blogUrl:\s*"([^"]+)"/.exec(first)?.[1];
  const languages = /blogLanguages:\s*(\[[^\]]*\])/.exec(first)?.[1];
  return { version, highlights, ...(blogUrl ? { blogUrl } : {}), ...(languages ? { blogLanguages: JSON.parse(languages) } : {}) };
}

/**
 * The note for one language. Title lines only — a sentence per highlight would
 * not fit ten languages into 500 characters, and the store note is a table of
 * contents for the dialog the app shows anyway.
 */
export function buildNote({ lang, version, highlights, strings, blogUrl, blogLanguages }) {
  const lines = [`Plainva ${version}`];
  highlights.forEach((h, i) => {
    const title = strings[`highlight${i + 1}Title`];
    if (!title) throw new Error(`${lang}: whatsNew.highlight${i + 1}Title is missing`);
    const pill = h.experimental && strings.experimental ? ` (${strings.experimental})` : "";
    lines.push(`• ${title}${pill}`);
  });
  const blog = getWhatsNewBlogUrl({ blogUrl, blogLanguages }, lang);
  if (blog) lines.push(blog.replace(/^https:\/\//, ""));
  return lines.join("\n");
}

export function buildAll({ catalogSource, readLocale }) {
  const release = parseCatalog(catalogSource);
  const { version } = release;
  const notes = {};
  for (const [lang, locale] of Object.entries(PLAY_LOCALES)) {
    const strings = readLocale(lang).whatsNew ?? {};
    const note = buildNote({ lang, ...release, strings });
    if ([...note].length > PLAY_LIMIT) {
      throw new Error(`${lang}: the store note has ${[...note].length} characters, Play allows ${PLAY_LIMIT}`);
    }
    notes[locale] = note;
  }
  return { version, notes };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node store-whatsnew.mjs <out-dir>");
    process.exit(2);
  }
  const catalogSource = readFileSync(join(repoRoot, "packages/ui/src/lib/whatsNew.ts"), "utf8");
  const readLocale = (lang) => JSON.parse(readFileSync(join(repoRoot, `packages/ui/src/locales/${lang}.json`), "utf8"));
  const { version, notes } = buildAll({ catalogSource, readLocale });
  const appVersion = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
  if (appVersion !== version) {
    // Not fatal: an interim build (0.8.0.3) legitimately ships the notes of the
    // last coordinated release. A mismatch on a coordinated tag is caught by
    // the release itself, which reads its version from the same package.json.
    console.warn(`store-whatsnew: catalog says ${version}, apps/mobile/package.json says ${appVersion}`);
  }
  mkdirSync(out, { recursive: true });
  for (const [locale, note] of Object.entries(notes)) {
    writeFileSync(join(out, `whatsnew-${locale}`), note + "\n", "utf8");
    console.log(`whatsnew-${locale}: ${[...note].length}/${PLAY_LIMIT}`);
  }
}
