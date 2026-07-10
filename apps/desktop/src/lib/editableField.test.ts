// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  findEditable,
  selectedText,
  insertIntoEditable,
  deleteEditableSelection,
  isTextInput,
} from "@plainva/ui";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mount<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  return el;
}

describe("findEditable", () => {
  it("detects text inputs and textareas", () => {
    const input = mount(Object.assign(document.createElement("input"), { type: "text", value: "abc" }));
    input.setSelectionRange(1, 2);
    expect(findEditable(input)).toMatchObject({ kind: "input", el: input, selStart: 1, selEnd: 2 });

    const search = mount(Object.assign(document.createElement("input"), { type: "search" }));
    expect(findEditable(search)?.kind).toBe("input");

    const ta = mount(document.createElement("textarea"));
    expect(findEditable(ta)?.kind).toBe("textarea");
  });

  it("ignores non-text inputs, read-only and disabled fields", () => {
    expect(findEditable(mount(Object.assign(document.createElement("input"), { type: "checkbox" })))).toBeNull();
    expect(findEditable(mount(Object.assign(document.createElement("input"), { type: "range" })))).toBeNull();
    expect(findEditable(mount(Object.assign(document.createElement("input"), { type: "text", readOnly: true })))).toBeNull();
    expect(findEditable(mount(Object.assign(document.createElement("input"), { type: "text", disabled: true })))).toBeNull();
  });

  it("finds the contenteditable host from a nested target", () => {
    const host = mount(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    host.appendChild(span);
    expect(findEditable(span)).toMatchObject({ kind: "contenteditable", el: host });
  });

  it("excludes a read-only (contenteditable=false) host and plain elements", () => {
    const ro = mount(document.createElement("div"));
    ro.setAttribute("contenteditable", "false");
    const span = document.createElement("span");
    ro.appendChild(span);
    expect(findEditable(span)).toBeNull();
    expect(findEditable(mount(document.createElement("p")))).toBeNull();
    expect(findEditable(null)).toBeNull();
  });

  it("isTextInput covers the text-like types only", () => {
    const el = document.createElement("input");
    for (const t of ["text", "search", "url", "email", "tel", "password", ""]) {
      el.type = t;
      expect(isTextInput(el)).toBe(true);
    }
    for (const t of ["checkbox", "radio", "range", "number", "color", "file"]) {
      el.type = t;
      expect(isTextInput(el)).toBe(false);
    }
  });
});

describe("selectedText", () => {
  it("reads the input's own selection", () => {
    const input = mount(Object.assign(document.createElement("input"), { type: "text", value: "hello world" }));
    input.setSelectionRange(6, 11);
    expect(selectedText(findEditable(input))).toBe("world");
  });

  it("falls back to the document selection for non-input targets", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false, toString: () => "sel" } as unknown as Selection);
    expect(selectedText(null)).toBe("sel");
  });

  it("strips Markdown in the live-preview editor (data-pv-live-preview)", () => {
    const host = mount(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    host.setAttribute("data-pv-live-preview", "true");
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "**bold** and [[Page|Alias]]",
    } as unknown as Selection);
    expect(selectedText(findEditable(host))).toBe("bold and Alias");
  });

  it("keeps raw Markdown for the source-mode editor (no marker)", () => {
    const host = mount(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "**bold**",
    } as unknown as Selection);
    expect(selectedText(findEditable(host))).toBe("**bold**");
  });
});

describe("insertIntoEditable / deleteEditableSelection (input)", () => {
  it("inserts at the selection, replacing it, and fires an input event", () => {
    const input = mount(Object.assign(document.createElement("input"), { type: "text", value: "abXYef" }));
    input.setSelectionRange(2, 4); // "XY"
    const onInput = vi.fn();
    input.addEventListener("input", onInput);

    insertIntoEditable(findEditable(input)!, "cd");
    expect(input.value).toBe("abcdef");
    expect(input.selectionStart).toBe(4);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("deletes the selection and fires an input event", () => {
    const input = mount(Object.assign(document.createElement("input"), { type: "text", value: "abXYef" }));
    input.setSelectionRange(2, 4);
    const onInput = vi.fn();
    input.addEventListener("input", onInput);

    deleteEditableSelection(findEditable(input)!);
    expect(input.value).toBe("abef");
    expect(input.selectionStart).toBe(2);
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});

describe("insertIntoEditable / deleteEditableSelection (contenteditable)", () => {
  it("routes through execCommand insertText/delete", () => {
    const host = mount(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    // jsdom does not implement execCommand — provide it, then restore.
    const original = (document as Partial<Document>).execCommand;
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as Document["execCommand"];
    try {
      const target = findEditable(host)!;
      insertIntoEditable(target, "hi");
      expect(exec).toHaveBeenCalledWith("insertText", false, "hi");

      deleteEditableSelection(target);
      expect(exec).toHaveBeenCalledWith("delete");
    } finally {
      if (original) document.execCommand = original;
      else delete (document as Partial<Document>).execCommand;
    }
  });
});
