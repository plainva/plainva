import { describe, expect, it } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, WRITE_DRAFT_LIMITS, readFrontmatterPath, type AiEgress, type ScriptedAcpStep, type WriteDraft } from "@plainva/core";
import { AiSession, createAcpDeviceStore, createWriteDraftStore, type AcpSessionEvent, type AcpThreadItem, type AiVaultHost, type DraftCreator } from "@plainva/ui";
import { acpLabel, memoryAcpVault, ROOT, scriptedAcpNative, type AcpScript } from "./acpTestHost";
import { memoryFiles } from "./mcpTestHost";

/**
 * A note an external agent wrote that does not exist yet (plan KI-Harness
 * P5-6), played against the REAL assistant's session and its real list of
 * drafts: it waits there like every other draft — signed with the agent's id
 * on this device —, and "Create" makes it at exactly the path the agent
 * named, or not at all. Nothing is written before that click.
 */

const turns = (...steps: ScriptedAcpStep[][]): AcpScript => () => ({ turns: steps });
const events = (thread: readonly AcpThreadItem[]): AcpSessionEvent[] => thread.flatMap((item) => (item.kind === "event" ? [item.event] : []));
const TEXT = { title: "Add", message: "Trust it?", confirm: "Add", cancel: "Cancel" };

async function window(script: AcpScript, options: { noteAt?: boolean } = {}) {
  const vault = memoryAcpVault();
  const native = scriptedAcpNative(script);
  native.installed = { gemini: "/usr/bin/gemini" };
  const appFiles = memoryFiles();
  /** What the shell wrote for a draft, in order: the path and the whole text. */
  const made: [string, string][] = [];
  const creates: DraftCreator = {
    note: async () => {
      throw new Error("a draft that names its file is never given another name");
    },
    task: async () => "",
    journal: async () => "",
    ...(options.noteAt === false
      ? {}
      : {
          // As the desktop shell does it: never over a file that is there.
          async noteAt({ path, content }) {
            if (vault.files.has(path)) return null;
            vault.files.set(path, content);
            made.push([path, content]);
            return path;
          },
        }),
  };
  const host = {
    conversations: { list: async () => [], load: async () => null, save: async () => undefined, remove: async () => undefined, removeAll: async () => undefined },
    ledger: { load: async () => [], save: async () => undefined },
    activeNote: async () => null,
    readNote: async () => null,
    candidates: async () => [],
    policy: { policyOf: vault.side.access.policyOf, resolveLink: async () => null },
    // The vault's side for an agent, as the shell hands it over: without a place for drafts — that is the session's own.
    agents: { access: vault.side.access, store: vault.side.store, activeNote: vault.side.activeNote },
    drafts: createWriteDraftStore(appFiles, "vault-a"),
    creates,
  } as Partial<AiVaultHost> as AiVaultHost;
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true };
  const egress: AiEgress = { async send() {}, async cancel() {}, async setKey() {}, hasKey: async () => true, async deleteKey() {}, addEndpoint: async () => true, async removeEndpoint() {} };
  const s = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-07",
    now: () => new Date("2026-10-07T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: acpLabel,
    acp: { native: native.native, store: createAcpDeviceStore(memoryFiles()), version: async () => "0.9.0", toolbox: async () => null },
  });
  await s.load();
  await s.attachVault(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await s.agents.add("Gemini CLI", { program: "gemini", args: ["--acp"] }, TEXT);
  await s.agents.start("geminicli");
  const agent = () => native.processes[native.processes.length - 1]!.agent;
  const drafts = () => s.getState().drafts.drafts;
  return { s, vault, host, made, agent, drafts, appFiles };
}

describe("a note an agent wrote waits in the vault's list of drafts", () => {
  it("as a draft that names its file, signed with the agent's id — and nothing is in the vault", async () => {
    const w = await window(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "---\ntags: [summary]\n---\n# Summary\n\nSee https://example.org/a.\n" } }]));
    await w.s.agents.send("Write a summary");
    expect(w.drafts()).toEqual<WriteDraft[]>([
      {
        id: "d-id-0001",
        createdAt: "2026-10-07T10:00:00.000Z",
        author: { id: "acp:geminicli", label: "ai.agent.author(Gemini CLI)" },
        conversationId: null,
        title: "Summary",
        body: { kind: "note", path: "Projects/Summary.md", folder: null, content: "---\ntags: [summary]\n---\n# Summary\n\nSee https[://]example.org/a.\n" },
        inherited: [],
        sources: [],
        defused: 1,
      },
    ]);
    // The agent's session shows exactly this card, and the vault has no such file.
    expect(w.s.getState().agents.session!.waiting).toEqual(["d-id-0001"]);
    expect(w.vault.files.has("Projects/Summary.md")).toBe(false);
    expect(w.made).toEqual([]);
    // It is on disk in the app's data, never in the vault: the list survives the session and the app.
    expect([...w.appFiles.files.keys()]).toContain("vault-a/drafts.json");
  });

  it("is written again under the same id — one card, the last text", async () => {
    const w = await window(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nFirst.\n" } }], [{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nSecond.\n" } }]));
    await w.s.agents.send("Write a summary");
    await w.s.agents.send("Better");
    expect(w.drafts().map((draft) => [draft.id, draft.body.kind === "note" ? draft.body.content : ""])).toEqual([["d-id-0001", "# Summary\n\nSecond.\n"]]);
  });

  it("is created at exactly its path with the stamp that says who wrote it — and the agent's session hears of it", async () => {
    const w = await window(
      turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "---\ntags: [summary]\n---\n# Summary\n\nText.\n" } }], [{ read: { path: `${ROOT}/Projects/Summary.md` } }]),
    );
    await w.s.agents.send("Write a summary");
    expect(w.s.canCreateDrafts()).toBe(true);
    expect(await w.s.createDraft("d-id-0001")).toEqual({ kind: "created", path: "Projects/Summary.md" });
    expect(w.made).toHaveLength(1);
    const [path, written] = w.made[0]!;
    expect(path).toBe("Projects/Summary.md");
    // The agent's whole text with its own properties, and the stamp: its id on this device, never a name it gives itself.
    expect(readFrontmatterPath(written, ["generated"])).toEqual({ by: "acp:geminicli", at: "2026-10-07T10:00:00Z" });
    expect(readFrontmatterPath(written, ["tags"])).toEqual(["summary"]);
    expect(written.endsWith("# Summary\n\nText.\n")).toBe(true);
    // The draft is gone, what became of it is kept, and the session says so in its thread.
    expect(w.drafts()).toEqual([]);
    expect(w.s.getState().drafts.done).toEqual([{ id: "d-id-0001", kind: "note", title: "Summary", outcome: "created", path: "Projects/Summary.md", at: "2026-10-07T10:00:00.000Z" }]);
    const current = w.s.getState().agents.session!;
    expect(current.waiting).toEqual([]);
    expect(current.counts.created).toBe(1);
    expect(events(current.thread)).toEqual([
      { type: "new", path: "Projects/Summary.md" },
      { type: "created", path: "Projects/Summary.md" },
    ]);
    // From now on the agent reads the note from the vault, stamp and all.
    await w.s.agents.send("Read it");
    expect(w.agent().answers[w.agent().answers.length - 1]).toEqual({ method: "fs/read_text_file", result: { content: written } });
  });

  it("is never written over a file that is there by now: the draft stays, and the user is told", async () => {
    const w = await window(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n" } }]));
    await w.s.agents.send("Write a summary");
    // Somebody made a note of that name meanwhile.
    w.vault.files.set("Projects/Summary.md", "# Mine\n");
    expect(await w.s.createDraft("d-id-0001")).toEqual({ kind: "refused", reason: "exists" });
    expect(w.vault.files.get("Projects/Summary.md")).toBe("# Mine\n");
    expect(w.made).toEqual([]);
    expect(w.drafts().map((draft) => draft.id)).toEqual(["d-id-0001"]);
    // Throwing it away is the way out; the session hears of that too.
    await w.s.discardDraft("d-id-0001");
    expect(w.drafts()).toEqual([]);
    expect(events(w.s.getState().agents.session!.thread).slice(-1)).toEqual([{ type: "discarded", path: "Projects/Summary.md" }]);
  });

  it("cannot be created by a shell that makes no note at a named path", async () => {
    const w = await window(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n" } }]), { noteAt: false });
    await w.s.agents.send("Write a summary");
    expect(await w.s.createDraft("d-id-0001")).toEqual({ kind: "refused", reason: "unavailable" });
    expect(w.drafts()).toHaveLength(1);
  });

  it("is refused at once while the list is full — a list that never drops a waiting draft to make room", async () => {
    const w = await window(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n" } }], [{ write: { path: `${ROOT}/Projects/Other.md`, content: "# Other\n" } }, { write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nMore.\n" } }]));
    await w.s.agents.send("Write a summary");
    // Ninety-nine drafts of the assistant itself fill the list beside the agent's one.
    for (let index = 0; index < WRITE_DRAFT_LIMITS.drafts - 1; index++) {
      const left = await w.s.leaveDraft(w.host, {
        id: `d-fill-${String(index).padStart(3, "0")}`,
        createdAt: "2026-10-07T09:00:00.000Z",
        author: { id: "plainva-ai/m-1", label: "Plainva AI" },
        conversationId: null,
        title: `Task ${index}`,
        body: { kind: "task", text: `Task ${index}`, day: "2026-10-07" },
        inherited: [],
        sources: [],
        defused: 0,
      });
      expect(left.ok).toBe(true);
    }
    expect(w.drafts()).toHaveLength(WRITE_DRAFT_LIMITS.drafts);
    await w.s.agents.send("And another");
    expect(w.agent().answers.slice(-2)).toEqual([
      { method: "fs/write_text_file", error: { code: -32602, message: "Too many drafts are waiting in Plainva. The user decides about them first." } },
      // Its own draft is written again in its place: that needs no room.
      { method: "fs/write_text_file", result: {} },
    ]);
    expect(w.drafts()).toHaveLength(WRITE_DRAFT_LIMITS.drafts);
    const mine = w.drafts().find((draft) => draft.author.id === "acp:geminicli")!;
    expect(mine.body).toMatchObject({ path: "Projects/Summary.md", content: "# Summary\n\nMore.\n" });
    expect(events(w.s.getState().agents.session!.thread).slice(-1)).toEqual([{ type: "refused", what: "write", reason: "waiting", path: "Projects/Other.md" }]);
  });
});
