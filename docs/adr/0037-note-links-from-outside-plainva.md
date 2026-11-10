# ADR 0037: Note links from outside Plainva — `plainva://open`

Status: Accepted

Date: 2026-11-10

## Context

A note could be linked from another note (`[[Note]]`, `[[Note#Heading]]`,
`[[Note#^block]]`, ADR 0027), but from nowhere else: not from a calendar
event, a task in a provider's list, a mail, a browser bookmark, a chat or
another app. Calendar, tasks and mail stood next to the notes instead of
being connected to them. Block links were half there: `[[Note#^id]]` was
read and drawn, but nothing created or copied a block id.

An address that reaches an app through the operating system is untrusted
input. Whoever can put a link in front of a person — a mail, a web page, an
invitation — decides every character of it. Obsidian's URI scheme shows how
far such an address can reach when it is allowed to (`obsidian://new` with
`content=`, `obsidian://advanced-uri` running commands); several Obsidian
plugins had to be fixed for exactly that.

## Decision

### The format (public and stable)

```
plainva://open?vault=<name>&path=<path>[&heading=<text> | &block=<id>]
```

- `open` is the only action. There is no `new`, `search`, `run`, `write` or
  `settings` action, and a later version may add actions only through a new
  ADR. An address with another action is refused.
- `vault` is the vault's **name as the person sees it** (its own name in
  Plainva, else its folder's name) — never its place on disk. An absolute path
  would tell everyone who reads the link where the vault lies, and it differs
  on every device anyway. `vault` may be left out: then the open vault is
  meant.
- `path` is the note's path inside the vault, `/` between folders,
  percent-encoded as a whole (a copied link encodes `/` too; both spellings
  read the same). It is normalised to NFC.
- `heading` is the text of a heading, `block` the id of a block (without
  `^`, `[A-Za-z0-9][A-Za-z0-9-]{0,63}`). At most one of the two.
- Values are percent-decoded strictly (a broken escape refuses the address);
  `+` reads as a space. A parameter given twice refuses the address; a
  parameter this version does not know is ignored and does nothing.
- Copied links always use `plainva`. The isolated development build and the
  Labs build register `plainva-dev` and `plainva-labs` (desktop
  `tauri.dev.conf.json` / `tauri.labs.conf.json`, Android build type `labs`),
  so they never take the release app's links; Plainva reads all three. The
  Android TLS test build registers `plainva-tlstest`, which Plainva does not
  read at all.

The address is read and written in ONE place, `packages/core/src/noteLinkUrl.ts`
(`parseNoteLinkUrl`, `buildNoteLinkUrl`); `buildNoteLinkUrl` refuses to write
an address `parseNoteLinkUrl` would refuse.

### What is refused

The reader refuses, with one sentence to the person and a diagnostics entry
that names only the reason: another scheme or action; an address longer than
4096 characters; a path that is absolute (`/x`, `C:/x`, `\\server`), leaves
the vault (`..`), has an empty or `.` segment or a backslash, or lies in an
internal folder (`.plainva`, `.obsidian`, `.git`, …); C0/C1 control
characters, line and paragraph separators, a byte order mark or bidirectional
controls in any value; a vault name over 255, a path over 1024, a heading
over 512 characters.

### What it does

Only navigation (`packages/ui/src/lib/noteLinks.ts`, `openNoteLink`):

1. **Which vault.** The shown vault when its name matches (letter case and
   NFC/NFD do not matter) or when the address names none. Another vault of
   this device by that name: Plainva **asks** whether to switch and switches
   only on yes; the link opens once that vault is shown. Several vaults by
   that name, or none: said as such, nothing switches.
2. **Which file.** The path as written; if it is not there, the link rule of
   ADR 0027 is asked for the path without `.md` and then for the file name —
   so a note moved to another folder, or renamed while its old name is still
   its `title`, is found. A name the rule would cut (`#`, `^`, `|`, `[`, `]`)
   is not asked about.
3. **What opens.** What Plainva shows itself — a note, a database, an image,
   a text file. A file the system would run or open in another program is
   never handed over by a link.
4. **Where in it.** The heading or block, by the anchor jump the wiki links
   use (`requestAnchorJump`).

Nothing is created, written, run or sent. A missing note is said as such; it
is not created.

### How it arrives

- **Desktop.** The installers register the scheme from `plugins.deep-link`
  in `tauri.conf.json` (NSIS/MSI on Windows, `CFBundleURLTypes` on macOS,
  `x-scheme-handler` in the `.desktop` file of the deb and rpm packages).
  Windows and Linux start the program with the address as an argument: a
  first launch reads its own arguments; a launch while Plainva runs reaches
  the single-instance callback of the running process, so the link goes to
  the window that is open, never to a second process. macOS delivers the
  address to the running process (`RunEvent::Opened`). Rust only picks out
  the arguments with a Plainva scheme and keeps them for the **central
  window** (`src-tauri/src/note_links.rs`), which takes them
  (`note_links_take`) — no plugin and no new dependency. A link clicked in an
  auxiliary window is forwarded to the central window (`note_link_forward`).
- **Phone.** An Android intent filter (`plainva://open`, scheme from the
  build type) and an iOS URL type hand the address to Capacitor's
  `appUrlOpen`; `routeAppUrl` takes it before the sign-in handlers.
- **Inside the app.** Every link a person clicks that is not a note link
  ends in a shell's `openExternal`, whose guard (`guardedExternalOpener`)
  allows only web, mail and phone addresses. A Plainva address is taken out
  before that check and opened in the app — in a note, a mail, an event
  description, a task, a database cell, in both shells. It never reaches the
  system, which would hand it back or give it to another installation.

An address waits in one inbox until a vault is open (a cold start).

### Making links

- **Copy link** in a note's menu (desktop: the editor's ⋮ menu, the tab menu,
  the file tree and the left sections; phone: the note's menu and a file's
  row sheet) copies the note's address.
- At a line (desktop: the block menu and the right-click menu of the editor;
  phone: the block sheet), **Copy link** copies the address of that heading
  or block and **Copy block link** the wiki link (`[[Note#Heading]]`,
  `[[Note#^id]]`).
- A block without an id gets one: six lower-case letters and digits, unused
  in the note, typed into the editor as an ordinary edit (undo, save and the
  write chain of ADR 0031 see it like a keystroke). Where it goes
  (`planBlockLink` in `packages/core/src/noteSource.ts`): at the end of the
  paragraph or list item; behind a table on a line of its own with a blank
  line around it. Not in frontmatter, code, `$$` formulas, `%%` comments,
  HTML blocks, on an empty line, or for a table inside a list or quote. Every
  new id is checked to lead to that block before it is written.
- `[[Note#^` suggests the ids the note already has.
- **Link a note** in the event editor of both shells adds
  `[Title](plainva://open?…)` to the description; the event preview shows
  such a link as a note chip that opens the note.

### Encrypted workspaces

The package asked that a locked encrypted workspace ask for its unlock
first. A locked workspace is opened with what is on the device: its notes
are plain files there and open without the key (the lock covers the sync
and the comments). A link therefore opens the note as any other way into it
does, and the existing locked states (the comment column's unlock prompt)
apply unchanged. Should notes ever be locked on the device, the gate belongs
in the one open path every way shares, not in the link.

## Consequences

- Links copied on one device open on another as long as the vault has the
  same name there. Renaming a vault breaks the links that name it; the
  person is told that the vault is not on this device.
- A vault name is visible in every copied link. It is the name the person
  gave or the folder's name, never a path.
- The format is a contract: it is documented in the user guide, and a change
  to it needs a new ADR.
- What could not be verified in the development environment: an operating
  system actually handing an address to the installed app on Windows, macOS,
  Linux, Android and iOS (the scheme registration happens at install time).

## Links

- ADR 0027 (where a link leads), ADR 0031 (one entry of the write chain)
- `packages/core/src/noteLinkUrl.ts`, `packages/core/src/noteSource.ts`
  (`planBlockLink`), `packages/ui/src/lib/noteLinks.ts`,
  `packages/ui/src/lib/externalUrl.ts`
