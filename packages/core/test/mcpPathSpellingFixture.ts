/**
 * The generator of `src/vault/mcpPathSpelling.fixture.json`: inputs an outside app may send as a path argument, and
 * the ONE spelling the MCP server's wall checks and forwards (`safe_rel_path` in
 * `apps/desktop/src-tauri/src/mcp/paths.rs`; `null`: refused). `mcpPathSpellingFixture.test.ts` asserts that the
 * file is this function's output; rewrite it with `PLAINVA_WRITE_MCP_SPELLING=1 npx vitest run
 * test/mcpPathSpellingFixture.test.ts`. Readers: the Rust test (every case), the desktop test
 * `src/ai/mcpPathSpelling.test.ts` (the web view keeps every checked spelling, reads a raw argument as the same
 * place, and `mcpNameAccepted` is the wall's rule for a name taken as it stands).
 */
export interface SpellingCase {
  input: string;
  checked: string | null;
  why: string;
}

const ch = (cp: number) => String.fromCodePoint(cp);
const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/** The code points this engine's `String.prototype.trim` removes, read off the engine. */
export function engineTrimSet(): number[] {
  const set: number[] = [];
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if ((ch(cp) + "a").trim() === "a" && ("a" + ch(cp)).trim() === "a") set.push(cp);
  }
  return set;
}

export function buildMcpPathSpellingFixture() {
  const trimSet = engineTrimSet();
  const cases: SpellingCase[] = [];
  const add = (input: string, checked: string | null, why: string) => cases.push({ input, checked, why });
  for (const cp of trimSet) {
    add(`${ch(cp)}Projects/a.md`, "Projects/a.md", `${hex(cp)} before`);
    add(`Projects/a.md${ch(cp)}`, "Projects/a.md", `${hex(cp)} after`);
    add(`Projects/private${ch(cp)}`, "Projects/private", `${hex(cp)} after a folder`);
  }
  add(" Projects/a.md", "Projects/a.md", "leading ASCII space");
  add("Projects/a.md ", "Projects/a.md", "trailing ASCII space");
  add(" .plainva/sync/keyfile.json", null, "internal behind a space");
  add(`${ch(0xfeff)}.agent/policy.yml`, null, "hidden behind a BOM");
  add(" node_modules/x.md", null, "internal behind a space");
  add(`${ch(0xa0)}.plainva/sync/keyfile.json`, null, "internal behind a no-break space");
  add(`${ch(0x3000)}Projects/out/secret.md`, "Projects/out/secret.md", "ideographic space before");
  add("./Projects/a.md", "Projects/a.md", "leading ./");
  add(" ./Projects/a.md", "Projects/a.md", "space, then ./");
  add(`./${ch(0xa0)}Projects/a.md`, null, "./ then white space the web view would still trim");
  add("././Projects/a.md", null, "a second ./ is a segment '.'");
  add("Projects/", null, "trailing slash");
  add("Projects//a.md", null, "empty segment");
  add("Icon\r", "Icon", "CR at the end is trimmed as the web view trims it");
  add("Icon\r/x.md", null, "a control character inside");
  add(`Projects/a.md${ch(0x85)}`, null, "U+0085 is no JS white space and a control character");
  add(`Projects/a.md${ch(0x180e)}`, `Projects/a.md${ch(0x180e)}`, "U+180E is no longer JS white space: kept as written");
  add(`Cafe${ch(0x301)}/x.md`, `Caf${ch(0xe9)}/x.md`, "NFD becomes NFC");
  add(`Projects/Cafe${ch(0x301)}`, `Projects/Caf${ch(0xe9)}`, "an NFD folder name");
  add(`Caf${ch(0xe9)}/x.md`, `Caf${ch(0xe9)}/x.md`, "NFC stays");
  add(".Plainva/x.md", null, "internal, other case");
  add(".plainva./x.md", null, "internal, trailing dot");
  add("Node_Modules/x.md", null, "internal without a dot, other case");
  add("Projects/v1.2 notes.md", "Projects/v1.2 notes.md", "an ordinary name");
  add("Notes/a:b.md", null, "a colon");
  add("Notes/x.", null, "a segment ending in a dot");
  add("Notes /x.md", null, "a segment ending in a space");
  add("Notes/ x.md", "Notes/ x.md", "a segment starting with a space inside the path is a name as written");
  add("/Notes/x.md", null, "absolute");
  add("Notes\\x.md", null, "a backslash");
  add(`${"中".repeat(1024)}`, "中".repeat(1024), "1024 UTF-16 units");
  add(`${"中".repeat(1025)}`, null, "1025 UTF-16 units");
  add(`${ch(0x1f4dd).repeat(513)}`, null, "513 astral characters are 1026 units");
  add("Projects/Draft~1/a.md", "Projects/Draft~1/a.md", "a short-name shape is a spelling question for the disk, not for this list");
  for (const c of cases) {
    if (c.checked !== null && (c.checked.trim() !== c.checked || c.checked.normalize("NFC") !== c.checked)) throw new Error(`not a checked spelling: ${JSON.stringify(c)}`);
  }
  return {
    about:
      "The one spelling the MCP server checks and forwards for a path argument (apps/desktop/src-tauri/src/mcp/paths.rs, safe_rel_path), and the trim set of the engine the web view runs on. Written by packages/core/test/mcpPathSpellingFixture.ts (a test asserts this file is its output); read by the Rust test and by apps/desktop/src/ai/mcpPathSpelling.test.ts.",
    trimSet,
    cases,
  };
}
