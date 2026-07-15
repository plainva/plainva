/**
 * Central catalog of Plainva's keyboard shortcuts and notable mouse gestures.
 * This is the single source of truth the shortcuts help window (F1) renders
 * from, and it mirrors what is actually wired in App.tsx (global keydown),
 * packages/ui editorSession (editor keymap) and the graph/base components.
 *
 * `keys` tokens are platform-substituted at render time ("Mod" -> Ctrl/⌘,
 * "Alt" -> Alt/⌥). Descriptions/labels/notes are i18n keys; existing keys are
 * reused where a matching action already has one, new ones live under
 * `shortcuts.*`. Mouse rows carry an optional `mods` (rendered as key chips)
 * plus a localized `gestureKey` verb and a `descKey` explanation.
 */

export interface KeyRow {
  descKey: string;
  keys: string[][];
  noteKey?: string;
}

export interface MouseRow {
  descKey: string;
  gestureKey: string;
  mods?: string[];
  noteKey?: string;
}

export interface ShortcutCategory {
  id: string;
  labelKey: string;
  keyboard: KeyRow[];
  mouse: MouseRow[];
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    id: "general",
    labelKey: "shortcuts.catGeneral",
    keyboard: [
      { descKey: "palette.title", keys: [["Mod", "P"], ["Mod", "Shift", "P"]] },
      { descKey: "shortcuts.quickSwitcher", keys: [["Mod", "O"]] },
      { descKey: "shortcuts.openSettings", keys: [["Mod", ","]] },
      { descKey: "shortcuts.zoomInOut", keys: [["Mod", "+"], ["Mod", "−"]] },
      { descKey: "shortcuts.zoomReset", keys: [["Mod", "0"]] },
      { descKey: "shortcuts.saveFlush", keys: [["Mod", "S"]], noteKey: "shortcuts.noteAutosave" },
      { descKey: "shortcuts.showShortcuts", keys: [["F1"]] },
      { descKey: "shortcuts.cancelAction", keys: [["Esc"]] },
    ],
    mouse: [],
  },
  {
    id: "files",
    labelKey: "shortcuts.catFiles",
    keyboard: [
      { descKey: "shortcuts.newNoteFolder", keys: [["Mod", "N"]] },
      { descKey: "sidebar.newDaily", keys: [["Mod", "Shift", "D"]] },
      { descKey: "shortcuts.renameFile", keys: [["F2"]] },
      { descKey: "shortcuts.deleteSelection", keys: [["Del"]] },
      { descKey: "shortcuts.navBack", keys: [["Mod", "Alt", "←"]] },
      { descKey: "shortcuts.navForward", keys: [["Mod", "Alt", "→"]] },
    ],
    mouse: [
      { descKey: "shortcuts.mTreeSelect", gestureKey: "shortcuts.gClick" },
      { descKey: "shortcuts.mTreeToggle", gestureKey: "shortcuts.gClick", mods: ["Mod"] },
      { descKey: "shortcuts.mTreeRange", gestureKey: "shortcuts.gClick", mods: ["Shift"] },
      { descKey: "shortcuts.mTreeNewTab", gestureKey: "shortcuts.gMiddleClick" },
      { descKey: "shortcuts.mTreeDrag", gestureKey: "shortcuts.gDrag" },
      { descKey: "shortcuts.mTreeMenu", gestureKey: "shortcuts.gRightClick" },
    ],
  },
  {
    id: "view",
    labelKey: "shortcuts.catView",
    keyboard: [
      { descKey: "shortcuts.toggleReadEdit", keys: [["Mod", "E"]] },
      { descKey: "shortcuts.toggleSourceMode", keys: [["Mod", "Shift", "E"]] },
      { descKey: "shortcuts.toggleLeftSidebar", keys: [["Mod", "Alt", "B"]] },
      { descKey: "shortcuts.toggleRightSidebar", keys: [["Mod", "Alt", "R"]] },
      { descKey: "shortcuts.splitVertical", keys: [["Mod", "Alt", "V"]] },
      { descKey: "shortcuts.splitHorizontal", keys: [["Mod", "Alt", "S"]] },
      { descKey: "graph.open", keys: [["Mod", "Shift", "G"]] },
      { descKey: "findReplace.title", keys: [["Mod", "Shift", "F"]] },
      { descKey: "shortcuts.newTab", keys: [["Mod", "T"]] },
      { descKey: "shortcuts.closeTab", keys: [["Mod", "W"]] },
      { descKey: "shortcuts.reopenTab", keys: [["Mod", "Shift", "T"]] },
      { descKey: "shortcuts.nextTab", keys: [["Ctrl", "Tab"]], noteKey: "shortcuts.noteCtrlBothOs" },
      { descKey: "shortcuts.prevTab", keys: [["Ctrl", "Shift", "Tab"]] },
      { descKey: "shortcuts.jumpTab", keys: [["Mod", "1"], ["Mod", "8"]] },
      { descKey: "shortcuts.lastTab", keys: [["Mod", "9"]] },
      { descKey: "shortcuts.toggleFocusMode", keys: [], noteKey: "shortcuts.notePaletteOnly" },
    ],
    mouse: [],
  },
  {
    id: "format",
    labelKey: "shortcuts.catFormat",
    keyboard: [
      { descKey: "shortcuts.bold", keys: [["Mod", "B"]] },
      { descKey: "shortcuts.italic", keys: [["Mod", "I"]] },
      { descKey: "shortcuts.strikethrough", keys: [["Mod", "Shift", "S"]] },
      { descKey: "shortcuts.highlight", keys: [["Mod", "Shift", "H"]] },
      { descKey: "shortcuts.insertLink", keys: [["Mod", "K"]] },
      { descKey: "shortcuts.heading1", keys: [["Mod", "Shift", "1"]] },
      { descKey: "shortcuts.heading2", keys: [["Mod", "Shift", "2"]] },
      { descKey: "shortcuts.heading3", keys: [["Mod", "Shift", "3"]] },
      { descKey: "shortcuts.normalText", keys: [["Mod", "Shift", "0"]] },
      { descKey: "shortcuts.toggleTask", keys: [["Mod", "Enter"]] },
    ],
    mouse: [
      { descKey: "shortcuts.mSelectionToolbar", gestureKey: "shortcuts.gSelectText" },
      { descKey: "shortcuts.mTaskCheckbox", gestureKey: "shortcuts.gClickCheckbox" },
    ],
  },
  {
    id: "edit",
    labelKey: "shortcuts.catEdit",
    keyboard: [
      { descKey: "shortcuts.undo", keys: [["Mod", "Z"]] },
      { descKey: "shortcuts.redo", keys: [["Mod", "Y"], ["Mod", "Shift", "Z"]] },
      { descKey: "shortcuts.selectAll", keys: [["Mod", "A"]] },
      { descKey: "shortcuts.indent", keys: [["Tab"], ["Shift", "Tab"]] },
      { descKey: "shortcuts.moveLine", keys: [["Alt", "↑"], ["Alt", "↓"]] },
      { descKey: "shortcuts.duplicateLine", keys: [["Shift", "Alt", "↓"]] },
      { descKey: "shortcuts.deleteLine", keys: [["Mod", "Shift", "K"]] },
      { descKey: "shortcuts.selectOccurrence", keys: [["Mod", "D"]] },
      { descKey: "shortcuts.findInNote", keys: [["Mod", "F"]] },
      { descKey: "shortcuts.findNext", keys: [["Mod", "G"], ["F3"]] },
      { descKey: "shortcuts.gotoLine", keys: [["Mod", "Alt", "G"]] },
      { descKey: "shortcuts.fold", keys: [["Ctrl", "Shift", "["], ["Ctrl", "Shift", "]"]], noteKey: "shortcuts.noteFoldMac" },
      { descKey: "shortcuts.autocomplete", keys: [["Mod", "Space"]] },
      { descKey: "shortcuts.cursorMove", keys: [["↑", "↓", "←", "→"]] },
    ],
    mouse: [],
  },
  {
    id: "insert",
    labelKey: "shortcuts.catInsert",
    keyboard: [
      { descKey: "shortcuts.slashMenu", keys: [["/"]] },
      { descKey: "shortcuts.mention", keys: [["@"]] },
      { descKey: "shortcuts.wikiLink", keys: [["[", "["]] },
      { descKey: "shortcuts.embed", keys: [["!", "[", "["]] },
      { descKey: "shortcuts.tagComplete", keys: [["#"]] },
      { descKey: "shortcuts.emojiComplete", keys: [[":"]] },
      { descKey: "shortcuts.insertTemplate", keys: [["Mod", "Alt", "T"]] },
    ],
    mouse: [
      { descKey: "shortcuts.mDropFile", gestureKey: "shortcuts.gDropFile" },
    ],
  },
  {
    id: "graph",
    labelKey: "shortcuts.catGraph",
    keyboard: [
      { descKey: "graph.open", keys: [["Mod", "Shift", "G"]] },
      { descKey: "shortcuts.graphFocusMove", keys: [["↑", "↓", "←", "→"]] },
      { descKey: "shortcuts.graphOpenNode", keys: [["Enter"]] },
    ],
    mouse: [
      { descKey: "shortcuts.mGraphZoom", gestureKey: "shortcuts.gWheel" },
      { descKey: "shortcuts.mGraphPan", gestureKey: "shortcuts.gMiddleDrag" },
      { descKey: "shortcuts.mGraphPan", gestureKey: "shortcuts.gDrag", mods: ["Mod"] },
      { descKey: "shortcuts.mGraphLasso", gestureKey: "shortcuts.gDragEmpty", noteKey: "shortcuts.noteVaultMapOnly" },
      { descKey: "shortcuts.mGraphLinkedDrag", gestureKey: "shortcuts.gDrag", mods: ["Alt"], noteKey: "shortcuts.noteVaultMapOnly" },
      { descKey: "shortcuts.mGraphConnect", gestureKey: "shortcuts.gDragNodeOnNode", noteKey: "shortcuts.noteVaultMapOnly" },
      { descKey: "shortcuts.mGraphClick", gestureKey: "shortcuts.gClick" },
      { descKey: "shortcuts.mGraphExpand", gestureKey: "shortcuts.gDoubleClickFolder", noteKey: "shortcuts.noteVaultMapOnly" },
      { descKey: "shortcuts.mGraphOpenSplit", gestureKey: "shortcuts.gClick", mods: ["Mod"] },
      { descKey: "shortcuts.mGraphNewTab", gestureKey: "shortcuts.gMiddleClick" },
      { descKey: "shortcuts.mGraphMenu", gestureKey: "shortcuts.gRightClick", noteKey: "shortcuts.noteVaultMapOnly" },
      { descKey: "shortcuts.mGraphPin", gestureKey: "shortcuts.gPinNeedle" },
    ],
  },
  {
    id: "base",
    labelKey: "shortcuts.catBase",
    keyboard: [
      { descKey: "shortcuts.baseCellCommit", keys: [["Enter"], ["Esc"]] },
    ],
    mouse: [
      { descKey: "shortcuts.mBaseCellEdit", gestureKey: "shortcuts.gClickCell" },
      { descKey: "shortcuts.mBasePeek", gestureKey: "shortcuts.gClickCard" },
      { descKey: "shortcuts.mBaseSplit", gestureKey: "shortcuts.gClickCard", mods: ["Mod"] },
      { descKey: "shortcuts.mBaseCardDrag", gestureKey: "shortcuts.gDragCard" },
      { descKey: "shortcuts.mBaseColumnDrag", gestureKey: "shortcuts.gDragColumn" },
      { descKey: "shortcuts.mBaseSort", gestureKey: "shortcuts.gClickHeader" },
      { descKey: "shortcuts.mBaseViewPill", gestureKey: "shortcuts.gClickViewPill" },
      { descKey: "shortcuts.mBaseNewEntry", gestureKey: "shortcuts.gNewEntry" },
    ],
  },
  {
    id: "mouse",
    labelKey: "shortcuts.catMouse",
    keyboard: [],
    mouse: [
      { descKey: "shortcuts.mBlockHandleTap", gestureKey: "shortcuts.gBlockHandleTap" },
      { descKey: "shortcuts.mBlockHandleDrag", gestureKey: "shortcuts.gBlockHandleDrag" },
      { descKey: "shortcuts.mTabDrag", gestureKey: "shortcuts.gDragTab" },
      { descKey: "shortcuts.mLinkClick", gestureKey: "shortcuts.gClickLink", noteKey: "shortcuts.noteLinkNewTab" },
      { descKey: "shortcuts.mContextCopy", gestureKey: "shortcuts.gRightClick", noteKey: "shortcuts.noteReloadGuard" },
      { descKey: "shortcuts.mPeek", gestureKey: "shortcuts.gPeekWindow" },
      { descKey: "shortcuts.mResize", gestureKey: "shortcuts.gDragDivider" },
      { descKey: "shortcuts.mCalendar", gestureKey: "shortcuts.gCalendar" },
      { descKey: "shortcuts.mImageEditor", gestureKey: "shortcuts.gImageDraw" },
    ],
  },
];
