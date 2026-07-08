# Screenshot capture spec

These images are referenced by the root `README.md` and (optionally) the website.
Capture them before the public push — otherwise the README shows broken images.

## Files to produce (place PNGs in this folder)

| File | Shows | Notes |
|---|---|---|
| `screenshot-editor.png` | The editor in **Live preview** with the **slash menu open** (type `/`). A real note with a heading, task checkboxes, a wiki link and a callout; file tree visible on the left. | Hero shot — the first impression. |
| `screenshot-base-board.png` | A **`.base` board** grouped by status (or a table) over plain notes, with the **"+ Eintrag"/"+ Entry"** button and a couple of cards/rows. | Proves "the data is your notes". |
| `screenshot-graph.png` | The **vault map** (open with `Mod+Shift+G`) — folder bubbles / connected nodes. | The "wow" shot. |

## Capture guidance

- **One theme, consistently.** Petrol (the brand default) — dark reads great for the hero, light is friendlier; pick one and use it for all three.
- **Use a clean demo vault**, not the dev test vault (no junk file names).
- **Capture just the app window** (Plainva has its own custom title bar; no OS taskbar/desktop behind it). Windows: `Win+Shift+S` region capture, or Alt+PrintScreen for the active window.
- **Native window size** is 1280×832; capture at 2× (HiDPI) if you can, then the PNG stays crisp when scaled.
- Export as **PNG**. Keep file sizes reasonable (< ~500 KB each; run through an optimizer if large).

## Optional: social preview / OG image

- `og-image.png`, **1200×630** (GitHub social preview accepts up to 1280×640). A branded card (logo + tagline "Plain files. Private vaults. Open by design.") or a cropped editor shot with the wordmark.
- Used for GitHub → Settings → Social preview, and for `og:image` on plainva.com. Ask the maintainer's AI to design a branded card you can export if you don't want to shoot one.
