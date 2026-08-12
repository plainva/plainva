import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenAction, opensExternally } from "@plainva/ui";

/**
 * The rule from issue #55 and the ratchet that keeps it in one place.
 *
 * The bug was never a wrong rule — it was a rule that existed once, in the file
 * tree, while every other route to a file went straight to the editor. So these
 * tests pin BOTH: what the rule says, and that every place which renders a vault
 * path still asks it.
 */
describe("resolveOpenAction", () => {
  it("sends notes to the editor and databases to the base viewer", () => {
    expect(resolveOpenAction("Notes/Plan.md")).toBe("editor");
    expect(resolveOpenAction("Tasks.base")).toBe("base");
    // Case is not a promise a file system makes.
    expect(resolveOpenAction("PLAN.MD")).toBe("editor");
    expect(resolveOpenAction("Tasks.BASE")).toBe("base");
  });

  it("sends images to Plainva's own viewer", () => {
    for (const p of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.bmp", "a.avif"]) {
      expect(resolveOpenAction(`Attachments/${p}`)).toBe("image");
    }
  });

  it("sends every other attachment to the operating system", () => {
    for (const p of ["Report.pdf", "Sheet.xlsx", "Deck.pptx", "clip.mp4", "archive.zip", "README"]) {
      expect(resolveOpenAction(`Attachments/${p}`)).toBe("external");
      expect(opensExternally(`Attachments/${p}`)).toBe(true);
    }
  });

  it("sends text-decodable attachments outside too (decision E1)", () => {
    // These are the ones the editor CAN display, and does today — by accident,
    // not by design. Opening them inside Plainva on purpose is C15.
    for (const p of ["data.csv", "notes.txt", "config.json", "feed.xml"]) {
      expect(resolveOpenAction(p)).toBe("external");
    }
  });

  it("never hands a virtual tab to the operating system", () => {
    // These are not files. `plainva://graph` reaching openPath would ask the OS
    // to open a path that does not exist.
    for (const p of ["plainva://graph", "plainva://tasks", "plainva://calendar", "plainva://mail"]) {
      expect(resolveOpenAction(p)).toBe("editor");
      expect(opensExternally(p)).toBe(false);
    }
  });
});

describe("the decision stays in one place", () => {
  const desktopSrc = join(__dirname);

  /**
   * Both places that render a vault path must consult the shared rule. Today
   * that is App (the tab) and BasePeekModal (the floating preview) — the peek
   * was missed when this plan was first written, and a guard on the tab alone
   * would have left it broken. A third renderer must fail here rather than
   * quietly reintroduce the bug.
   */
  it("is asked by every renderer of a vault path", () => {
    const renderers = [
      "hooks/usePaneLayout.ts", // openTab / openInFocusedPane / openPathInSplit
      "components/BasePeekModal.tsx",
      "components/FileTree.tsx",
    ];
    for (const rel of renderers) {
      const src = readFileSync(join(desktopSrc, rel), "utf8");
      expect(
        /opensExternally|resolveOpenAction/.test(src),
        `${rel} renders or opens vault paths but never asks resolveOpenAction — see issue #55`,
      ).toBe(true);
    }
  });

  it("is not re-implemented next to the shared rule", () => {
    // The old file-tree branch tested `mode === "attachment"` plus an inline
    // isImagePath. Any copy of that shape is the drift this ratchet exists for.
    const tree = readFileSync(join(desktopSrc, "components/FileTree.tsx"), "utf8");
    expect(tree).not.toMatch(/=== ?"attachment"[\s\S]{0,120}isImagePath/);
  });
});
