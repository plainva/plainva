import { describe, expect, it } from "vitest";
import { buildContextPackage, type ContextBuildHost, type SituationInput } from "../src/ai/context/package.js";
import { protectedTokens } from "../src/ai/context/gists.js";
import { resetGistStores } from "../src/ai/context/gistStore.js";
import { GistReader, GistWriter, areaGistKey, VAULT_GIST_KEY, type GistModel } from "../src/ai/context/gistWriter.js";
import { GistStore } from "../src/ai/context/gistStore.js";
import { withinAsync } from "./helpers/timeBudget.js";
import { gateDecision, type EgressRecipient } from "../src/ai/egressGate.js";
import { buildLinkNameIndex, filesALinkCouldMean } from "../src/ai/linkNames.js";
import { DEFAULT_AI_POLICY, effectivePolicy, notePolicyFrom } from "../src/ai/policy.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * Short summaries and a reader with a narrower view (decision of 2026-11-13, review of R19, wave 2): a gist is
 * written from the whole of a note by a model on this computer, keeps every link word for word and says the rest in
 * its own words — "the Kowalski pay talk is private". To a cloud a note's gist goes only where the note holds
 * nothing back from it, an area's only where none of its notes does, decided when the message goes. Real index, real
 * writer and reader of the gists, the package as the shells build it.
 */
const filler = "The team went through the plan line by line and agreed on the next steps for the quarter. ".repeat(9);
const long = (line: string) => `# Note\n\n## Pay\n\n${filler}\n${line}\n`;
const PRIVATE = "Private/Salary Kowalski.md";

/** A model that does what the instruction asks: keeps every link as written, says what a link's text names in its own words. */
const model: GistModel = {
  id: "local/m",
  async complete(_instruction, text) {
    const label = /\[([^\]]+)\]\([^)]*Salary[^)]*\)/.exec(text);
    return `Plan of the quarter; ${label ? `the ${label[1]} is private; ` : ""}${protectedTokens(text).join(" ")}`.slice(0, 380);
  },
};

const cloud: EgressRecipient = { kind: "cloud", provider: "x", model: "x" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };
const situation: SituationInput = { now: "2026-11-13 10:00", weekday: "Friday", calendarDay: "2026-11-13", journalDay: "2026-11-13", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

async function vaultOf(notes: Record<string, string>, denied: Set<string>) {
  resetGistStores();
  const db = await realSqlite();
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(notes)) await files.writeTextFile(path, text);
  const indexer = new VaultIndexer(files, db);
  await indexer.indexVaultFull();
  const query = new VaultQueryService(db as never);
  const read = (path: string) => files.readTextFile(path).catch(() => null);
  // Kept from a cloud: what `denied` names, as a rule would — changed between writing the gists and sending.
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom(denied.has(path) ? { plainva: { ai: { cloud: "deny" } } } : {}), [], DEFAULT_AI_POLICY);
  const writeGists = () =>
    new GistWriter({ db, readText: read, cloudAllowed: async (path) => gateDecision(await policyOf(path), { recipient: cloud, webTools: false }).allowed, now: () => 10_000_000 }, model).run(new AbortController().signal);
  const host: ContextBuildHost = {
    policyOf,
    resolveLink: (target, from) => query.resolveNotePath(target, from),
    linkCandidates: async (target, from) => filesALinkCouldMean(buildLinkNameIndex(await query.linkTargets()), target, from),
    readNote: async (path) => {
      const text = await read(path);
      return text === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
    },
    gists: new GistReader(db, "local/m"),
  };
  const ask = async (recipient: EgressRecipient, paths: string[]) => {
    const pack = await buildContextPackage(
      { question: "What is the offer for the quarter?", recipient, situation, candidates: [paths.map((path, i) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), signals: { lexical: i === 0 ? 1 : 0.1 } }))], pins: [], budget: { evidence: 1, cards: 0, map: 8 } },
      host,
    );
    return pack.part.text;
  };
  const rewrite = async (path: string, text: string) => {
    await files.writeTextFile(path, text);
    await indexer.indexVaultFull();
  };
  return { ask, writeGists, rewrite, done: () => db.close() };
}

const NOTES: Record<string, string> = {
  [PRIVATE]: "# Salary\n\nKowalski earns more.\n",
  "Projects/Offer.md": "# Offer\n\nOffer for the quarter.\n",
  "Projects/Wiki.md": long("The pay talk is in [[Private/Salary Kowalski]] and stays private."),
  "Projects/Markdown.md": long("The [Kowalski pay talk](../Private/Salary%20Kowalski.md) stays private."),
  "Projects/Property.md": `---\nrelated: "[[Private/Salary Kowalski]]"\n---\n${long("Nothing else here.")}`,
  "Projects/Table.md": long("| who | note |\n| --- | --- |\n| a | [[Salary Kowalski\\|the talk]] |"),
};
const FOUND = Object.keys(NOTES).filter((path) => path.startsWith("Projects/"));

describe("a short summary and a reader with a narrower view", () => {
  it("goes to a cloud only where its note holds nothing back, and an area's only where none of its notes does", async () => {
    const v = await vaultOf(NOTES, new Set([PRIVATE]));
    await v.writeGists();
    const text = await v.ask(cloud, FOUND);
    expect(text).not.toMatch(/Kowalski|Salary/);
    // Every note that withholds a link — in its text, a Markdown link's words, a property, a table — goes without its gist.
    for (const path of FOUND.slice(1)) expect(text).toContain(`(${path})`);
    expect(text).not.toContain("(gist)");
    // The area holds such notes: its gist stays back too.
    expect(text).not.toContain("Where these notes sit");
    // A model on this device is told as before.
    const there = await v.ask(local, FOUND);
    expect(there).toContain("(gist)");
    expect(there).toContain("Where these notes sit");
    await v.done();
  });

  it("is decided when the message goes: a gist written before a note was kept back, or before a link came in, does not go", async () => {
    // Written while nothing was kept back: the gists name the note.
    const denied = new Set<string>();
    const v = await vaultOf(NOTES, denied);
    await v.writeGists();
    expect(await v.ask(local, FOUND)).toMatch(/Kowalski/);
    // Then the note is kept from the cloud: the stored gists are not sent on.
    denied.add(PRIVATE);
    const kept = await v.ask(cloud, FOUND);
    expect(kept).not.toMatch(/Kowalski|Salary/);
    expect(kept).not.toContain("(gist)");
    expect(kept).not.toContain("Where these notes sit");
    await v.done();

    // A note whose gist was written without a link, that links to a kept note since — within the same moment, so the
    // gist still counts as fresh: it does not go either, nor does its area's.
    const plain = { [PRIVATE]: NOTES[PRIVATE]!, "Projects/Offer.md": NOTES["Projects/Offer.md"]!, "Projects/Later.md": long("The pay talk stays private.") };
    const w = await vaultOf(plain, new Set([PRIVATE]));
    await w.writeGists();
    expect(await w.ask(cloud, ["Projects/Offer.md", "Projects/Later.md"])).toContain("(gist)");
    await w.rewrite("Projects/Later.md", long("The pay talk is in [[Private/Salary Kowalski]] and stays private."));
    const linked = await w.ask(cloud, ["Projects/Offer.md", "Projects/Later.md"]);
    expect(linked).not.toMatch(/Kowalski|Salary/);
    expect(linked).not.toContain("(gist)");
    expect(linked).not.toContain("Where these notes sit");
    await w.done();
  });

  it("belongs to the note it was written from: the same section in a note kept back gives another note's gist nothing of it (review of R19, wave 2)", async () => {
    const agenda = `## Agenda\n\n${"Each round starts with the open points from last time, then the numbers of the quarter. ".repeat(20)}\n`;
    // A model that names where the section stands, as the instruction gives it.
    const naming: GistModel = { id: "local/m", complete: async (_instruction, text) => `${text.split("\n")[0]}: open points, numbers, decisions.` };
    for (const order of [["Private/Salary Kowalski.md", "Projects/Weekly.md"], ["Projects/Weekly.md", "Private/Salary Kowalski.md"]]) {
      resetGistStores();
      const db = await realSqlite();
      const files = new MemoryVaultAdapter(1_000);
      const notes: Record<string, string> = { "Private/Salary Kowalski.md": `# Salary talk\n\n${agenda}`, "Projects/Weekly.md": `# Weekly\n\n${agenda}` };
      for (const path of order) await files.writeTextFile(path, notes[path]!);
      await new VaultIndexer(files, db).indexVaultFull();
      await new GistWriter({ db, readText: (path) => files.readTextFile(path).catch(() => null), cloudAllowed: async (path) => !path.startsWith("Private/"), now: () => 10_000_000 }, naming).run(new AbortController().signal);
      const reader = new GistReader(db, "local/m");
      expect(String(await reader.note("Projects/Weekly.md"))).toContain("Weekly");
      expect(String(await reader.note("Projects/Weekly.md"))).not.toMatch(/Salary|Kowalski/);
      expect(String(await reader.area("Projects"))).not.toMatch(/Salary|Kowalski/);
      await db.close();
    }
  });

  it("holds back links, not names: a name that stands in the text of a note that may go is that note's, and goes with it", async () => {
    const v = await vaultOf({ [PRIVATE]: NOTES[PRIVATE]!, "Projects/Offer.md": long("Offer for the quarter."), "Projects/Talk.md": long("Kowalski asked about the pay.") }, new Set([PRIVATE]));
    await v.writeGists();
    const text = await v.ask(cloud, ["Projects/Talk.md", "Projects/Offer.md"]);
    expect(text).toContain("(gist)");
    expect(text).toContain("Where these notes sit");
    expect(text).toContain("Kowalski asked");
    await v.done();
  });

  it("keeps its verdict on an area over messages while the index and the rules stay, and decides anew when either changes (review of R19, wave 2)", async () => {
    resetGistStores();
    const db = await realSqlite();
    const files = new MemoryVaultAdapter(1_000);
    const N = 400;
    for (let i = 0; i < N; i++) await files.writeTextFile(`Projects/n${i}.md`, `---\nowner: "[[Projects/n${(i * 7) % N}]]"\n---\n# n${i}\nOffer ${i}, see [[Projects/n${(i * 13) % N}]].\n`);
    await files.writeTextFile(PRIVATE, NOTES[PRIVATE]!);
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    const query = new VaultQueryService(db as never);
    // Stored gists of the area and of the vault, as the writer leaves them once it ran.
    const store = new GistStore(db);
    const later = Date.now() + 365 * 864e5;
    await store.put({ key: areaGistKey("Projects"), level: "folder", source: areaGistKey("Projects"), text: "Offers of the studio.", ok: true, createdAt: later }, "local/m");
    await store.put({ key: VAULT_GIST_KEY, level: "vault", source: VAULT_GIST_KEY, text: "Notes of a small studio.", ok: true, createdAt: later }, "local/m");
    // The rules besides the notes' own: a folder kept from the cloud. Each lookup counted.
    let keptFolders = ["Private/"];
    // `lookups` counts every question about a note's rules; `looked`, those about a note of the area, asked with its
    // text — what looking through the area costs. A kept "may go" asks again only about the notes its links could
    // mean, whose own rules stand in their files (review of R19, wave 2).
    let lookups = 0;
    let looked = 0;
    const host: ContextBuildHost = {
      policyOf: async (path, text) => {
        lookups++;
        if (text !== undefined) looked++;
        const own = notePolicyFrom(keptFolders.some((folder) => path.startsWith(folder)) ? { plainva: { ai: { cloud: "deny" } } } : {});
        void text;
        return effectivePolicy(path, own, [], DEFAULT_AI_POLICY);
      },
      rulesStamp: async () => JSON.stringify(keptFolders),
      resolveLink: (target, from) => query.resolveNotePath(target, from),
      linkCandidates: async (target, from) => filesALinkCouldMean(buildLinkNameIndex(await query.linkTargets()), target, from),
      // The names read once for a verdict that is kept (`linkSnapshot`).
      linkSnapshot: async () => {
        const names = buildLinkNameIndex(await query.linkTargets());
        return { resolveLink: async () => null, linkCandidates: async (target, from) => filesALinkCouldMean(names, target, from) };
      },
      readNote: async (path) => {
        const text = await files.readTextFile(path).catch(() => null);
        return text === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
      },
    };
    const ask = async () => {
      lookups = 0;
      looked = 0;
      // A reader for each message, as the shells make one.
      const pack = await buildContextPackage(
        { question: "What is the offer?", recipient: cloud, situation, candidates: [[{ path: "Projects/n1.md", title: "n1", signals: { lexical: 1 } }]], pins: [], budget: { evidence: 1, cards: 0, map: 4 } },
        { ...host, gists: new GistReader(db, "local/m") },
      );
      return { text: pack.part.text, lookups, looked };
    };
    const first = await ask();
    expect(first.text).toContain("Offers of the studio.");
    expect(first.lookups).toBeGreaterThan(N);
    expect(first.looked).toBeGreaterThan(N);
    // The same state: the verdict is kept, not one note of the area is looked through again — only the rules of the
    // notes its links could mean are read again from their files.
    const again = await withinAsync(200, () => ask());
    expect(again.text).toEqual(first.text);
    expect(again.looked).toBeLessThan(20);
    // Every question a kept verdict asks: one about each note its links could mean (every note of the area is one
    // here, N), and those of the package besides the verdict — never more than deciding it anew would.
    expect(again.lookups - again.looked).toBeGreaterThan(0);
    expect(again.lookups).toBeLessThanOrEqual(N + 20);
    expect(again.lookups).toBeLessThan(first.lookups);
    // A note of the area that links to the kept note since: decided anew, and its gist stays back.
    await files.writeTextFile("Projects/n3.md", "# n3\nSee [[Private/Salary Kowalski]].\n");
    await indexer.indexVaultFull();
    const linked = await ask();
    expect(linked.text).not.toContain("Offers of the studio.");
    expect(linked.text).not.toContain("Notes of a small studio.");
    await files.writeTextFile("Projects/n3.md", "# n3\nOffer 3.\n");
    await indexer.indexVaultFull();
    expect((await ask()).text).toContain("Offers of the studio.");
    // The rules keep a note of the area from the cloud since: decided anew.
    keptFolders = ["Private/", "Projects/n9"];
    const ruled = await ask();
    // Looked through again, as far as the first note the rules keep back.
    expect(ruled.looked).toBeGreaterThan(again.looked + 20);
    expect(ruled.text).not.toContain("Offers of the studio.");
    // A host that cannot read the names as fresh as the stamp keeps no verdict: every message looks through the area.
    keptFolders = ["Private/"];
    const { linkSnapshot: _snapshot, ...stale } = host;
    const without = async () => {
      lookups = 0;
      await buildContextPackage(
        { question: "What is the offer?", recipient: cloud, situation, candidates: [[{ path: "Projects/n1.md", title: "n1", signals: { lexical: 1 } }]], pins: [], budget: { evidence: 1, cards: 0, map: 4 } },
        { ...stale, gists: new GistReader(db, "local/m") },
      );
      return lookups;
    };
    expect(await without()).toBeGreaterThan(N);
    expect(await without()).toBeGreaterThan(N);
    await db.close();
  });
});
