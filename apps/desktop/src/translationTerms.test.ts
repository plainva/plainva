import { describe, it, expect } from "vitest";
import { sourceFile, sourceTexts } from "./test-sourceTree";

// Terminology guard (Befunde 2026-09-24, E26). zh-CN had three names for the
// daily note side by side — 日记, 每日笔记 and, on the journal's day card, even
// 日志每日笔记 — so one thing read like two, and the journal (日志) blurred into
// it. The decision: 日记, Obsidian's term, everywhere; 日志 stays the journal.
// `docs/engineering/Translation_Glossary.md` records it; this guard keeps a
// retired variant from coming back through a new string, a guide page, a vault
// template or a tour lesson.

/** A term a language no longer uses, and the one it uses instead. */
const RETIRED: { lang: string; term: string; use: string }[] = [
  { lang: "zh-CN", term: "每日笔记", use: "日记" },
];

type Source = { path: string; text: string };

// Each file once; the guide pages from the scan guards' shared snapshot
// (test-sourceTree.ts).
function read(path: string): Source {
  return { path, text: sourceFile(path) };
}

/** Everything a language's reader sees in words: UI, guide, templates, tour. */
function sourcesOf(lang: string): Source[] {
  const guide = `docs/user/${lang}/`;
  return [
    read(`packages/ui/src/locales/${lang}.json`),
    read(`packages/ui/src/vaultTemplates/templates.${lang}.ts`),
    read(`packages/ui/src/vaultTemplates/tourLessons.${lang}.json`),
    ...sourceTexts(["docs/user"], "markdown")
      .filter(({ rel }) => rel.startsWith(guide) && !rel.slice(guide.length).includes("/"))
      .map(({ rel, text }) => ({ path: rel, text })),
  ];
}

function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = String(node);
  }
  return out;
}

function locale(lang: string): Record<string, string> {
  return flatten(JSON.parse(sourceFile(`packages/ui/src/locales/${lang}.json`)));
}

describe("translation terms", () => {
  for (const { lang, term, use } of RETIRED) {
    it(`${lang} writes ${use}, never ${term}`, () => {
      const hits = sourcesOf(lang).flatMap(({ path, text }) =>
        text.split("\n").flatMap((line, i) => (line.includes(term) ? [`${path}:${i + 1}`] : [])),
      );
      expect(hits).toEqual([]);
    });
  }

  it("zh-CN names the daily note 日记 wherever the English names it, and keeps 日志 for the journal", () => {
    const en = locale("en");
    const zh = locale("zh-CN");
    const daily = Object.keys(en).filter((key) => /daily[ -]notes?\b/i.test(en[key]));
    // Sanity: the daily note is named in the settings, the calendar, the phone and the journal.
    expect(daily.length).toBeGreaterThan(15);
    const wrong = daily.filter((key) => {
      const text = zh[key] ?? "";
      if (!text.includes("日记")) return true;
      // 日志 belongs to the journal: only where the English speaks of it too.
      return text.includes("日志") && !/journal/i.test(en[key]);
    });
    expect(wrong.map((key) => `${key}: ${zh[key]}`)).toEqual([]);
  });
});
