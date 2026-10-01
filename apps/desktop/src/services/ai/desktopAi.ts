import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, remove } from "@tauri-apps/plugin-fs";
import i18n from "@plainva/ui/i18n";
import type { AiAppSettings, CommentOperationService, IVaultAdapter, VaultQueryService } from "@plainva/core";
import type { LocalEmbeddings, LocalGists } from "@plainva/ui";
import {
  aiDefaultSettings,
  AiSession,
  aiVaultKey,
  calendarDay,
  adapterInstructionIO,
  adapterInstructionWriter,
  createAiVaultHost,
  createVaultPolicy,
  databaseTaskRows,
  flushPendingSave,
  getPlatformServices,
  journalToday,
  noteDisplayName,
  parseRecentsFile,
  plannerRowsFromTasks,
  proposeSuggestionRound,
  situationFrom,
  withCloudDenied,
  type AiFileStore,
  type AiNavigationCommand,
  type AiVaultHost,
  type SituationEventInput,
  type VaultPolicyHost,
} from "@plainva/ui";
import { checkedReadTextFile } from "../../adapters/checkedFilesystem";
import { journalMoodPropertyKey } from "../../contexts/VaultContext";
import { buildDailyNotePath, readDailyNoteConfig } from "../dailyNotes";
import { readEditorSelection } from "../editorSelection";
import { getSettingsStore } from "../settingsStore";
import { getTaskDatabasePath } from "../taskDatabase";
import { isOwnerWindow } from "../windowContext";
import { createDesktopAiEgress } from "./desktopAiEgress";

/**
 * The desktop's AI session (plan KI-Harness P1a). AI v1 runs in the central
 * window only: it owns the vault's write paths, and the native egress answers
 * no other window. An auxiliary window gets no session, and its surfaces
 * render nothing.
 */

const SETTINGS_KEY = "ai";

/** Opens the companion from anywhere in the main window (the selection door, plan P1.5). */
export const AI_OPEN_EVENT = "plainva-ai-open";

/**
 * Opens the AI tab on its skills — the settings' "Open skills" (plan
 * KI-Harness P3-5), optionally reviewing one source. The request waits here
 * until the tab takes it, so a tab that mounts only now still sees it.
 */
export const AI_SKILLS_EVENT = "plainva-ai-skills";
let pendingSkills: { review: string | null } | null = null;

export function requestSkillsView(review: string | null = null): void {
  pendingSkills = { review };
  window.dispatchEvent(new CustomEvent(AI_SKILLS_EVENT));
}

export function takeSkillsRequest(): { review: string | null } | null {
  const request = pendingSkills;
  pendingSkills = null;
  return request;
}

let aiRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

/** `<appData>/ai` — registered once as a write root of the atomic write command. */
async function aiRoot(): Promise<{ dir: string; rootId: string }> {
  if (!aiRootPromise) {
    aiRootPromise = (async () => {
      const dir = await join(await appDataDir(), "ai");
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((error: unknown) => {
      aiRootPromise = null;
      throw error;
    });
  }
  return aiRootPromise;
}

export const desktopAiFiles: AiFileStore = {
  async read(relPath) {
    const { rootId } = await aiRoot();
    return checkedReadTextFile(rootId, relPath);
  },
  async write(relPath, text) {
    const { rootId } = await aiRoot();
    await invoke("write_file_atomic", { rootId, relPath, contents: text, encoding: "utf8" });
  },
  async remove(relPath) {
    const { dir } = await aiRoot();
    const file = await join(dir, ...relPath.split("/"));
    if (await exists(file)) await remove(file);
  },
  async removeDir(relPath) {
    const { dir } = await aiRoot();
    const folder = await join(dir, ...relPath.split("/"));
    if (await exists(folder)) await remove(folder, { recursive: true });
  },
};

/** Removes the AI data of one vault — part of "forget app data". */
export async function forgetAiVaultData(vaultPath: string): Promise<void> {
  await desktopAiFiles.removeDir(aiVaultKey(vaultPath));
}

function englishLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "English";
  } catch {
    return "English";
  }
}

let session: AiSession | null = null;

/** The one AI session of this process; null outside the central window. */
export function getDesktopAiSession(defaults: AiAppSettings = aiDefaultSettings()): AiSession | null {
  if (!isOwnerWindow()) return null;
  if (!session) {
    session = new AiSession({
      egress: createDesktopAiEgress(() => ({
        title: i18n.t("ai.add.confirmTitle"),
        message: i18n.t("ai.add.confirmMessage"),
        confirm: i18n.t("ai.add.confirmAction"),
        cancel: i18n.t("common.cancel"),
      })),
      async loadSettings() {
        const store = await getPlatformServices().loadSettings();
        return store.get(SETTINGS_KEY);
      },
      async saveSettings(settings) {
        const store = await getPlatformServices().loadSettings();
        await store.set(SETTINGS_KEY, settings);
        await store.save();
      },
      defaults,
      language: () => englishLanguageName(i18n.language || "en"),
      today: () => calendarDay(),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      label: (key, vars) => i18n.t(key, vars),
    });
    void session.load();
  }
  return session;
}

export interface DesktopVaultInput {
  vaultPath: string;
  adapter: IVaultAdapter;
  query: VaultQueryService;
  encrypted: () => boolean;
  /** The path open in the focused pane, if it is a note. */
  activePath: () => string | null;
  /** The document open in the focused pane — a note or a database. */
  documentPath: () => string | null;
  /** Every path open in a tab of this window. */
  openPaths: () => string[];
  /** Appointments between two instants (the PIM cache); empty without one. */
  events: (from: Date, to: Date) => Promise<SituationEventInput[]>;
  /** Navigation the assistant may trigger: views and notes, nothing that changes data. */
  commands: () => AiNavigationCommand[];
  /** The vault's comment service: where an AI suggestion round is written (plan P1.5). */
  commentOperations: () => CommentOperationService | null;
  /** The vault's search by meaning, for the context package (plan P2b); null while there is none. */
  semantic?: () => LocalEmbeddings | null;
  /** The vault's gists by the model on this computer, for the context package (plan P2b-3); null while there are none. */
  gists?: () => LocalGists | null;
}

let currentPolicy: VaultPolicyHost | null = null;

/** The policy of the vault the session reads — the settings invalidate it after writing the rules. */
export function currentAiPolicy(): VaultPolicyHost | null {
  return currentPolicy;
}

/** The vault side of the session for the open desktop vault. */
export function createDesktopVaultHost(input: DesktopVaultInput): { host: AiVaultHost; policy: VaultPolicyHost } {
  const read = async (path: string): Promise<string | null> => {
    try {
      return (await input.adapter.exists(path)) ? await input.adapter.readTextFile(path) : null;
    } catch {
      return null;
    }
  };
  const note = async (path: string) => {
    if (!/\.md$/i.test(path)) return null;
    await flushPendingSave(path);
    const text = await read(path);
    return text === null ? null : { path, title: noteDisplayName(path), text };
  };
  const policy = createVaultPolicy({
    readFile: read,
    resolveLink: (target) => input.query.resolveNotePath(target),
    encrypted: input.encrypted,
  });
  currentPolicy = policy;
  /** Checkbox tasks and the task database, as every task view reads them. */
  const taskRows = async () => {
    const [db, notes] = await Promise.all([
      getTaskDatabasePath(input.vaultPath)
        .then(async (dbPath) => databaseTaskRows(dbPath ? await read(dbPath) : null, (config) => input.query.queryDatabaseFiles(config)))
        .catch(() => []),
      input.query
        .listTasks()
        .then((tasks) => plannerRowsFromTasks(tasks.filter((task) => !task.excluded)))
        .catch(() => []),
    ]);
    return [...db, ...notes];
  };
  const moodKey = async (): Promise<string | null> => {
    try {
      return ((await (await getSettingsStore()).get<string>(journalMoodPropertyKey(input.vaultPath))) ?? "").trim() || null;
    } catch {
      return null;
    }
  };
  const host = createAiVaultHost({
    files: desktopAiFiles,
    vaultKey: aiVaultKey(input.vaultPath),
    instructionIO: adapterInstructionIO(input.adapter),
    instructionWriter: adapterInstructionWriter(input.adapter),
    policy,
    async activeNote() {
      const path = input.activePath();
      return path ? note(path) : null;
    },
    readNote: note,
    async propose(round) {
      const service = input.commentOperations();
      if (!service) throw new Error("comments are not available in this vault");
      await proposeSuggestionRound(service, round);
    },
    encrypted: input.encrypted,
    gists: () => input.gists?.()?.reader() ?? null,
    async keepOnDevice(path) {
      // The editor's pending keystrokes land first, so the rule is written into the live text.
      await flushPendingSave(path);
      const text = await read(path);
      if (text === null) throw new Error(`No note at ${path}`);
      await input.adapter.writeTextFile(path, withCloudDenied(text));
    },
    async situation() {
      const now = new Date();
      const path = input.documentPath();
      const kind = path && /\.base$/i.test(path) ? "base" : "note";
      const text = path && kind === "note" ? ((await note(path))?.text ?? null) : null;
      const [tasks, events, mood, dailyNotePath] = await Promise.all([
        taskRows(),
        input.events(now, new Date(now.getTime() + 2 * 86_400_000)).catch(() => []),
        moodKey(),
        readDailyNoteConfig(input.vaultPath)
          .then(async (config) => {
            const { fullPath } = buildDailyNotePath(journalToday(now), config.format, config.folder);
            return (await input.adapter.exists(fullPath)) ? fullPath : null;
          })
          .catch(() => null),
      ]);
      return situationFrom({ now, active: path ? { path, kind, text } : null, selection: path ? readEditorSelection() : null, tabs: input.openPaths(), taskRows: tasks, events, dailyNotePath, moodKey: mood });
    },
    retrieval: {
      searchCandidates: (terms, limit) => input.query.searchCandidates(terms, limit),
      linkNeighbors: (path, limit) => input.query.getLinkNeighbors(path, limit),
      recentlyChanged: (limit) => input.query.getRecentlyChangedNotes(limit),
      async recentlyOpened() {
        try {
          return parseRecentsFile(await input.adapter.readTextFile(".plainva/recents.json"));
        } catch {
          return [];
        }
      },
      now: () => Date.now(),
      semanticCandidates: async (question, limit, options) => (await input.semantic?.()?.semanticCandidates(question, limit, options)) ?? [],
      // What sending without a selection would cost (plan P2b-5): the index's sizes, no note read.
      noteSizes: async (paths) => new Map([...(await input.query.fileRecords(paths))].map(([path, record]) => [path, record.size_bytes])),
    },
    toolDeps: {
      async search(query, limit, offset) {
        const hits = await input.query.searchFullText(query, limit, offset);
        return hits.map((hit) => ({ path: hit.path, title: hit.title || noteDisplayName(hit.path), snippet: hit.snippet ?? null }));
      },
      readNote: read,
      taskRows,
      todayKey: () => calendarDay(),
      commands: input.commands,
      backlinks: (path) => input.query.getBacklinks(path),
      queryDatabase: (config) => input.query.queryDatabaseFiles(config),
      events: (from, to) => input.events(from, to),
      moodKey,
    },
  });
  return { host, policy };
}
