// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownDecorationPlugin, toast, toastStore } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * Issue 175: on the phone a fenced code block showed as plain text. The phone
 * always shows a note in the editor's live preview (`createEditorSession`,
 * mode "live", the same session the desktop editor uses), and in 0.8.7 the
 * live preview had no styling for code blocks; the desktop only hid it behind
 * its reading view's code card. Fixed with 77958a0d3 (X6); this pins it: each
 * line of the block is part of one card, and the info string is its label.
 */
const DOC = "Intro\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\nAfter\n";

function mount(isLive: boolean, caret = 0): EditorView {
  return new EditorView({
    state: forceFullParse(EditorState.create({ doc: DOC, extensions: [markdown(), markdownDecorationPlugin(isLive)], selection: EditorSelection.single(caret) })),
    parent: document.body,
  });
}

function lineClasses(view: EditorView): string[] {
  return [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].map((el) => el.className);
}

describe("a fenced code block in the live preview (issue 175)", () => {
  it("draws every line of the block as one card, with the language as its label", () => {
    const view = mount(true);
    try {
      const classes = lineClasses(view);
      // Lines: Intro, "", ```js, const…, console…, ```, "", After
      expect(classes[2]).toContain("cm-md-codeblock--first");
      expect(classes[3]).toContain("cm-md-codeblock");
      expect(classes[4]).toContain("cm-md-codeblock");
      expect(classes[5]).toContain("cm-md-codeblock--last");
      expect(classes[0]).not.toContain("cm-md-codeblock");
      expect(classes[7]).not.toContain("cm-md-codeblock");
      expect(view.contentDOM.querySelector(".cm-md-codeinfo")?.textContent).toBe("js");
    } finally {
      view.destroy();
    }
  });

  it("keeps the card while the caret is inside the block", () => {
    const view = mount(true, DOC.indexOf("console"));
    try {
      expect(lineClasses(view).filter((c) => c.includes("cm-md-codeblock"))).toHaveLength(4);
    } finally {
      view.destroy();
    }
  });
});

describe("the copy button of a fenced code block in the live preview (parity: code-block-copy)", () => {
  const written: string[] = [];
  const stubClipboard = (fail = false) => {
    written.length = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => (fail ? Promise.reject(new Error("denied")) : (written.push(text), Promise.resolve())) },
    });
  };

  it("sits once on the first line and copies the code between the fences, not the fences", async () => {
    stubClipboard();
    const view = mount(true);
    try {
      const buttons = view.contentDOM.querySelectorAll<HTMLButtonElement>("button.cm-md-codecopy");
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest(".cm-line")?.className).toContain("cm-md-codeblock--first");
      buttons[0].click();
      await Promise.resolve();
      expect(written).toEqual(["const a = 1;\nconsole.log(a);"]);
      expect(buttons[0].classList.contains("is-copied")).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("is still there while the caret is on the fence, and copies an unclosed block to its end", async () => {
    stubClipboard();
    const open = "```py\nprint(1)\nprint(2)";
    const view = new EditorView({
      state: forceFullParse(EditorState.create({ doc: open, extensions: [markdown(), markdownDecorationPlugin(true)], selection: EditorSelection.single(2) })),
      parent: document.body,
    });
    try {
      const button = view.contentDOM.querySelector<HTMLButtonElement>("button.cm-md-codecopy");
      expect(button).not.toBeNull();
      button!.click();
      await Promise.resolve();
      expect(written).toEqual(["print(1)\nprint(2)"]);
    } finally {
      view.destroy();
    }
  });

  it("offers no button on an empty block", () => {
    const view = new EditorView({
      state: forceFullParse(EditorState.create({ doc: "```js\n```\n", extensions: [markdown(), markdownDecorationPlugin(true)] })),
      parent: document.body,
    });
    try {
      expect(view.contentDOM.querySelector("button.cm-md-codecopy")).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("shows an error toast when writing to the clipboard rejects or clipboard is unavailable", async () => {
    toast.clearAll();
    stubClipboard(true);
    const view = mount(true);
    try {
      const button = view.contentDOM.querySelector<HTMLButtonElement>("button.cm-md-codecopy")!;
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(button.classList.contains("is-copied")).toBe(false);
      expect(toastStore.get().some((t) => t.kind === "error")).toBe(true);

      toast.clearAll();
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      expect(() => button.click()).not.toThrow();
      expect(toastStore.get().some((t) => t.kind === "error")).toBe(true);
    } finally {
      toast.clearAll();
      view.destroy();
    }
  });

  it("extends the copied indicator cleanly on a quick second click", async () => {
    vi.useFakeTimers();
    stubClipboard();
    const view = mount(true);
    try {
      const button = view.contentDOM.querySelector<HTMLButtonElement>("button.cm-md-codecopy")!;
      button.click();
      await Promise.resolve();
      expect(button.classList.contains("is-copied")).toBe(true);
      vi.advanceTimersByTime(800);
      button.click();
      await Promise.resolve();
      vi.advanceTimersByTime(600);
      // 1400ms after first click, only 600ms after second: indicator stays on.
      expect(button.classList.contains("is-copied")).toBe(true);
      vi.advanceTimersByTime(700);
      expect(button.classList.contains("is-copied")).toBe(false);
    } finally {
      vi.useRealTimers();
      view.destroy();
    }
  });
});
