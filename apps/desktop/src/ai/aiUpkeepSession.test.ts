import { describe, expect, it } from "vitest";
import { ACTIVE_MEMORY_FILE, LONG_MEMORY_FILE, addMemoryEntry, type EgressChunk, type InstructionApprovals, type LedgerEntry, type UpkeepHint } from "@plainva/core";
import type { AiSession } from "@plainva/ui";
import { turn } from "./mcpSessionHarness";
import { memorySession, memoryVault, type MemoryVault } from "./memorySessionHarness";

/**
 * Upkeep without a model, in the session (plan KI-Harness P6-3, ADR 0029):
 * what the device says about its skills and its memory — from what it already
 * holds, with no request and no write —, how a hint is put away, and how the
 * run ledger tells a run somebody asked for from one nobody typed. The vault
 * host is the one both shells build; the session's clock stands at
 * 2026-10-09 10:00 UTC.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-09T10:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const day = (days: number) => ago(days).slice(0, 10);

const BODY = [
  "1. Read the offer the user names and list its positions.",
  "2. Look up last year's rate for each position in the notes under Projects/.",
  "3. Say which positions differ from last year, by how much, and where the rate was found.",
  "4. End with the positions for which no rate was found.",
].join("\n");
const skillFile = (name: string, description: string, body = BODY, tools = "search_vault read_note") => `---\nname: ${name}\ndescription: ${description}\nallowed-tools: ${tools}\n---\n\n${body}\n`;
const idOf = (name: string) => `.agent/skills/${name}`;
const pathOf = (name: string) => `${idOf(name)}/SKILL.md`;
const SCENARIOS = JSON.stringify({ version: 1, scenarios: [{ id: "rates", message: "Check the offer." }] });

const LETTER_A = skillFile("client-letter", "Drafts a letter to a client in the tone of the last three letters to this client.", "Write the letter.\n");
const LETTER_B = skillFile("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "Compose it.\n");
const NUMBERS = skillFile("weekly-numbers", "Sums up the week's sales figures from the notes under Sales/.", "Add them up.\n");
const FAIR = skillFile("fair-follow-up", "Writes the follow-up after a trade fair, one note per contact.", "Collect the contacts.\n", "search_vault send_mail");
const OFFER = skillFile("offer-check", "Checks an offer against last year's rates. Use when an offer is open.");

type Session = AiSession;
const hints = (s: Session) => s.getState().upkeep;
const kinds = (list: readonly UpkeepHint[]) => list.map((hint) => hint.kind);
const approvalsKey = (vault: MemoryVault) => [...vault.appData.files.keys()].find((name) => name.endsWith("/instructions.json"))!;

/** Approves every skill of the vault on this device as it stands — and, with `at`, as if that had been then. */
async function approveAll(s: Session, vault: MemoryVault, at?: string): Promise<void> {
  for (const entry of (await s.refreshSkills()).filter((candidate) => candidate.source.origin === "vault" && candidate.status !== "active")) {
    expect(await s.approveSource(entry.source.id, Object.fromEntries(entry.source.files.map((file) => [file.path, file.sha256])))).toBeNull();
  }
  if (at) {
    const key = approvalsKey(vault);
    const stored = JSON.parse(vault.appData.files.get(key)!) as InstructionApprovals;
    vault.appData.files.set(key, JSON.stringify({ ...stored, approved: stored.approved.map((approval) => ({ ...approval, at })) }));
    await s.refreshSkills();
  }
}
const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
const run = (at: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({ at, conversationId: "c-1", providerId: "anthropic", model: "m-1", stop: "answered", steps: 1, tools: [], usage, ...over });
/** An answer that was cut off at the output limit: a run that ends so did not answer. */
function cutOff(): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "First I" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("") }, { type: "done" }];
}
const memoryFile = (place: "active" | "long", ...lines: [text: string, added: string][]): string => {
  let text: string | null = null;
  for (const [entry, added] of lines) {
    const next = addMemoryEntry(text, place, entry, { added, by: "user" });
    if (!next.ok) throw new Error(`fixture: ${next.problem}`);
    text = next.text;
  }
  return text!;
};

describe("what the device says about its skills", () => {
  it("is nothing for a vault in order — and nobody is asked, and nothing is written", async () => {
    const vault = memoryVault({ [pathOf("offer-check")]: OFFER });
    const { s, fake } = await memorySession([], vault);
    await approveAll(s, vault);
    const written = [...vault.written];
    await s.refreshUpkeep();
    expect(hints(s)).toEqual({ skills: [], memory: [] });
    expect(fake.sent).toEqual([]);
    expect(vault.written).toEqual(written);
  });

  it("names skills that say almost the same, a skill nobody ran, and a tool that does not exist — from its own data alone", async () => {
    const vault = memoryVault({ [pathOf("client-letter")]: LETTER_A, [pathOf("letter-to-client")]: LETTER_B, [pathOf("weekly-numbers")]: NUMBERS, [pathOf("fair-follow-up")]: FAIR });
    const { s, fake } = await memorySession([], vault);
    await approveAll(s, vault, ago(200));
    // The two letters ran lately; the numbers ran in spring; the follow-up never did.
    await vault.host.ledger.save([run(ago(150), { skills: [idOf("weekly-numbers")] }), run(ago(3), { skills: [idOf("client-letter")] }), run(ago(2), { skills: [idOf("letter-to-client")] }), run(ago(1), { skills: [idOf("fair-follow-up")] })]);
    const disk = new Map(vault.disk);
    await s.refreshUpkeep();
    const found = hints(s).skills;
    expect(kinds(found)).toEqual(["skill-unknown-tool", "skills-alike", "skill-unused"]);
    expect(found[0]).toMatchObject({ id: idOf("fair-follow-up"), tools: ["send_mail"] });
    expect(found[1]).toMatchObject({ a: idOf("client-letter"), b: idOf("letter-to-client") });
    expect(found[2]).toMatchObject({ id: idOf("weekly-numbers"), last: ago(150), approved: ago(200) });
    // Arithmetic on this device: no request left it, and no file of the vault was touched.
    expect(fake.sent).toEqual([]);
    expect(new Map(vault.disk)).toEqual(disk);
  });

  it("puts a hint away on this device — in the app's data, never in the vault — until the matter itself changes", async () => {
    const vault = memoryVault({ [pathOf("client-letter")]: LETTER_A, [pathOf("letter-to-client")]: LETTER_B });
    const { s } = await memorySession([], vault);
    await approveAll(s, vault);
    await s.refreshUpkeep();
    const pair = hints(s).skills[0]!;
    expect(pair.kind).toBe("skills-alike");
    const disk = new Map(vault.disk);

    await s.dismissUpkeepHint(pair.key);
    expect(hints(s).skills).toEqual([]);
    expect(JSON.parse(vault.appData.files.get("vault-memory/upkeep.json")!)).toEqual({ version: 1, dismissed: [pair.key] });
    expect(new Map(vault.disk)).toEqual(disk);
    // Still put away after the views read again.
    await s.refreshSkills();
    await s.refreshUpkeep();
    expect(hints(s).skills).toEqual([]);

    // One of the two is rewritten and approved again: the question is a new one.
    vault.disk.set(pathOf("letter-to-client"), skillFile("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "Compose it, briefly.\n"));
    await approveAll(s, vault);
    await s.refreshUpkeep();
    expect(kinds(hints(s).skills)).toEqual(["skills-alike"]);
    expect(hints(s).skills[0]!.key).not.toBe(pair.key);
  });

  it("switching one of two alike skills off settles the hint: the device's list changes, no file of the vault", async () => {
    const vault = memoryVault({ [pathOf("client-letter")]: LETTER_A, [pathOf("letter-to-client")]: LETTER_B });
    const { s } = await memorySession([], vault);
    await approveAll(s, vault);
    await s.refreshUpkeep();
    expect(kinds(hints(s).skills)).toEqual(["skills-alike"]);
    const disk = new Map(vault.disk);
    await s.switchInstruction(idOf("letter-to-client"), false);
    await s.refreshUpkeep();
    expect(hints(s).skills).toEqual([]);
    expect(new Map(vault.disk)).toEqual(disk);
    expect((JSON.parse(vault.appData.files.get(approvalsKey(vault))!) as InstructionApprovals).off).toEqual([idOf("letter-to-client")]);
  });

  it("a run somebody started is a run; a regression run is marked as one nobody typed", async () => {
    const vault = memoryVault({ [pathOf("offer-check")]: OFFER, [`${idOf("offer-check")}/tests/scenarios.json`]: SCENARIOS });
    const { s } = await memorySession([turn({ text: "Every rate matches." }), turn({ text: "Every rate matches." })], vault);
    await approveAll(s, vault);
    expect(await s.runSkill(idOf("offer-check"), "Check the offer for Harbour Studio.")).toEqual({ kind: "answered" });
    expect(await s.testSkills([idOf("offer-check")], { maxCostUsd: null })).toMatchObject({ kind: "done" });
    const ledger = await vault.host.ledger.load();
    expect(ledger.map((entry) => [entry.skills, entry.aside ?? false])).toEqual([
      [[idOf("offer-check")], false],
      [[idOf("offer-check")], true],
    ]);
  });

  it("a skill whose runs end without an answer leads to a review of its newest run — which is asked about first", async () => {
    const vault = memoryVault({ [pathOf("offer-check")]: OFFER });
    const { s, fake } = await memorySession([cutOff(), cutOff()], vault);
    await approveAll(s, vault);
    await s.runSkill(idOf("offer-check"), "Check the offer for Harbour Studio.");
    await s.runSkill(idOf("offer-check"), "Check the offer for Yard 7.");
    const ledger = await vault.host.ledger.load();
    expect(ledger.map((entry) => entry.stop)).toEqual(["max_tokens", "max_tokens"]);
    const newest = ledger[ledger.length - 1]!.conversationId;
    expect(newest).not.toBe(ledger[0]!.conversationId);
    await s.refreshUpkeep();
    expect(hints(s).skills).toEqual([expect.objectContaining({ kind: "skill-failing", id: idOf("offer-check"), failed: 2, runs: 2, conversationId: newest })]);
    // The hint sent nothing; the review it leads to says first what it would send.
    expect(fake.sent).toHaveLength(2);
    expect(await s.learnPlan(newest)).toMatchObject({ ok: true, plan: { conversationId: newest } });
    expect(fake.sent).toHaveLength(2);
  });

  it("speaks of a regression result only while it stands for the skill and the model as they are now", async () => {
    const vault = memoryVault({ [pathOf("offer-check")]: OFFER, [`${idOf("offer-check")}/tests/scenarios.json`]: SCENARIOS });
    const { s } = await memorySession([], vault);
    await approveAll(s, vault);
    const plan = (await s.skillTestPlan())!;
    const target = plan.targets.find((candidate) => candidate.id === idOf("offer-check"))!;
    const failed = { id: "rates", passed: false, checks: [], stop: "answered", tokens: 10 };
    const record = (over: Record<string, unknown> = {}) => ({ id: idOf("offer-check"), version: target.version, providerId: plan.choice.providerId, model: plan.choice.model, at: ago(1), scenarios: [failed], ...over });

    await vault.host.skillTests!.save({ records: [record()] });
    await s.refreshSkills();
    await s.refreshUpkeep(plan);
    expect(hints(s).skills).toEqual([expect.objectContaining({ kind: "skill-test-failing", id: idOf("offer-check"), failed: 1, ran: 1, model: plan.choice.model })]);

    // A result of another model, or of another version of the skill, says nothing about this one.
    await vault.host.skillTests!.save({ records: [record({ model: "another-model" })] });
    await s.refreshSkills();
    await s.refreshUpkeep(plan);
    expect(hints(s).skills).toEqual([]);
    await vault.host.skillTests!.save({ records: [record({ version: "an-earlier-version" })] });
    await s.refreshSkills();
    await s.refreshUpkeep(plan);
    expect(hints(s).skills).toEqual([]);

    // Without a plan — the memory's view has none — nothing is said about tests.
    await vault.host.skillTests!.save({ records: [record()] });
    await s.refreshSkills();
    await s.refreshUpkeep(null);
    expect(hints(s).skills).toEqual([]);
  });
});

describe("what the device says about its memory", () => {
  const files = () => ({
    [ACTIVE_MEMORY_FILE]: memoryFile("active", ["Harbour Studio bills per episode.", day(10)]),
    [LONG_MEMORY_FILE]: memoryFile("long", ["Harbour Studio bills per episode, not per hour.", day(5)], ["Ms Petersen is my tax adviser.", day(400)]),
  });

  it("names two entries that say almost the same and one from more than a year ago", async () => {
    const vault = memoryVault(files());
    const { s, fake } = await memorySession([], vault);
    await s.refreshUpkeep();
    const memory = s.getState().memory;
    const found = hints(s).memory;
    expect(kinds(found)).toEqual(["entries-alike", "entry-old"]);
    expect(new Set([(found[0] as Extract<UpkeepHint, { kind: "entries-alike" }>).a, (found[0] as Extract<UpkeepHint, { kind: "entries-alike" }>).b])).toEqual(new Set([memory.active[0]!.id, memory.long[0]!.id]));
    expect(found[1]).toMatchObject({ id: memory.long[1]!.id, added: day(400) });
    expect(fake.sent).toEqual([]);
    expect(vault.written).toEqual([]);
  });

  it("a hint is settled by the user's own step on the entry", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([], vault);
    await s.refreshUpkeep();
    const twin = s.getState().memory.long[0]!.id;
    expect((await s.removeMemory(twin)).ok).toBe(true);
    await s.refreshUpkeep();
    expect(kinds(hints(s).memory)).toEqual(["entry-old"]);
  });

  it("says nothing about a memory that is switched off on this device", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([], vault);
    await s.switchMemory(false);
    await s.refreshUpkeep();
    expect(hints(s).memory).toEqual([]);
    await s.switchMemory(true);
    await s.refreshUpkeep();
    expect(kinds(hints(s).memory)).toEqual(["entries-alike", "entry-old"]);
  });

  it("another vault's hints are not this one's", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([], vault);
    await s.refreshUpkeep();
    expect(hints(s).memory).toHaveLength(2);
    const other = memoryVault({});
    await s.attachVault(other.host);
    expect(hints(s)).toEqual({ skills: [], memory: [] });
  });
});
