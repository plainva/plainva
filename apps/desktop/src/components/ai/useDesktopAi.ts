import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import i18n from "@plainva/ui/i18n";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { getPlatformServices, noteDisplayName, situationEvents, useStableHandler, type AiNavigationCommand, type AiSession, type AiState } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { createDesktopVaultHost, getDesktopAiSession } from "../../services/ai/desktopAi";
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
  // Appointments come from the PIM cache of the open vault, when it has one.
  const { pimRuntime } = useVault();
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
  useEffect(() => {
    if (!session) return;
    if (!vaultPath || !vaultAdapter || !queryService) {
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
    });
    void session.attachVault(host);
  }, [session, vaultPath, vaultAdapter, queryService, commands]);

  // Switching the AI off closes the companion; the conversation stays stored.
  useEffect(() => {
    if (!enabled) setCompanionOpen(false);
  }, [enabled]);

  const openCompanion = useStableHandler(() => {
    session?.present("window");
    setCompanionOpen(true);
  });
  const closeCompanion = useStableHandler(() => setCompanionOpen(false));
  const toggleCompanion = useStableHandler(() => (companionOpen ? closeCompanion() : openCompanion()));
  const openAsTab = useStableHandler(() => {
    setCompanionOpen(false);
    session?.present("tab");
    latest.current.openView(AI_TAB_PATH);
  });
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

  return { session, enabled, companionOpen, openCompanion, closeCompanion, toggleCompanion, openAsTab, openNoteTarget, openUrl, activeNote };
}
