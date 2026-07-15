# Keyboard Shortcuts

Last reviewed: 2026-07-15

Press `F1` (or **Command palette → Show keyboard shortcuts**) to open the shortcuts window at any time. It groups every shortcut and mouse gesture into areas you switch with the chips along the top, has a search box that spans all areas, and detects your platform automatically: it shows `Ctrl`/`Alt` on Windows and Linux and `⌘`/`⌥` on macOS. In the tables below, `Ctrl` therefore means `⌘` on macOS and `Alt` means `⌥`.

## General

| Shortcut | Action |
|---|---|
| `Ctrl+P` (or `Ctrl+Shift+P`) | Open the command palette |
| `Ctrl+O` | Quick switcher – search and open files |
| `Ctrl+,` | Open settings |
| `Ctrl+Plus` / `Ctrl+Minus` | Zoom the interface in / out (80–150 %) |
| `Ctrl+0` | Reset zoom to 100 % |
| `Ctrl+S` | Confirm save (Plainva saves automatically) |
| `F1` | Show this window |
| `Esc` | Cancel action (close dialog, cancel renaming) |

## Notes & files

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New note in the selected folder |
| `Ctrl+Shift+D` | Open today's daily note |
| `F2` | Rename the active note |
| `Ctrl+Alt+Left` / `Ctrl+Alt+Right` | Back / forward (navigation history) |

In the file tree: **click** selects and opens, `Ctrl`+click toggles a multi-selection, `Shift`+click selects a range, **middle-click** opens a file in a new tab, **drag** moves files, **right-click** opens the context menu, and `Delete` moves the selection to the trash.

## View, windows & tabs

| Shortcut | Action |
|---|---|
| `Ctrl+E` | Toggle reading ↔ editing |
| `Ctrl+Shift+E` | Toggle live preview ↔ Markdown source |
| `Ctrl+Alt+B` / `Ctrl+Alt+R` | Toggle the left / right sidebar |
| `Ctrl+Alt+V` / `Ctrl+Alt+S` | Split editor side by side / stacked |
| `Ctrl+Shift+G` | Open the graph / vault map |
| `Ctrl+Shift+F` | Find & replace across the vault |
| `Ctrl+T` | New tab (pick a note to open) |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen the last closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab (`Ctrl` on every OS) |
| `Ctrl+1` … `Ctrl+8` | Jump to tab 1–8 |
| `Ctrl+9` | Jump to the last tab |

The focus mode (both sidebars hidden) lives in the command palette.

## Format text

Works in the editor (live preview or source):

| Shortcut | Action |
|---|---|
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Shift+H` | Highlight (`==mark==`) |
| `Ctrl+K` | Insert link / turn the selection into a link |
| `Ctrl+Shift+1` / `2` / `3` | Heading 1 / 2 / 3 |
| `Ctrl+Shift+0` | Normal text (remove heading) |
| `Ctrl+Enter` | Toggle the task checkbox |

You can also select text for the floating toolbar (bold, italic, strikethrough, code, highlight, link), and click a rendered `[ ]` checkbox to toggle a task in any mode.

## Edit text

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl+A` | Select all |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Alt+Up` / `Alt+Down` | Move line up / down |
| `Shift+Alt+Down` | Duplicate line |
| `Ctrl+Shift+K` | Delete line |
| `Ctrl+D` | Add the next occurrence to the selection |
| `Ctrl+F` | Find & replace in the note |
| `Ctrl+G` / `F3` | Find next (Shift for previous) |
| `Ctrl+Alt+G` | Go to line |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Fold / unfold (macOS: `⌘⌥[` / `⌘⌥]`) |
| `Ctrl+Space` | Trigger autocomplete |

## Insert

Type these in the editor:

| Input | Action |
|---|---|
| `/` | Command menu (blocks, formatting, templates, emoji) |
| `@` | Mention: date, note link or database |
| `[[` | Wiki link – pick a note |
| `![[` | Embed a note or image |
| `#` | Complete a tag |
| `:name` | Emoji by name (inserts the character) |
| `Ctrl+Alt+T` | Insert template |

Dropping a file into the editor embeds an image (or copies in and links another file).

## Graph

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Open the graph / vault map |
| Arrow keys | Move focus between nodes |
| `Enter` | Open the focused node |

Mouse: **scroll** to zoom; **middle-mouse drag** or `Ctrl`+drag to pan (even over a node); **drag on empty space** draws a selection lasso (vault map); `Alt`+drag moves a node with its linked neighbors (vault map); **drag one node onto another** to create a link or database relation (vault map); a single click opens (context/base graph) or selects (vault map); **double-click a folder bubble** to unfold it (double-click the ring to collapse); `Ctrl`+click opens in the split, **middle-click** opens in a new tab; **right-click** for the context menu; the **pin needle** (top right) toggles whether positions are remembered.

## Databases (.base)

| Input | Action |
|---|---|
| Click a cell | Edit in place; a checkbox toggles directly |
| Click a card / row | Open the note in a peek window |
| `Ctrl`+click a card | Open the note in the split |
| Drag a card | Board: set the column value; calendar/timeline: set the date |
| Drag a column header | Reorder columns (and the property's options) |
| Click a table header | Change the sort order |
| Click / drag a view pill | Switch views; drag to reorder; `▾` renames/duplicates/deletes |
| **+ Entry** | New entry with the default template (`▾` = template/folder) |

## Mouse & gestures (everywhere)

- **Block handle (`⠿`):** tap for the block menu (turn into, duplicate, move, delete); drag to reorder.
- **Tabs:** drag to reorder, between panes, or to an edge to split.
- **Links:** click a wiki / Markdown link to open it (`Ctrl`+click for a new tab).
- **Right-click** a selection or field for Plainva's own copy / cut / paste menu. `F5` and `Ctrl+R` do **not** reload (they would drop tabs and unsaved buffers).
- **Peek window:** drag the header to move, the corner grip to resize; `◀ ▶` is its own history.
- **Calendar:** click the month name to pick month/year; click a day for its daily note.
- **Image editor:** draw with the mouse (pen/arrow/rectangle/text/crop); zoom with the buttons.

## See also

- [Getting Started](Getting_Started.md) — interface and editor modes
- [Search](Search.md)
