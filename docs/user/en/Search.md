# Search

Last reviewed: 2026-07-06

Plainva offers three ways to search: full-text search across the whole vault, the quick switcher for opening files, and find & replace inside a note.

## Full-text search across the vault

The search field at the top of the sidebar searches the entire vault — titles *and* contents. It is backed by a local full-text index (SQLite FTS5) that is built when the vault opens and kept current on every change; search therefore works offline and without noticeable delay.

Search reacts while you type: word prefixes already match ("Projec" finds "Project plan") — no Enter needed. The **X** at the right of the field clears the current search (or press `Esc`); the sidebar then shows the normal file tree again.

The result list shows the hit count at the top and groups the results: **File name** hits first (the term appears in the note's name), then **Content** hits. Every row shows the document icon, the folder path and — for content hits — a text excerpt with the match highlighted. Clicking a result opens the note and jumps straight to the first occurrence; it is selected there. If nothing matches, the list says **No results**.

The search field also applies to the other sidebar views: in **Tags** it filters the tag list, in **Bookmarks** the bookmarks.

### Search operators

- `"exact phrase"` — quotes match the word sequence exactly. This doubles as a whole-word search for a single word: `"plan"` finds "plan" but not "planning".
- `-term` — excludes notes containing the term (works with phrases too: `-"old version"`).
- `path:folder` — only files whose path contains the text (e.g. `path:Projects`; with spaces: `path:"My Folder"`).
- `tag:name` — only notes carrying that tag, including nested tags: `tag:project` also finds `#project/internal`. `tag:#project` works as well.
- Operators can be negated (`-path:Archive`, `-tag:done`) and combined freely with search terms: `plan tag:project -draft`.
- Multiple terms are combined with AND. Special characters like `- ( ) : *` inside terms are harmless — Plainva treats the input literally.

## Quick switcher

`Ctrl+O` or `Ctrl+K` opens the quick switcher: type, navigate with the arrow keys, open with `Enter`. Without input it shows the **Recent Files** list — the fastest way to jump between your current notes. Matches can also be opened directly in a new tab (the dialog's footer shows the keys).

Matching is fuzzy: `prjplan` also finds "Project Plan" — the letters only have to appear in order, and word starts count extra. And when the note does not exist yet, the list shows **Create '…'**: `Enter` creates it right away (in the vault root) and opens it — type a name, press Enter, start writing.

Below the name hits the switcher also shows a **Content** group: notes whose text matches your input, with a highlighted excerpt of the match. Opening such a hit jumps straight to the match inside the note — just like the sidebar search.

## Find & replace inside a note

`Ctrl+F` opens the editor's search bar (in Live Preview and source mode):

- **Find** with `Enter`/**next** and **previous** through the matches; **all** highlights every occurrence.
- Options: **match case**, **by word**, **regexp**.
- **Replace**: replace single matches (**replace**) or **replace all**.

## Tags

The sidebar view **Tags** lists all `#tags` in the vault with a hit count; a click shows the **Files with #tag**. Tags work in the text (`#project`) and in the frontmatter (`tags: [project]`). The sidebar's search field filters the tag list as well.

## Navigating within a note

The **Outline** in the right sidebar lists all headings of the active note — a click jumps to the spot. For jumping between notes, **Backlinks** (who links here) and the editor's **Back**/**Forward** buttons help as well.

## See also

- [Keyboard Shortcuts](Keyboard_Shortcuts.md)
- [Databases (.base)](Databases_Base.md) — structured queries over properties instead of full text
