import { DEFAULT_AI_APP_SETTINGS, type AiAppSettings, type AiEgress, type EgressChunk, type HttpRequestSpec, type InstructionIO, type ModelChoice, type RoutineDraft } from "@plainva/core";
import { AI_POLICY_FILE, AiSession, createAiVaultHost, createVaultPolicy, folderLogHost, writeCapturedNote } from "@plainva/ui";
import { CLOUD, LOCAL } from "./mcpSessionHarness";
import { memoryFiles } from "./mcpTestHost";

/**
 * A vault with routines, for tests (plan KI-Harness P8): the vault's files in
 * memory, above them the host BOTH shells build (`createAiVaultHost`) — so
 * the routines' store in the app's data, the skills with their approvals,
 * the privacy rules, the tools and the writer of a kept note are the real
 * wiring —, and in front of it the real session with a scripted model and a
 * clock the test moves.
 */

export interface RoutineVaultOptions {
  /** Folder rules of the vault, as `.agent/policy.yml` would hold them. */
  policy?: string;
  /** A shared workspace: others read what is written here. */
  shared?: boolean;
  /** The shell cannot write notes. */
  noCapture?: boolean;
}

const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export function routineVault(files: Record<string, string> = {}, options: RoutineVaultOptions = {}) {
  const disk = new Map(Object.entries(files));
  /** When each note last changed on disk, as the index would know it (epoch milliseconds). */
  const changed = new Map<string, number>();
  /** When each note was made on this device, as the index knows it (`files.ctime`; epoch milliseconds). */
  const made = new Map<string, number>();
  /** The vault's version history: per note its snapshots, oldest first — each the text before the write it was taken for. */
  const versions = new Map<string, { at: number; text: string }[]>();
  let clock = () => Date.now();
  /** The notes "Keep as a note" wrote, in order. */
  const kept: string[] = [];
  const dirs = new Set<string>();
  /** The mail the tools were asked for: a routine whose model is at a provider never gets here. */
  const mailSearches: string[] = [];
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
    },
    // A change of a file where it lies, as the chain's one entry makes it (`adapterInstructionWriter`).
    async update(path: string, change: (text: string | null) => string | null) {
      const before = disk.get(path) ?? null;
      const next = change(before);
      if (next === null || next === before) return null;
      disk.set(path, next);
      return next;
    },
    async remove(path: string) {
      for (const key of [...disk.keys()]) if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
    },
  };
  const read = async (path: string) => disk.get(path) ?? null;
  const notes = () => [...disk.keys()].filter((path) => path.endsWith(".md") && !path.startsWith("."));
  const resolveLink = async (target: string) => {
    const wanted = target.toLowerCase();
    return [...disk.keys()].find((path) => title(path).toLowerCase() === wanted || path.toLowerCase() === wanted || path.toLowerCase() === `${wanted}.md`) ?? null;
  };
  const policy = createVaultPolicy({
    // The rules file as it lies in the vault now — a test may change it —, read again once the test's clock moved on.
    readFile: async (path) => (path === AI_POLICY_FILE ? (disk.get(AI_POLICY_FILE) ?? options.policy ?? null) : read(path)),
    resolveLink,
    fileNames: async () => [...disk.keys()].map((path) => ({ path, title: title(path) })),
    encrypted: () => options.shared === true,
    now: () => clock(),
  });
  const appData = memoryFiles();
  const host = createAiVaultHost({
    files: appData,
    vaultKey: "vault-routines",
    policy,
    activeNote: async () => null,
    readNote: async (path) => {
      const text = await read(path);
      return text === null ? null : { path, title: title(path), text };
    },
    situation: async () => ({ now: "2026-10-09 07:00", weekday: "Friday", calendarDay: "2026-10-09", journalDay: "2026-10-09", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    // What changed lately is a candidate for every question: this is where the notes of a run's context come from.
    retrieval: {
      searchCandidates: async () => [],
      linkNeighbors: async () => [],
      recentlyChanged: async (limit) =>
        [...changed]
          .filter(([path]) => disk.has(path))
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([path, mtime]) => ({ path, title: title(path), mtime })),
      recentlyOpened: async () => [],
      now: () => clock(),
    },
    toolDeps: {
      search: async () => notes().map((path) => ({ path, title: title(path), snippet: (disk.get(path) ?? "").slice(0, 40) })),
      readNote: read,
      taskRows: async () => [],
      todayKey: () => "2026-10-09",
      commands: () => [],
      events: async () => [],
      mail: {
        accounts: async () => [{ id: "a1", label: "Work", address: "me@example.org", inbox: "INBOX", numericIds: true }],
        folders: async () => ["INBOX"],
        newest: async () => ({ messages: [], offline: false }),
        search: async (_account, _folder, query) => {
          mailSearches.push(query);
          return [];
        },
        message: async () => null,
      },
    },
    encrypted: () => options.shared === true,
    ...(options.noCapture
      ? {}
      : {
          capture: {
            folder: async () => "Inbox",
            write: (folder: string, stem: string, content: string) =>
              writeCapturedNote(
                {
                  exists: async (path) => disk.has(path) || dirs.has(path),
                  createDir: async (path) => void dirs.add(path),
                  writeTextFile: async (path, text) => {
                    disk.set(path, text);
                    kept.push(path);
                    changed.set(path, clock());
                  },
                },
                folder,
                stem,
                content,
              ),
          },
        }),
    instructionIO: io,
    instructionWriter: writer,
    // A folder's log (plan P8-2): the index's changes, the version history and the chain's entry for a change — as both shells wire it.
    log: folderLogHost({
      changedIn: async (folder, since, limit) =>
        [...changed]
          .filter(([path, mtime]) => disk.has(path) && path.endsWith(".md") && mtime > since && (!folder || path.startsWith(`${folder}/`)))
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([path, mtime]) => ({ path, title: title(path), mtime, created: made.get(path) ?? null })),
      versions: {
        list: async (path) => [...(versions.get(path) ?? [])].reverse().map((version) => ({ id: `${path}\n${version.at}`, at: version.at, size: version.text.length })),
        read: async (id) => {
          const cut = id.lastIndexOf("\n");
          return versions.get(id.slice(0, cut))?.find((version) => version.at === Number(id.slice(cut + 1)))?.text ?? null;
        },
      },
      update: (path, change) => writer.update(path, change),
    }),
  });
  return {
    host,
    disk,
    appData,
    kept,
    mailSearches,
    file: (path: string) => disk.get(path) ?? null,
    /** A note is written or changed, now or at a given moment. */
    touch(path: string, text: string, at?: number) {
      disk.set(path, text);
      changed.set(path, at ?? clock());
    },
    /** A note is made at a moment: the index knows it as new from then on. */
    make(path: string, text: string, at: number) {
      disk.set(path, text);
      changed.set(path, at);
      made.set(path, at);
    },
    /** A note is edited at a moment, as the vault's chain writes it: the text it had is kept as a version first. */
    edit(path: string, text: string, at: number) {
      const before = disk.get(path);
      if (before !== undefined) versions.set(path, [...(versions.get(path) ?? []), { at, text: before }]);
      disk.set(path, text);
      changed.set(path, at);
    },
    /** The harness' clock, set by the session. */
    useClock(now: () => number) {
      clock = now;
    },
    /** The routines as the app's data holds them. */
    stored: (): unknown => JSON.parse(appData.files.get("vault-routines/routines.json") ?? "null"),
  };
}

export type RoutineVault = ReturnType<typeof routineVault>;

export interface RoutineSessionOptions {
  model?: ModelChoice;
  settings?: Partial<AiAppSettings>;
  /** Providers without a key on this device. */
  noKey?: readonly string[];
  /** The first moment of the clock (local time). */
  start?: Date;
  /** Called as each request is on its way, with how many were sent so far (this one included): where a test presses STOP. */
  onSend?(count: number): void;
}

/** The words a folder's log writes itself, in English, so that a test reads the file as a person would. */
const LOG_WORDS: Readonly<Record<string, string>> = {
  "ai.routines.log.ask": "Write the entry for this folder's log.",
  "ai.routines.log.fileTitleVault": "Log of this vault",
  "ai.routines.log.entryNew": "New",
  "ai.routines.log.entryChanged": "Updated",
};

/** October 2026: the 5th is a Monday, the 9th a Friday. Built from calendar parts, so a test says the same in every time zone. */
export const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

/**
 * The real session in front of a scripted model, with the vault attached and
 * a clock the test moves. Nobody answers a send overview here: one that is
 * shown is counted (`overviews`) and left standing — a routine must never
 * show one.
 */
export async function routineSession(script: EgressChunk[][], vault: RoutineVault, options: RoutineSessionOptions = {}) {
  const sent: HttpRequestSpec[] = [];
  let cancelled = 0;
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      options.onSend?.(sent.length);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
    },
    async cancel() {
      cancelled += 1;
    },
    async setKey() {},
    hasKey: async (providerId) => !(options.noKey ?? []).includes(providerId),
    async deleteKey() {},
    addEndpoint: async () => true,
    async removeEndpoint() {},
  };
  let ids = 0;
  let now = options.start ?? at(9, 6, 0);
  vault.useClock(() => now.getTime());
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: options.model ?? CLOUD, local: LOCAL }, ...(options.settings ?? {}) };
  const s = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-09",
    now: () => now,
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key, vars) =>
      key === "ai.routines.conversation"
        ? `Routine: ${vars?.name}`
        : key === "ai.routines.log.fileTitle"
          ? `Log of “${vars?.folder}”`
          : key === "ai.routines.log.entryMore"
            ? `More notes that changed: ${vars?.count}.`
            : (LOG_WORDS[key] ?? (key.startsWith("ai.skills.") && key.endsWith(".prompt") ? "What matters today?" : key)),
  });
  /** Every send overview the session showed: a routine shows none. */
  const overviews: unknown[] = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (consent && !overviews.includes(consent)) overviews.push(consent);
  });
  await s.load();
  await s.attachVault(vault.host);
  await s.refreshSkills();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    s,
    sent,
    overviews,
    cancelled: () => cancelled,
    /** Moves the clock. */
    go(to: Date) {
      now = to;
    },
    /** Sets a routine up as its dialog would: the confirmation is put together, then confirmed. */
    async setUp(draft: Partial<RoutineDraft> = {}, id?: string) {
      const full: RoutineDraft = { name: "Morning brief", skill: "plainva:daily-orientation", request: "", days: [1, 2, 3, 4, 5], time: "07:00", missed: "catch-up", onlyWhenChanged: false, choice: options.model ?? CLOUD, ...draft };
      const outcome = await s.routinePreview(full, id);
      if (outcome.kind !== "preview") throw new Error(`no confirmation: ${outcome.reason}`);
      const saved = await s.saveRoutine(full, outcome.preview, id);
      if (saved !== "saved") throw new Error(`not saved: ${saved}`);
      return { preview: outcome.preview, routine: s.getState().routines.list.find((routine) => (id ? routine.id === id : routine.name === full.name))! };
    },
  };
}

/** The tools a request offered to the model, by name — in a provider's format or a local server's. */
export const toolNames = (spec: HttpRequestSpec | undefined) =>
  ((spec?.body?.tools ?? []) as { name?: string; function?: { name?: string } }[]).map((tool) => tool.name ?? tool.function?.name ?? "");

/** A skill of the vault's own that only reads, as `.agent/skills/<name>/SKILL.md`. */
export const ownSkill = (name: string, tools = "search_vault read_note", body = "Say what changed.") =>
  `---\nname: ${name}\ndescription: Says what changed in the vault lately. Use when asked for a short look back.\nallowed-tools: ${tools}\n---\n\n# ${name}\n\n${body}\n`;
