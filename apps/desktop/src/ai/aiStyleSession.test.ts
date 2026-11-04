import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  EMPTY_INSTRUCTION_APPROVALS,
  notePolicyFrom,
  readConversationRecord,
  readInstructionFile,
  scanInstruction,
  scanVaultInstructions,
  type ConversationRecord,
  type EgressChunk,
  type EgressManifest,
  type InstructionIO,
  type LedgerEntry,
  type ModelChoice,
} from "@plainva/core";
import {
  AiSession,
  CHAT_TOOL_NAMES,
  captureVocabularyOf,
  createStylePrefStore,
  createVaultToolExecutor,
  createWriteDraftStore,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  styleView,
  type AiVaultHost,
  type VaultToolDeps,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { chat, CLOUD, fakeEgress, LOCAL, turn, viaDispatch } from "./mcpSessionHarness";
import { memoryFiles } from "./mcpTestHost";

/**
 * The writing style in the real session (plan KI-Harness P9-3, ADR 0035):
 * measured on this device from notes the user chose, kept as paths and the
 * features taken out — never a note's text —; carried only by a conversation
 * the user started with "My style", as lines the app wrote; an example a rule
 * keeps from the reader gives it nothing; and what such a conversation lays
 * down says so and stays the model's.
 */

const WEEKLY = [
  "# Weekly 41",
  "",
  "Ich habe heute mit dem Studio gesprochen. Du kannst die Termine morgen prüfen.",
  "",
  "Das Budget steht noch nicht fest. Wir warten auf die Zahlen vom Verleih.",
  "",
  "## Offen",
  "- Termine für den zweiten Block klären",
  "- Budget mit dir abstimmen",
  "- Tonmischung: wer bezahlt das?",
  "- Drehplan für den Winter schreiben",
  "",
  "Ich schicke dir die Liste am Abend. Dann sehen wir weiter, z. B. am 3. März im Büro.",
  "",
  "Kannst du mir sagen, ob das passt? Ich brauche die Antwort bis Freitag.",
  "",
  "## Notizen",
  "Der Kunde will mehr Bilder vom Hafen. Das ist gut für uns. Wir haben genug Material.",
  "",
  "Die Kamera ist noch beim Verleih. Ich hole sie morgen ab, wenn du Zeit hast.",
  "",
  "- Kamera abholen",
  "- Akkus laden",
  "- Speicherkarten prüfen",
  "",
  "Am Ende des Tages ist alles fertig. Ich bin zufrieden mit dem Stand. Du auch?",
].join("\n");

/** A note kept from every cloud — written formally, so what it gives is told apart from what the weekly note gives. */
const LETTER = `---\nplainva:\n  ai:\n    cloud: deny\n---\n${Array.from({ length: 6 }, () => "Sehr geehrte Frau Berg, vielen Dank für Ihre Nachricht. Gern sende ich Ihnen das Angebot bis zum Ende der Woche, damit Sie es in Ruhe prüfen können. Sie erreichen mich jederzeit im Büro.").join("\n\n")}\n`;

function vault() {
  const notes = new Map<string, string>([
    ["Notes/Weekly.md", WEEKLY],
    ["Notes/Weekly 42.md", WEEKLY.replace("41", "42")],
    ["Private/Letter.md", LETTER],
    ...Array.from({ length: 7 }, (_, i) => [`More/${i}.md`, WEEKLY] as [string, string]),
  ]);
  const files = memoryFiles();
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const io: InstructionIO = { list: async () => [], read: async () => null };
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const policyOf: VaultToolDeps["policyOf"] = async (path, text) => {
    const said = text ?? notes.get(path) ?? "";
    return effectivePolicy(path, notePolicyFrom(said.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), []);
  };
  const writes: VaultWriteDeps = {
    sealed: () => false,
    current: async (path) => notes.get(path) ?? null,
    propose: async () => {},
    folderExists: async () => true,
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async (kind, day) => (kind === "task" ? "Tasks/task.md" : `Daily/${day}.md`),
    renamePlan: (path, name) => noteRenamePlan({ getBacklinks: async () => [] as never }, async (p) => notes.has(p), path, name),
    rename: async () => null,
    movePlan: (path, folder) => noteMovePlan(async (p) => notes.has(p), path, folder),
    move: async () => null,
    requestDelete: async () => false,
    setRule: async () => false,
    entryPlace: async () => null,
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => notes.get(path) ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-25",
    commands: () => [],
    writes,
  };
  const host: AiVaultHost = {
    conversations: {
      list: async () => [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model })),
      load: async (id) => (saved.has(id) ? readConversationRecord(JSON.parse(JSON.stringify(saved.get(id)))) : null),
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: async (path) => {
      const text = notes.get(path);
      return text === undefined ? null : { path, title: title(path), text };
    },
    situation: async () => ({ now: "2026-10-25 09:14", weekday: "Sunday", calendarDay: "2026-10-25", journalDay: "2026-10-25", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign, writing) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }, writing) };
    },
    instructions: {
      scan: () => scanVaultInstructions(io),
      scanOne: (id) => scanInstruction(io, id),
      readFile: (source, rel) => readInstructionFile(io, source, rel),
      approvals: { load: async () => EMPTY_INSTRUCTION_APPROVALS, save: async () => {} },
    },
    drafts: createWriteDraftStore(files, "vault-style"),
    style: createStylePrefStore(files, "vault-style"),
  };
  return { host, notes, files };
}

async function session(script: EgressChunk[][], v = vault(), choice: ModelChoice = CLOUD) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: choice } };
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "German",
    today: () => "2026-10-25",
    now: () => new Date("2026-10-25T09:14:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key, vars) => (key === "ai.suggestionAuthor" ? `Plainva AI · ${String(vars?.model)}` : key === "ai.replay.title" ? `${vars?.title} · ${vars?.model}` : key),
  });
  // Every send overview the session showed, approved as the user would here.
  const overviews: EgressManifest[] = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (consent) {
      overviews.push(consent.manifest);
      s.answerConsent(true);
    }
  });
  await s.load();
  await s.attachVault(v.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake, v, overviews };
}

const STYLE_BLOCK = "the user chose to have what you write for them follow their own writing style";
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("the writing style of this device (plan P9-3)", () => {
  it("measures the notes the user chose, keeps their paths and what was taken out — never a word of them", async () => {
    const h = await session([]);
    expect(h.s.getState().style).toMatchObject({ available: true, examples: [], features: [] });
    expect(await h.s.addStyleExample("Notes/Weekly.md")).toEqual({ ok: true });
    const style = h.s.getState().style;
    expect(style.examples).toEqual([{ path: "Notes/Weekly.md", title: "Weekly", missing: false, deny: [] }]);
    expect(style.features.map((feature) => feature.key)).toEqual(expect.arrayContaining(["sentences", "lists", "headings", "address"]));
    expect(styleView(t, style, "en").rows.find((row) => row.key === "address")).toEqual({ key: "address", label: "Addresses people as “du”", desc: "“du” 6 times, “Sie” never" });

    // What is no example: the same note twice, a database, the hidden agent area, a note that is not there.
    expect(await h.s.addStyleExample("Notes/Weekly.md")).toEqual({ ok: false, reason: "duplicate" });
    expect(await h.s.addStyleExample("Projects/Board.base")).toEqual({ ok: false, reason: "not-note" });
    expect(await h.s.addStyleExample(".agent/active_memory.md")).toEqual({ ok: false, reason: "not-note" });
    expect(await h.s.addStyleExample("Notes/Gone.md")).toEqual({ ok: false, reason: "not-note" });
    for (let i = 0; i < 7; i++) expect(await h.s.addStyleExample(`More/${i}.md`)).toEqual({ ok: true });
    expect(await h.s.addStyleExample("Notes/Weekly 42.md")).toEqual({ ok: false, reason: "full" });

    // One feature out, and back: the device keeps the paths and the keys, nothing of a text.
    await h.s.removeStyleFeature("address");
    expect(h.s.getState().style.features.map((feature) => feature.key)).not.toContain("address");
    expect(h.s.getState().style.removed).toEqual(["address"]);
    const stored = h.v.files.files.get("vault-style/style.json")!;
    expect(JSON.parse(stored)).toEqual({ version: 1, examples: ["Notes/Weekly.md", ...Array.from({ length: 7 }, (_, i) => `More/${i}.md`)], removed: ["address"] });
    for (const word of ["Studio", "Budget", "Kamera", "du "]) expect(stored).not.toContain(word);
    await h.s.restoreStyleFeatures();
    expect(h.s.getState().style.features.map((feature) => feature.key)).toContain("address");

    // An example that went since says so, and measures nothing until it comes back or is taken out.
    h.v.notes.delete("More/0.md");
    await h.s.refreshStyle();
    expect(h.s.getState().style.examples.find((example) => example.path === "More/0.md")).toMatchObject({ missing: true });
    await h.s.removeStyleExample("More/0.md");
    expect(h.s.getState().style.examples.map((example) => example.path)).not.toContain("More/0.md");
  });

  it("goes into no conversation the user did not choose it for; chosen, the system prompt carries the app's lines from the first message on", async () => {
    const h = await session([turn({ text: "Hier ist ein Entwurf." }), turn({ text: "Noch einer." }), turn({ text: "Und weiter." })]);
    await h.s.addStyleExample("Notes/Weekly.md");
    // Not chosen: nothing of it, though the device keeps a style.
    await h.s.send("Schreib mir eine Notiz.");
    expect(h.s.getState().active!.conversation.system).not.toContain(STYLE_BLOCK);
    expect(h.s.getState().active!.instructions?.style).toBeUndefined();
    // An open conversation keeps what it started with.
    h.s.setDraftStyle(true);
    expect(h.s.getState().draftStyle).toBe(false);

    h.s.newConversation();
    h.s.setDraftStyle(true);
    expect(h.s.getState().draftStyle).toBe(true);
    await h.s.send("Schreib mir eine Notiz für morgen.");
    const record = h.s.getState().active!;
    expect(record.conversation.system).toContain(STYLE_BLOCK);
    expect(record.conversation.system).toContain('- Addresses people informally (in German: "du", not "Sie").');
    expect(record.conversation.system).toContain("Do not use it on your own for an e-mail");
    // No word of the note went with it.
    for (const word of ["Studio", "Budget", "Kamera", "Verleih"]) expect(record.conversation.system).not.toContain(word);
    const features = h.s.getState().style.features.length;
    expect(record.instructions?.style).toEqual({ features, examples: 1, withheld: 0, tokens: expect.any(Number), restricted: [] });
    // The choice was for this one conversation.
    expect(h.s.getState().draftStyle).toBe(false);
    // The first request to this cloud with the style showed it, as a kind of its own.
    const first = h.overviews[h.overviews.length - 1]!;
    expect(first.style).toEqual({ features, examples: 1, withheld: 0, tokens: expect.any(Number) });
    expect(first.dataClasses).toContain("style");
    // Fixed from its first message: the next one carries the same, and says so again in its own record.
    await h.s.send("Und kürzer?");
    expect(h.s.getState().active!.runs[1]!.manifest?.style).toEqual(first.style);
  });

  it("gives a cloud nothing of an example its rules keep from clouds — and a model on this device all of it, with the rule for what is made of it", async () => {
    // To a cloud: the letter stays here; what goes is measured from the weekly note alone, and the overview counts the rest.
    const cloud = await session([turn({ text: "Gut." })]);
    await cloud.s.addStyleExample("Notes/Weekly.md");
    await cloud.s.addStyleExample("Private/Letter.md");
    expect(cloud.s.getState().style.examples.find((example) => example.path === "Private/Letter.md")).toMatchObject({ deny: ["cloud"] });
    cloud.s.setDraftStyle(true);
    await cloud.s.send("Schreib mir etwas.");
    const sent = cloud.s.getState().active!;
    expect(sent.instructions?.style).toMatchObject({ examples: 1, withheld: 1, restricted: [] });
    expect(sent.conversation.system).toContain('"du", not "Sie"');
    expect(cloud.overviews[cloud.overviews.length - 1]!.style).toMatchObject({ examples: 1, withheld: 1 });

    // Only the letter: nothing goes to the cloud, and the record says why.
    const only = await session([turn({ text: "Gut." })]);
    await only.s.addStyleExample("Private/Letter.md");
    only.s.setDraftStyle(true);
    await only.s.send("Schreib mir etwas.");
    expect(only.s.getState().active!.instructions?.style).toEqual({ features: 0, examples: 0, withheld: 1, tokens: 0, restricted: [] });
    expect(only.s.getState().active!.conversation.system).not.toContain(STYLE_BLOCK);

    // On this device: the letter counts, and what the conversation makes inherits its rule.
    const local = await session([chat({ text: "Gut." })], vault(), LOCAL);
    await local.s.addStyleExample("Private/Letter.md");
    local.s.setDraftStyle(true);
    await local.s.send("Schreib mir etwas.");
    const here = local.s.getState().active!;
    expect(here.instructions?.style).toMatchObject({ examples: 1, withheld: 0, restricted: ["cloud"] });
    expect(here.conversation.system).toContain('"Sie", not "du"');
  });

  it("asks a replay's reader with the original's choice, measured for that reader", async () => {
    const h = await session([turn({ text: "Erste Antwort." }), turn({ text: "Zweite Antwort." })]);
    await h.s.addStyleExample("Notes/Weekly.md");
    h.s.setDraftStyle(true);
    await h.s.send("Schreib mir eine Notiz.");
    const original = h.s.getState().active!;
    await h.s.replay(original.id, 0, { providerId: "anthropic", model: "m-2" });
    const replay = h.s.getState().active!;
    expect(replay.id).not.toBe(original.id);
    expect(replay.conversation.system).toContain(STYLE_BLOCK);
    expect(replay.instructions?.style).toMatchObject({ examples: 1, withheld: 0 });
  });

  it("marks what a conversation with the style lays down — signed by its model as every draft is", async () => {
    const h = await session([turn({ calls: [viaDispatch("c1", "create_note", { title: "Vorbesprechung", content: "- Termine klären" })] }), turn({ text: "Der Entwurf wartet." })]);
    await h.s.addStyleExample("Notes/Weekly.md");
    h.s.setDraftStyle(true);
    await h.s.send("Schreib mir eine Notiz für die Vorbesprechung.");
    const [draft] = h.s.getState().drafts.drafts;
    expect(draft).toMatchObject({ title: "Vorbesprechung", style: true, author: { id: "plainva-ai/m-1" } });
    // A draft from a conversation without it carries no such mark.
    const plain = await session([turn({ calls: [viaDispatch("c1", "create_note", { title: "Plain", content: "- eins" })] }), turn({ text: "Wartet." })]);
    await plain.s.send("Schreib mir eine Notiz.");
    expect(plain.s.getState().drafts.drafts[0]).not.toHaveProperty("style");
  });
});
