import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LocalEmbeddings, LocalGists } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  aiNavigationCommands,
  appendPlannedJournalEntry,
  captureVocabularyOf,
  createAudioTranscriber,
  createImageExplainer,
  createTaskInDatabase,
  parseTaskCapture,
  getPlatformServices,
  noteDisplayName,
  requestEventSeed,
  resolveAudioPath,
  setAudioTranscriber,
  setImageExplainer,
  situationEvents,
  startableSkills,
  toast,
  useStableHandler,
  type AiNavigationCommand,
  type AiSession,
  type AiState,
  type AiVaultHost,
  type AppCommand,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { readJournalHeading, useJournalFiles } from "../../hooks/useJournal";
import { applyIndexChanges, moveItems, reindexAfterRename, renameToName } from "../../services/fileActions";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";
import { getConfiguredNoteType } from "../../services/newNote";
import { requestSaveFlush } from "../../services/saveFlush";
import { getTaskDatabasePath } from "../../services/taskDatabase";
import { providerListLabel, sendTaskToProviderList } from "../../services/pim/taskToProvider";
import { AI_OPEN_EVENT, AI_SKILLS_EVENT, AI_WAITING_EVENT, createDesktopVaultHost, getDesktopAiSession, requestWaitingView, type DesktopWriteHost } from "../../services/ai/desktopAi";
import { configureMcp, listenForMcpCalls, vaultName } from "../../services/ai/mcpBridge";
import { mcpPlans } from "../../services/ai/mcpPlans";
import { AI_TAB_PATH, CALENDAR_TAB_PATH, isVirtualPath } from "../graph/virtualPaths";

/**
 * Everything the desktop shell needs from the AI harness in one hook: the
 * session of the central window, the vault it reads, the companion's
 * open state and the navigation the assistant may trigger. AppShell only
 * wires the returned handlers; the harness logic stays in `@plainva/ui`.
 */
export interface DesktopAiInput {
  vaultPath: string | null;
  vaultAdapter: IVaultAdapter | null;
  queryService: VaultQueryService | null;
  encrypted: boolean;
  activePath: string | null;
  /** The panes of this window: their open tabs are part of the situation (plan §7). */
  layout: { panes: readonly { tabs: readonly { history: readonly string[]; historyIndex: number }[] }[] };
  openView: (path: string) => void;
  openNote: (path: string) => void;
  /** The vault's search by meaning (plan P2b): the context package ranks with it. */
  embeddings?: LocalEmbeddings | null;
  /** The vault's gists (plan P2b-3): the context package sends them for its cards. */
  gists?: LocalGists | null;
  /** Makes open tabs follow a note that was renamed or moved (plan P5): the window's own bookkeeping. */
  renameTabPrefix?: (from: string, to: string) => void;
}

const clockNow = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

/** Where the shell leaves its palette's commands for the assistant: built late in a render, asked for when a command runs. */
export type AiCommandSource = { current: (() => readonly AppCommand[]) | null };

/**
 * Hands the palette's commands to the assistant (plan KI-Harness P4-4): what
 * `run_command` can do is what the command registry holds, never a list of
 * its own. Rendered where the shell has built them.
 */
export function AiCommandSourceLink({ sourceRef, build }: { sourceRef: AiCommandSource; build: () => readonly AppCommand[] }) {
  useEffect(() => {
    sourceRef.current = build;
    return () => {
      sourceRef.current = null;
    };
  }, [sourceRef, build]);
  return null;
}

const NOOP_SUBSCRIBE = () => () => {};
const NULL_STATE = (): AiState | null => null;

export function useDesktopAi(input: DesktopAiInput) {
  const session: AiSession | null = useMemo(() => getDesktopAiSession(), []);
  const state = useSyncExternalStore(session ? session.subscribe : NOOP_SUBSCRIBE, session ? session.getState : NULL_STATE, session ? session.getState : NULL_STATE);
  const enabled = Boolean(state?.loaded && state.settings.enabled);
  const [companionOpen, setCompanionOpen] = useState(false);

  // The vault host reads the latest active path and handlers through refs:
  // it is built once per vault, not once per keystroke.
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });
  // Appointments come from the PIM cache of the open vault, when it has one;
  // an AI suggestion round goes through its comment service (plan P1.5).
  const { pimRuntime, commentOperations, dbAdapter, indexer, triggerFileTreeUpdate, listAllWorkspaceComments, listWorkspaceMembers } = useVault();
  const comments = useRef(commentOperations);
  useLayoutEffect(() => {
    comments.current = commentOperations;
  });
  // A note the assistant's "Keep as a note" wrote (plan P4-6) is made known like any new file: to the index, to the tree,
  // and to whoever follows file operations (the folder's index.md).
  const created = useRef<(path: string) => Promise<void>>(async () => undefined);
  useLayoutEffect(() => {
    created.current = async (path) => {
      if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
      triggerFileTreeUpdate([path]);
      notifyFileOps([{ type: "create", path }]);
    };
  });
  const pim = useRef(pimRuntime);
  useLayoutEffect(() => {
    pim.current = pimRuntime;
  });
  // What a plan and a draft of the assistant ask for is done the way this window does it (plan KI-Harness P5): the file
  // tree's rename and move — unsaved text first, links, tabs, index and tree after —, the task view's capture, the
  // journal's entry. Read through a ref like everything else the host uses.
  const journalFiles = useJournalFiles();
  const allComments = useRef(listAllWorkspaceComments);
  const authors = useRef(listWorkspaceMembers);
  // The ways that need the vault's adapter and index; opening the composer or the calendar needs neither (see below).
  const writeHost = useRef<Pick<DesktopWriteHost, "rename" | "move" | "createTask" | "taskList" | "addJournal"> | null>(null);
  useLayoutEffect(() => {
    allComments.current = listAllWorkspaceComments;
    authors.current = listWorkspaceMembers;
    const { vaultAdapter: adapter, vaultPath: root, queryService: query, renameTabPrefix } = input;
    if (!adapter || !root) {
      writeHost.current = null;
      return;
    }
    const landed = async (path: string) => {
      try {
        await requestSaveFlush(path, root);
        return true;
      } catch {
        // Unsaved text that cannot be written stays where it is: nothing moves under it (issue 113).
        return false;
      }
    };
    const addJournal = async (entry: { text: string; day: string; time: string; task: boolean }): Promise<string> => {
      if (!journalFiles) throw new Error("the journal is not available");
      const path = await appendPlannedJournalEntry(journalFiles, { date: entry.day, time: entry.time, heading: await readJournalHeading(root), text: entry.text, ...(entry.task ? { task: true } : {}) });
      if (!path) throw new Error("the entry could not be written");
      return path;
    };
    // A task made from a draft reaches its provider list the way every other new task does (C4, S16): through the one
    // shared service, after the note exists. A failure is reported and never costs the note. Nothing exists at the
    // provider after a failed creation, so trying again is safe; a task created there without its anchor is the
    // opposite, and that message offers no retry.
    const sendToList = async (dbPath: string, notePath: string, title: string, dueDate?: string): Promise<void> => {
      const outcome = await sendTaskToProviderList({ adapter, dbPath, notePath, title, ...(dueDate ? { dueDate } : {}), pimRuntime: pim.current });
      if (outcome === "createFailed") toast.error(i18n.t("tasks.providerCreateFailed"), { label: i18n.t("pim.eventWriteRetry"), run: () => void sendToList(dbPath, notePath, title, dueDate) });
      else if (outcome === "notAnchored") toast.error(i18n.t("tasks.providerAnchorFailed"));
    };
    writeHost.current = {
      async rename(path, title) {
        if (!(await landed(path))) return null;
        const result = await renameToName({ adapter, queryService: query, oldPath: path, newName: title, isFolder: false });
        if (!result.ok) return null;
        renameTabPrefix?.(path, result.newPath);
        if (indexer) await reindexAfterRename(indexer, { oldPath: path, newPath: result.newPath, isFolder: false, changedPaths: result.changedPaths }).catch(() => undefined);
        triggerFileTreeUpdate();
        notifyFileOps([{ type: "move", from: path, to: result.newPath, isFolder: false }]);
        return result.newPath;
      },
      async move(path, folder) {
        if (!(await landed(path))) return null;
        const { moved } = await moveItems({ adapter, queryService: query, indexer, isFolder: () => false, onMoved: (from, to) => renameTabPrefix?.(from, to) }, [path], folder);
        if (moved.length === 0) return null;
        triggerFileTreeUpdate();
        notifyFileOps(moved);
        return moved[0]!.to;
      },
      async createTask(text, day, atProvider) {
        const taskDb = await getTaskDatabasePath(root);
        // Without a task database a task is what it is everywhere else in Plainva: a line with an open box, in the journal.
        if (!taskDb) return addJournal({ text, day, time: clockNow(), task: true });
        // The same reading as a line typed into the capture field — with "today" being the day it was drafted.
        const read = parseTaskCapture(text, captureVocabularyOf((key) => i18n.t(key), i18n.language), day);
        const created = await createTaskInDatabase({
          adapter,
          dbPath: taskDb,
          title: read.title.trim() || text,
          noteType: await getConfiguredNoteType(root),
          ...(read.due ? { dueDate: read.due, dueMinutes: read.minutes } : {}),
          tags: read.tags,
          priority: read.priority,
          repeat: read.repeat,
        });
        if (!created.ok) throw new Error(created.reason);
        if (indexer) await applyIndexChanges(indexer, { added: [created.notePath] }).catch(() => undefined);
        triggerFileTreeUpdate([created.notePath]);
        notifyFileOps([{ type: "create", path: created.notePath }]);
        // …and in the provider list the database names, where the card's chip stayed on. The note is the deliverable
        // and exists; the provider's answer only adds the link to it and does not hold the creation back (issue 119).
        if (atProvider) void sendToList(taskDb, created.notePath, read.title.trim() || text, read.due ?? undefined);
        return created.notePath;
      },
      async taskList() {
        const taskDb = await getTaskDatabasePath(root).catch(() => null);
        return taskDb ? providerListLabel({ adapter, dbPath: taskDb, pimRuntime: pim.current }) : null;
      },
      addJournal,
    };
  });
  // The index database: the mail client's offline copy lives there, and the assistant's mail tools read it when an account does not answer.
  const db = useRef(dbAdapter);
  useLayoutEffect(() => {
    db.current = dbAdapter;
  });

  // What `run_command` can do (plan KI-Harness P4-4): the palette's commands that show or arrange something, and the three that take a note or a day.
  const commandSourceRef = useRef<AiCommandSource["current"]>(null);
  const commands = useStableHandler((): AiNavigationCommand[] =>
    aiNavigationCommands({
      commands: () => commandSourceRef.current?.() ?? [],
      openNote: (path) => latest.current.openNote(path),
      resolveNote: async (target) => (await latest.current.queryService?.resolveNotePath(target)) ?? null,
      neighbors: async (path, limit) => (await latest.current.queryService?.getLinkNeighbors(path, limit)) ?? [],
    }),
  );

  const { vaultPath, vaultAdapter, queryService } = input;
  /** The vault host of the open vault: the MCP server's calls run on it too (plan §17.3). */
  const hostRef = useRef<AiVaultHost | null>(null);
  useEffect(() => {
    if (!session) return;
    if (!vaultPath || !vaultAdapter || !queryService) {
      hostRef.current = null;
      void session.attachVault(null);
      return;
    }
    const { host } = createDesktopVaultHost({
      vaultPath,
      adapter: vaultAdapter,
      query: queryService,
      encrypted: () => latest.current.encrypted,
      activePath: () => {
        const path = latest.current.activePath;
        return path && !isVirtualPath(path) && /\.md$/i.test(path) ? path : null;
      },
      documentPath: () => {
        const path = latest.current.activePath;
        return path && !isVirtualPath(path) && /\.(md|base)$/i.test(path) ? path : null;
      },
      openPaths: () => latest.current.layout.panes.flatMap((pane) => pane.tabs.map((tab) => tab.history[tab.historyIndex]).filter((p): p is string => Boolean(p))),
      events: async (from, to) => situationEvents((await pim.current?.cache.listEvents(from.getTime(), to.getTime())) ?? []),
      commands,
      db: () => db.current,
      commentOperations: () => comments.current,
      noteCreated: (path) => created.current(path),
      semantic: () => latest.current.embeddings ?? null,
      gists: () => latest.current.gists ?? null,
      writes: {
        rename: async (path, title) => (await writeHost.current?.rename(path, title)) ?? null,
        move: async (path, folder) => (await writeHost.current?.move(path, folder)) ?? null,
        createTask: (text, day, atProvider) => (writeHost.current ? writeHost.current.createTask(text, day, atProvider) : Promise.reject(new Error("no vault"))),
        taskList: async () => (await writeHost.current?.taskList()) ?? null,
        addJournal: (entry) => (writeHost.current ? writeHost.current.addJournal(entry) : Promise.reject(new Error("no vault"))),
        // A drafted e-mail opens in the window's own composer — the event every "write a mail" of the app sends —,
        // a drafted appointment in the calendar's event editor (plan P5-6). Nothing is sent or saved by either.
        // Asked as a cancelable event: a composer that is open keeps its mail and says no, so nothing is lost unseen.
        openMail: (mail, done) =>
          window.dispatchEvent(
            new CustomEvent("plainva-compose-mail", {
              cancelable: true,
              detail: { subject: mail.subject, markdown: mail.body, to: mail.to.join(", "), cc: mail.cc.join(", "), bcc: mail.bcc.join(", "), onDone: done },
            }),
          ),
        openEvent: (seed, saved) => {
          requestEventSeed(seed, saved);
          latest.current.openView(CALENDAR_TAB_PATH);
          // The event editor is a dialog of the calendar, and the floating companion would lie over it: it makes
          // room. The conversation is the same one in the AI tab, and the draft waits in the list either way.
          setCompanionOpen(false);
        },
        // Asked when a draft is laid down or listed, so the mail module loads then and not with the window.
        mailConnected: async () => {
          const { listMailAccounts } = await import("@plainva/ui/mail");
          return (await listMailAccounts(vaultPath).catch(() => [])).length > 0;
        },
        // The calendars the event editor offers for a new appointment: shown, not read-only, of an account that is on.
        calendarWritable: async () => {
          const cache = pim.current?.cache;
          if (!cache) return false;
          const [accounts, calendars] = await Promise.all([cache.listAccounts(), cache.listCalendars()]).catch(() => [[], []] as const);
          const enabled = new Set(accounts.filter((account) => account.enabled).map((account) => account.id));
          return calendars.some((calendar) => calendar.selected && !calendar.readOnly && enabled.has(calendar.accountId));
        },
      },
      listComments: () => allComments.current(),
      authorNames: async () => new Map((await authors.current()).map((member) => [member.memberId, member.displayName])),
    });
    hostRef.current = host;
    void session.attachVault(host);
  }, [session, vaultPath, vaultAdapter, queryService, commands]);

  // The MCP server (plan §17.3): the native side forwards calls here; only
  // the main window has a session, so only it answers. An app the user allowed
  // to propose changes (stage 2) leaves a suggestion or a draft like the
  // assistant does, signed with its own name — and the user hears of it once,
  // where they work: the app that wrote it is another window.
  useEffect(() => {
    if (!session) return;
    return listenForMcpCalls(() => hostRef.current, {
      session,
      plans: mcpPlans,
      left: (what) => {
        if (what.kind === "proposal") {
          const path = what.path;
          toast.info(i18n.t("ai.mcp.left.proposal", { client: what.client, note: noteDisplayName(path) }), { label: i18n.t("ai.mcp.left.open"), run: () => latest.current.openNote(path) });
        } else {
          toast.info(i18n.t("ai.mcp.left.draft", { client: what.client }), { label: i18n.t("ai.write.draft.show"), run: () => requestWaitingView() });
        }
      },
    });
  }, [session]);
  // A plan of an app was asked of the vault that was open then: another vault, or none, and it waits no more.
  useEffect(() => () => mcpPlans.clear(), [vaultPath]);
  // "View" on the toast about a draft: the AI tab takes the request when it shows.
  useEffect(() => {
    const open = () => latest.current.openView(AI_TAB_PATH);
    window.addEventListener(AI_WAITING_EVENT, open);
    return () => window.removeEventListener(AI_WAITING_EVENT, open);
  }, []);
  // What the native side serves: on only with the AI and the device switch,
  // and always for the vault open now — a new vault closes older connections.
  const mcpOn = Boolean(enabled && state?.settings.mcpEnabled);
  const { i18n: translator } = useTranslation();
  const language = translator.language;
  useEffect(() => {
    if (!session || !state?.loaded) return;
    const vault = vaultPath && vaultAdapter && queryService ? { path: vaultPath, name: vaultName(vaultPath) } : null;
    void configureMcp(mcpOn, vault).catch(() => undefined);
    // The prompts speak the app's language: a switch registers them again.
  }, [session, state?.loaded, mcpOn, vaultPath, vaultAdapter, queryService, language]);

  // "Transcribe" at every voice note (plan P1.5): the door exists while the AI is on for the open vault.
  useEffect(() => {
    if (!session || !enabled || !vaultAdapter) return;
    setAudioTranscriber(
      createAudioTranscriber(session, (key, vars) => i18n.t(key, vars), {
        resolve: (place) => resolveAudioPath(place, (path) => vaultAdapter.exists(path), queryService ? (name, near) => queryService.findByFileName(name, near) : undefined),
        readBinary: (path) => vaultAdapter.readBinaryFile(path),
      }),
    );
    return () => setAudioTranscriber(null);
  }, [session, enabled, vaultAdapter, queryService]);

  // "Explain image" at every picture of the vault (plan P4-5): the door exists while the AI is on for the open vault.
  useEffect(() => {
    if (!session || !enabled || !vaultAdapter) return;
    setImageExplainer(createImageExplainer(session, (key, vars) => i18n.t(key, vars), { readBinary: (path) => vaultAdapter.readBinaryFile(path) }));
    return () => setImageExplainer(null);
  }, [session, enabled, vaultAdapter]);

  // Switching the AI off closes the companion; the conversation stays stored.
  useEffect(() => {
    if (!enabled) setCompanionOpen(false);
  }, [enabled]);

  const openCompanion = useStableHandler(() => {
    session?.present("window");
    setCompanionOpen(true);
  });
  const closeCompanion = useStableHandler(() => setCompanionOpen(false));
  // The selection door opens the companion wherever it sits (plan P1.5).
  useEffect(() => {
    const open = () => openCompanion();
    window.addEventListener(AI_OPEN_EVENT, open);
    return () => window.removeEventListener(AI_OPEN_EVENT, open);
  }, [openCompanion]);
  // A door outside the conversation ("Transcribe" at a voice note, "@AI" in a
  // comment thread) may need the send overview while no conversation shows:
  // then the companion opens, or the question would wait unseen.
  useEffect(() => {
    if (!session) return;
    session.setReveal(() => openCompanion());
    return () => session.setReveal(null);
  }, [session, openCompanion]);
  const toggleCompanion = useStableHandler(() => (companionOpen ? closeCompanion() : openCompanion()));
  // The skills a person can start now (plan KI-Harness P3): the palette lists them.
  const skills = useMemo(() => (state ? startableSkills((key, vars) => i18n.t(key, vars), state.skills.entries) : []), [state]);
  // A skill from the palette: a new conversation in the companion, bound to it.
  const runSkill = useStableHandler((id: string) => {
    if (!session || session.getState().live) return openCompanion();
    const skill = startableSkills((key, vars) => i18n.t(key, vars), session.getState().skills.entries).find((s) => s.id === id);
    openCompanion();
    if (skill) void session.runSkill(skill.id, skill.start);
  });
  const openAsTab = useStableHandler(() => {
    setCompanionOpen(false);
    session?.present("tab");
    latest.current.openView(AI_TAB_PATH);
  });
  // "Open skills" in the settings: the AI tab takes the request when it shows (plan P3-5).
  useEffect(() => {
    const open = () => latest.current.openView(AI_TAB_PATH);
    window.addEventListener(AI_SKILLS_EVENT, open);
    return () => window.removeEventListener(AI_SKILLS_EVENT, open);
  }, []);
  const openNoteTarget = useStableHandler((target: string) => {
    const query = latest.current.queryService;
    if (!query) return;
    void query.resolveNotePath(target).then((path) => {
      if (path) latest.current.openNote(path);
    });
  });
  /**
   * A link in an answer is untrusted: it opens only after the reader saw where
   * it goes — and, for an address the model put together itself (plan P4),
   * read that it did.
   */
  const openUrl = useStableHandler((url: string, composed?: boolean) => {
    const message = composed ? `${url}

${i18n.t("ai.openLinkBuilt")}` : url;
    void appConfirm({ title: i18n.t("ai.openLinkTitle"), message, confirmLabel: i18n.t("ai.openLink") }).then((ok) => {
      if (ok) void getPlatformServices().openExternal(url);
    });
  });

  const activePath = input.activePath;
  const activeNote = useMemo(
    () => (activePath && !isVirtualPath(activePath) && /\.md$/i.test(activePath) ? { path: activePath, title: noteDisplayName(activePath) } : null),
    [activePath],
  );

  return { session, enabled, companionOpen, openCompanion, closeCompanion, toggleCompanion, runSkill, skills, openAsTab, openNoteTarget, openUrl, activeNote, commandSourceRef };
}
