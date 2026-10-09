import { DEFAULT_AI_APP_SETTINGS, MCP_OAUTH_CLIENT_DOCUMENT, type EgressChunk, type InstructionIO, type ScriptedMcpServer } from "@plainva/core";
import { AI_POLICY_FILE, AiSession, captureVocabularyOf, createAiVaultHost, createMcpDeviceStore, createVaultPolicy, type VaultWriteDeps } from "@plainva/ui";
import { CLOUD, LOCAL, TRACKER_URL, fakeEgress } from "./mcpSessionHarness";
import { memoryFiles, scriptedNative } from "./mcpTestHost";

/**
 * A vault with a memory, for tests (plan KI-Harness P6): the vault's files in
 * memory, and above them the host BOTH shells build (`createAiVaultHost`) —
 * so the memory's reader and writer, the switch in the app's data, the tools'
 * view of the memory, the drafts and the vault's instructions are the real
 * wiring, not a copy of it. The session in front is the real one, with a
 * scripted model.
 */

export interface MemoryVaultOptions {
  /** Folder rules of the vault, as `.agent/policy.yml` would hold them. */
  policy?: string;
  /** The shell cannot write the vault's agent files: the memory is read only. */
  readOnly?: boolean;
}

const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export function memoryVault(files: Record<string, string> = {}, options: MemoryVaultOptions = {}) {
  const disk = new Map(Object.entries(files));
  /** The paths written, in the order they were. */
  const written: string[] = [];
  const io: InstructionIO = {
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of disk.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, isFolder]) => ({ name, folder: isFolder }));
    },
    async read(path) {
      const text = disk.get(path);
      return text === undefined ? null : new TextEncoder().encode(text);
    },
  };
  const writer = {
    async write(path: string, bytes: Uint8Array) {
      disk.set(path, new TextDecoder("utf-8").decode(bytes));
      written.push(path);
    },
    async remove(path: string) {
      for (const key of [...disk.keys()]) if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
    },
  };
  const read = async (path: string) => disk.get(path) ?? null;
  const resolveLink = async (target: string) => {
    const wanted = target.toLowerCase();
    return [...disk.keys()].find((path) => title(path).toLowerCase() === wanted || path.toLowerCase() === wanted || path.toLowerCase() === `${wanted}.md`) ?? null;
  };
  const policy = createVaultPolicy({
    readFile: async (path) => (path === AI_POLICY_FILE ? (options.policy ?? null) : read(path)),
    resolveLink,
    fileNames: async () => [...disk.keys()].map((path) => ({ path, title: title(path) })),
    encrypted: () => false,
  });
  // The writing tools' hands. The memory's drafts need none of them — only that the shell has writing tools at all.
  const writes: VaultWriteDeps = {
    sealed: () => false,
    current: read,
    propose: async () => {},
    folderExists: async () => true,
    taskVocabulary: () => captureVocabularyOf((key) => key, "en"),
    draftPlace: async () => null,
    renamePlan: async () => "bad-name",
    rename: async () => null,
    movePlan: async () => "no-folder",
    move: async () => null,
    requestDelete: async () => false,
    setRule: async () => false,
    entryPlace: async () => null,
  };
  const appData = memoryFiles();
  const replies: string[] = [];
  const host = createAiVaultHost({
    files: appData,
    vaultKey: "vault-memory",
    policy,
    activeNote: async () => null,
    readNote: async (path) => {
      const text = await read(path);
      return text === null ? null : { path, title: title(path), text };
    },
    situation: async () => ({ now: "2026-10-09 10:00", weekday: "Friday", calendarDay: "2026-10-09", journalDay: "2026-10-09", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    retrieval: null,
    toolDeps: { search: async () => [], readNote: read, taskRows: async () => [], todayKey: () => "2026-10-09", commands: () => [], writes },
    // A comment thread's door (plan P3-6): what the assistant answers there.
    reply: async (reply) => void replies.push(reply.body),
    // The shell's own ways of making a note, a task, a line in the journal. The memory's drafts need none of them —
    // only that the shell makes drafts into things at all, as both shells do.
    creates: {
      note: async () => {
        throw new Error("no note is made in this test");
      },
      task: async () => {
        throw new Error("no task is made in this test");
      },
      journal: async () => {
        throw new Error("no journal line is made in this test");
      },
      entryPlace: async () => null,
      placeDenies: async () => [],
    },
    instructionIO: io,
    ...(options.readOnly ? {} : { instructionWriter: writer }),
  });
  return {
    host,
    /** The vault's files, by path. */
    disk,
    /** The app's data on this device: the switch, the drafts, the approvals. */
    appData,
    written,
    replies,
    file: (path: string) => disk.get(path) ?? null,
  };
}

export type MemoryVault = ReturnType<typeof memoryVault>;

/**
 * The real session in front of a scripted model, with this vault attached. The send overview is approved as it
 * comes, and kept. `server`: a foreign MCP server behind the tracker's address, for the tests of what must not
 * reach one.
 */
export async function memorySession(script: EgressChunk[][], vault: MemoryVault, model: { providerId: string; model: string } = CLOUD, server?: ScriptedMcpServer) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: model, local: LOCAL } };
  const native = server ? scriptedNative((target) => (target === TRACKER_URL ? server : null)) : null;
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-09",
    now: () => new Date("2026-10-09T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key) => key,
    ...(native ? { mcp: { native: native.native, browser: native.browser, clientDocument: MCP_OAUTH_CLIENT_DOCUMENT, store: createMcpDeviceStore(vault.appData), version: async () => "0.9.0" } } : {}),
  });
  /** Every send overview the session asked about, as it was shown. */
  const overviews: NonNullable<ReturnType<AiSession["getState"]>["consent"]>[] = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (consent) {
      overviews.push(consent);
      s.answerConsent(true);
    }
  });
  await s.load();
  await s.attachVault(vault.host);
  await s.refreshMemory();
  return { s, fake, overviews };
}
