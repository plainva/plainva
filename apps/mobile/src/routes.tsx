import type { ReactNode } from "react";
import type { MobileVault } from "./services/vaultService";
import type { NavEntry, NavKind, NavState, TabScreenId } from "./navigation";
import type { AppCommand, AreaOrder } from "@plainva/ui";
import { BaseScreen } from "./screens/base/BaseScreen";
import { BookmarksScreen } from "./BookmarksScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { NavigatorScreen } from "./screens/NavigatorScreen";
import { AddVaultScreen } from "./AddVaultScreen";
import { AppearanceScreen } from "./screens/AppearanceScreen";
import { CleanupScreen } from "./screens/CleanupScreen";
import { CloudAccountsScreen } from "./screens/CloudAccountsScreen";
import { CloudConnectScreen } from "./screens/CloudConnectScreen";
import { DatabasesScreen } from "./screens/DatabasesScreen";
import { GraphScreen } from "./screens/GraphScreen";
import { MailAccountsScreen } from "./screens/MailAccountsScreen";
import { MailComposeScreen } from "./screens/MailComposeScreen";
import { MailListScreen } from "./screens/MailListScreen";
import { MailMessageScreen } from "./screens/MailMessageScreen";
import { NavBarScreen } from "./screens/NavBarScreen";
import { BehaviorAreaScreen } from "./screens/BehaviorAreaScreen";
import { MaintenanceAreaScreen } from "./screens/MaintenanceAreaScreen";
import { ImportWizardScreen } from "./screens/ImportWizardScreen";
import { NoteScreen } from "./screens/NoteScreen";
import { PimAccountsScreen } from "./screens/PimAccountsScreen";
import { PimCalendarScreen } from "./screens/PimCalendarScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
import { TagsScreen } from "./TagsScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { VaultDetailScreen } from "./VaultDetailScreen";
import { VaultsScreen } from "./screens/VaultsScreen";
import { AboutAreaScreen, BackupAreaScreen, ContentAreaScreen, EditorAreaScreen } from "./screens/SettingsAreaScreens";
import { SecurityAreaScreen } from "./screens/SecurityAreaScreen";
import { SecurityWizardScreen, type SecurityWizardFlow } from "./screens/SecurityWizardScreen";
import { parseDraft, parseMailRef } from "./screens/mail/mailNavRefs";

/**
 * The route table (redesign P2 / S8).
 *
 * This was a 210-line chain of nested ternaries in App.tsx — 25 `top.kind`
 * tests followed by 9 `activeTab` tests, ending in a fallback. Two things were
 * wrong with that shape, and only one of them was length:
 *
 *  - Nothing forced a branch to EXIST. The tasks tab had none, so it fell
 *    through to the databases branch and the Aufgaben tab showed the database
 *    list under the title "Aufgaben" (P0 defect, fixed in S1). A test caught it
 *    after the fact; the shape could not.
 *  - A route's props sat 200 lines from the route's name, and both grew.
 *
 * Both tables below are exhaustive `Record`s over their union, so a new
 * NavKind or a tenth tab area does not compile until it has a screen. The
 * fallthrough is gone as a possibility, not merely as a bug.
 *
 * Everything a screen needs arrives in ONE context object. That is deliberate:
 * the alternative — threading fifteen props through a render helper — is the
 * same chain with extra steps.
 */

/** What the shell hands to a route. Screens stay unaware of the shell. */
export interface RouteContext {
  vault: MobileVault;
  vaultName: string;
  /** Index generation; screens re-query when it changes. */
  bump: number;
  push: (entry: NavEntry) => void;
  pop: () => void;
  setNav: (fn: (state: NavState) => NavState) => void;
  openNote: (path: string) => void;
  openBase: (path: string, configOpen?: boolean) => void;
  openDaily: (iso: string) => void;
  createVaultFlow: () => void;
  quickNewDatabase: () => void;
  /** Creates a note in the folder on screen — the empty state's one action. */
  captureNote: () => void;
  /** What this shell can do — the shared registry with mobile deps (S15). */
  commands: AppCommand[];
  /** The navigation bar's arrangement — the shared bar model's fifth bar (S10). */
  barLayout: AreaOrder;
  onBarLayout: (next: AreaOrder) => void;
}

/** A pushed screen: it owns the surface and shows a back affordance. */
type PushedRoute = (entry: NavEntry, ctx: RouteContext) => ReactNode;
/** A tab root: same screen, no back affordance — the tab bar is the way out. */
type TabRoute = (ctx: RouteContext) => ReactNode;

/** Rewrites the top entry's path in place — a rename keeps its stack slot. */
function retargetTop(setNav: RouteContext["setNav"], newPath: string): void {
  setNav((st) => {
    if (st.overlay.length > 0) {
      const next = [...st.overlay];
      next[next.length - 1] = { ...next[next.length - 1], path: newPath };
      return { ...st, overlay: next };
    }
    const stack = st.stacks[st.activeTab];
    if (stack.length === 0) return st;
    const next = [...stack];
    next[next.length - 1] = { ...next[next.length - 1], path: newPath };
    return { ...st, stacks: { ...st.stacks, [st.activeTab]: next } };
  });
}

/** Settings area ids that have a screen of their own rather than a sub-page. */
function settingsAreaScreen(id: string, ctx: RouteContext): ReactNode {
  switch (id) {
    case "editor": return <EditorAreaScreen onBack={ctx.pop} />;
    case "content": return <ContentAreaScreen onBack={ctx.pop} vault={ctx.vault} />;
    case "backup": return <BackupAreaScreen onBack={ctx.pop} />;
    case "behavior": return <BehaviorAreaScreen onBack={ctx.pop} />;
    case "maintenance": return <MaintenanceAreaScreen onBack={ctx.pop} onImport={() => ctx.push({ kind: "importwizard", path: "" })} vault={ctx.vault} />;
    // "Bars & areas" IS the navigation bar on a phone — the fifth bar of the
    // shared layout model. It gets the catalog's area rather than a second,
    // mobile-only settings row (S39).
    case "bars": return <NavBarScreen onBack={ctx.pop} onChange={ctx.onBarLayout} value={ctx.barLayout} />;
    case "security":
      return (
        <SecurityAreaScreen
          onBack={ctx.pop}
          onConnectCloud={() => ctx.push({ kind: "cloudaccounts", path: "" })}
          onSetupWorkspace={() => ctx.push({ kind: "securitywizard", path: "workspace" })}
          vault={ctx.vault}
        />
      );
    case "about": return <AboutAreaScreen onBack={ctx.pop} />;
    // An unknown id is a bug, not a screen. It used to render About, which
    // looked like a working area and hid the typo.
    default: return null;
  }
}

export const PUSHED_ROUTES: Record<NavKind, PushedRoute> = {
  tags: (e, c) => (
    <TagsScreen
      bump={c.bump}
      key={e.path}
      onBack={c.pop}
      onOpenNote={c.openNote}
      onOpenTag={(tag) => c.push({ kind: "tags", path: tag })}
      tag={e.path}
      vault={c.vault}
    />
  ),
  bookmarks: (_e, c) => <BookmarksScreen bump={c.bump} onBack={c.pop} onOpenNote={c.openNote} vault={c.vault} />,
  settings: (_e, c) => (
    <SettingsScreen
      onBack={c.pop}
      onOpenArea={(id) =>
        id === "appearance"
          ? c.push({ kind: "appearance", path: "" })
          : id === "cloudAccounts"
            ? c.push({ kind: "cloudaccounts", path: "" })
            : id === "sync"
              ? c.push({ kind: "vault", path: c.vault.vaultId })
              : id === "pim"
                ? c.push({ kind: "pimaccounts", path: "" })
                : id === "mail"
                  ? c.push({ kind: "mailaccounts", path: "" })
                  : c.push({ kind: "settingsArea", path: id })
      }
      barCount={c.barLayout.visibleCount}
      onOpenVaults={() => c.push({ kind: "vaults", path: "" })}
    />
  ),
  settingsArea: (e, c) => settingsAreaScreen(e.path, c),
  importwizard: (_e, c) => <ImportWizardScreen onBack={c.pop} vault={c.vault} />,
  vaults: (_e, c) => (
    <VaultsScreen
      activeVaultId={c.vault.vaultId}
      onBack={c.pop}
      onCreateVault={c.createVaultFlow}
      onOpenCloudAccounts={() => c.push({ kind: "cloudaccounts", path: "" })}
      onOpenVault={(id) => c.push({ kind: "vault", path: id })}
    />
  ),
  cloudaccounts: (_e, c) => (
    <CloudAccountsScreen
      onBack={c.pop}
      onConnect={() => c.push({ kind: "cloudconnect", path: "" })}
      onOpenCalendarAccounts={() => c.push({ kind: "pimaccounts", path: "" })}
      onOpenMailAccounts={() => c.push({ kind: "mailaccounts", path: "" })}
      onOpenVault={(id) => c.push({ kind: "vault", path: id })}
    />
  ),
  cloudconnect: (_e, c) => (
    <CloudConnectScreen
      onBack={c.pop}
      onPickService={(service) =>
        c.push({
          kind: service === "files" ? "sync" : service === "calendar" ? "pimaccounts" : "mailaccounts",
          path: "",
        })
      }
    />
  ),
  sync: (e, c) => <AddVaultScreen createTemplateId={e.createTemplateId} onBack={c.pop} vault={c.vault} />,
  vault: (e, c) => (
    <VaultDetailScreen
      activeVault={c.vault}
      onBack={c.pop}
      onSetupEncryption={() => c.push({ kind: "securitywizard", path: "encryption" })}
      vaultId={e.path}
    />
  ),
  base: (e, c) => (
    <BaseScreen
      initialConfigOpen={e.configOpen}
      key={e.path}
      onBack={c.pop}
      onOpenNote={c.openNote}
      path={e.path}
      vault={c.vault}
    />
  ),
  note: (e, c) => (
    <NoteScreen
      key={e.path}
      onBack={c.pop}
      onComposeMail={(d) =>
        c.push({ kind: "mailcompose", path: JSON.stringify({ accountId: "", to: "", subject: d.subject, body: d.body }) })
      }
      onOpenNote={c.openNote}
      onRenamed={(newPath) => retargetTop(c.setNav, newPath)}
      path={e.path}
      vault={c.vault}
    />
  ),
  appearance: (_e, c) => <AppearanceScreen onBack={c.pop} />,
  search: (_e, c) => <SearchScreen commands={c.commands} onBack={c.pop} onOpenNote={c.openNote} vault={c.vault} />,
  more: (_e, c) => (
    <NavBarScreen onBack={c.pop} onChange={c.onBarLayout} value={c.barLayout} />
  ),
  today: (_e, c) => (
    <TodayScreen bump={c.bump} onBack={c.pop} onOpenDate={c.openDaily} onOpenNote={c.openNote} vault={c.vault} />
  ),
  pimcalendar: (_e, c) => (
    <PimCalendarScreen
      bump={c.bump}
      onBack={c.pop}
      onOpenNote={c.openNote}
      onOpenSettings={() => c.push({ kind: "pimaccounts", path: "" })}
    />
  ),
  pimaccounts: (_e, c) => <PimAccountsScreen bump={c.bump} onBack={c.pop} />,
  mail: (_e, c) => (
    <MailListScreen
      vault={c.vault}
      bump={c.bump}
      onBack={c.pop}
      onOpenMessage={(a, m, id, f) => c.push({ kind: "mailmsg", path: JSON.stringify({ a, m, id, f }) })}
      onOpenAccounts={() => c.push({ kind: "mailaccounts", path: "" })}
      onCompose={(accountId) =>
        c.push({ kind: "mailcompose", path: JSON.stringify({ accountId, to: "", subject: "", body: "" }) })
      }
    />
  ),
  mailmsg: (e, c) => (
    <MailMessageScreen
      vault={c.vault}
      {...parseMailRef(e.path)}
      onBack={c.pop}
      onOpenNote={c.openNote}
      onReply={(d) => c.push({ kind: "mailcompose", path: JSON.stringify(d) })}
    />
  ),
  mailcompose: (e, c) => <MailComposeScreen draft={parseDraft(e.path)} onBack={c.pop} vault={c.vault} />,
  mailaccounts: (_e, c) => <MailAccountsScreen bump={c.bump} onBack={c.pop} />,
  tasks: (_e, c) => (
    <TasksScreen bump={c.bump} onBack={c.pop} onOpenBase={c.openBase} onOpenNote={c.openNote} vault={c.vault} />
  ),
  databases: (_e, c) => (
    <DatabasesScreen
      bump={c.bump}
      onBack={c.pop}
      onCreate={c.quickNewDatabase}
      onOpenBase={c.openBase}
      vault={c.vault}
    />
  ),
  graphmap: (_e, c) => (
    <GraphScreen
      bump={c.bump}
      onBack={c.pop}
      onCleanup={() => c.push({ kind: "cleanup", path: "" })}
      onOpenNote={c.openNote}
      vault={c.vault}
    />
  ),
  cleanup: (_e, c) => <CleanupScreen onBack={c.pop} onOpenNote={c.openNote} vault={c.vault} />,
  // The security wizards are a DESTINATION (S37), not a state inside the
  // security area and not a sheet: the bar is hidden here, and Back — which
  // the leave guard intercepts — is the only way out of a prepared key.
  securitywizard: (e, c) => (
    <SecurityWizardScreen
      flow={(e.path || "workspace") as SecurityWizardFlow}
      onBack={c.pop}
      onDone={c.pop}
      vault={c.vault}
    />
  ),
  folder: (e, c) => (
    <BrowseScreen
      bump={c.bump}
      folder={e.path}
      onBack={c.pop}
      onOpenBase={c.openBase}
      onCreateNote={c.captureNote}
      onOpenFolder={(path) => c.push({ kind: "folder", path })}
      onOpenNote={c.openNote}
      vault={c.vault}
    />
  ),
  // "areas" is a sheet, not a screen: it opens over whatever is showing and the
  // shell renders it outside the route area. It stays in NavKind because the
  // back gesture must be able to close it.
  areas: () => null,
};

export const TAB_ROUTES: Record<TabScreenId, TabRoute> = {
  // The "notes" tab is the NAVIGATOR: the desktop's left sidebar folded into
  // one root — pinned Recent/Bookmarks above, the Files/Tags/Databases tabs
  // below (S9).
  notes: (c) => (
    <NavigatorScreen
      bump={c.bump}
      onCreateDatabase={c.quickNewDatabase}
      onSearch={() => c.push({ kind: "search", path: "" })}
      onOpenBase={c.openBase}
      onOpenFolder={(path) => c.push({ kind: "folder", path })}
      onOpenNote={c.openNote}
      onOpenSettings={() => c.push({ kind: "settings", path: "" })}
      onOpenTag={(tag) => c.push({ kind: "tags", path: tag })}
      vault={c.vault}
      vaultName={c.vaultName}
    />
  ),
  today: (c) => (
    <TodayScreen
      bump={c.bump}
      onOpenDate={c.openDaily}
      onOpenNote={c.openNote}
      onSearch={() => c.push({ kind: "search", path: "" })}
      vault={c.vault}
    />
  ),
  calendar: (c) => (
    <PimCalendarScreen
      bump={c.bump}
      onOpenNote={c.openNote}
      onOpenSettings={() => c.push({ kind: "pimaccounts", path: "" })}
      onSearch={() => c.push({ kind: "search", path: "" })}
    />
  ),
  mail: (c) => (
    <MailListScreen
      vault={c.vault}
      bump={c.bump}
      onOpenMessage={(acc, mb, id, f) => c.push({ kind: "mailmsg", path: JSON.stringify({ a: acc, m: mb, id, f }) })}
      onOpenAccounts={() => c.push({ kind: "mailaccounts", path: "" })}
      onCompose={(accountId) =>
        c.push({ kind: "mailcompose", path: JSON.stringify({ accountId, to: "", subject: "", body: "" }) })
      }
    />
  ),
  graph: (c) => (
    <GraphScreen
      bump={c.bump}
      onCleanup={() => c.push({ kind: "cleanup", path: "" })}
      onOpenNote={c.openNote}
      vault={c.vault}
    />
  ),
  tasks: (c) => <TasksScreen bump={c.bump} onOpenBase={c.openBase} onOpenNote={c.openNote} vault={c.vault} />,
};

/** Renders whatever the navigation state points at. */
export function renderRoute(top: NavEntry | undefined, activeTab: TabScreenId, ctx: RouteContext): ReactNode {
  return top ? PUSHED_ROUTES[top.kind](top, ctx) : TAB_ROUTES[activeTab](ctx);
}
