// No link is left without a word (review of L14, round four: the reviewer's oracle, taken over as this test). Link
// forms are drawn at random from the name — case, NFC/NFD, percent bytes in both hex cases, entities, backslashes,
// `./`, a folder, the extension, anchors, an alias, an embed, angle brackets, a title, a reference with its
// definition — and kept where the index of a small note resolves them to the old note: the resolver decides, not a
// list. Each kept form then stands in a part read, in a part not read (a quote too heavy for a piece), across two
// quote lines there, and in an open place, with and without a link read beside it; real SQLite, the indexer and
// renameFileWithLinkUpdates. Every run is rewritten or reported. And a part that names the note only in words is not
// reported. A sample here (ORACLE_PER forms a name, 3 by default); the full run: ORACLE_PER=20 ORACLE_SEED=2.
import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync } from "node:fs";
import { encodeMarkdownLinkPath, NOTE_BUDGET, readAsTextParts, readNoteLinks, setNoteBudget, VaultIndexer, VaultQueryService } from "@plainva/core";
import { renameFileWithLinkUpdates } from "@plainva/ui";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";

const OUT = process.env.ORACLE_OUT;
const record = (row: unknown) => {
  if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
};
const NAMES = (process.env.ORACLE_NAMES ?? "Ordner/Größe x.md|Name X.md|日本語メモ.md|🚀 Rocket.md|123.md|a.md|Note (1).md|50% off.md").split("|");
const PER = Number(process.env.ORACLE_PER ?? 3);
const SEED = Number(process.env.ORACLE_SEED ?? 2);
afterAll(() => setNoteBudget(NOTE_BUDGET));

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const enc = new TextEncoder();
const pct = (ch: string, r: () => number) => [...enc.encode(ch)].map((b) => { const h = b.toString(16).padStart(2, "0"); return `%${r() < 0.5 ? h.toUpperCase() : h}`; }).join("");
const ENT: Record<string, string> = { "ö": "&ouml;", "ß": "&szlig;", "&": "&amp;", " ": "&#32;", "(": "&#40;", ")": "&#41;", "%": "&#37;" };
function spell(name: string, md: boolean, angle: boolean, r: () => number): string {
  let out = "";
  for (const ch of name) {
    let c = ch;
    const w = r();
    if (w < 0.2) c = r() < 0.5 ? c.toUpperCase() : c.toLowerCase();
    if (r() < 0.2) c = c.normalize("NFD");
    if (md) {
      if (c === " " && !angle) c = r() < 0.7 ? "%20" : r() < 0.5 ? "&#32;" : "+";
      else if (r() < 0.2) c = pct(c, r);
      else if (r() < 0.1 && ENT[ch]) c = ENT[ch];
      else if (r() < 0.1 && /[()%&]/.test(ch)) c = `\\${ch}`;
      else if (r() < 0.05 && /[A-Za-z]/.test(ch)) c = `&#${ch.charCodeAt(0)};`;
      if (!angle && /[()]/.test(c) && r() < 0.5) c = `\\${c}`;
    }
    out += c;
  }
  return out;
}
function candidate(path: string, r: () => number): { link: string; def?: string } {
  const stem = path.replace(/\.md$/, "");
  const base = stem.split("/").pop()!;
  const md = r() < 0.55;
  const angle = md && r() < 0.25;
  let target = r() < 0.5 ? base : stem;
  const pre = r();
  if (pre < 0.1) target = `./${target}`;
  else if (pre < 0.15) target = `/${target}`;
  else if (pre < 0.2 && target.includes("/")) target = target.replace("/", "\\");
  let t = spell(target, md, angle, r);
  if (md ? r() < 0.7 : r() < 0.2) t += r() < 0.8 ? ".md" : ".MD";
  const suf = r();
  if (suf < 0.15) t += "#Head";
  else if (suf < 0.22) t += "#^blk";
  if (!md) {
    const alias = r() < 0.2 ? "|alias" : "";
    return { link: `${r() < 0.15 ? "!" : ""}[[${t}${alias}]]` };
  }
  const dest = angle ? `<${t}>` : t;
  const kind = r();
  if (kind < 0.12) return { link: `[t][r${Math.floor(r() * 1e6)}]`.replace(/r(\d+)/, (m) => m), def: dest };
  const title = r() < 0.15 ? ` "ti"` : "";
  return { link: `${r() < 0.1 ? "!" : ""}[t](${dest}${title})` };
}

const quote = (lines: number) => Array.from({ length: lines }, (_, i) => `> quoted ${i} [[Other ${i % 7}]] words`).join("\n");

describe("a rename and a part not read: no link left without a word", () => {
  it("rewrites or reports every form the resolver takes, in every place", async () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    let lines = 2_000;
    while (readAsTextParts(`# Big\n\nintro\n\n${quote(lines)}\n`).unread.length === 0) lines *= 2;
    let silent = 0, runs = 0;
    const silentRuns: string[] = [];
    for (const [ni, OLD] of NAMES.entries()) {
      const r = rng(SEED * 1000 + ni);
      const seen = new Set<string>();
      const forms: Array<{ link: string; def?: string }> = [];
      let tried = 0;
      for (let k = 0; k < PER * 4 && forms.length < PER; k++) {
        const c = candidate(OLD, r);
        const label = /\[t\]\[(r\d+)\]/.exec(c.link)?.[1];
        const small = c.def ? `${c.link}\n\n[${label}]: ${c.def}\n` : `${c.link}\n`;
        if (seen.has(small)) continue;
        seen.add(small);
        tried++;
        const files = new MemoryVaultAdapter(1_000);
        await files.writeTextFile(OLD, "# Head\n\npara ^blk\n");
        await files.writeTextFile("Small.md", small);
        const db = await realSqlite();
        await new VaultIndexer(files, db).indexVaultFull();
        const ok = (await new VaultQueryService(db).getBacklinks(OLD)).some((row: any) => row.source_path === "Small.md");
        record({ t: "cand", OLD, small, resolves: ok });
        if (ok) forms.push(c);
      }
      const base = OLD.replace(/\.md$/, "").split("/").pop()!;
      for (const form of forms) {
        const label = /\[t\]\[(r\d+)\]/.exec(form.link)?.[1];
        const defLine = form.def ? `[${label}]: ${form.def}` : null;
        for (const place of ["read", "unread", "unread2lines", "open"] as const) {
          for (const beside of [null, `[[${base}]]`, `[t](${encodeMarkdownLinkPath(OLD)})`]) {
            for (const colon of place === "unread" ? [false, true] : [place === "open"]) {
              const link = place === "unread2lines" ? form.link.replace(/\]\(/, "](\n> ").replace(/\[\[/, "[[\n> ") : form.link;
              const q = quote(lines).split("\n");
              if (place === "unread" || place === "unread2lines") q[7] = `> quoted 7 ${link} [[Other 0]] words`;
              const parts = ["# Big", beside ? `read ${beside} here` : "intro", q.join("\n")];
              if (place === "read") parts.push(`plain ${link} here`);
              if (place === "open") parts.push(`see [x [b]] ${link} here`);
              if (colon) parts.push("[zz]: zz.md");
              if (defLine) parts.push(defLine);
              const big = `${parts.join("\n\n")}\n`;
              const at = big.indexOf(link);
              const probe = defLine ?? link;
              setNoteBudget(Number.MAX_SAFE_INTEGER);
              const whole = readNoteLinks(big).links;
              setNoteBudget(NOTE_BUDGET);
              const isLink = whole.some((l: any) => l.start >= at && l.start < at + link.length);
              const unread = readNoteLinks(big).unread;
              const inUnread = unread.some((x: any) => x.from <= at && at < x.to);
              const files = new MemoryVaultAdapter(1_000);
              await files.writeTextFile("Big.md", big);
              await files.writeTextFile(OLD, "# Head\n\npara ^blk\n");
              const db = await realSqlite();
              await new VaultIndexer(files, db).indexVaultFull();
              let result: any;
              try {
                result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: OLD, newPath: "Renamed Z.md" });
              } catch (e) { result = { error: String(e) }; }
              const after = await files.readTextFile("Big.md");
              const remains = after.includes(probe);
              runs++;
              // Every form here is one the index resolves to the old note: left as it is, it is reported, whether the note read
              // whole would rewrite it (`isLink`) or only say it could not (as `main` does for an entity in a destination).
              const verdict = !remains ? "rewritten" : result.linkUpdateFailed ? "reported" : isLink ? "SILENT" : "SILENT-unplaced";
              if (verdict.startsWith("SILENT")) {
                silent++;
                silentRuns.push(`${OLD}: ${place}, beside ${beside}, ${colon ? "with" : "without"} ]:: ${link}`);
              }
              record({ t: "run", OLD, link, def: defLine, place, beside, colon, inUnread, isLink, verdict, renamed: result.renamedLinks, failed: result.linkUpdateFailed, error: result.error });
            }
          }
        }
      }
      record({ t: "name", OLD, tried, kept: forms.length });
    }
    record({ t: "done", runs, silent });
    expect(runs).toBeGreaterThan(0);
    expect(silentRuns, silentRuns.slice(0, 5).join("\n")).toEqual([]);
  }, 3_600_000);

  it("does not report a part that names the note in words only", async () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    let lines = 2_000;
    while (readAsTextParts(`# Big\n\nintro\n\n${quote(lines)}\n`).unread.length === 0) lines *= 2;
    const PROSE: Record<string, string> = {
      "Ordner/Größe x.md": "the Grösse x and (Größe x) here, see <Größe x> or [Größe x]",
      "Name X.md": "we met (Name X) and <Name X> then [Name X] later",
      "a.md": "this is (a picture) and <a> tag, (see a.md) ok",
      "123.md": "page (123) and <123> and [123]",
      "Note (1).md": "see Note (1) and (Note (1)) here",
      "50% off.md": "a (50% off) sale and <50%20off>",
      "日本語メモ.md": "（日本語メモ） and (日本語メモ)",
      "🚀 Rocket.md": "launch (🚀 Rocket) today",
    };
    for (const OLD of NAMES) {
      for (const colon of [false, true]) {
        const q = quote(lines).split("\n");
        q[7] = `> quoted 7 ${PROSE[OLD] ?? OLD} words`;
        const big = `# Big\n\nintro\n\n${q.join("\n")}\n${colon ? "\n[zz]: zz.md\n" : ""}`;
        const files = new MemoryVaultAdapter(1_000);
        await files.writeTextFile("Big.md", big);
        await files.writeTextFile(OLD, "# Head\n");
        const db = await realSqlite();
        await new VaultIndexer(files, db).indexVaultFull();
        const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: OLD, newPath: "Renamed Z.md" });
        const changed = (await files.readTextFile("Big.md")) !== big;
        record({ t: "noise", OLD, colon, reported: result.linkUpdateFailed, changed });
        expect(changed, OLD).toBe(false);
        expect(result.linkUpdateFailed, `${OLD} ${colon ? "with" : "without"} ]:`).toBe(false);
      }
    }
  }, 600_000);
});

