import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LocalEmbeddings, LocalGists } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import i18n from "@plainva/ui/i18n";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  createAudioTranscriber,
  getPlatformServices,
  noteDisplayName,
  resolveAudioPath,
  setAudioTranscriber,
  situationEvents,
  startableSkills,
  useStableHandler,
  type AiNavigationCommand,
  type AiSession,
  type AiState,
  type AiVaultHost,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
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
  /** Named navigation targets of the shell; absent ones are not offered. */
  navigation: Partial<Record<"graph" | "tasks" | "calendar" | "journal" | "mail" | "comments" | "leftSidebar" | "rightSidebar", () => void>>;
  /** The vault's search by meaning (plan P2b): the context package ranks with it. */
  embeddings?: LocalEmbeddings | null;
  /** The vault's gists (plan P2b-3): the context package sends them for its cards. */
  gists?: LocalGists | null;
}

const NAVIGATION_LABELS: Record<keyof DesktopAiInput["navigation"], [id: string, label: string]> = {
  graph: ["open-graph", "Open the graph view"],
  tasks: ["open-tasks", "Open the task list"],
  calendar: ["open-calendar", "Open the calendar"],
  journal: ["open-journal", "Open the journal"],
  mail: ["open-mail", "Open mail"],
  comments: ["open-comments", "Open the open comments"],
  leftSidebar: ["toggle-left-sidebar", "Show or hide the left sidebar"],
  rightSidebar: ["toggle-right-sidebar", "Show or hide the right sidebar"],
};

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
  const { pimRuntime, commentOperations } = useVault();
  const comments = useRef(commentOperations);
  useLayoutEffect(() => {
    comments.current = commentOperations;
  });
  const pim = useRef(pimRuntime);
  useLayoutEffect(() => {
    pim.current = pimRuntime;
  });

  const commands = useStableHandler((): AiNavigationCommand[] => {
    const nav = latest.current.navigation;
    const list: AiNavigationCommand[] = [];
    for (const [key, [id, label]] of Object.entries(NAVIGATION_LABELS) as Array<[keyof DesktopAiInput["navigation"], [string, string]]>) {
      const run = nav[key];
      if (run) list.push({ id, label, run: () => (run(), true) });
    }
    list.push({
      id: "open-note",
      label: "Open a note; args: { path: vault-relative path }",
      run: async (args) => {
        const path = typeof args?.path === "string" ? args.path : "";
        const query = latest.current.queryService;
        // Only a note that exists: opening an unknown path would make a new tab of it.
        const resolved = path && query ? await query.resolveNotePath(path) : null;
        if (!resolved) return false;
        latest.current.openNote(resolved);
        return true;
      },
    });
    return list;
  });

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
      commentOperations: () => comments.current,
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
  /** A link in an answer is untrusted: it opens only after the reader saw where it goes. */
  const openUrl = useStableHandler((url: string) => {
    void appConfirm({ title: i18n.t("ai.openLinkTitle"), message: url, confirmLabel: i18n.t("ai.openLink") }).then((ok) => {
      if (ok) void getPlatformServices().openExternal(url);
    });
  });

  const activePath = input.activePath;
  const activeNote = useMemo(
    () => (activePath && !isVirtualPath(activePath) && /\.md$/i.test(activePath) ? { path: activePath, title: noteDisplayName(activePath) } : null),
    [activePath],
  );

  return { session, enabled, companionOpen, openCompanion, closeCompanion, toggleCompanion, runSkill, skills, openAsTab, openNoteTarget, openUrl, activeNote };
}
