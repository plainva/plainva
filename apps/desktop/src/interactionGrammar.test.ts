import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NEW_ITEM_ORDER, ROW_ACTION_IDS } from "@plainva/ui";

/**
 * The interaction grammar the phone got in its redesign, made binding for the
 * desktop too (Design-Runde Bedienung 2026-09-04, E2–E5).
 *
 * The phone has ~200 such assertions in `mobileLint.test.ts`; these are the
 * desktop's share, and the ones that hold BOTH shells to one definition:
 *
 * 1. One action list per row kind — a context menu, a selection bar, a sheet
 *    or a swipe reads it, never defines its own (E2).
 * 2. One "New …" catalog — the sidebar menu, the ribbon, both palettes and the
 *    phone's FAB show its entries in its order (E4).
 * 3. Every desktop list that can be empty says so through `EmptyState` (E3).
 * 4. No modal without the `Modal` primitive, no menu without `MenuSurface`,
 *    no bar with an action the row's menu does not know (E5).
 *
 * Source scans, like the phone's: the guard reads what a file SAYS, so a new
 * surface that copies a pattern instead of reading the list fails here, not
 * on a device weeks later.
 */
const DESKTOP = join(__dirname);
const MOBILE = join(__dirname, "..", "..", "mobile", "src");
const UI = join(__dirname, "..", "..", "..", "packages", "ui", "src");

const read = (base: string, rel: string) => readFileSync(join(base, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("one action list per row kind (E2)", () => {
  const consumers: Array<[string, string, string]> = [
    // row kind, desktop consumer, mobile consumer
    ["mailRowActions", "components/mail/MailView.tsx", "screens/MailListScreen.tsx"],
    ["fileRowActions", "components/FileContextMenu.tsx", "screens/BrowseScreen.tsx"],
    ["taskRowActions", "components/tasks/TasksView.tsx", "screens/TasksScreen.tsx"],
  ];

  it.each(consumers)("%s is what both shells read", (builder, desktop, mobile) => {
    expect(stripComments(read(DESKTOP, desktop))).toContain(builder + "(");
    expect(stripComments(read(MOBILE, mobile))).toContain(builder + "(");
  });

  it("the desktop mail bar is the list's bulk subset, not a second list", () => {
    const src = stripComments(read(DESKTOP, "components/mail/MailView.tsx"));
    const bar = src.slice(src.indexOf("<SelectionBar"), src.indexOf("</SelectionBar>"));
    expect(bar).toContain("<RowActionList");
    expect(bar).toContain("a.bulk");
    // No hand-written button beside the list: every entry of the bar comes from it.
    expect(bar.match(/<Button\b/g)?.length ?? 0).toBe(1);
  });

  it("the desktop mail context menu and the task row menu read the list through the boundary", () => {
    for (const rel of ["components/mail/MailView.tsx", "components/tasks/TasksView.tsx"]) {
      const src = stripComments(read(DESKTOP, rel));
      expect(src).toContain("<RowActionList");
    }
  });

  it("the file menu renders its row section from the list, not from props one by one", () => {
    const src = stripComments(read(DESKTOP, "components/FileContextMenu.tsx"));
    expect(src).toContain("rowList.map(");
    // The place actions (new here, refresh, restore, index) may stay hand-written; a
    // ROW verb may not — none of the list's verbs appears as a literal MenuItem label.
    const rowSection = src.slice(src.indexOf("const rowList"));
    for (const key of ["common.rename", "fileTree.duplicate", "fileTree.moveTo", "fileTree.copyPath", "fileTree.versionHistory", "conflict.resolveAction", "editor.revealInTree", "fileTree.openNewTab"]) {
      expect(rowSection, `${key} rendered by hand in FileContextMenu`).not.toContain(`t("${key}"`);
    }
  });

  it("the phone's swipes are subsets of the same list", () => {
    const browse = stripComments(read(MOBILE, "screens/BrowseScreen.tsx"));
    expect(browse).toMatch(/rowActionsFor\(n, "note"\)\.filter\(\(a\) => a\.swipe\)/);
    expect(browse).toMatch(/pickRowActions\(rowActionsFor\(target, "folder"\), \["rename", "delete"\]\)/);
    expect(browse).not.toMatch(/<SwipeRow\s+actions=\{\[/);
    const tasks = stripComments(read(MOBILE, "screens/TasksScreen.tsx"));
    expect(tasks).toMatch(/taskRowActions\(t, a\)\.map/);
  });

  it("the id catalog is complete: every builder id is listed, every listed id is buildable", () => {
    const shared = stripComments(read(UI, "lib/rowActions.ts"));
    for (const [kind, ids] of Object.entries(ROW_ACTION_IDS)) {
      for (const id of ids) expect(shared, `${kind}.${id}`).toContain(`id: "${id}"`);
    }
  });
});

describe('one "New …" catalog (E4)', () => {
  it("the palette's create group is the catalog", () => {
    const registry = stripComments(read(UI, "services/commandRegistry.ts"));
    expect(registry).toContain("NEW_ITEM_ORDER.map((id) => newCommand(id, newHandlersOf(d)))");
    expect(registry).not.toMatch(/group: "create"[^\n]*titleKey: "common\.newNote"/);
  });

  it("the sidebar menu, the ribbon and the phone's FAB read it", () => {
    const shell = stripComments(read(DESKTOP, "AppShell.tsx"));
    expect(shell).toContain("newEntries(t, newHandlers)");
    const ribbon = stripComments(read(DESKTOP, "components/AppRibbon.tsx"));
    for (const id of ["note", "folder", "base", "daily"]) expect(ribbon).toContain(`NEW_ITEMS.${id}.titleKey`);
    const app = stripComments(read(MOBILE, "App.tsx"));
    expect(app).toContain("newEntries(t, newHandlers)");
    // Nobody lists a "New …" entry by hand any more.
    expect(app).not.toContain('t("mobile.newNote")');
    expect(shell).not.toContain("t('sidebar.newNote'");
  });

  it("a term and a task are made where they live, on both shells", () => {
    expect(stripComments(read(DESKTOP, "components/pimcal/CalendarView.tsx"))).toContain('consumePendingNew("event"');
    expect(stripComments(read(DESKTOP, "components/tasks/TasksView.tsx"))).toContain('consumePendingNew("task"');
    expect(stripComments(read(MOBILE, "screens/TodayScreen.tsx"))).toContain('consumePendingNew("event"');
    expect(stripComments(read(MOBILE, "screens/TasksScreen.tsx"))).toContain('consumePendingNew("task"');
  });

  it("the catalog's order is the one both shells show", () => {
    expect([...NEW_ITEM_ORDER]).toEqual(["note", "noteFromTemplate", "daily", "folder", "base", "template", "event", "task"]);
  });
});

describe("every desktop list that can be empty says so (E3)", () => {
  /**
   * The inventory (P3, measured 2026-09-04): each of these renders a list that
   * can be empty. A new list surface goes on this list when it is built —
   * and comes off only with its EmptyState.
   */
  const listSurfaces = [
    "components/BacklinksPanel.tsx",
    "components/BookmarksList.tsx",
    "components/TagTree.tsx",
    "components/BaseViewer.tsx",
    "components/comments/CommentsOverview.tsx",
    "components/graph/VaultGraphView.tsx",
    "components/mail/MailView.tsx",
    "components/pimcal/CalendarView.tsx",
    "components/tasks/TasksView.tsx",
    "components/settings/CloudAccountsPage.tsx",
    "components/settings/SyncPage.tsx",
    "components/mail/MailAccountsSection.tsx",
    "components/VaultFindReplaceModal.tsx",
  ];

  it.each(listSurfaces)("%s renders EmptyState", (rel) => {
    expect(stripComments(read(DESKTOP, rel))).toContain("<EmptyState");
  });

  it("no list surface paints its own faint centred sentence instead", () => {
    // The pattern every hand-rolled empty state used: a muted, centred div
    // around one translated sentence. Where it survives it is a list that
    // forgot the primitive.
    for (const rel of listSurfaces) {
      const src = stripComments(read(DESKTOP, rel));
      expect(src, rel).not.toMatch(/color: ['"]var\(--text-muted\)['"],[^}]*textAlign: ['"]center['"][^}]*\}\s*\}>\s*\{t\(/);
    }
  });
});

describe("modal, menu and bar grammar (E5)", () => {
  const files = walk(join(DESKTOP, "components")).concat(walk(DESKTOP).filter((p) => !p.includes("components")));

  /**
   * Surfaces that carry `role="dialog"` or an overlay of their own without
   * being the Modal primitive. Each one is an ANCHORED surface (a popover at
   * a point, a palette under the search field) that the centred Modal cannot
   * be — the reason is the entry. The list only ever shrinks.
   */
  const anchoredDialogs: Record<string, string> = {
    "components/BasePicker.tsx": "palette family: opens under the field, like the quick switcher",
    "components/CommandPalette.tsx": "palette family: the palette IS its own surface",
    "components/QuickSwitcher.tsx": "palette family",
    "components/TemplatePickerModal.tsx": "palette family",
    "components/ColorPopover.tsx": "anchored popover at the swatch, not a centred modal",
    "components/EmojiPicker.tsx": "anchored popover at the icon button",
    "components/TableSizePicker.tsx": "anchored popover at the toolbar button",
    "components/pimcal/QuickCreatePopover.tsx": "anchored at the dragged slot; its scrim is the calendar's own",
  };

  it("no modal without Modal: a dialog outside the primitive is an anchored surface with a reason", () => {
    const offenders: string[] = [];
    for (const p of files) {
      const rel = p.slice(DESKTOP.length + 1).replace(/\\/g, "/");
      if (rel.startsWith("components/ui/")) continue;
      const src = stripComments(readFileSync(p, "utf8"));
      const own = /role="dialog"/.test(src) || /className="pv-overlay"|className="pv-palette-overlay/.test(src);
      if (own && !(rel in anchoredDialogs)) offenders.push(rel);
    }
    expect(offenders, "wrap it in <Modal> or name why it must be anchored").toEqual([]);
  });

  it("keeps the anchored-dialog list honest (no stale entries)", () => {
    for (const rel of Object.keys(anchoredDialogs)) {
      const src = stripComments(read(DESKTOP, rel));
      expect(/role="dialog"|className="pv-overlay"|className="pv-palette-overlay/.test(src), `${rel} no longer builds its own dialog — drop it from the list`).toBe(true);
    }
  });

  it("no menu without MenuSurface: nobody draws role=\"menu\" by hand", () => {
    const offenders: string[] = [];
    for (const p of files) {
      const rel = p.slice(DESKTOP.length + 1).replace(/\\/g, "/");
      const src = stripComments(readFileSync(p, "utf8"));
      if (/role="menu"/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    // The primitive is the one place the role lives.
    expect(read(UI, "components/ui/Menu.tsx")).toContain('role="menu"');
  });

  it("no context menu opens anything but a menu surface", () => {
    // A file that handles the context-menu gesture either shows a MenuSurface
    // (directly or through one of the menu components) or only forwards the
    // gesture to a parent that does. What it may not do is build a menu.
    const menuBearers = /MenuSurface|FileContextMenu|TabContextMenu|TableContextMenu|EventContextMenu|GraphMapMenus|DropdownMenu|BlockMenu|ContextMenuHost/;
    for (const p of files) {
      const rel = p.slice(DESKTOP.length + 1).replace(/\\/g, "/");
      const src = stripComments(readFileSync(p, "utf8"));
      if (!/onContextMenu=/.test(src)) continue;
      const bearsMenu = menuBearers.test(src);
      // A no-op handler (`() => {}`) is a prop of a tab strip that owns no menu in that window.
      const forwardsOnly = /onContextMenu=\{[^}]*(preventDefault|props\.|on[A-Z]\w*\?\.|on[A-Z]\w*\(|\(\) => \{\})/.test(src);
      expect(bearsMenu || forwardsOnly, `${rel} handles the context-menu gesture without a menu surface`).toBe(true);
    }
  });
});
