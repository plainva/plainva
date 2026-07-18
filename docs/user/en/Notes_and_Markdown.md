# Notes & Markdown

Last reviewed: 2026-07-18

Every note in Plainva is an ordinary Markdown file (`.md`). This page explains how to write comfortably and what actually ends up in the file — because that is exactly what makes your notes portable: any text editor, Obsidian, or a git diff can read them.

## The core principle: everything is text

Whatever you see in Plainva — formatted text, tables, properties, icons — is stored as open text:

```markdown
---
type: Note
okf_version: "0.1"
tags: [project]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought with a link to [[Another Note]].

- [ ] First task
```

The block between the `---` lines is the **frontmatter** (YAML): that is where the note's properties live. Below it comes the regular Markdown text. Plainva-specific presentation (icon, header color) is bundled under the single `plainva:` key — other programs simply ignore it.

## Writing in Live Preview

**Live Preview** is the default mode: Markdown renders as you type yet stays editable at all times.

### The slash menu

Type `/` at the start of a line to open the insert menu. It is grouped into sections:

- **Basic blocks** — Text, Heading 1–6, Bulleted List, Numbered List, To-do List, Quote, Code Block, Table, Divider, **Formula (LaTeX)**, **Mermaid diagram**
- **Formatting** — Bold, Italic, Strikethrough, Inline Code, Highlight, **Emoji**
- **Links & media** — Link, Internal Link, Image (web), Internal image, Embed, Embed database, Create inline database
- **Document** — Document icon, Header color, Insert Template
- **Callouts** — 13 variants (Note, Info, To-do, Summary, Tip, Success, Question, Warning, Failure, Danger, Bug, Example, Quote)

### More writing helpers

- **Selection toolbar** — select some text and a small bar offers **Bold**, **Italic**, **Strikethrough**, **Inline code**, **Highlight** and **Link**.
- **`@` mentions** — type `@` anywhere in the text to insert a **Date** (Today, Tomorrow, Yesterday, or **Pick a date…**, stored as an ISO date), a link to a **Note**, or a **Database** embed.
- **Emoji** — the **Emoji** slash command (`/emoji`) opens an emoji picker at the cursor; or type `:name` (for example `:rocket`) for inline suggestions. Either way Plainva inserts the actual emoji **character** (portable Unicode), never a `:shortcode:` — so the note stays readable in Obsidian, on GitHub and everywhere else. (This is separate from the note's **Document icon**, which is stored in the frontmatter.)
- **Block handles** — a handle appears to the left of each paragraph on hover: drag it to move the block, click it to open **Block actions** (**Turn into** Text/Heading/List/To-do/Quote/Code block, **Duplicate**, **Move up**/**Move down**, **Delete block**). If you drag a list next to another list of the same kind, Plainva inserts an invisible separator line `<!-- -->` so both lists stay separate — in Markdown, same-style lists would otherwise merge despite the blank line (in Obsidian too).
- **Tables** — rendered as a widget with click-to-edit cells. The cell display renders formatting (**bold**, *italic*, `code`, highlight), clickable links (`[[Internal Link]]`, web addresses) and `<br>` as a line break; while editing you see the raw text. The table menu offers inserting/deleting rows and columns plus alignment (**Align left**/**Align center**/**Align right**).
- **Lists continue themselves** (Enter inserts the next list marker), code blocks get language-aware highlighting (in the reading view as well), pasted content is converted to Markdown (smart paste), and headings can be folded.
- **Find & replace** inside the current note: `Ctrl+F` (see [Search](Search.md)).

## Links and backlinks

- **Internal links**: `[[Note name]]` (wiki link) — via the slash menu or `@` with built-in note search. Classic Markdown links `[text](path.md)` work as well.
- **Targets that don't exist yet**: A wiki link to a note that hasn't been created yet is shown **muted with a dashed underline** (both in live preview and reading mode). **Clicking it creates the note** and opens it — placed in the current note's folder (or at the given path if the link contains one, e.g. `[[Folder/New note]]`). To be asked first, enable **Settings → App → Editor & Notes → Ask before creating empty links**.
- **Backlinks**: The **Backlinks** section in the right sidebar shows which notes link to the active one — grouped per source file, with a counter for multiple occurrences.
- **Rename with link care**: When you rename a file in the file tree, Plainva updates every link to it across the whole vault (anchors like `#Section` are preserved) and reports: "N link(s) in M file(s) were updated to the new name."

## Properties (frontmatter)

The **Properties** section in the right sidebar shows the note's frontmatter as a form. **Add property** creates new ones; every property has a **Field type**:

| Group | Types |
|---|---|
| **Basic** | Text, Number, Checkbox, Date, Date & time |
| **Choice** | Select, Status, Multi-select |
| **Lists & relations** | List, Tags, Relation |
| **Web & contact** | URL, Email, Phone |

Choice types can carry fixed options with a **Color** and (for **Status**) a **Group**/stage — these option lists are managed in databases (`.base`), see [Databases (.base)](Databases_Base.md).

Two fields are protected: `type` and `okf_version` are **OKF system fields** managed by Plainva — the `type` value is selectable from a dropdown of known types, while name/field type/delete are locked (background: [OKF](OKF.md)).

## Document icon and header color

Every note can carry an icon (Notion-style above the title, also visible in tabs and the file tree) and a full-width color stripe:

- In Live Preview, hover above the title: **Add icon** / **Add header color** (later: **Change icon** / **Change header color**) — or use the slash commands **Document icon** and **Header color**.
- The icon picker has two modes: **Emoji** and **Icons** (the Lucide icon set, with a selectable color).
- Both are stored in the frontmatter under `plainva:` (`icon`, `icon_color`, `header_color`) — pure presentation that does not affect other programs.

## Templates

Set a **Template Folder** under **Settings → Vault → Content & structure** (**Choose folder…** next to the field lets you pick the folder right inside the vault). Then insert templates via `Ctrl+Alt+T` or the slash command **Insert Template**. Templates fully define the content of new files — including frontmatter: if a template brings its own `type`, the template wins. When inserting into an existing note, the template's frontmatter is left out — only the content lands.

**Placeholders**: templates interpolate `{{title}}` (the note's title), `{{date}}` and `{{time}}`. When you *insert* a template, two more resolve: `{{cursor}}` marks where the caret lands afterwards, and `{{prompt:Label}}` asks you for a value (shown as *Label*) and inserts your answer. Creating a *new* note from a template strips `{{cursor}}` and leaves any `{{prompt:…}}` blank.

Creating templates works from anywhere: the command palette (`Ctrl+P`) offers **Create new template** (a fresh template opens for editing) and **Save current note as template** (copies the open note into the template folder). Templates are ordinary Markdown files — edit, rename or delete them right in the file tree.

## Daily notes

**Open Daily Note** (sidebar) or a click in the **Calendar** creates today's note using your date format in the configured daily notes folder, optionally from a template.

## Tasks, formulas, diagrams and footnotes

- **Task checkboxes**: `- [ ] task` renders as a checkbox everywhere — and in **read mode** you can click it: Plainva writes `[x]` or `[ ]` back into the file.
- **Math (LaTeX)**: `$E = mc^2$` inline and `$$…$$` as a block render as formulas in read mode AND in the live preview (KaTeX). With the caret inside a formula you see the syntax; clicking a rendered formula opens it for editing. Only source mode always shows the raw syntax. You do not have to memorize the `$$…$$` block — the **Formula (LaTeX)** slash command (`/katex`) inserts it and places the caret inside.
- **Mermaid diagrams**: a code block with the language `mermaid` (fastest via the **Mermaid diagram** slash command, `/mermaid`) is drawn as a diagram in read mode and in the live preview — clicking the diagram shows the code for editing:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Footnotes**: `Text[^1]` plus `[^1]: The footnote.` at the end — read mode renders the reference and the footnote apparatus with jump marks. The fastest way is the **Footnote** slash command (`/footnote`): it inserts the next free reference and jumps straight into the definition at the end of the note.

## Printing and saving as PDF

The editor's **⋮** menu and the command palette (`Ctrl+P`) have **Print / Save as PDF…**: printing always uses the read view (from live/source, Plainva switches into it first). In the system dialog you can pick "Save as PDF" instead of a printer.

## Exporting a note

- **Export as Markdown…** (editor **⋮** menu or command palette): saves a copy of the note anywhere via the system dialog — for example to hand it to another program. Linked attachments (images) are not copied along; Plainva shows a short notice when the note references any.
- **PDF**: use **Print / Save as PDF…** (above) and choose "Save as PDF" in the system dialog.

## Opening a note in another editor

Your notes are plain `.md` files, so any Markdown editor can open them. The editor's **⋮** menu has **Open in default app**, which hands the current note to the app your system uses for Markdown files (Byword, MacDown, VS Code and so on). Plainva keeps watching the file, so edits you make there appear here automatically.

## Images and attachments

- **Inserting**: slash commands **Internal image** (search & embed from the vault) or **Image (web)** (by URL). Also: simply **paste** an image from the clipboard (Ctrl+V) — it is saved next to the note and embedded. And you can **drag files from the file explorer into the editor**: images embed (`![[…]]`), other files are copied in and linked (`[[…]]`).
- **Viewing**: image files (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) open in the built-in image viewer with **Zoom in**/**Zoom out**, **Fit** and **Actual size (1:1)**.
- **Editing**: the **Edit** button opens the image editor with **Crop**, rotate/flip, **Resize**, drawing tools (**Pen**, **Arrow**, **Rectangle**, **Text**) plus **Undo**/**Redo**. Save in place or **Save as copy…**. Editable formats are PNG, JPG and WebP; other formats open view-only.
- Other attachments open in the system's default program on double-click.

## What about Obsidian?

Everything stays standard Markdown with standard frontmatter. Obsidian opens the files fully; it shows the bundled `plainva:` key as a non-editable object in its properties panel — that is intentional and harmless.

## See also

- [Databases (.base)](Databases_Base.md) — notes as a table, board or calendar
- [OKF](OKF.md) — what `type` and `okf_version` mean
- [Search](Search.md) and [Keyboard Shortcuts](Keyboard_Shortcuts.md)
