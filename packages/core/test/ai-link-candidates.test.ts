import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { assembleContext, withholdDeniedLinks, type ContextPolicyHost } from "../src/ai/chat.js";
import { gateDecision, WITHHELD_LINK, type EgressRecipient } from "../src/ai/egressGate.js";
import { buildLinkNameIndex, filesALinkCouldMean } from "../src/ai/linkNames.js";
import { effectivePolicy, notePolicyFrom, parsePolicyFile } from "../src/ai/policy.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * Which note a link names, asked of the real index (plan KI-Harness P5-7b).
 *
 * The app follows a link by more than one rule — the desktop's editor by a
 * note's title or its whole path (`resolveNotePath`), the phone by the file's
 * name, the graph by the end of a path — and the privacy gate used to ask the
 * shell's own rule: a link that rule did not follow was not recognised as a
 * link to a note the rules keep back, and went to a cloud model with the
 * note's name in it. Here the vault is indexed by the real indexer into a
 * real SQLite index, and the gate asks the names of all files instead.
 */

const FILES: Record<string, string> = {
  ".agent/policy.yml": "folders:\n  Finance/:\n    cloud: deny\n",
  // A note whose properties give it another title than its file's name — common in vaults a site generator reads.
  "Finance/Brief.md": "---\ntitle: Offer letter\n---\n# Offer letter\n\nThe day rate is 1,800 euros.\n",
  "Finance/2026/Report.md": "# Report\n\nNumbers nobody outside may see.\n",
  // Two notes of one name; one of them is kept back by its own rule.
  "Journal/Diary.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\nWhat I would not tell a server.\n",
  "Notes/Diary.md": "A diary anyone may read.\n",
  "Plan.md": "# Plan\n\nNext steps.\n",
  "Projects/Offer.md": "# Offer\n\nSee [[Brief]], [[Offer letter]], [[2026/Report]], [the report](<../Finance/2026/Report.md>), [[Diary]] — and [[Plan]].\n",
};

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const rules = parsePolicyFile(FILES[".agent/policy.yml"]!).rules;
const frontmatter = (text: string): unknown => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? parseYaml(m[1]!) : {};
};
const policyOf: ContextPolicyHost["policyOf"] = async (path, text) => effectivePolicy(path, notePolicyFrom(frontmatter(text ?? FILES[path] ?? "")), rules);
const allowed = async (path: string) => gateDecision(await policyOf(path), { recipient: cloud, webTools: false }).allowed;

let query: VaultQueryService;
/** The desktop's own host before P5-7b: the gate asks where a tap on the link leads. */
let byTheEditorsRule: ContextPolicyHost;
/** The host as both shells build it now: the names of all files, read from the index. */
let byAllNames: ContextPolicyHost;

beforeAll(async () => {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(FILES)) await vault.writeTextFile(path, text);
  await new VaultIndexer(vault, db).indexVaultFull();
  query = new VaultQueryService(db);
  byTheEditorsRule = { policyOf, resolveLink: (target) => query.resolveNotePath(target) };
  byAllNames = {
    policyOf,
    resolveLink: (target) => query.resolveNotePath(target),
    linkCandidates: async (target, from) => filesALinkCouldMean(buildLinkNameIndex(await query.fileNames()), target, from),
  };
}, 60_000);

describe("which note a link names, asked of the real index", () => {
  it("the index holds a note's own title — so the editor's rule does not find that note by its file's name, nor a note by the end of its path", async () => {
    const names = await query.fileNames();
    expect(names.find((file) => file.path === "Finance/Brief.md")).toEqual({ path: "Finance/Brief.md", title: "Offer letter" });
    expect(names.find((file) => file.path === "Plan.md")).toEqual({ path: "Plan.md", title: "Plan" });
    // What the desktop's editor does with these links: it opens none of the first three.
    expect(await query.resolveNotePath("Brief")).toBeNull();
    expect(await query.resolveNotePath("2026/Report")).toBeNull();
    expect(await query.resolveNotePath("../Finance/2026/Report.md")).toBeNull();
    expect(await query.resolveNotePath("Offer letter")).toBe("Finance/Brief.md");
    expect(await query.resolveNotePath("Plan")).toBe("Plan.md");
  });

  it("asked where a tap leads, three names of kept notes went out — asked what the links could mean, none does", async () => {
    const text = FILES["Projects/Offer.md"]!;
    const before = await withholdDeniedLinks(text, "Projects/Offer.md", byTheEditorsRule, allowed);
    // The editor's rule finds the note by its title — and one of the two diaries, whichever the index hands out first.
    expect(before.text).toContain("[[Brief]]");
    expect(before.text).toContain("[[2026/Report]]");
    expect(before.text).toContain("Finance/2026/Report.md");
    expect(before.text).not.toContain("[[Offer letter]]");

    const after = await withholdDeniedLinks(text, "Projects/Offer.md", byAllNames, allowed);
    expect(after.text).toBe(`# Offer\n\nSee ${WITHHELD_LINK}, ${WITHHELD_LINK}, ${WITHHELD_LINK}, ${WITHHELD_LINK}, ${WITHHELD_LINK} — and [[Plan]].\n`);
    expect(after.redacted).toBe(5);
  });

  it("the context of a message carries no name of a kept note, whichever way a link spells it", async () => {
    const note = { path: "Projects/Offer.md", title: "Offer", text: FILES["Projects/Offer.md"]!, pinned: false };
    const ctx = await assembleContext([note], cloud, byAllNames);
    expect(ctx.withheldLinks).toBe(5);
    expect(ctx.part!.text).not.toMatch(/Brief|Offer letter|Report|Diary|Finance/);
    expect(ctx.part!.text).toContain("[[Plan]]");
  });

  it("a link that could only mean notes anyone may read stays", async () => {
    const text = "Compare [[Notes/Diary]] with [[Plan]] and [[Nobody]].";
    expect(await withholdDeniedLinks(text, "Projects/Offer.md", byAllNames, allowed)).toEqual({ text, redacted: 0 });
  });
});
