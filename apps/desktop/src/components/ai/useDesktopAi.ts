import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LocalEmbeddings, LocalGists } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  aiNavigationCommands,
  createAudioTranscriber,
  createImageExplainer,
  getPlatformServices,
  noteDisplayName,
  resolveAudioPath,
  setAudioTranscriber,
  setImageExplainer,
  situationEvents,
  startableSkills,
  useStableHandler,
  type AiNavigationCommand,
  type AiSession,
  type AiState,
  type AiVaultHost,
  type AppCommand,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { applyIndexChanges } from "../../services/fileActions";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";
import { AI_OPEN_EVENT, AI_SKILLS_EVENT, createDesktopVaultHost, getDesktopAiSession } from "../../services/ai/desktopAi";
import { configureMcp, listenForMcpCalls, vaultName } from "../../services/ai/mcpBridge";
import { AI_TAB_PATH, isVirtualPath } from "../graph/virtualPaths";

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
}

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
  const { pimRuntime, commentOperations, dbAdapter, indexer, triggerFileTreeUpdate } = useVault();
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
    });
    hostRef.current = host;
    void session.attachVault(host);
  }, [session, vaultPath, vaultAdapter, queryService, commands]);

  // The MCP server (plan §17.3): the native side forwards calls here; only
  // the main window has a session, so only it answers.
  useEffect(() => {
    if (!session) return;
    return listenForMcpCalls(() => hostRef.current);
  }, [session]);
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
