import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  IMAGE_IS_DATA,
  IMAGE_MAX_BYTES,
  notePolicyFrom,
  readConversationRecord,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type FolderPolicyRule,
  type HttpRequestSpec,
  type ImagePart,
  type LedgerEntry,
} from "@plainva/core";
import { AiSession, CHAT_TOOL_NAMES, createVaultToolExecutor, notesEmbedding, transcriptOf, type AiVaultHost, type ImageRequest, type PreparedImage, type VaultToolDeps } from "@plainva/ui";

/**
 * "Explain image" in the session (plan KI-Harness P4-5): a picture of the
 * vault goes, with a question, to the model a new conversation would get —
 * through the gate, the send overview and a conversation of its own.
 */

/** One Anthropic answer: text. */
function answer(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 2400 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

/** One answer of a server on this computer, as a chat stream. */
function chat(text: string): EgressChunk[] {
  const lines = [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 20 } }];
  return [{ type: "open", status: 200 }, { type: "data", text: `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")}data: [DONE]\n\n` }, { type: "done" }];
}

/** A provider that turns the request down: its model reads no pictures. */
const refusal: EgressChunk[] = [{ type: "httpError", status: 400, body: JSON.stringify({ error: { message: "This model does not support image input." } }) }];

function fakeEgress(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
    },
    async cancel() {},
    async setKey() {},
    async hasKey() {
      return true;
    },
    async deleteKey() {},
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  return { egress, sent };
}

const NOTES: Record<string, string> = {
  "Projects/Kickoff.md": "# Kickoff\n\n![[Whiteboard.jpg]]\n\nThree columns on the board.",
  "Journal/Private.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Private\n\n![[scan.png]]",
};

/** A vault with notes, folder rules and the real read tools. `index`: what the lookup of embedding notes does when it cannot answer. */
function imageVault(options: { rules?: FolderPolicyRule[]; active?: string; index?: "broken" | "truncated" } = {}) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  /** The pictures the lookup of embedding notes was asked about. */
  const asked: string[] = [];
  const policyOf = async (path: string, text?: string) => {
    const own = (text ?? NOTES[path] ?? "").includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {};
    return effectivePolicy(path, notePolicyFrom(own), options.rules ?? []);
  };
  const note = (path: string) => (NOTES[path] === undefined ? null : { path, title: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""), text: NOTES[path]! });
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => NOTES[path] ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-06",
    commands: () => [{ id: "open-graph", label: "Open the graph view", run: () => true }],
  };
  const host: AiVaultHost = {
    conversations: {
      async list() {
        return [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model }));
      },
      async load(id) {
        const r = saved.get(id);
        return r ? readConversationRecord(JSON.parse(JSON.stringify(r))) : null;
      },
      async save(record) {
        saved.set(record.id, JSON.parse(JSON.stringify(record)));
      },
      async remove(id) {
        saved.delete(id);
      },
      async removeAll() {
        saved.clear();
      },
    },
    ledger: {
      async load() {
        return ledger;
      },
      async save(entries) {
        ledger = [...entries];
      },
    },
    async activeNote() {
      return options.active ? note(options.active) : null;
    },
    async readNote(path) {
      return note(path);
    },
    async situation() {
      const active = options.active ? note(options.active) : null;
      return {
        now: "2026-10-06 10:00",
        weekday: "Tuesday",
        calendarDay: "2026-10-06",
        journalDay: "2026-10-06",
        active: active ? { kind: "note" as const, path: active.path, title: active.title } : null,
        tabs: [],
        tasks: [],
        events: [],
        dailyNote: null,
      };
    },
    async candidates() {
      return [];
    },
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web) {
      return { names: CHAT_TOOL_NAMES, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact) };
    },
    // The notes that embed a picture, found as the shells find them: the notes that name the file, then their embeds.
    async embedders(path) {
      asked.push(path);
      if (options.index === "broken") return null;
      return notesEmbedding(path, {
        containing: async (needles) => ({ paths: Object.keys(NOTES).filter((note) => needles.some((needle) => NOTES[note]!.includes(needle))), truncated: options.index === "truncated" }),
        read: async (note) => NOTES[note] ?? null,
      });
    },
  };
  return { host, saved, ledger: () => ledger, asked };
}

const CLOUD = { providerId: "anthropic", model: "m-1" };
const LOCAL = { providerId: "ollama", model: "local-vision:8b" };
const SYSTEM = { providerId: "apple", model: "system" };

async function session(script: EgressChunk[][], vault: ReturnType<typeof imageVault>, options: { choice?: { providerId: string; model: string }; consent?: "send" | "cancel" | "hold" } = {}) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama", "apple", "openrouter"], profiles: { balanced: options.choice ?? CLOUD } };
  const labels: Record<string, (vars?: Record<string, string>) => string> = {
    "ai.image.ask": () => "Explain this image.",
    "ai.image.title": (vars) => `Image: ${vars?.name ?? ""}`,
  };
  const s = new AiSession({
    egress: fake.egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-06",
    now: () => new Date("2026-10-06T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key, vars) => labels[key]?.(vars) ?? key,
  });
  const overviews: NonNullable<ReturnType<AiSession["getState"]>["consent"]>[] = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (!consent || overviews.includes(consent)) return;
    overviews.push(consent);
    if (options.consent !== "hold") s.answerConsent(options.consent !== "cancel");
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake, overviews };
}

const PICTURE: PreparedImage = { mime: "image/jpeg", data: "QUJDRA==", width: 1568, height: 1045, bytes: 312_000 };

/** A request whose picture is ready; `loads` counts how often the file was asked for. */
function request(path: string, extra: Partial<ImageRequest> = {}) {
  let loads = 0;
  const made: ImageRequest = {
    path,
    load: async () => {
      loads++;
      return PICTURE;
    },
    ...extra,
  };
  return { made, loads: () => loads };
}

const messages = (spec: HttpRequestSpec | undefined) => (spec?.body?.messages ?? []) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
const toolNames = (spec: HttpRequestSpec | undefined) => ((spec?.body?.tools ?? []) as { name?: string }[]).map((tool) => tool.name);

describe("explain image", () => {
  it("sends the picture with a question, in a conversation of its own that keeps it", async () => {
    const vault = imageVault();
    const { s, fake, overviews } = await session([answer("A whiteboard with three columns: now, next, later.")], vault);
    const { made, loads } = request("Projects/Assets/Whiteboard.jpg");
    const outcome = await s.explainImage(made);
    expect(outcome).toEqual({ kind: "answered", conversationId: "id1" });
    expect(loads()).toBe(1);

    // What reached the provider: the words before the picture, the picture, the question — and of the picture only its bytes.
    const [first] = messages(fake.sent[0]);
    const kinds = first!.content.map((block) => block.type);
    expect(kinds.slice(-3)).toEqual(["text", "image", "text"]);
    const [lead, image, question] = first!.content.slice(-3);
    expect(lead!.text).toContain('the file "Projects/Assets/Whiteboard.jpg" from the user\'s vault');
    expect(lead!.text).toContain(IMAGE_IS_DATA);
    expect(image).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" } });
    expect(question!.text).toBe("Explain this image.");

    // The overview asked first, and showed the picture as it would go.
    expect(overviews).toHaveLength(1);
    expect(overviews[0]!.images).toEqual([{ type: "image", mime: "image/jpeg", data: "QUJDRA==", name: "Whiteboard.jpg", width: 1568, height: 1045, path: "Projects/Assets/Whiteboard.jpg" }]);
    expect(overviews[0]!.manifest.sources[0]).toEqual({ path: "Projects/Assets/Whiteboard.jpg", title: "Whiteboard.jpg", tier: "evidence", chars: 0, reasons: ["active"], image: { width: 1568, height: 1045, bytes: 312_000 } });
    expect(overviews[0]!.manifest.dataClasses).toContain("images");
    expect(overviews[0]!.manifest.folders).toContain("Projects");
    // The estimate counts the picture.
    expect(overviews[0]!.manifest.estimatedTokens).toBeGreaterThan(2185);

    // A conversation of its own, titled by the picture, that the history keeps — with the picture in its first turn.
    const record = vault.saved.get("id1")!;
    expect(record.title).toBe("Image: Whiteboard.jpg");
    const stored = record.conversation.turns[0]!.parts.find((part): part is ImagePart => part.type === "image");
    expect(stored).toMatchObject({ name: "Whiteboard.jpg", data: "QUJDRA==", path: "Projects/Assets/Whiteboard.jpg" });
    expect(record.runs[0]!.manifest!.sources[0]!.image).toEqual({ width: 1568, height: 1045, bytes: 312_000 });
    // The reader sees the question and the picture, not the words Plainva put before it.
    const [user] = transcriptOf(record);
    expect(user).toMatchObject({ kind: "user", text: "Explain this image." });
    expect(user!.kind === "user" && user.images?.map((picture) => picture.name)).toEqual(["Whiteboard.jpg"]);
    // The audit counts it and names nothing.
    expect(vault.ledger()[0]).toMatchObject({ images: 1, stop: "answered" });
    expect(JSON.stringify(vault.ledger())).not.toContain("Whiteboard");
  });

  it("is a door: the vault's read tools, nothing that moves the app, no further tools, no internet", async () => {
    const vault = imageVault();
    const { s, fake } = await session([answer("A diagram.")], vault);
    await s.explainImage(request("Assets/diagram.png").made);
    const names = toolNames(fake.sent[0]);
    expect(names).toContain("read_note");
    for (const name of ["run_command", "find_tools", "call_tool", "use_skill", "fetch_url", "web_search"]) expect(names).not.toContain(name);
    expect(vault.saved.get("id1")!.conversation.more).toBeUndefined();
  });

  it("stays in the conversation: the next question carries the picture again, in the same place", async () => {
    const vault = imageVault();
    const { s, fake } = await session([answer("A whiteboard."), answer("The second column says: next.")], vault);
    await s.explainImage(request("Assets/Whiteboard.jpg").made);
    expect(await s.send("What stands in the second column?")).toEqual({ kind: "answered" });
    const [first, second] = fake.sent.map((spec) => JSON.stringify(spec.body!.messages));
    expect(second!.startsWith(first!.slice(0, -1))).toBe(true);
    expect(second!.match(/QUJDRA==/g)).toHaveLength(1);
    // The follow-up brought no picture of its own: the audit counts none for it.
    expect(vault.ledger().map((entry) => entry.images)).toEqual([1, undefined]);
  });

  it("asks once in a session: the first picture brings the overview, a second one of the same folder does not", async () => {
    const vault = imageVault();
    const { s, overviews } = await session([answer("One."), answer("Two.")], vault);
    await s.explainImage(request("Assets/a.png").made);
    await s.explainImage(request("Assets/b.png").made);
    expect(overviews).toHaveLength(1);
    expect(overviews[0]!.growth).toEqual([{ kind: "first" }]);
    expect([...vault.saved.keys()]).toHaveLength(2);
  });

  it("after notes were approved, the first picture is a new kind of data and asks again", async () => {
    const vault = imageVault();
    const { s, overviews } = await session([answer("Hello."), answer("A picture.")], vault);
    await s.send("Hello");
    await s.explainImage(request("a.png").made);
    expect(overviews).toHaveLength(2);
    expect(overviews[1]!.growth).toContainEqual({ kind: "dataClass", dataClass: "images" });
  });

  it("sends nothing when the overview is declined", async () => {
    const vault = imageVault();
    const { s, fake } = await session([answer("never")], vault, { consent: "cancel" });
    expect(await s.explainImage(request("Assets/a.png").made)).toEqual({ kind: "refused", reason: "cancelled" });
    expect(fake.sent).toHaveLength(0);
    expect(vault.saved.size).toBe(0);
    expect(vault.ledger()).toEqual([]);
  });

  it("goes to a model on this computer without an overview", async () => {
    const vault = imageVault();
    const { s, fake, overviews } = await session([chat("A cat.")], vault, { choice: LOCAL });
    expect(await s.explainImage(request("Assets/cat.jpg").made)).toMatchObject({ kind: "answered" });
    expect(overviews).toHaveLength(0);
    const user = (fake.sent[0]!.body!.messages as Array<{ role: string; content: unknown }>).find((message) => message.role === "user")!;
    expect(user.content).toContainEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJDRA==" } });
  });
});

describe("a picture that does not go", () => {
  it("is kept by a folder's rule — and is not even read", async () => {
    const vault = imageVault({ rules: [{ folder: "Private/", cloud: "deny" }] });
    const { s, fake } = await session([answer("never")], vault);
    const { made, loads } = request("Private/scan.png");
    expect(await s.explainImage(made)).toEqual({ kind: "refused", reason: "denied" });
    expect(loads()).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("is kept by the rule of the note it stands in", async () => {
    const vault = imageVault();
    const { s, fake } = await session([answer("never")], vault);
    // The embed was just written: no index names the picture yet, but the door stood in that note.
    const { made, loads } = request("Assets/fresh.png", { notePath: "Journal/Private.md" });
    expect(await s.explainImage(made)).toEqual({ kind: "refused", reason: "denied" });
    expect(loads()).toBe(0);
    expect(fake.sent).toHaveLength(0);
    // A picture in a note without such a rule goes, and the model is told where it stands.
    expect(await s.explainImage(request("Assets/Whiteboard.jpg", { notePath: "Projects/Kickoff.md" }).made)).toMatchObject({ kind: "answered" });
    expect(JSON.stringify(fake.sent[0]!.body)).toContain("embedded in the note [[Kickoff]]");
  });

  it("is kept by the rule of a note that embeds it — also from the viewer, which names no note", async () => {
    // `Journal/Private.md` embeds `scan.png` and says "never to the cloud"; the file itself sits in a folder without a rule.
    const vault = imageVault();
    const { s, fake } = await session([answer("never"), answer("A whiteboard.")], vault);
    const { made, loads } = request("Attachments/scan.png");
    expect(await s.explainImage(made)).toEqual({ kind: "refused", reason: "denied" });
    expect(loads()).toBe(0);
    expect(fake.sent).toHaveLength(0);
    // A picture only notes without such a rule embed goes.
    expect(await s.explainImage(request("Attachments/Whiteboard.jpg").made)).toMatchObject({ kind: "answered" });
    expect(vault.asked).toEqual(["Attachments/scan.png", "Attachments/Whiteboard.jpg"]);
  });

  it("stays when nobody can tell which notes embed it: not knowing is not 'none'", async () => {
    for (const index of ["broken", "truncated"] as const) {
      const vault = imageVault({ index });
      const { s, fake } = await session([answer("never")], vault);
      const { made, loads } = request("Attachments/Whiteboard.jpg");
      expect(await s.explainImage(made)).toEqual({ kind: "refused", reason: "unchecked" });
      expect(loads()).toBe(0);
      expect(fake.sent).toHaveLength(0);
    }
    // A vault that cannot be asked at all is the same case.
    const vault = imageVault();
    delete vault.host.embedders;
    const { s } = await session([answer("never")], vault);
    expect(await s.explainImage(request("a.png").made)).toEqual({ kind: "refused", reason: "unchecked" });
  });

  it("is kept where the rules only allow this computer — and goes to a model that runs on it", async () => {
    const vault = imageVault({ rules: [{ folder: "Private/", cloud: "deny" }], index: "broken" });
    const { s } = await session([chat("A scan.")], vault, { choice: LOCAL });
    expect(await s.explainImage(request("Private/scan.png").made)).toMatchObject({ kind: "answered" });
    // Nothing leaves the device for it, so no note's rule could keep it: the lookup is not even asked.
    expect(vault.asked).toEqual([]);
  });

  it("never comes from Plainva's own folders", async () => {
    const vault = imageVault();
    const { s } = await session([], vault);
    for (const path of [".agent/skills/x/shot.png", ".plainva/cache/a.png", ".obsidian/icon.png"]) {
      const { made, loads } = request(path);
      expect(await s.explainImage(made)).toEqual({ kind: "refused", reason: "denied" });
      expect(loads()).toBe(0);
    }
  });

  it("is refused for a model of the system, which takes text only", async () => {
    const vault = imageVault();
    const { s } = await session([], vault, { choice: SYSTEM });
    const { made, loads } = request("Assets/a.png");
    expect(await s.explainImage(made)).toMatchObject({ kind: "refused", reason: "no-route" });
    expect(loads()).toBe(0);
  });

  it("says why when it cannot be read or stays too large", async () => {
    const vault = imageVault();
    const { s, fake } = await session([], vault);
    expect(await s.explainImage({ path: "Assets/broken.png", load: async () => "unreadable" })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(await s.explainImage({ path: "Assets/huge.png", load: async () => "too-large" })).toEqual({ kind: "refused", reason: "too-large" });
    expect(await s.explainImage({ path: "Assets/huge.png", load: async () => ({ ...PICTURE, bytes: IMAGE_MAX_BYTES + 1 }) })).toEqual({ kind: "refused", reason: "too-large" });
    expect(
      await s.explainImage({
        path: "Assets/gone.png",
        load: async () => {
          throw new Error("gone");
        },
      }),
    ).toEqual({ kind: "refused", reason: "unreadable" });
    expect(fake.sent).toHaveLength(0);
    // Nothing is left running: the next one starts.
    expect(s.getState().live).toBeNull();
  });

  it("is off with the AI, and without a model", async () => {
    const vault = imageVault();
    const { s } = await session([], vault);
    await s.updateSettings((settings) => ({ ...settings, enabled: false }));
    expect(await s.explainImage(request("a.png").made)).toEqual({ kind: "refused", reason: "off" });
    await s.updateSettings((settings) => ({ ...settings, enabled: true, profiles: {} }));
    expect(await s.explainImage(request("a.png").made)).toEqual({ kind: "refused", reason: "no-model" });
  });

  it("starts once: a second press while the first one runs is not a second run", async () => {
    const vault = imageVault();
    const { s, fake } = await session([answer("One.")], vault);
    const [first, second] = await Promise.all([s.explainImage(request("a.png").made), s.explainImage(request("a.png").made)]);
    expect([first.kind, second.kind].sort()).toEqual(["answered", "refused"]);
    expect(second).toEqual({ kind: "refused", reason: "busy" });
    expect(fake.sent).toHaveLength(1);
  });
});

describe("a model that reads no pictures", () => {
  it("is named in the overview where the provider's own list says so — and can be asked all the same", async () => {
    const vault = imageVault();
    const listing: EgressChunk[] = [
      { type: "open", status: 200 },
      { type: "data", text: JSON.stringify({ data: [{ id: "vendor/blind", architecture: { input_modalities: ["text"] } }, { id: "vendor/sees", architecture: { input_modalities: ["text", "image"] } }] }) },
      { type: "done" },
    ];
    const { s, fake, overviews } = await session([listing, chat("I see no picture."), chat("A cat.")], vault, { choice: { providerId: "openrouter", model: "vendor/blind" } });
    // The list the connection test fetched says which models read pictures.
    await s.testProvider("openrouter");
    expect(await s.explainImage(request("a.png").made)).toMatchObject({ kind: "answered" });
    expect(overviews[0]!.blind).toBe(true);
    // Said, never a lock: the picture went.
    expect(JSON.stringify(fake.sent[1]!.body)).toContain("QUJDRA==");

    // A model the list calls sighted is not named.
    await s.updateSettings((settings) => ({ ...settings, profiles: { balanced: { providerId: "openrouter", model: "vendor/sees" } } }));
    await s.explainImage(request("b.png").made);
    expect(overviews[1]!.blind).toBeUndefined();
  });

  it("the provider's refusal ends the run as a failure the conversation shows, with the picture kept", async () => {
    const vault = imageVault();
    const { s } = await session([refusal], vault);
    const outcome = await s.explainImage(request("Assets/a.png").made);
    expect(outcome).toEqual({ kind: "refused", reason: "failed", conversationId: "id1" });
    expect(s.getState().notice?.stop).toMatchObject({ kind: "failed", failure: { kind: "refused_by_provider" } });
    // The question and the picture stay: another model can be chosen and asked again.
    expect(vault.saved.get("id1")!.conversation.turns[0]!.parts.some((part) => part.type === "image")).toBe(true);
  });
});
