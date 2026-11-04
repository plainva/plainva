import { describe, expect, it } from "vitest";
import { NEW_ITEM_ORDER, ROW_ACTION_IDS } from "@plainva/ui";
import { sourceFile, sourceTexts } from "./test-sourceTree";

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
const DESKTOP = "apps/desktop/src";
const MOBILE = "apps/mobile/src";
const UI = "packages/ui/src";

// Each file is read once, however many checks look at it, and the desktop's
// components come from the scan guards' shared snapshot (test-sourceTree.ts):
// three checks used to walk and read all of them again (Befunde 2026-09-24, Z2).
const read = (base: string, rel: string) => sourceFile(`${base}/${rel}`);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

let surfaces: Array<{ rel: string; src: string }> | undefined;
/** Every shipped .tsx of the desktop, relative to its src, comments stripped. */
function desktopSurfaces(): Array<{ rel: string; src: string }> {
  surfaces ??= sourceTexts([DESKTOP], "shipped")
    .filter((f) => f.rel.endsWith(".tsx"))
    .map((f) => ({ rel: f.rel.slice(DESKTOP.length + 1), src: stripComments(f.text) }));
  return surfaces;
}

describe("one action list per row kind (E2)", () => {
  const consumers: Array<[string, string, string]> = [
    // row kind, desktop consumer, mobile consumer
    ["mailRowActions", "components/mail/MailView.tsx", "screens/MailListScreen.tsx"],
    ["fileRowActions", "components/FileContextMenu.tsx", "lib/useFileRowSheet.tsx"],
    ["taskRowActions", "components/tasks/TasksView.tsx", "components/useTaskRowActions.tsx"],
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
    // One swipe definition for every list of vault rows (plan Rückmeldungen
    // 2026-10-24, E8): the file list, Recent and Bookmarks all call `swipeFor`.
    const rows = stripComments(read(MOBILE, "lib/useFileRowSheet.tsx"));
    expect(rows).toMatch(/rowActionsFor\(target, kind\)\.filter\(\(a\) => a\.swipe\)/);
    expect(rows).toMatch(/pickRowActions\(rowActionsFor\(target, "folder"\), \["rename", "delete"\]\)/);
    for (const rel of ["screens/BrowseScreen.tsx", "screens/RecentScreen.tsx", "BookmarksScreen.tsx"]) {
      const src = stripComments(read(MOBILE, rel));
      expect(src, rel).not.toMatch(/<SwipeRow\s+actions=\{\[/);
      expect(src, rel).toContain("swipeFor(");
    }
    // Every task list of the phone reads the one task-row hook (E1).
    const tasks = stripComments(read(MOBILE, "components/useTaskRowActions.tsx"));
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
    // `journal` stands next to `daily` — it is a line in that note, not a file
    // of its own (plan Journal, J4) — and since 2026-09-22 in front of it:
    // writing a line is reached for more often than opening the day's note,
    // and a task more often than an appointment (E12).
    expect([...NEW_ITEM_ORDER]).toEqual(["note", "journal", "daily", "noteFromTemplate", "folder", "base", "template", "task", "event"]);
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
    // Added 2026-09-22: both were hand-built empty states the guard could
    // not see, which is exactly the gap that let them stay hand-built.
    "AppShell.tsx",
    "components/FileTree.tsx",
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
    for (const { rel, src } of desktopSurfaces()) {
      if (rel.startsWith("components/ui/")) continue;
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

  /**
   * `pv-menu` as a class a file DRAWS: not one of the row classes
   * (`pv-menu-item`), and not a selector the document is asked with
   * (`.pv-menu[role="menu"]` — the floating window and the modal look for an
   * open menu that way, which is no menu of their own).
   */
  const DRAWS_MENU = /(?<![\w.-])pv-menu(?![\w-])/;
  /** The role as an attribute a file sets, not inside such a selector. */
  const SETS_MENU_ROLE = /(?<!\[)role="menu"/;
  const MENU_PRIMITIVE = `${UI}/components/ui/Menu.tsx`;

  it("no menu without MenuSurface: nobody draws the role or the surface by hand", () => {
    // The role alone was not enough to look for. The two menus that were still
    // drawn by hand on 2026-10-09 — the vault menu at the foot of the sidebar,
    // the ⋮ menu of a database — wore the surface's class WITHOUT the role, so
    // this check passed them by: they had the look and none of the contract,
    // no Escape, and for one of them no way out but its own button. Both
    // shells and the shared package are read; only the primitive may draw it.
    const offenders: string[] = [];
    for (const { rel, text } of sourceTexts([DESKTOP, MOBILE, UI], "shipped")) {
      if (rel === MENU_PRIMITIVE) continue;
      const src = stripComments(text);
      if (SETS_MENU_ROLE.test(src) || DRAWS_MENU.test(src)) offenders.push(rel);
    }
    expect(offenders, "a menu is <MenuSurface> — Escape, the press beside it and its layer come from there").toEqual([]);
    // The primitive is the one place the role and the surface live.
    const primitive = stripComments(sourceFile(MENU_PRIMITIVE));
    expect(primitive).toMatch(SETS_MENU_ROLE);
    expect(primitive).toMatch(DRAWS_MENU);
  });

  it("the menu rule sees a hand-drawn surface in every spelling it takes, and nothing else", () => {
    for (const drawn of [
      '<div className="pv-menu" style={{ position: "absolute" }}>',
      "<div className='pv-menu base-thing'>",
      '<div className={cx("pv-menu", className)}>',
      "<div className={`pv-menu ${open ? \"is-open\" : \"\"}`}>",
      '<div className="base-thing pv-menu">',
    ]) expect(drawn, drawn).toMatch(DRAWS_MENU);
    expect('<div role="menu" aria-label="Actions">').toMatch(SETS_MENU_ROLE);
    for (const fine of [
      '<button className="pv-menu-item">',
      '<div className="pv-menu-sep" role="separator" />',
      `document.querySelector('.pv-menu[role="menu"]')`,
      'const TAKES_ESCAPE = \'.pv-modal, .pv-menu[role="menu"], .pv-palette-overlay\';',
      '<div className="pv-menubar">',
    ]) {
      expect(fine, fine).not.toMatch(DRAWS_MENU);
      expect(fine, fine).not.toMatch(SETS_MENU_ROLE);
    }
  });

  /** Every rule of the shells' and the shared stylesheets, themes aside: [file, selector, declarations]. */
  const styleRules = (): Array<[string, string, string]> =>
    sourceTexts([DESKTOP, MOBILE, UI], "css")
      // A theme's decoration is not in the way of a press (pointer-events: none).
      .filter(({ rel }) => !rel.startsWith(`${UI}/themes/`))
      .flatMap(({ rel, text }) =>
        [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
          ([, selector, body]): [string, string, string] => [rel, selector.trim(), body],
        ),
      );
  const DRAWS_CATCHER = /(?<![\w.-])pv-click-catch(?![\w-])/;
  const CATCHER_PRIMITIVE = `${UI}/components/ui/ClickCatch.tsx`;

  it("a press beside a surface is heard at the window; the one catcher class has the menus' layer and one place that draws it", () => {
    // A menu and a popover that let the press through hear it at the window
    // (`useOutsidePress`) and lay nothing over the page. A database's menus
    // laid an element of their own over it, on the popover layer, and one
    // popover used the shared catcher class without any layer: both lay under
    // a floating window, and a press into a note preview never reached them.
    //
    // Where the press is meant to go nowhere else — the dialog-like popovers —
    // an element may catch it: the class below, with the menus' layer in the
    // class itself. A stylesheet cannot say more than that. A layer counts
    // only inside its own stacking context (a database embedded in a note
    // sits in the editor's), so the class is drawn by ONE primitive, which
    // also hears the press the catcher does not get — and no call site can
    // draw a catcher without that, or give it a layer of its own.
    // (The calendar's quick-create card keeps a scrim of its own on the
    // dialogs' layer; it is listed among the anchored dialogs above.) The
    // phone has neither: its sheets dim the page, and nothing floats over them.
    const catchers = styleRules()
      .filter(([, , body]) => /position:\s*fixed/.test(body) && /inset:\s*0\b/.test(body) && !/background|backdrop-filter/.test(body))
      .map(([, selector, body]) => `${selector} { z-index: ${/z-index:\s*([^;}]+)/.exec(body)?.[1].trim() ?? "none"} }`);
    expect(catchers).toEqual([".pv-click-catch { z-index: var(--z-menu) }"]);

    const drawnElsewhere: string[] = [];
    for (const { rel, text } of sourceTexts([DESKTOP, MOBILE, UI], "shipped")) {
      if (rel !== CATCHER_PRIMITIVE && DRAWS_CATCHER.test(stripComments(text))) drawnElsewhere.push(rel);
    }
    expect(drawnElsewhere, "use <ClickCatch>: it carries the layer and hears what the catcher does not get").toEqual([]);
    const primitive = stripComments(sourceFile(CATCHER_PRIMITIVE));
    expect(primitive).toMatch(DRAWS_CATCHER);
    expect(primitive).toContain("useOutsidePress(");
    expect(primitive, "the catcher's layer is the class's").not.toMatch(/zIndex|style=/);
  });

  /**
   * A listener for a press at the document or the window, in any spelling a
   * file writes it: the element is the document, the window, or a document
   * reached from an element (`doc`, `ownerDocument`).
   */
  const HEARS_A_PRESS = /\b(?:document|window|doc|ownerDocument)\s*\??\.\s*addEventListener\(\s*["'`](?:mousedown|pointerdown|touchstart)["'`]/;
  /**
   * What listens for a press at the document or the window, and why that is
   * not a surface being left. The list only ever shrinks.
   */
  const listensForAnotherReason: Record<string, string> = {
    [`${UI}/components/ui/useOutsidePress.ts`]: "the primitive itself",
    [`${UI}/components/ui/Menu.tsx`]: "after a press beside it closed the menu: whether that press moved the focus — if not, the menu hands it back",
    [`${UI}/components/ui/Tooltip.tsx`]: "any press hides a tooltip, the one on the element it explains as well",
    [`${UI}/components/anchorRegion.ts`]: "marking a region of a picture is armed; a press elsewhere disarms it (an editor widget, not React)",
    [`${UI}/components/completedTap.ts`]: "a tap counts once its finger is lifted; another pointer coming down cancels it",
    [`${DESKTOP}/services/inputModality.ts`]: "which device is in use, for the focus ring",
    [`${MOBILE}/lib/useEdgeSwipeBack.ts`]: "back from the left edge on iOS: a touch that starts in the edge strip, wherever it lands, belongs to back - a gesture, not a surface",
    [`${DESKTOP}/components/settings/QuickCaptureSettings.tsx`]: "the shortcut recorder: any press ends the recording, as Escape and the window losing the focus do — a mode, not a surface",
  };

  it("a surface hears the press beside it through useOutsidePress; nothing else listens for a press at the document or the window without a reason", () => {
    // Twelve surfaces heard the press beside them by themselves, as a
    // `mousedown` at the document — the select lists, the font field, the
    // property popovers, a database's cell editors, the table size, the date
    // field (Sammelplan § 3.100). A press on a handle that drags — a floating
    // window's head, a column's grip — cancels its `pointerdown`, the browser
    // then sends no `mousedown` at all, and they stayed open beside it; a
    // handler that stopped the event on its way (a table cell of the editor)
    // hid it too. `useOutsidePress` hears it at the window, capturing, as a
    // `pointerdown` — and a finger once its tap is made out. Both shells and
    // the shared package are read.
    const listening: string[] = [];
    for (const { rel, text } of sourceTexts([DESKTOP, MOBILE, UI], "shipped")) {
      if (HEARS_A_PRESS.test(stripComments(text))) listening.push(rel);
    }
    expect(
      listening.filter((rel) => !(rel in listensForAnotherReason)),
      "hear the press beside a surface with useOutsidePress — or name here why the press is listened for",
    ).toEqual([]);
    for (const rel of Object.keys(listensForAnotherReason)) {
      expect(listening, `${rel} no longer listens for a press — drop it from the list`).toContain(rel);
    }
  });

  it("the press rule sees a listener in every spelling it takes, and nothing else", () => {
    for (const heard of [
      'document.addEventListener("mousedown", onDoc);',
      "window.addEventListener('pointerdown', onDown, true);",
      'doc.addEventListener("touchstart", onTouch, { passive: true });',
      "el.ownerDocument.addEventListener(`mousedown`, onDown);",
      'el.ownerDocument?.addEventListener("pointerdown", onDown, true);',
      'document\n      .addEventListener("mousedown", onDown);',
    ]) expect(heard, heard).toMatch(HEARS_A_PRESS);
    for (const fine of [
      'el.addEventListener("mousedown", (e) => e.preventDefault());',
      'document.addEventListener("keydown", onKey);',
      'window.addEventListener("pointerup", done, true);',
      'document.removeEventListener("mousedown", onDoc);',
      'window.addEventListener("click", suppress, { capture: true, once: true });',
    ]) expect(fine, fine).not.toMatch(HEARS_A_PRESS);
  });

  it("what opens menus and popovers is no size container", () => {
    // Menus and popovers are placed by the WINDOW (`position: fixed`). By the
    // first form of the specification `container-type` brought layout
    // containment with it, and an engine that still follows it (WebKit did for
    // longest; the app's floor reaches back to such versions) makes a size
    // container the box its fixed descendants are placed in: they land
    // displaced by the container's own offset, and under the floating windows.
    // A database's head was such a container and held the "New entry" popover
    // from the first release on. It measures its width now (baseHeadWidth.ts),
    // as the sidebars do; what is left are containers that hold no surface of
    // that kind. A new one goes on this list with what it holds.
    const inStylesheets = styleRules()
      .filter(([, , body]) => /(^|[;\s])container(-type)?\s*:/.test(body))
      .map(([rel, selector]) => `${rel}: ${selector}`);
    expect(inStylesheets).toEqual([
      // The band of the suggestion mode: a sentence, a note field and buttons
      // — nothing that opens over the page.
      `${UI}/styles/ui.css: .pv-suggest-band`,
    ]);
    const inMarkup = sourceTexts([DESKTOP, MOBILE, UI], "shipped")
      .filter(({ text }) => /containerType\s*:/.test(stripComments(text)))
      .map(({ rel }) => rel);
    expect(inMarkup).toEqual([
      // The month grid alone — never the widget, whose day menu is a menu.
      `${DESKTOP}/components/CalendarWidget.tsx`,
    ]);
    // …and the head that used to be one says how wide it is by itself.
    expect(stripComments(read(DESKTOP, "components/BaseViewer.tsx"))).toMatch(/data-narrow=\{narrowHead/);
  });

  it("no context menu opens anything but a menu surface", () => {
    // A file that handles the context-menu gesture either shows a MenuSurface
    // (directly or through one of the menu components) or only forwards the
    // gesture to a parent that does. What it may not do is build a menu.
    const menuBearers = /MenuSurface|FileContextMenu|TabContextMenu|TableContextMenu|EventContextMenu|GraphMapMenus|DropdownMenu|BlockMenu|ContextMenuHost/;
    for (const { rel, src } of desktopSurfaces()) {
      if (!/onContextMenu=/.test(src)) continue;
      const bearsMenu = menuBearers.test(src);
      // A no-op handler (`() => {}`) is a prop of a tab strip that owns no menu in that window.
      // A directly forwarded callback prop needs no wrapper lambda either
      // (AuxTitleBar -> AuxApp -> TabContextMenu is the same menu boundary).
      const forwardsOnly = /onContextMenu=\{on[A-Z]\w*\}/.test(src)
        || /onContextMenu=\{[^}]*(preventDefault|props\.|on[A-Z]\w*\?\.|on[A-Z]\w*\(|\(\) => \{\})/.test(src);
      expect(bearsMenu || forwardsOnly, `${rel} handles the context-menu gesture without a menu surface`).toBe(true);
    }
  });
});
