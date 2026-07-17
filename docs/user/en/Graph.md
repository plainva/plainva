# Graph

Last reviewed: 2026-07-14

Plainva's graph is a working tool, not a poster: it shows you where you are, what is connected, what is missing — and you can act on it directly. There is ONE graph engine with three faces.

## Context graph (right sidebar)

Open the **Graph** section in the right sidebar. It shows the active note in the center, the folder structure above, for folder overviews (index.md) the contained notes below, incoming references on the left and outgoing ones on the right. Relations from databases carry their property name as the label.

- Clicking a node opens the note (the focus rotates with you).
- Ctrl/Cmd+click opens in a split, middle-click in a new tab.
- Drag a node elsewhere and it stays put (small dot), remembered per note — reopen that note and your arrangement is back. The active note always stays in the center. The **pin needle** at the top right toggles remembering on and off; turning it off discards this note's remembered arrangement.
- Below it, up to three **suggestions** appear: notes that mention your active note (but do not link it), are often linked together with it, share a similar neighborhood, or share a rare tag. Where the title occurs as text in the note being edited, the suggestion shows a **preview of the passage** that would be linked; **Link** turns exactly that passage into a wiki link (as `[[Target|text]]` when the visible text differs from the target). If there is no matching passage, the link is appended at the end of the note (the preview says so). **Dismiss suggestion** remembers your decision.

## Vault map (its own tab)

Open the map with **Ctrl/Cmd+Shift+G**, via the graph icon in the **action rail** on the far left, or via the command palette (**Open graph**). It opens in its own tab. Instead of a hairball you see your real folder structure as bubbles — double-click a bubble and the folder unfolds into a **container circle** that encloses its notes and subfolders; unfolded subfolders nest inside it like a map. Double-click the **circle's rim** to fold the folder back up, **Collapse all folders** closes everything. The circle always follows its content: move notes inside and it grows with them; drag the rim and the folder moves together with its content. Inside a circle the notes still arrange by their links, and edges run directly from note to note. The layout is deterministic: the same map looks the same every time you open it. **Pan the map** with the middle mouse button or Ctrl/Cmd+drag, and **zoom** with the mouse wheel. Drag a node and it stays pinned (small dot). At the top right, the **pin needle** toggles remembering on and off: turn it off and this view's remembered arrangement is discarded and the automatic layout returns (the same as **Reset layout** in the right-click menu). Pins are stored per device.

Tools in the header bar:

- Edge styles at a glance (legend, bottom left): **relations** are solid accent lines with a label, **links** are dashed, **embeds** dotted.
- **Search** dims everything that does not match. Filter by **type** (OKF) and **tag**; edge kinds (**Links**, **Relations**, **Embeds**) toggle individually.
- Plainva-managed overview notes (`index.md` and `log.md`) are hidden by default — they link to almost everything and would otherwise clutter the graph; this also applies to the context graph and the database graph. In the vault map, bring them back via the **Filters** button with the **Show index.md** checkbox.
- **Focus on selection** reduces the map to a selected note plus 1–3 neighborhood hops.
- **Heatmap** brightens recently edited notes (7/30/90 days) — "what was I working on?"
- **Time travel** shows notes by their creation date; the slider replays your vault's growth. The date comes from a `date`/`datum` property, else from the file creation date (an approximation for cloud-only vaults).

Working on the map:

- Drag one node **onto** another: Plainva offers to write a text link — or directly a matching **relation** from your databases (if the relation allows exactly one entry, Plainva asks before replacing).
- Right-click a node: Open, Peek, Open in split, **New connected note**, Rename (with vault-wide link updates), Bookmark, Delete.
- Right-click empty space: **New note**, Reset layout, **Export as PNG/SVG**.
- Clicking an edge bundle between folders lists the individual links; hovering an edge shows the sentence the link lives in.
- **Dragging on empty space** draws a selection rectangle and marks multiple notes (Shift+drag extends an existing selection); drag one of the marked nodes afterwards and they all move together. The footer offers bookmark/delete for the selection.
- **Alt+drag a node** moves it together with its directly linked neighbours — the note and everything one hop away reposition as a group; a node that merely sits nearby but is not linked stays put.

## Cleaning up

The **Clean up** button opens a worklist with three tabs: **Orphans** (notes without connections), **Broken links** (targets that do not exist — **Create note** creates them) and **Mentions** (**Scan vault** finds places where a note is named but not linked; **Link** turns the occurrence into a wiki link). The map's footer shows the orphan count — clicking it opens the panel.

## Graph as a database view

Every `.base` database can get a **Graph** view (add view → **Graph**): the database's rows become nodes, your **relations** become labeled edges. In the header bar you pick the edge properties, **Color by** a select property, **Size by** a number and whether **external targets** (relations pointing out of the database) or **incoming relations** (relations from other databases that point at these entries — e.g. a project's tasks) appear. The view is saved Obsidian-compatibly — Obsidian shows the same file as a table.

## Limits

- The graph shows notes (files), not individual paragraphs.
- Pins and dismissed suggestions live under `.plainva/` and do not travel with sync — the base layout is identical on every device.
- Suggestions are pure vault analyses; nothing leaves your machine.
