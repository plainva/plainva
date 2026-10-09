import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { BINARY_PROBE_BYTES, applyTextShape, editorTextOf, getExtraTextExtensions, looksBinary, openEditorText, opensExternally, readTextShape, resolveOpenAction, setExtraTextExtensions } from "@plainva/ui";

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

  /**
   * The property that matters, stated once: read then write gives back the same
   * bytes. Checking the two fields separately can pass while the pair still
   * loses a file — this cannot.
   */
  it("gives a consistently-ended file back byte for byte", () => {
    for (const [name, raw] of [
      ["CRLF ini", "[a]\r\nx=1\r\n"],
      ["BOM csv", "\uFEFFid;name\r\n1;Ada\r\n"],
      ["LF shell script", "#!/bin/sh\necho hi\n"],
      ["no trailing newline", "single line"],
      ["BOM with LF", "\uFEFFa\nb\n"],
      ["empty file", ""],
    ] as [string, string][]) {
      const { text, shape } = readTextShape(raw);
      expect(applyTextShape(text, shape), name).toBe(raw);
    }
  });

  it("normalises a stray line ending to the majority — one line of diff, on purpose", () => {
    // Not byte-identical, and deliberately so: a mostly-CRLF file with one lone
    // LF is a CRLF file. Remembering the ending PER LINE would be the only way
    // to be exact here, and it would preserve a stray ending forever.
    const { text, shape } = readTextShape("a\r\nb\r\nc\nd\r\n");
    expect(applyTextShape(text, shape)).toBe("a\r\nb\r\nc\r\nd\r\n");
  });

  /**
   * The one opener of both shells (finding 2026-10-08). Text, save shape and
   * the bytes' veto come from one call, so no shell can take one without the
   * others — the phone had taken none of them.
   */
  it("opens a file for an editor: the text it holds, the shape its save puts back, and the bytes' veto", () => {
    // Built at run time: neither character is typed into this file.
    const MARK = String.fromCharCode(0xfeff), NUL = String.fromCharCode(0);
    // A foreign text file leaves exactly as it arrived.
    expect(openEditorText("Settings.ini", `${MARK}[a]\r\nx=1\r\n`)).toEqual({ text: "[a]\nx=1\n", shape: { eol: "\r\n", bom: true } });
    // A note is held in the SAME text space — no mark in the buffer either,
    // where it used to hide a properties block from the editor and made every
    // decision on a suggestion fail, because the comment operation reads the
    // note without one. Its save writes the house form: "\n", the mark kept.
    expect(openEditorText("Note.md", `${MARK}---\r\ntitle: x\r\n---\r\n`)).toEqual({ text: "---\ntitle: x\n---\n", shape: { eol: "\n", bom: true } });
    expect(openEditorText("Note.md", "plain\n")).toEqual({ text: "plain\n", shape: { eol: "\n", bom: false } });
    // The veto: a text name over bytes that are not text opens nothing…
    expect(openEditorText("dump.log", `PK${NUL}${NUL}`)).toBeNull();
    // …and it is a foreign file's veto. A note is a note by its name.
    expect(openEditorText("Note.md", `a${NUL}b`)).not.toBeNull();
  });

  /**
   * Why there is ONE text space, as a fact about the editor: CodeMirror splits
   * a document at every line end and joins it with "\n". Whatever a shell
   * keeps beside its editor — the last saved text, the text its screen
   * resolves comment anchors on — has to be that same string, or a file from
   * Windows differs from itself. `editorTextOf` is that string.
   */
  it("holds exactly what CodeMirror holds for the same file", () => {
    const MARK = String.fromCharCode(0xfeff);
    for (const raw of ["one\r\ntwo\r\nthree", `${MARK}one\r\ntwo\n`, "one\ntwo\n", ""]) {
      const held = editorTextOf(raw);
      expect(EditorState.create({ doc: held }).doc.toString(), JSON.stringify(raw)).toBe(held);
    }
    // The raw file is NOT that string, and offsets into it are not offsets
    // into the editor: one further right with every "\r\n" before them.
    const raw = "one\r\ntwo\r\nthree";
    expect(EditorState.create({ doc: raw }).doc.toString()).not.toBe(raw);
    expect(raw.indexOf("three") - editorTextOf(raw).indexOf("three")).toBe(2);
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
   *
   * BOTH shells (finding 2026-10-08): the phone opened the same files and
   * called neither function. It showed whatever decoded and wrote every text
   * file back with `\n` — and because its screens held the raw file while its
   * editor held it without `\r`, a note from Windows counted as edited from the
   * moment it was opened. What the two shells do with a file's shape is tested
   * on real files beside their savers; this guard only keeps the calls there.
   */
  it("opens a text file through the one opener and writes it back in its shape — in both shells", () => {
    const editor = readFileSync(join(desktopSrc, "components/Editor.tsx"), "utf8");
    // The load side: text, shape and the bytes' veto come from ONE call.
    expect(editor).toMatch(/openEditorText\(activePath, text\)/);
    // The save side: the write ARGUMENT carries the shape, not just the file.
    const write = /vaultAdapter\.writeTextFile\(path,([^)]*)\)/.exec(editor);
    expect(write, "the save write moved — re-point this guard").not.toBeNull();
    expect(write![1]).toMatch(/applyTextShape/);

    const phone = readFileSync(join(desktopSrc, "..", "..", "mobile", "src", "services", "vaultService.ts"), "utf8");
    // The phone has ONE read of a file for an editor, and one saver.
    const read = /async readEditor\([\s\S]*?\n {2}\},/.exec(phone);
    expect(read, "the phone's editor read moved — re-point this guard").not.toBeNull();
    expect(read![0]).toMatch(/openEditorText\(path, /);
    expect(phone, "the phone's saver no longer puts the shape back").toMatch(/writeEditorText\(path, applyTextShape\(text, shape\)/);
    // …and nothing else on a note screen reads the open file around it.
    for (const rel of ["screens/NoteScreen.tsx", "EditorHost.tsx", "screens/base/PinboardEntryScreen.tsx"]) {
      const source = readFileSync(join(desktopSrc, "..", "..", "mobile", "src", rel), "utf8");
      expect(source, `${rel} reads the open file itself instead of asking vaultOps.readEditor`).not.toMatch(/files\.readTextFile\(path\)|vaultOps\.read\(vault, path\)/);
    }
  });

  /**
   * A comment operation is planned on what the editor holds and changes one
   * passage of the note. Both wirings take the two file functions for that
   * from the core; the phone's own pair handed over the raw file, and no
   * suggestion on a note with `\r\n` could be accepted (finding 2026-10-08).
   */
  it("runs the comment operation of both shells on the editor's text", () => {
    for (const rel of [join("services", "commentOperations.ts"), join("..", "..", "mobile", "src", "services", "commentOperations.ts")]) {
      const source = readFileSync(join(desktopSrc, rel), "utf8");
      expect(source, `${rel} wires its own file functions`).toMatch(/readText: noteFiles\.readText/);
      expect(source).toMatch(/noteFiles = editorTextFiles\(/);
      expect(source).toMatch(/noteFiles\.writeText/);
    }
  });

  /**
   * S14. The three view modes are a markdown idea: read mode runs the document
   * through the markdown renderer, and "source" only means something when
   * "live" renders. Offering them on a `.csv` shows it as rendered markdown —
   * so the buttons are hidden AND the mode is pinned AND the keyboard shortcut
   * is closed. Hiding a control without closing its shortcut is a bug that
   * looks fixed.
   */
  it("keeps a text file out of the markdown view modes", () => {
    const editor = readFileSync(join(desktopSrc, "components/Editor.tsx"), "utf8");
    const flag = /const (\w+) = !!activePath && resolveOpenAction\(activePath\) === "text"/.exec(editor);
    expect(flag, "Editor no longer derives a text-file flag from the shared rule").not.toBeNull();
    const name = flag![1];
    // Pinned: the mode effect cannot land on 'read' for a text file.
    expect(editor).toMatch(new RegExp(`setViewMode\\(${name} \\? "live" :`));
    // Hidden: the button group renders only when this is not a text file.
    const group = editor.indexOf('<button\n              onClick={() => { setViewMode(\'read\')');
    expect(group, "the view-mode button group moved — re-point this guard").toBeGreaterThan(0);
    expect(editor.slice(Math.max(0, group - 220), group)).toMatch(new RegExp(`\\{!${name} &&`));
    // Closed: the Mod+E / Mod+Shift+E handler bails out for a text file.
    expect(editor).toMatch(new RegExp(`if \\(!isActivePane \\|\\| managedIndex \\|\\| ${name}\\) return;`));
  });
});
