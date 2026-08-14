import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BINARY_PROBE_BYTES, applyTextShape, getExtraTextExtensions, looksBinary, opensExternally, readTextShape, resolveOpenAction, setExtraTextExtensions } from "@plainva/ui";

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

  /**
   * C15 (S13) turns the E1 decision around, on purpose this time. These used to
   * open as a note buffer by accident, then went to the OS while the question
   * was open; now they are a named list with a named home.
   */
  it("opens known text files in Plainva", () => {
    for (const p of ["data.csv", "notes.txt", "config.json", "feed.xml", "run.sh", "main.py", "app.ts"]) {
      expect(resolveOpenAction(p)).toBe("text");
      expect(opensExternally(p)).toBe(false);
    }
    // An SVG is text AND an image, and it is in both lists. The viewer wins —
    // it is the one that can show it.
    expect(resolveOpenAction("Attachments/logo.svg")).toBe("image");
  });

  it("lets a vault extend the list but never shrink it", () => {
    expect(resolveOpenAction("notes.fountain")).toBe("external");
    setExtraTextExtensions([".fountain", "  ADOC ", "not a value!", ""]);
    expect(resolveOpenAction("notes.fountain")).toBe("text");
    // Case and a leading dot are what people type; junk is dropped rather than
    // matched against a filename that could never contain it.
    expect(resolveOpenAction("book.adoc")).toBe("text");
    expect(getExtraTextExtensions()).toEqual(["fountain", "adoc"]);

    // The setting only ADDS. Anything that would take `.md` or an image away
    // could turn a note into an OS handoff, and one rule means no surface can
    // reach a different answer than another.
    setExtraTextExtensions(["md", "png"]);
    expect(resolveOpenAction("Plan.md")).toBe("editor");
    expect(resolveOpenAction("shot.png")).toBe("image");
    setExtraTextExtensions([]);
    expect(resolveOpenAction("notes.fountain")).toBe("external");
  });

  /**
   * The name says WHERE a file would open; the first bytes say whether it may.
   * A rotated `.log` or a database dump called `.csv` is a destroyed save the
   * moment the editor decodes it, holds a lossy string and writes that back.
   */
  it("refuses to treat bytes as text when they carry a NUL", () => {
    const text = new TextEncoder().encode("id,name\n1,Ada\n");
    expect(looksBinary(text)).toBe(false);
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true);
    // Deep enough in to catch a header that starts printable…
    const late = new Uint8Array(BINARY_PROBE_BYTES);
    late.fill(0x41);
    late[BINARY_PROBE_BYTES - 1] = 0;
    expect(looksBinary(late)).toBe(true);
    // …and bounded, so a huge text file costs a prefix and not a scan.
    const huge = new Uint8Array(BINARY_PROBE_BYTES * 2);
    huge.fill(0x41);
    huge[BINARY_PROBE_BYTES + 10] = 0;
    expect(looksBinary(huge)).toBe(false);
  });

  /**
   * A foreign file leaves the way it arrived. Notes are UTF-8/LF by house rule
   * and keep being normalised; an `.ini` from Windows or a `.csv` with the BOM
   * Excel wants is not ours to reformat — and rewriting every line ending turns
   * one edit into a whole-file diff.
   */
  it("remembers the line endings and BOM a text file arrived in", () => {
    const crlf = readTextShape("a\r\nb\r\nc");
    expect(crlf.text).toBe("a\nb\nc");
    expect(crlf.shape).toEqual({ eol: "\r\n", bom: false });
    expect(applyTextShape("a\nb\nc", crlf.shape)).toBe("a\r\nb\r\nc");

    const bom = readTextShape("\uFEFFid;name\n1;Ada\n");
    expect(bom.text.startsWith("\uFEFF")).toBe(false);
    expect(bom.shape.bom).toBe(true);
    expect(applyTextShape(bom.text, bom.shape)).toBe("\uFEFFid;name\n1;Ada\n");

    // Mixed endings collapse to the majority — a CRLF file with one stray LF
    // is a CRLF file, and calling it otherwise is the whole-file diff again.
    expect(readTextShape("a\r\nb\r\nc\nd").shape.eol).toBe("\r\n");
    expect(readTextShape("a\nb\nc\r\nd").shape.eol).toBe("\n");
    expect(readTextShape("no endings at all").shape).toEqual({ eol: "\n", bom: false });
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

  /**
   * C15's own version of the same trap. The extension list is exactly the kind
   * of thing a surface reaches for directly — "just check for .csv here" — and
   * the moment two places carry one, they disagree: the tree opens a file the
   * peek hands to the OS. So the list lives in `openTarget.ts`, the vault
   * INSTALLS its addition once when it loads, and nobody else spells out an
   * extension set.
   */
  it("keeps the text-file list out of the surfaces", () => {
    const files = [
      "components/Editor.tsx",
      "components/FileTree.tsx",
      "components/BasePeekModal.tsx",
      "hooks/usePaneLayout.ts",
    ];
    // Comments name extensions to explain themselves — that is documentation,
    // not a second rule. Only code counts.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A literal that lists two of them is the shape of a hand-rolled list.
    const listy = /(["'`])(csv|txt|json|yaml|yml|ini|log|xml|toml)\1\s*[,\]][\s\S]{0,60}(["'`])(csv|txt|json|yaml|yml|ini|log|xml|toml)\3/;
    for (const rel of files) {
      const src = code(readFileSync(join(desktopSrc, rel), "utf8"));
      expect(
        listy.test(src),
        `${rel} looks like it carries its own text-extension list — ask resolveOpenAction instead (C15)`,
      ).toBe(false);
    }
  });

  /**
   * The setting reaches the rule through the vault, not through the dialog
   * that edits it: a vault opened without ever visiting settings must still
   * honour its own list, and the settings row only keeps the running app in
   * step. Wiring only the dialog is a bug that looks correct while testing.
   */
  it("installs the vault's own extensions when the vault opens", () => {
    const context = readFileSync(join(desktopSrc, "contexts/VaultContext.tsx"), "utf8");
    expect(context).toMatch(/setExtraTextExtensions\(/);
    expect(context).toMatch(/textFileExtensionsKey\(/);
  });

  /**
   * `readTextShape`/`applyTextShape` are pure and well tested — and none of
   * that helps if the save simply does not call them. Removing the call from
   * the write left every other test in this file green, which is exactly the
   * gap this guard closes: a text file must go back through the shape it came
   * in, or one edit rewrites every line ending in the file.
   */
  it("writes a foreign text file back in the shape it arrived in", () => {
    const editor = readFileSync(join(desktopSrc, "components/Editor.tsx"), "utf8");
    // The load side: the shape is taken, and the bytes are checked against the
    // name before anything is shown as text.
    expect(editor).toMatch(/readTextShape\(/);
    expect(editor).toMatch(/looksBinary\(/);
    // The save side: the write ARGUMENT carries the shape, not just the file.
    const write = /vaultAdapter\.writeTextFile\(path,([^)]*)\)/.exec(editor);
    expect(write, "the save write moved — re-point this guard").not.toBeNull();
    expect(write![1]).toMatch(/applyTextShape/);
  });
});
