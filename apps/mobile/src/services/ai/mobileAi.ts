import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import i18n from "@plainva/ui/i18n";
import {
  aiDefaultSettings,
  aiNavigationCommands,
  AiSession,
  aiVaultKey,
  calendarDay,
  adapterInstructionIO,
  adapterInstructionWriter,
  createAiVaultHost,
  createVaultPolicy,
  dailyNotePathFor,
  databaseTaskRows,
  flushPendingSave,
  getPlatformServices,
  journalToday,
  noteDisplayName,
  parseRecentsFile,
  plannerRowsFromTasks,
  postThreadReply,
  proposeSuggestionRound,
  createAudioTranscriber,
  createImageExplainer,
  resolveAudioPath,
  setAudioTranscriber,
  setImageExplainer,
  situationEvents,
  situationFrom,
  startableSkills,
  vaultMailSource,
  withCloudDenied,
  type AiFileStore,
  type AppCommand,
  type AreaOrder,
  type VaultPolicyHost,
  GRAPH_TRAIL_EVENT,
} from "@plainva/ui";
import { atomicWriteText } from "../../platform/atomicFile";
import { mConfirm } from "../mobileDialogs";
import { createMobileAiEgress } from "../../platform/aiNet";
import { createMobileWebFetcher } from "../../platform/aiWeb";
import { vaultOps, type MobileVault } from "../vaultService";
import { readEditorSelection } from "../editorSelection";
import { getMobileSettings } from "../mobileSettings";
import { mobileCommentOperations } from "../commentOperations";
import { useMobileEmbeddings } from "./mobileEmbeddings";
import { useMobileGists } from "./mobileGists";

/**
 * The phone's AI session (plan KI-Harness P1a). The same store as on the
 * desktop, in two dresses: the KI screen (ninth area of the pool) and the
 * KI sheet over a note. Conversations live in the app's data folder, per
 * vault, never in the vault.
 */

const SETTINGS_KEY = "ai";
const ROOT = "ai";

export const mobileAiFiles: AiFileStore = {
  async read(relPath) {
    try {
      const res = await Filesystem.readFile({ path: `${ROOT}/${relPath}`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof res.data === "string" ? res.data : null;
    } catch {
      return null;
    }
  },
  async write(relPath, text) {
    await atomicWriteText(`${ROOT}/${relPath}`, text);
  },
  async remove(relPath) {
    try {
      await Filesystem.deleteFile({ path: `${ROOT}/${relPath}`, directory: Directory.Data });
    } catch {
      // absent is fine
    }
  },
  async removeDir(relPath) {
    try {
      await Filesystem.rmdir({ path: `${ROOT}/${relPath}`, directory: Directory.Data, recursive: true });
    } catch {
      // absent is fine
    }
  },
};

/** Removes the AI data of one vault — part of "forget app data". */
export async function forgetAiVaultData(vaultId: string): Promise<void> {
  await mobileAiFiles.removeDir(aiVaultKey(vaultId));
}

function englishLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "English";
  } catch {
    return "English";
  }
}

let session: AiSession | null = null;

export function getMobileAiSession(): AiSession {
  if (!session) {
    session = new AiSession({
      egress: createMobileAiEgress(() => ({
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
      defaults: aiDefaultSettings(),
      language: () => englishLanguageName(i18n.language || "en"),
      today: () => calendarDay(),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      label: (key, vars) => i18n.t(key, vars),
      // The assistant's page fetch (plan KI-Harness P4): the plugin of its own, apart from the egress.
      web: createMobileWebFetcher(),
    });
    void session.load();
  }
  return session;
}

let currentPolicy: VaultPolicyHost | null = null;

/** The policy of the vault the session reads — the settings invalidate it after writing the rules. */
export function currentMobileAiPolicy(): VaultPolicyHost | null {
  return currentPolicy;
}

/** The note the KI sheet was opened over — the context chip and the host's active note. */
let sheetNote: string | null = null;
const SHEET_EVENT = "plainva-ai-sheet";

/** Makes a note the AI's open note without opening the sheet (the AI segment of the note's context). */
export function focusAiNote(path: string | null): void {
  sheetNote = path;
}

/**
 * A review the vault's AI settings ask for on the way into the workshop (plan
 * KI-Harness P3-5): taken once by the AI screen's skills segment.
 */
let pendingSkillReview: string | null = null;

export function requestSkillReview(id: string | null): void {
  pendingSkillReview = id;
}

export function takeSkillReview(): string | null {
  const id = pendingSkillReview;
  pendingSkillReview = null;
  return id;
}

/** Starts a skill (plan KI-Harness P3) in a new conversation bound to it; the caller shows it. */
export function runMobileAiSkill(id: string): void {
  const session = getMobileAiSession();
  if (session.getState().live) return;
  const skill = startableSkills((key, vars) => i18n.t(key, vars), session.getState().skills.entries).find((s) => s.id === id);
  if (skill) void session.runSkill(skill.id, skill.start);
}

/** Opens the KI sheet over a note (the note's ⋮ menu, the palette). */
export function openAiSheet(path: string | null): void {
  sheetNote = path;
  window.dispatchEvent(new CustomEvent(SHEET_EVENT, { detail: { path } }));
}

/**
 * A link in an answer is untrusted: it opens only after the reader saw where
 * it goes — and, for an address the model put together itself (plan P4), read
 * that it did.
 */
export function openAiLink(url: string, composed?: boolean): void {
  const message = composed ? `${url}

${i18n.t("ai.openLinkBuilt")}` : url;
  void mConfirm({ title: i18n.t("ai.openLinkTitle"), message, confirmLabel: i18n.t("ai.openLink") }).then((ok) => {
    if (ok) void getPlatformServices().openExternal(url);
  });
}

/** A wikilink in an answer names a note as written; the vault's resolver finds its path. */
export function openAiNoteTarget(vault: MobileVault, target: string, openNote: (path: string) => void): void {
  void vaultOps.resolveWikiTarget(vault, target, "").then((path) => {
    if (path) openNote(path);
  });
}

/** The areas without the KI screen while the switch is off: no entry leads to a surface that is off. */
export function withoutAiArea(order: AreaOrder, enabled: boolean): AreaOrder {
  const index = order.order.indexOf("ai");
  if (enabled || index < 0) return order;
  return { order: order.order.filter((id) => id !== "ai"), visibleCount: index < order.visibleCount ? order.visibleCount - 1 : order.visibleCount };
}

/** True while the per-device switch is on: entries that lead to the AI exist only then. */
export function aiEnabled(): boolean {
  const state = session?.getState();
  return Boolean(state?.loaded && state.settings.enabled);
}

export interface MobileAiNavigation {
  openNote: (path: string) => void;
  /** The AI settings screen (the conversation's "set up" leads there). */
  openSettings?: () => void;
  /**
   * The palette's commands as the shell built them (plan KI-Harness P4-4):
   * what `run_command` can do is what the command registry holds on this
   * shell, never a list of its own.
   */
  commands: readonly AppCommand[];
}

/**
 * The shell side in one hook: attaches the open vault, follows the sheet
 * requests, and says whether the AI is switched on. App.tsx stays within its
 * line budget by calling only this. It sits above App's vault gate (a hook
 * never follows a return), so the navigation it may trigger arrives later,
 * through `MobileAiNavigation` rendered below the gate.
 */
export function useMobileAi(vault: MobileVault | null) {
  const s = getMobileAiSession();
  const state = useSyncExternalStore(s.subscribe, s.getState);
  const [sheet, setSheet] = useState<{ path: string | null } | null>(null);
  const [policy, setPolicy] = useState<VaultPolicyHost | null>(null);
  // Search by meaning (plan KI-Harness P2a-4/5) follows the same per-device settings; an own provider goes through this session's egress.
  const embeddings = useMobileEmbeddings(vault, state.loaded ? state.settings : null, { session: s, files: mobileAiFiles });
  // Gists (plan P2b-3): written by the model of the profile "Local" on a server counted as local.
  const gists = useMobileGists(vault, state.loaded ? state.settings : null, { session: s, files: mobileAiFiles });
  // The vault host is built once per vault; the context package reads the controllers when a message is built.
  const embeddingsRef = useRef(embeddings);
  const gistsRef = useRef(gists);
  useLayoutEffect(() => {
    embeddingsRef.current = embeddings;
    gistsRef.current = gists;
  });

  useEffect(() => {
    const onSheet = (event: Event) => setSheet({ path: (event as CustomEvent<{ path: string | null }>).detail?.path ?? null });
    window.addEventListener(SHEET_EVENT, onSheet);
    return () => window.removeEventListener(SHEET_EVENT, onSheet);
  }, []);
  // A door outside the conversation ("Transcribe" at a voice note, "@AI" in a
  // comment thread) may need the send overview while no conversation shows:
  // then the sheet opens over the note the AI was last pointed at.
  useEffect(() => {
    s.setReveal(() => openAiSheet(sheetNote));
    return () => s.setReveal(null);
  }, [s]);

  const navRef = useRef<MobileAiNavigation>({ openNote: () => undefined, commands: [] });
  // The AI's trail (plan KI-Harness P2b-5): the graph opens for it, and the graph screen takes the trail.
  useEffect(() => {
    const onTrail = () => navRef.current.commands.find((command) => command.id === "open-graph")?.run();
    window.addEventListener(GRAPH_TRAIL_EVENT, onTrail);
    return () => window.removeEventListener(GRAPH_TRAIL_EVENT, onTrail);
  }, []);
  useEffect(() => {
    if (!vault || !vault.queryService) {
      void s.attachVault(null);
      setPolicy(null);
      return;
    }
    const query = vault.queryService;
    const read = async (path: string): Promise<string | null> => {
      try {
        return (await vault.files.exists(path)) ? await vault.files.readTextFile(path) : null;
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
    const vaultPolicy = createVaultPolicy({
      readFile: read,
      resolveLink: (target, from) => vaultOps.resolveWikiTarget(vault, target, from),
      encrypted: () => vault.workspaceRuntime !== null,
    });
    // What `run_command` can do: the palette's commands that show something, and the three that take a note or a day.
    const commands = () =>
      aiNavigationCommands({
        commands: () => navRef.current.commands,
        openNote: (path) => navRef.current.openNote(path),
        resolveNote: (target) => vaultOps.resolveWikiTarget(vault, target, ""),
        neighbors: (path, limit) => query.getLinkNeighbors(path, limit),
      });
    /** Checkbox tasks and the task database, as every task view reads them. */
    const taskRows = async () => {
      const db = getMobileSettings().taskDatabase.trim();
      const [dbRows, notes] = await Promise.all([
        db ? read(db).then((text) => databaseTaskRows(text, (config) => query.queryDatabaseFiles(config))) : Promise.resolve([]),
        query
          .listTasks()
          .then((tasks) => plannerRowsFromTasks(tasks.filter((task) => !task.excluded)))
          .catch(() => []),
      ]);
      return [...dbRows, ...notes];
    };
    // Loaded late: the PIM service is a large module the AI need not start with.
    const events = (from: Date, to: Date) =>
      import("../pim/pimService")
        .then(({ listPimEvents }) => listPimEvents(from.getTime(), to.getTime()))
        .then(situationEvents)
        .catch(() => []);
    const moodKey = async () => getMobileSettings().journalMoodProperty.trim() || null;
    const host = createAiVaultHost({
      files: mobileAiFiles,
      vaultKey: aiVaultKey(vault.vaultId),
      instructionIO: adapterInstructionIO(vault.files),
      instructionWriter: adapterInstructionWriter(vault.files),
      policy: vaultPolicy,
      activeNote: async () => (sheetNote ? note(sheetNote) : null),
      readNote: note,
      async propose(round) {
        await proposeSuggestionRound(mobileCommentOperations(vault), round);
      },
      async reply(reply) {
        await postThreadReply(mobileCommentOperations(vault), reply);
      },
      encrypted: () => vault.workspaceRuntime !== null,
      gists: () => gistsRef.current?.reader() ?? null,
      async keepOnDevice(path) {
        // The editor's pending keystrokes land first; the save is the conflict-aware chain, synced like any edit.
        await flushPendingSave(path);
        const text = await read(path);
        if (text === null) throw new Error(`No note at ${path}`);
        await vaultOps.save(vault, path, withCloudDenied(text));
      },
      // The phone's situation: the note the sheet opened over (one editor at a
      // time, no tabs), due tasks, the next appointments, today's daily note.
      async situation() {
        const now = new Date();
        const path = sheetNote;
        const text = path ? ((await note(path))?.text ?? null) : null;
        const settings = getMobileSettings();
        const dailyPath = dailyNotePathFor(journalToday(now), { folder: settings.dailyFolder, format: settings.dailyFormat });
        const [tasks, upcoming, dailyExists] = await Promise.all([taskRows(), events(now, new Date(now.getTime() + 2 * 86_400_000)), vault.files.exists(dailyPath).catch(() => false)]);
        return situationFrom({
          now,
          active: path ? { path, kind: "note", text } : null,
          selection: path ? readEditorSelection() : null,
          taskRows: tasks,
          events: upcoming,
          dailyNotePath: dailyExists ? dailyPath : null,
          moodKey: await moodKey(),
        });
      },
      retrieval: {
        searchCandidates: (terms, limit) => query.searchCandidates(terms, limit),
        linkNeighbors: (path, limit) => query.getLinkNeighbors(path, limit),
        recentlyChanged: (limit) => query.getRecentlyChangedNotes(limit),
        async recentlyOpened() {
          try {
            return parseRecentsFile(await vault.adapter.readTextFile(".plainva/recents.json"));
          } catch {
            return [];
          }
        },
        now: () => Date.now(),
        // Search by meaning of this vault (plan P2b): read when a message is built, never while rendering.
        semanticCandidates: async (question, limit, options) => (await embeddingsRef.current?.semanticCandidates(question, limit, options)) ?? [],
        // What sending without a selection would cost (plan P2b-5): the index's sizes, no note read.
        noteSizes: async (paths) => new Map([...(await query.fileRecords(paths))].map(([path, record]) => [path, record.size_bytes])),
        // Which notes name a file (plan P4-5): a picture embedded in a note kept from the cloud stays with it.
        notesContaining: (needles) => query.notesContaining(needles),
      },
      toolDeps: {
        async search(q, limit, offset) {
          const hits = await query.searchFullText(q, limit, offset);
          return hits.map((hit) => ({ path: hit.path, title: hit.title || noteDisplayName(hit.path), snippet: hit.snippet ?? null }));
        },
        readNote: read,
        taskRows,
        todayKey: () => calendarDay(),
        commands,
        backlinks: (path) => query.getBacklinks(path),
        queryDatabase: (config) => query.queryDatabaseFiles(config),
        events,
        moodKey,
        // The vault's mail accounts (plan KI-Harness P4-4): found through the tool search, asked for at the first call.
        mail: vaultMailSource(vault.vaultId, () => vault.db),
      },
    });
    currentPolicy = vaultPolicy;
    setPolicy(vaultPolicy);
    void s.attachVault(host);
  }, [s, vault, navRef]);

  const enabled = Boolean(state?.loaded && state.settings.enabled);
  // "Transcribe" at every voice note (plan P1.5): the door exists while the AI is on for the open vault.
  useEffect(() => {
    if (!enabled || !vault) return;
    const query = vault.queryService;
    setAudioTranscriber(
      createAudioTranscriber(s, (key, vars) => i18n.t(key, vars), {
        resolve: (place) => resolveAudioPath(place, (path) => vault.files.exists(path), query ? (name, near) => query.findByFileName(name, near) : undefined),
        readBinary: (path) => vault.adapter.readBinaryFile(path),
      }),
    );
    return () => setAudioTranscriber(null);
  }, [s, enabled, vault]);
  // "Explain image" at every picture of the vault (plan P4-5): the door exists while the AI is on for the open vault.
  useEffect(() => {
    if (!enabled || !vault) return;
    setImageExplainer(createImageExplainer(s, (key, vars) => i18n.t(key, vars), { readBinary: (path) => vault.adapter.readBinaryFile(path) }));
    return () => setImageExplainer(null);
  }, [s, enabled, vault]);
  const closeSheet = () => {
    sheetNote = null;
    setSheet(null);
  };
  // The skills a person can start now (plan KI-Harness P3): the palette lists them.
  const skills = useMemo(() => startableSkills((key, vars) => i18n.t(key, vars), state.skills.entries), [state.skills]);
  return { session: s, enabled, sheet: enabled ? sheet : null, closeSheet, policy, navRef, embeddings, gists, skills };
}

/**
 * Hands the shell's navigation to the AI: rendered below App's vault gate,
 * where `openNote` exists, and kept current after every render.
 */
export function MobileAiNavigation({ navRef, nav }: { navRef: { current: MobileAiNavigation }; nav: MobileAiNavigation }) {
  useEffect(() => {
    navRef.current = nav;
    latestNav = nav;
  });
  return null;
}

/** The shell's navigation as last rendered, for surfaces outside App (the note's context). */
let latestNav: MobileAiNavigation | null = null;

/** Opens the AI settings screen from any surface. */
export function openAiSettings(): void {
  latestNav?.openSettings?.();
}

/** True while the AI is switched on, re-rendering when that changes. */
export function useMobileAiEnabled(): boolean {
  const s = getMobileAiSession();
  const state = useSyncExternalStore(s.subscribe, s.getState);
  return Boolean(state?.loaded && state.settings.enabled);
}
