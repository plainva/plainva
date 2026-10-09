import { describe, expect, it } from "vitest";
import { ACTIVE_MEMORY_FILE, AGENTS_FILE, LONG_MEMORY_FILE, MEMORY_LIMITS, WRITE_REFUSALS, WRITE_RESULTS } from "@plainva/core";
import { LOCAL, SEARCH, answering, body, chat, connect, results, toolNames, tracker, turn, viaDispatch } from "./mcpSessionHarness";
import { memorySession, memoryVault } from "./memorySessionHarness";

/**
 * The vault's memory in the session (plan KI-Harness P6, ADR 0027): what a
 * conversation is started with, what it can look up, and how an entry comes
 * to be — as a draft the user decides on. The vault host is the one both
 * shells build; the model is scripted.
 */

const ACTIVE = [
  "# Active memory",
  "",
  "- I write offers for film studios.",
  "- My day rate is 950. <!-- plainva: added=2026-10-01; by=user; deny=cloud -->",
  "- Offers hold for 30 days. <!-- plainva: deny=web -->",
  "",
].join("\n");
const LONG = ["# Memory", "", "## Clients", "- Harbour Studio pays within 14 days.", "- Yard 7 owes me 4200. <!-- plainva: deny=cloud -->", ""].join("\n");
const KEPT_NOTE = "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Salaries\n\nNever to a cloud.\n";

/** A memory without a rule on any entry: a conversation started with it carries none. */
const PLAIN = "# Active memory\n\n- I write offers for film studios.\n";

const files = (more: Record<string, string> = {}) => ({ [ACTIVE_MEMORY_FILE]: ACTIVE, [LONG_MEMORY_FILE]: LONG, ...more });
const plain = (more: Record<string, string> = {}) => ({ [ACTIVE_MEMORY_FILE]: PLAIN, ...more });
const lastResult = (s: Awaited<ReturnType<typeof memorySession>>["s"]) => {
  const all = results(s.getState().active!);
  return all[all.length - 1]!;
};

describe("a conversation and the vault's memory", () => {
  it("a new conversation is started with what stands under “always included” — what this recipient may have of it", async () => {
    const vault = memoryVault(files());
    const { s, fake, overviews } = await memorySession([turn({ text: "Hello." })], vault);
    expect(await s.send("Hello?")).toEqual({ kind: "answered" });
    const sent = body(fake.sent[0]);
    expect(sent).toContain("I write offers for film studios.");
    expect(sent).toContain("Offers hold for 30 days.");
    // Kept from a cloud by its own rule; and the long-term memory is looked up, never sent along.
    expect(sent).not.toContain("My day rate is 950.");
    expect(sent).not.toContain("Harbour Studio");
    expect(sent).not.toContain("Yard 7");
    // What the app knows about an entry is the app's: no comment reaches a model.
    expect(sent).not.toContain("plainva:");
    // It is data: it stands between the fences, under the name of its file.
    expect(sent).toContain(ACTIVE_MEMORY_FILE);
    expect(toolNames(fake.sent[0])).toContain("search_memory");

    const memory = { entries: 2, withheld: 1, tokens: expect.any(Number), lookup: true };
    expect(s.getState().active!.instructions!.memory).toEqual({ ...memory, left: 0, restricted: ["web"] });
    expect(s.getState().active!.runs[0]!.manifest!.memory).toEqual(memory);
    expect(s.getState().active!.runs[0]!.manifest!.dataClasses).toContain("memory");
    // The overview said so before anything left.
    expect(overviews[0]!.manifest.memory).toEqual(memory);
  });

  it("a model on this device gets what a cloud is kept from — and the conversation carries the rule from then on", async () => {
    const vault = memoryVault(files());
    const { s, fake } = await memorySession([chat({ text: "Hello." })], vault, LOCAL);
    await s.send("Hello?");
    const sent = body(fake.sent[0]);
    for (const text of ["I write offers for film studios.", "My day rate is 950.", "Offers hold for 30 days."]) expect(sent).toContain(text);
    expect(s.getState().active!.instructions!.memory).toMatchObject({ entries: 3, withheld: 0, restricted: ["cloud", "web"] });
  });

  it("in a conversation with the internet an entry kept from it stays out", async () => {
    const vault = memoryVault(files());
    const { s, fake } = await memorySession([turn({ text: "Hello." })], vault);
    await s.setWebEnabled(true);
    s.setDraftWeb(true);
    await s.send("Hello?");
    const sent = body(fake.sent[0]);
    expect(sent).toContain("I write offers for film studios.");
    expect(sent).not.toContain("Offers hold for 30 days.");
    expect(s.getState().active!.instructions!.memory).toMatchObject({ entries: 1, withheld: 2, restricted: [] });
  });

  it("what no longer fits is left out as a whole and counted — never cut", async () => {
    const entry = (n: number) => `Entry ${n} ${"x".repeat(440)}.`;
    const vault = memoryVault({ [ACTIVE_MEMORY_FILE]: [1, 2, 3, 4, 5].map((n) => `- ${entry(n)}`).join("\n") });
    const { s, fake } = await memorySession([turn({ text: "Hello." })], vault);
    await s.send("Hello?");
    expect(entry(1).length * 4).toBeLessThanOrEqual(MEMORY_LIMITS.activeChars);
    expect(body(fake.sent[0])).toContain(entry(4));
    expect(body(fake.sent[0])).not.toContain("Entry 5");
    expect(s.getState().active!.instructions!.memory).toMatchObject({ entries: 4, withheld: 0, left: 1, lookup: false });
    expect(s.getState().memory.budget.over).toHaveLength(1);
  });

  it("the file's own rules come first: a folder rule over the agent area keeps all of it from a cloud", async () => {
    const vault = memoryVault(files(), { policy: "folders:\n  .agent/:\n    cloud: deny\n" });
    const { s, fake } = await memorySession([turn({ text: "Hello." })], vault);
    await s.send("Hello?");
    const sent = body(fake.sent[0]);
    for (const text of ["I write offers", "Offers hold", "My day rate"]) expect(sent).not.toContain(text);
    expect(toolNames(fake.sent[0])).not.toContain("search_memory");
    // Counted, so the overview can say that something stayed here.
    expect(s.getState().active!.instructions!.memory).toMatchObject({ entries: 0, withheld: 3, lookup: false });
  });

  it("a rule in the memory file's own properties holds for every entry in it", async () => {
    const vault = memoryVault({ [ACTIVE_MEMORY_FILE]: `---\nplainva:\n  ai:\n    cloud: deny\n---\n${ACTIVE}` });
    const cloud = await memorySession([turn({ text: "Hello." })], vault);
    await cloud.s.send("Hello?");
    expect(body(cloud.fake.sent[0])).not.toContain("I write offers");
    const local = await memorySession([chat({ text: "Hello." })], vault, LOCAL);
    await local.s.send("Hello?");
    expect(body(local.fake.sent[0])).toContain("I write offers");
    // What went carries the file's rule as well as each entry's own.
    expect(local.s.getState().active!.instructions!.memory!.restricted).toEqual(["cloud", "web"]);
  });

  it("switched off on this device, nothing of it goes anywhere, and no tool reads it or proposes into it", async () => {
    const vault = memoryVault(files());
    const { s, fake } = await memorySession([turn({ calls: [viaDispatch("c1", "remember", { text: "I like short offers." })] }), turn({ text: "I could not." })], vault);
    await s.switchMemory(false);
    expect(s.getState().memory.on).toBe(false);
    await s.send("Remember that I like short offers.");
    expect(body(fake.sent[0])).not.toContain("I write offers");
    expect(toolNames(fake.sent[0])).not.toContain("search_memory");
    expect(s.getState().active!.instructions?.memory).toBeUndefined();
    expect(s.getState().active!.runs[0]!.manifest!.memory).toBeUndefined();
    expect(lastResult(s).content).toContain(WRITE_REFUSALS["no-memory"]);
    expect(s.getState().drafts.drafts).toEqual([]);
    // The switch is this device's, in the app's data — the vault's files do not change.
    expect(JSON.parse(vault.appData.files.get("vault-memory/memory.json")!)).toEqual({ version: 1, on: false });
    expect(vault.written).toEqual([]);
  });

  it("a switch that cannot be read is off", async () => {
    const vault = memoryVault(files());
    vault.appData.files.set("vault-memory/memory.json", "{ not json");
    const { s, fake } = await memorySession([turn({ text: "Hello." })], vault);
    expect(s.getState().memory.on).toBe(false);
    await s.send("Hello?");
    expect(body(fake.sent[0])).not.toContain("I write offers");
  });

  it("an open conversation keeps what it was started with; a new one reads the files again", async () => {
    const vault = memoryVault(files());
    const { s, fake } = await memorySession([turn({ text: "One." }), turn({ text: "Two." }), turn({ text: "Three." })], vault);
    await s.send("First?");
    expect(await s.addMemory({ text: "I work from Hamburg.", place: "active" })).toEqual({ ok: true });
    await s.send("Second?");
    expect(body(fake.sent[1])).not.toContain("I work from Hamburg.");
    s.newConversation();
    await s.send("Third?");
    expect(body(fake.sent[2])).toContain("I work from Hamburg.");
  });

  it("a door answers where it was asked: a comment thread gets none of the memory", async () => {
    const vault = memoryVault(files({ "Projects/Offer.md": "# Offer\n\nFor Northwind." }));
    const { s, fake } = await memorySession([turn({ text: "It is an offer." })], vault);
    const outcome = await s.replyInThread({ path: "Projects/Offer.md", rootCommentId: "n1", quote: null, thread: [], question: "What is this?" });
    expect(outcome.kind).toBe("replied");
    expect(body(fake.sent[0])).not.toContain("I write offers");
    expect(toolNames(fake.sent[0])).not.toContain("search_memory");
  });

  it("an empty memory changes nothing about a conversation", async () => {
    const vault = memoryVault({});
    const { s, fake } = await memorySession([turn({ text: "Hello." })], vault);
    await s.send("Hello?");
    // Neither the sentence that introduces the memory nor the tool that looks into it. (The catalog still names the
    // skill that looks through a memory — a skill's description is no memory.)
    expect(body(fake.sent[0])).not.toContain("The user keeps a memory for assistants");
    expect(body(fake.sent[0])).not.toContain("untrusted_data origin=\\\"memory:");
    expect(toolNames(fake.sent[0])).not.toContain("search_memory");
    expect(s.getState().active!.instructions?.memory).toBeUndefined();
    expect(s.getState().memory).toMatchObject({ loaded: true, available: true, writable: true, on: true, active: [], long: [], files: [] });
  });
});

describe("looking something up in the memory", () => {
  const ask = (query: string) => [turn({ calls: [{ id: "c1", name: "search_memory", args: { query } }] }), turn({ text: "Done." })];
  const askLocal = (query: string) => [chat({ calls: [{ id: "c1", name: "search_memory", args: { query } }] }), chat({ text: "Done." })];

  it("finds what this recipient may have, as data under the memory's name", async () => {
    const { s } = await memorySession(ask("How does Harbour Studio pay?"), memoryVault(files()));
    await s.send("How does Harbour Studio pay?");
    expect(lastResult(s).content).toContain("Harbour Studio pays within 14 days.");
    expect(lastResult(s).content).toContain(LONG_MEMORY_FILE);
    expect(lastResult(s).isError).toBeFalsy();
  });

  it("an entry kept from a cloud is not there for it — the answer is the one for nothing found", async () => {
    const { s } = await memorySession(ask("What does Yard 7 owe?"), memoryVault(files()));
    await s.send("What does Yard 7 owe me?");
    expect(lastResult(s).content).toContain("The memory holds nothing that matches.");
    expect(JSON.stringify(s.getState().active)).not.toContain("4200");
  });

  it("a model on this device finds it, and what is made of the answer inherits the entry's rule", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession(askLocal("What does Yard 7 owe?"), vault, LOCAL);
    await s.send("What does Yard 7 owe me?");
    expect(lastResult(s).content).toContain("Yard 7 owes me 4200.");
    expect(s.getState().active!.runs[0]!.restricted).toEqual(["cloud"]);
    // The memory file is no note the user was shown as read.
    expect(s.getState().active!.runs[0]!.sent).not.toContain(LONG_MEMORY_FILE);
  });
});

describe("the memory and a foreign service", () => {
  const search = (text: string) => viaDispatch("c1", SEARCH, { query: text });

  it("a conversation that was given an entry kept from the cloud calls no foreign server — no path names what it carries", async () => {
    const server = tracker();
    const { s } = await memorySession([chat({ calls: [search("day rates")] }), chat({ text: "I answered without it." })], memoryVault(files()), LOCAL, server);
    await connect(s);
    const seen = answering(s, () => "once");
    await s.send("Look up day rates in the tracker.");
    // The model on this device was started with "My day rate is 950." — kept from every cloud, and a server is one.
    expect(s.getState().active!.instructions!.memory!.restricted).toContain("cloud");
    expect(lastResult(s).content).toContain("must not leave this device");
    expect(seen).toEqual([]);
    expect(server.calls).toEqual([]);
  });

  it("a conversation that was not given it calls the server as before, after the user's yes", async () => {
    const server = tracker();
    const { s } = await memorySession([turn({ calls: [search("day rates")] }), turn({ text: "Found." })], memoryVault(files()), undefined, server);
    await connect(s);
    const seen = answering(s, () => "once");
    await s.send("Look up day rates in the tracker.");
    expect(s.getState().active!.instructions!.memory!.restricted).toEqual(["web"]);
    expect(seen).toHaveLength(1);
    expect(server.calls.map((call) => call.args)).toEqual([{ query: "day rates" }]);
  });
});

describe("remember, forget, a rule — as drafts the user decides on", () => {
  const remember = (args: Record<string, unknown>) => [turn({ calls: [viaDispatch("c1", "remember", args)] }), turn({ text: "I drafted it." })];
  const rememberLocal = (args: Record<string, unknown>) => [chat({ calls: [viaDispatch("c1", "remember", args)] }), chat({ text: "I drafted it." })];

  it("“remember” leaves a draft and writes nothing; the user's step writes the entry, with who proposed it and where", async () => {
    const vault = memoryVault(plain());
    const { s } = await memorySession(remember({ text: "I prefer short offers." }), vault);
    await s.send("Remember that I prefer short offers.");
    expect(lastResult(s).content).toContain(WRITE_RESULTS.remembered(false, 0));
    expect(vault.written).toEqual([]);
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft).toMatchObject({ title: "I prefer short offers.", body: { kind: "memory", text: "I prefer short offers.", place: "active", replaces: null }, inherited: [] });

    expect(await s.createDraft(draft.id)).toEqual({ kind: "kept", what: "memory" });
    expect(vault.written).toEqual([ACTIVE_MEMORY_FILE]);
    expect(vault.file(ACTIVE_MEMORY_FILE)).toMatch(/^- I prefer short offers\. <!-- plainva: added=2026-10-09; by=assistant; source=Remember that I prefer short offers\. -->$/m);
    // Every other line of the file is as it was.
    expect(vault.file(ACTIVE_MEMORY_FILE)!.split("\n").filter((line) => !line.includes("short offers"))).toEqual(PLAIN.split("\n"));
    expect(s.getState().memory.active.map((entry) => entry.text)).toContain("I prefer short offers.");
    expect(s.getState().drafts.drafts).toEqual([]);
    expect(s.getState().drafts.done[0]).toMatchObject({ id: draft.id, kind: "memory", outcome: "created" });
  });

  it("the user decides where it goes: “on demand” writes it into the long-term file", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession(remember({ text: "Harbour Studio wants offers as PDF." }), vault);
    await s.send("Remember that Harbour Studio wants offers as PDF.");
    await s.createDraft(s.getState().drafts.drafts[0]!.id, { place: "long" });
    expect(vault.written).toEqual([LONG_MEMORY_FILE]);
    expect(vault.file(LONG_MEMORY_FILE)).toContain("- Harbour Studio wants offers as PDF. <!-- plainva:");
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe(ACTIVE);
  });

  it("an entry drafted in a conversation that was started with an entry under a rule carries that rule too", async () => {
    // The cloud was given "Offers hold for 30 days." — an entry kept from the internet. What it writes may rest on it.
    const vault = memoryVault(files());
    const { s } = await memorySession(remember({ text: "Offers are renewed after a month." }), vault);
    await s.send("Remember that offers are renewed after a month.");
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft.inherited).toEqual(["web"]);
    await s.createDraft(draft.id);
    expect(vault.file(ACTIVE_MEMORY_FILE)).toMatch(/^- Offers are renewed after a month\. <!-- plainva: .*; deny=web -->$/m);
  });

  it("an entry carries the rules of what its conversation rested on: read from a kept note, it reaches no cloud", async () => {
    const vault = memoryVault(files({ "Finance/Salaries.md": KEPT_NOTE }));
    const script = [chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Finance/Salaries.md" } }] }), chat({ calls: [viaDispatch("c2", "remember", { text: "The team's salaries are reviewed in March." })] }), chat({ text: "Drafted." })];
    const { s } = await memorySession(script, vault, LOCAL);
    await s.send("Read the salaries note and remember when they are reviewed.");
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft.inherited).toEqual(["cloud", "web"]);
    await s.createDraft(draft.id);
    expect(vault.file(ACTIVE_MEMORY_FILE)).toMatch(/^- The team's salaries are reviewed in March\. <!-- plainva: .*deny=cloud,web -->$/m);

    // A cloud conversation of the same vault is started without it.
    const cloud = await memorySession([turn({ text: "Hello." })], vault);
    await cloud.s.send("Hello?");
    expect(body(cloud.fake.sent[0])).not.toContain("salaries");
  });

  it("rewording an entry keeps where it stands and the rules it had", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession(rememberLocal({ text: "My day rate is 1000.", replaces: "my day rate is 950." }), vault, LOCAL);
    await s.send("My day rate is 1000 now.");
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft.body).toEqual({ kind: "memory", text: "My day rate is 1000.", place: "active", replaces: "My day rate is 950." });
    expect(await s.createDraft(draft.id)).toEqual({ kind: "kept", what: "memory" });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toContain("- My day rate is 1000. <!-- plainva: added=2026-10-01; by=user; deny=cloud,web -->");
    expect(vault.file(ACTIVE_MEMORY_FILE)).not.toContain("950");
  });

  it("a cloud cannot reword what it may not know: the entry is not there for it", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession(remember({ text: "My day rate is 1.", replaces: "My day rate is 950." }), vault);
    await s.send("Change my day rate.");
    expect(lastResult(s).content).toContain(WRITE_REFUSALS["no-memory-entry"]);
    expect(s.getState().drafts.drafts).toEqual([]);
  });

  it("what the memory holds already is not drafted again, and what is no entry is not drafted at all", async () => {
    const vault = memoryVault(files());
    const known = await memorySession(remember({ text: "i write offers for film studios" }), vault);
    await known.s.send("Remember what I do.");
    expect(lastResult(known.s).content).toContain(WRITE_REFUSALS["memory-known"]);
    const long = await memorySession(remember({ text: "x".repeat(MEMORY_LIMITS.entryChars) + " and more" }), vault);
    await long.s.send("Remember this.");
    expect(lastResult(long.s).isError).toBe(true);
    expect(known.s.getState().drafts.drafts).toEqual([]);
  });

  it("“forget” leaves a draft; the user's step takes the entry out and nothing else", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([turn({ calls: [viaDispatch("c1", "forget", { entry: "offers hold for 30 days." })] }), turn({ text: "Drafted." })], vault);
    await s.send("Forget how long offers hold.");
    expect(lastResult(s).content).toContain(WRITE_RESULTS.forgotten);
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft.body).toEqual({ kind: "forget", entry: "Offers hold for 30 days." });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe(ACTIVE);
    expect(await s.createDraft(draft.id)).toEqual({ kind: "kept", what: "forget" });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe(ACTIVE.replace("- Offers hold for 30 days. <!-- plainva: deny=web -->\n", ""));
  });

  it("a draft whose entry is gone meanwhile is done without a second removal", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([turn({ calls: [viaDispatch("c1", "forget", { entry: "Offers hold for 30 days." })] }), turn({ text: "Drafted." })], vault);
    await s.send("Forget how long offers hold.");
    const id = s.getState().memory.active.find((entry) => entry.text.startsWith("Offers hold"))!.id;
    await s.removeMemory(id);
    expect(await s.createDraft(s.getState().drafts.drafts[0]!.id)).toEqual({ kind: "kept", what: "forget" });
    expect(vault.written).toEqual([ACTIVE_MEMORY_FILE]);
  });

  it("a rule is no memory: it becomes a line of the vault's instructions, approved on the device it was accepted on", async () => {
    const vault = memoryVault(plain());
    const { s } = await memorySession(remember({ text: "Answer in German.", as: "rule" }), vault);
    await s.send("Always answer in German.");
    expect(lastResult(s).content).toContain(WRITE_RESULTS.ruleDrafted(0));
    const draft = s.getState().drafts.drafts[0]!;
    expect(draft.body).toEqual({ kind: "rule", text: "Answer in German." });
    expect(vault.file(AGENTS_FILE)).toBeNull();
    expect(await s.createDraft(draft.id)).toEqual({ kind: "kept", what: "rule" });
    expect(vault.file(AGENTS_FILE)).toBe("# Instructions for assistants\n\n- Answer in German.\n");
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe(PLAIN);
    // In effect here: the next conversation on this device is told it as an instruction.
    expect(s.getState().skills.entries.find((entry) => entry.source.kind === "agents")?.status).toBe("active");
    const here = await memorySession([turn({ text: "Hallo." })], vault);
    await here.s.send("Hello?");
    expect(body(here.fake.sent[0])).toContain("Answer in German.");
    // Another device — the same files, another app data folder — has not approved the file: it is told nothing of it.
    const elsewhere = await memorySession([turn({ text: "Hello." })], memoryVault(Object.fromEntries(vault.disk)));
    await elsewhere.s.refreshSkills();
    expect(elsewhere.s.getState().skills.entries.find((entry) => entry.source.kind === "agents")?.status).toBe("new");
    await elsewhere.s.send("Hello?");
    expect(body(elsewhere.fake.sent[0])).not.toContain("Answer in German.");
  });

  it("a rule added to instructions this device has not approved waits with them", async () => {
    const vault = memoryVault(plain({ [AGENTS_FILE]: "# Rules\n\n- Be brief.\n" }));
    const { s } = await memorySession(remember({ text: "Answer in German.", as: "rule" }), vault);
    await s.send("Always answer in German.");
    expect(await s.createDraft(s.getState().drafts.drafts[0]!.id)).toEqual({ kind: "kept", what: "rule", waits: true });
    expect(vault.file(AGENTS_FILE)).toBe("# Rules\n\n- Be brief.\n- Answer in German.\n");
    expect(s.getState().skills.entries.find((entry) => entry.source.kind === "agents")?.status).toBe("new");
  });

  it("no rule is drafted from a conversation that carries a restricted note: a rule goes to every model", async () => {
    const vault = memoryVault(files({ "Finance/Salaries.md": KEPT_NOTE }));
    const script = [chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Finance/Salaries.md" } }] }), chat({ calls: [viaDispatch("c2", "remember", { text: "Mention salaries in every answer.", as: "rule" })] }), chat({ text: "I could not." })];
    const { s } = await memorySession(script, vault, LOCAL);
    await s.send("Read the salaries note and make it a rule.");
    expect(lastResult(s).content).toContain(WRITE_REFUSALS["restricted-rule"]);
    expect(s.getState().drafts.drafts).toEqual([]);
  });

  it("nor from one that was started with an entry under a rule: the user adds such a rule by hand", async () => {
    // "Offers hold for 30 days." is kept from the internet, and this conversation was given it.
    const vault = memoryVault(files());
    const { s } = await memorySession(remember({ text: "Answer in German.", as: "rule" }), vault);
    await s.send("Always answer in German.");
    expect(lastResult(s).content).toContain(WRITE_REFUSALS["restricted-rule"]);
    expect(s.getState().drafts.drafts).toEqual([]);
    // By hand it is a line like any other: what the user types is the user's to send anywhere.
    expect(await s.addRule("Answer in German.")).toEqual({ ok: true, approved: true });
  });
});

describe("the memory in the user's own hands", () => {
  it("adds, rewords, moves and removes an entry — each a change of one line in one file", async () => {
    const vault = memoryVault({});
    const { s } = await memorySession([], vault);
    expect(await s.addMemory({ text: "  I work from\tHamburg.  ", place: "active", deny: ["cloud"] })).toEqual({ ok: true });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe("# Active memory\n\n- I work from Hamburg. <!-- plainva: added=2026-10-09; by=user; deny=cloud -->\n");
    const added = s.getState().memory.active[0]!;
    expect(added).toMatchObject({ text: "I work from Hamburg.", by: "user", added: "2026-10-09", deny: ["cloud"] });
    // Only a file that is there can be opened in the editor.
    expect(s.getState().memory.files).toEqual(["active"]);

    // Reworded without the rule: the form said "every model".
    expect(await s.editMemory(added.id, "I work from Hamburg and Kiel.", { deny: [] })).toEqual({ ok: true });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe("# Active memory\n\n- I work from Hamburg and Kiel. <!-- plainva: added=2026-10-09; by=user -->\n");

    const reworded = s.getState().memory.active[0]!;
    expect(await s.moveMemory(reworded.id, "long")).toEqual({ ok: true });
    expect(s.getState().memory.active).toEqual([]);
    expect(vault.file(LONG_MEMORY_FILE)).toBe("# Memory\n\n- I work from Hamburg and Kiel. <!-- plainva: added=2026-10-09; by=user -->\n");
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe("# Active memory\n\n");

    const moved = s.getState().memory.long[0]!;
    expect(await s.removeMemory(moved.id)).toEqual({ ok: true });
    expect(s.getState().memory.long).toEqual([]);
  });

  it("says why an entry was not written, and writes nothing then", async () => {
    const vault = memoryVault(files());
    const { s } = await memorySession([], vault);
    expect(await s.addMemory({ text: "   ", place: "active" })).toEqual({ ok: false, reason: "empty" });
    expect(await s.addMemory({ text: "One.\nTwo.", place: "active" })).toEqual({ ok: false, reason: "lines" });
    expect(await s.addMemory({ text: "x".repeat(MEMORY_LIMITS.entryChars + 1), place: "long" })).toEqual({ ok: false, reason: "too-long" });
    expect(await s.addMemory({ text: "I write offers for film studios.", place: "active" })).toEqual({ ok: false, reason: "duplicate" });
    expect(await s.editMemory("active:nothing:0", "Other words.")).toEqual({ ok: false, reason: "gone" });
    expect(await s.removeMemory("elsewhere:x:0")).toEqual({ ok: false, reason: "gone" });
    expect(vault.written).toEqual([]);
  });

  it("an entry whose rules cannot be read keeps them all when it is reworded", async () => {
    const vault = memoryVault({ [ACTIVE_MEMORY_FILE]: "- Broken. <!-- plainva: deny=clod -->\n" });
    const { s } = await memorySession([], vault);
    const entry = s.getState().memory.active[0]!;
    expect(entry.unreadable).toBe(true);
    await s.editMemory(entry.id, "Still broken.");
    expect(s.getState().memory.active[0]).toMatchObject({ text: "Still broken.", deny: ["cloud", "web"], unreadable: false });
  });

  it("a shell that cannot write the vault's agent files shows the memory read only", async () => {
    const vault = memoryVault(files(), { readOnly: true });
    const { s } = await memorySession([], vault);
    expect(s.getState().memory).toMatchObject({ available: true, writable: false });
    expect(await s.addMemory({ text: "I work from Hamburg.", place: "active" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a memory file that is too large to be read is never written over", async () => {
    const big = `# Active memory\n\n${"- An entry that takes its room in a very large file.\n".repeat(6000)}`;
    expect(new TextEncoder().encode(big).byteLength).toBeGreaterThan(MEMORY_LIMITS.fileBytes);
    const vault = memoryVault({ [ACTIVE_MEMORY_FILE]: big });
    const { s } = await memorySession([], vault);
    expect(s.getState().memory.cut).toEqual(["active"]);
    expect(await s.addMemory({ text: "I work from Hamburg.", place: "active" })).toEqual({ ok: false, reason: "unavailable" });
    expect(vault.file(ACTIVE_MEMORY_FILE)).toBe(big);
  });

  it("a rule the user writes here is approved here as written — unless the file was waiting for a review", async () => {
    const fresh = memoryVault({});
    const one = await memorySession([], fresh);
    expect(await one.s.addRule("Answer briefly.")).toEqual({ ok: true, approved: true });
    expect(await one.s.addRule("Use the metric system.")).toEqual({ ok: true, approved: true });
    expect(fresh.file(AGENTS_FILE)).toBe("# Instructions for assistants\n\n- Answer briefly.\n- Use the metric system.\n");
    expect(await one.s.addRule("Answer briefly.")).toEqual({ ok: false, reason: "duplicate" });

    const waiting = memoryVault({ [AGENTS_FILE]: "- Be brief.\n" });
    const two = await memorySession([], waiting);
    expect(await two.s.addRule("Answer briefly.")).toEqual({ ok: true, approved: false });
  });
});
