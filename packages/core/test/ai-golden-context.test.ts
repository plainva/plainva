import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { aiTestVaultFiles, LANGUAGES, LOCKED_FACTS } from "../../../scripts/ai-test-vault.mjs";
import { buildContextPackage, type ContextBuildHost, type ContextPackage, type SituationInput } from "../src/ai/context/package.js";
import type { Candidate } from "../src/ai/context/ranking.js";
import { questionTerms } from "../src/ai/context/terms.js";
import type { EgressRecipient } from "../src/ai/egressGate.js";
import { effectivePolicy, notePolicyFrom, parsePolicyFile } from "../src/ai/policy.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * The golden suite of the context package (plan KI-Harness P2b-7): the AI
 * test vault's thirty questions in the app's ten languages, each asked the
 * way a message asks — the words' candidates from the real full-text index,
 * the package built for a cloud recipient — and measured against what the
 * vault's generator knows to be the answer. It runs in CI on the words alone;
 * the same measure with a real embedding model runs by hand over the larger
 * spike corpus, because CI has no model.
 *
 * A ratchet: `fixtures/ai-golden-context.json` holds the numbers reached so
 * far, and a change that makes one of them worse fails here. A change that
 * makes one better raises it there, in the same commit.
 *
 * - recall: the note that answers is in the package, as evidence or card;
 * - facts: its fact (a deadline, an amount, a decision, a role) stands in the
 *   package word for word — what a card keeps verbatim by construction;
 * - ratio: the characters of the whole top five notes by words, as a naive
 *   retrieval would send them, against the characters of the package's
 *   sources — how much smaller the package is;
 * - leaks and staleness are not measured but forbidden: no locked fact ever
 *   reaches the cloud, and a note that changed after it was indexed goes as
 *   it is now.
 */

const BASELINE = JSON.parse(readFileSync(new URL("./fixtures/ai-golden-context.json", import.meta.url), "utf8")) as { recall: number; facts: number; ratio: number };

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
const NAIVE_TOP = 5;

const { files, golden } = aiTestVaultFiles();
const disk = new Map<string, string>(files);
const rules = parsePolicyFile(disk.get(".agent/policy.yml")!).rules;
const titleOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

function frontmatter(text: string): unknown {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? parseYaml(m[1]!) : {};
}

const host: ContextBuildHost = {
  policyOf: async (path, content) => effectivePolicy(path, notePolicyFrom(frontmatter(content ?? disk.get(path) ?? "")), rules),
  resolveLink: async (target) => [...disk.keys()].find((path) => titleOf(path) === target.replace(/#.*$/, "")) ?? null,
  async readNote(path) {
    const text = disk.get(path);
    return text === undefined ? null : { title: titleOf(path), text };
  },
};

let query: VaultQueryService;

/** The words' candidates as the shells hand them in (`gatherCandidates`): the score relative to the best. */
async function wordCandidates(question: string): Promise<Candidate[]> {
  const hits = await query.searchCandidates(questionTerms(question), 30);
  const best = Math.max(...hits.map((h) => h.score), 0) || 1;
  return hits.map((h) => ({ path: h.path, title: h.title, signals: { lexical: h.score / best }, ...(h.snippet ? { snippet: h.snippet } : {}) }));
}

/** The package's own sources: evidence blocks and cards, without the situation and the preamble. */
function sourceChars(pack: ContextPackage): number {
  return pack.refs.reduce((sum, ref) => sum + ref.chars, 0);
}

interface Measured {
  id: string;
  found: boolean;
  fact: boolean;
  ratio: number;
  text: string;
}

const measured: Measured[] = [];

beforeAll(async () => {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  for (const [path, text] of files) await vault.writeTextFile(path, text);
  await new VaultIndexer(vault, db).indexVaultFull();
  query = new VaultQueryService(db);
  for (const g of golden.filter((q) => LANGUAGES.includes(q.lang) && q.fact && !q.today)) {
    const candidates = await wordCandidates(g.query);
    const pack = await buildContextPackage({ question: g.query, recipient: cloud, situation, candidates: [candidates], pins: [] }, host);
    const ref = pack.refs.find((r) => g.expect.includes(r.path));
    const naive = candidates.slice(0, NAIVE_TOP).reduce((sum, c) => sum + (disk.get(c.path)?.length ?? 0), 0);
    measured.push({
      id: g.id,
      found: Boolean(ref && (ref.tier === "evidence" || ref.tier === "card")),
      fact: pack.part.text.includes(g.fact!),
      ratio: naive / Math.max(1, sourceChars(pack)),
      text: pack.part.text,
    });
  }
}, 60_000);

const share = (pick: (m: Measured) => boolean) => measured.filter(pick).length / measured.length;
const meanRatio = () => measured.reduce((sum, m) => sum + m.ratio, 0) / measured.length;

describe("the golden suite of the context package (a ratchet)", () => {
  it("asks all thirty questions of the ten languages", () => {
    expect(measured).toHaveLength(30);
    // `GOLDEN_REPORT=1` prints the numbers, to raise the baseline after an improvement.
    if (process.env.GOLDEN_REPORT) console.log(JSON.stringify({ recall: share((m) => m.found), facts: share((m) => m.fact), ratio: meanRatio(), missed: measured.filter((m) => !m.found || !m.fact).map((m) => m.id) }));
  });

  it("finds the note that answers at least as often as before", () => {
    const missed = measured.filter((m) => !m.found).map((m) => m.id);
    expect(share((m) => m.found), `missed: ${missed.join(", ")}`).toBeGreaterThanOrEqual(BASELINE.recall);
  });

  it("carries the answer's fact word for word at least as often as before", () => {
    const missed = measured.filter((m) => !m.fact).map((m) => m.id);
    expect(share((m) => m.fact), `missed: ${missed.join(", ")}`).toBeGreaterThanOrEqual(BASELINE.facts);
  });

  it("sends no more than before against the whole top five", () => {
    expect(meanRatio()).toBeGreaterThanOrEqual(BASELINE.ratio);
  });

  it("never lets a locked fact reach the cloud", () => {
    for (const m of measured) for (const fact of LOCKED_FACTS) expect(m.text, m.id).not.toContain(fact);
  });

  it("sends a note as it is now, not as it was indexed", async () => {
    const g = golden.find((q) => q.id === "de-deadline")!;
    const path = g.expect[0]!;
    const before = disk.get(path)!;
    disk.set(path, before.replaceAll(g.fact!, "2027-03-31"));
    try {
      const pack = await buildContextPackage({ question: g.query, recipient: cloud, situation, candidates: [await wordCandidates(g.query)], pins: [] }, host);
      expect(pack.part.text).toContain("2027-03-31");
      expect(pack.part.text).not.toContain(g.fact!);
    } finally {
      disk.set(path, before);
    }
  });
});
