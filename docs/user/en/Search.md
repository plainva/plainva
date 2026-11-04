# Search

Last reviewed: 2026-10-01

Plainva offers three ways to search: full-text search across the whole vault, the quick switcher for opening files, and find & replace inside a note.

## Full-text search across the vault

The field at the top of the sidebar searches titles and contents across the vault. A local full-text index (SQLite FTS5) is built when the vault opens and updated as files change. Search works offline.

Search reacts while you type: word prefixes already match ("Projec" finds "Project plan") — no Enter needed. The **X** at the right of the field clears the current search (or press `Esc`); the sidebar then shows the normal file tree again.

In Chinese, Japanese, Thai and other scripts written without spaces between words, search finds a term anywhere in the text: `議事録` finds "今日は会議の議事録を書いた", `搜索` finds "全文搜索". Latin words inside such text are found too ("Plainva" in "…でPlainvaを使った").

Search lists individual occurrences with a text excerpt, heading path and line number. Opening a row selects that exact occurrence; several matches in the same note appear separately. The displayed count includes only results already loaded. You can load more occurrences. Arrow keys move between occurrences and Enter opens the selection. Loading, empty results and errors are shown explicitly; new input discards obsolete answers. If an edited occurrence can no longer be identified uniquely, a message explains this. The same occurrences are available in the quick switcher and mobile search. Returning to search on the phone restores the query, loaded results and list position. Hits come by **Relevance** unless you pick **Last modified**, **Title** or **Path** with the sort button next to the search field (on the phone: in the bar of the search screen); loading more keeps the chosen order. On the phone the sort sheet stays open until you tap **Done**: tapping the chosen order again reverses its direction.

The search field also applies to the other sidebar views: in **Tags** it filters the tag list, in **Bookmarks** the bookmarks.

### Search operators

- `"exact phrase"` — quotes match the word sequence exactly. This doubles as a whole-word search for a single word: `"plan"` finds "plan" but not "planning". In scripts written without spaces, quotes change nothing — such text has no word boundaries.
- `-term` — excludes notes containing the term (works with phrases too: `-"old version"`).
- `path:folder` — only files whose path contains the text (e.g. `path:Projects`; with spaces: `path:"My Folder"`).
- `tag:name` — only notes carrying that tag, including nested tags: `tag:project` also finds `#project/internal`. `tag:#project` works as well.
- Operators can be negated (`-path:Archive`, `-tag:done`) and combined freely with search terms: `plan tag:project -draft`.
- Multiple terms are combined with AND. Special characters like `- ( ) : *` inside terms are harmless — Plainva treats the input literally.

## Search by meaning

With a local model, search also finds notes by what they mean — not only by their words, and across languages: a question in German finds an English note that says the same. The model runs on this device; your notes and the vectors computed from them never leave it.

Switch it on under **Settings → AI & automation → Semantic search** (the AI must be on). Choose a model — **Granite Embedding Multilingual R2 (97M)** is the recommended one — and Plainva shows its size, source, license and an estimated duration before anything is downloaded. Every file comes from a fixed version on huggingface.co and is checked by its SHA-256; no sign-in is needed. Before the first note is embedded, Plainva checks that the model computes correctly on this device.

Instead of a package you can choose **Own provider**: then the model of the profile **Embeddings** computes the vectors — any embedding model your provider offers, for example `text-embedding-3-small` at OpenAI, `gemini-embedding-001` at Gemini or `nomic-embed-text` in Ollama. With Ollama or LM Studio nothing leaves your computer. With a cloud, the overview shows once what goes there — every note your privacy rules let go, now and whenever it changes, and your search questions — and **Approve until withdrawn** starts it; **Withdraw approval** in the settings stops it. Notes your rules keep from the cloud stay out, and in an encrypted workspace only a package or a server on this computer computes. If another model answers under the same name — a new `ollama pull`, a server that moved — Plainva notices it before the next note and computes the vectors again instead of mixing two models. If the provider cannot be reached, search answers by words and says so. **Not in use on this device** lists packages and vectors of models you no longer use; **Remove** clears them away.

**Measure this device** (beside **Pause** while a model computes) checks this device against the budgets Plainva holds itself to: the first run over 5,000 sections, a changed note found again, a search over 20,000 sections, the app's memory at its peak and the download. It measures with sample text, never with your notes, and embedding waits meanwhile; **Copy results** puts the numbers on the clipboard — for example for your feedback on the beta.

While a model is active, the head of the search results offers **Words**, **Meaning** and **Both**:

- **Words** is the full-text search described above.
- **Meaning** lists the notes whose sections come closest to your question; opening a hit jumps to that section.
- **Both** (the default) ranks the hits of words and meaning together.

In **Meaning** and **Both** every note appears once, and a small label says what found it: **Words**, **Meaning** or **Words and meaning**. Search operators (`path:`, `tag:`, `-term`) limit the hits by meaning too. The choice applies to this device.

Plainva embeds the notes in the background, the most recently changed first; a note you are editing follows a few seconds after you stop typing. Until then it is found by its words only — a hit by meaning never comes from the old text of a note. A line under the results shows how far this has come and offers **Pause**. On the phone, embedding runs only while Plainva is open. **Remove (with its vectors)** in the settings deletes the model and everything it computed.

### Related notes

Beside the open note, Plainva shows up to three notes that are close to it in meaning but not linked with it yet — on the desktop in the section **Related** of the right sidebar, after **Backlinks**; on the phone in the tab **Related** of the note's sheet. They come from the vectors search by meaning already keeps on this device: nothing is sent, not even to an own provider. A hint appears only when a note stands out clearly from everything else in the vault; copies and shared template text do not count. Most notes therefore have no hint, and the section then disappears.

Each hint names the two sections that are closest — for example “Production ↔ Shooting days › Split” — and the notes both link to. **Why this hint?** shows the beginning of both sections (a click jumps there); **Not helpful** hides exactly this pair on this device and does not change search. **Pause for this note** and **Pause in this vault** are in the section's menu, on the phone under the list. **Show related notes** under **Settings → AI & automation → Semantic search** switches the hints off on this device; there you also resume a paused vault or paused notes and bring back hidden hints.

## Quick switcher

`Ctrl+O` or `Ctrl+K` opens the quick switcher: type, navigate with the arrow keys, open with `Enter`. Without input it shows the **Recent Files** list — the fastest way to jump between your current notes. Matches can also be opened directly in a new tab (the dialog's footer shows the keys).

Matching is fuzzy: `prjplan` also finds "Project Plan" — the letters only have to appear in order, and word starts count extra. And when the note does not exist yet, the list shows **Create '…'**: `Enter` creates it right away (in the vault root) and opens it — type a name, press Enter, start writing.

Below the name hits the switcher also shows a **Content** group: notes whose text matches your input, with a highlighted excerpt of the match. Opening such a hit jumps straight to the match inside the note — just like the sidebar search.

## Find & replace inside a note

`Ctrl+F` opens the editor's search bar (in Live Preview and source mode):

- **Find** with `Enter`/**next** and **previous** through the matches; **all** highlights every occurrence.
- Options: **match case**, **by word**, **regexp**.
- **Replace**: replace single matches (**replace**) or **replace all**.

### Across the whole vault

`Ctrl/Cmd+Shift+F` (or **Find & replace in vault** in the command palette) searches every note at once. Enter a term, press **Find**, and the matches appear grouped by note with a line of context each. Type a replacement, untick any note you want to leave out, and **Replace in N notes** rewrites the rest — each note is written back safely (atomic write + a version snapshot), so a stale preview can never overwrite newer content. Match case, whole word and regex work here too; in regex mode `$1`/`$2` backreferences are available in the replacement.

Every match shows two lines: **before** with the hit and **after** with the result — with a regex, `$1` back-references are resolved, so the change can be checked before anything is written. An invalid expression is named right at the field instead of answering with an empty list; when nothing matches, the empty state says what to check. While replacing you see the progress and can **Cancel** — notes already written stay written and are named. On the phone every match shows the same two lines.

**On the phone** the same thing runs under the magnifier in the header, then `>` and **Find & replace in vault**: matches are grouped per note and collapsed, so a term with forty hits does not bury the action; tap a note to look inside, untick the ones you want left alone, and the button names its own scope (**Replace in 2 notes**). Leaving the app stops a running replace at the next note — notes already written stay written and are named.

## Tags

The sidebar view **Tags** lists all `#tags` in the vault with a hit count; a click shows the **Files with #tag**. Tags work in the text (`#project`) and in the frontmatter (`tags: [project]`). The sidebar's search field filters the tag list as well.

In a note a tag is drawn as a small pill — while you write and while you read; the text itself stays `#project/website`. A click on the pill (on the phone: a tap while reading) opens the notes that carry the tag. What counts as a tag is the same everywhere — in the tag list, in a task and when renaming: a `#` at the start of a line or after a space, followed by letters, digits, `_`, `-` or `/`. Digits alone are not a tag (`#42` stays a number), and neither is anything inside code or a link. **Colour tags** under **Settings → App → Appearance** gives every tag a colour that follows from its name; nested tags share the colour of their top-level tag. The setting belongs to this device and stores nothing in your notes.

**Rename a tag** right across the vault: right-click a tag in the **Tags** view and enter a new name. Plainva rewrites the tag everywhere — in note bodies (`#tag` and its `#tag/child` subtags) and in the frontmatter (`tags:`) — writing each affected note back through the same safe path. Unrelated tags that merely contain the name (for example `#area/tag`) are left alone.

## Navigating within a note

The **Outline** in the right sidebar lists all headings of the active note — a click jumps to the spot. For jumping between notes, **Backlinks** (who links here) and the editor's **Back**/**Forward** buttons help as well.

## See also

- [Keyboard Shortcuts](Keyboard_Shortcuts.md)
- [Databases (.base)](Databases_Base.md) — structured queries over properties instead of full text
