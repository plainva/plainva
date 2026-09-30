// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { FIELD_DRAFT_DELAY_MS, useFieldDraft } from "@plainva/ui";
import { ContentPage, type ContentPageProps } from "./components/settings/VaultPages";

/**
 * A settings field keeps the caret and every key (E23, TestFlight finding
 * 2026-09-22 — the phone's "Date format"; desktop half of the same class).
 *
 * The shared `useFieldDraft` owns a draft that changes with the keys; saving
 * and normalizing happen after a pause, on blur, on Enter and on unmount. The
 * desktop bound "Daily note format" to the stored value and ran the file-name
 * sanitizer on every key, so typing a "/" in the middle rewrote the text under
 * the caret and threw it to the end. The phone's side of the class is pinned in
 * `apps/mobile/src/settingsFields.test.tsx`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

/** A key the way the WebView delivers it: the DOM text changes, then `input`. */
function edit(el: HTMLInputElement | HTMLTextAreaElement, next: string, caret: number) {
  (el instanceof HTMLTextAreaElement ? areaSetter : inputSetter).call(el, next);
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function typeAt(el: HTMLInputElement, text: string) {
  const at = el.selectionStart ?? el.value.length;
  edit(el, el.value.slice(0, at) + text + el.value.slice(at), at + text.length);
}
function key(el: HTMLElement, name: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers();
});

describe("useFieldDraft", () => {
  const saves: string[] = [];
  let failNext = false;
  let setStored: (v: string) => void = () => {};

  /** A field over a stored value, like every settings page has one. */
  function Field({ multiline, normalize }: { multiline?: boolean; normalize?: (v: string) => string }) {
    const [stored, set] = useState("Daily");
    setStored = set;
    const draft = useFieldDraft({
      value: stored,
      normalize,
      onSave: (v) => {
        saves.push(v);
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("refused"));
        }
        set(v);
      },
    });
    const { flush: _flush, ...props } = draft;
    return multiline ? <textarea data-testid="f" {...props} /> : <input data-testid="f" {...props} />;
  }
  const field = () => host.querySelector<HTMLInputElement>('[data-testid="f"]')!;

  beforeEach(() => {
    saves.length = 0;
    failNext = false;
  });

  it("types into its draft at once and saves once after a pause", async () => {
    await act(async () => { root.render(<Field />); });
    const el = field();
    el.focus();
    el.setSelectionRange(5, 5);
    for (const ch of "Notes") await act(async () => { typeAt(el, ch); });
    expect(el.value).toBe("DailyNotes");
    expect(saves).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(FIELD_DRAFT_DELAY_MS); });
    expect(saves).toEqual(["DailyNotes"]);
  });

  it("saves on blur and shows the normalized text only then", async () => {
    await act(async () => { root.render(<Field normalize={(v) => v.trim() || "Daily"} />); });
    const el = field();
    el.focus();
    await act(async () => { edit(el, "", 0); });
    // A cleared field stays cleared while one is still typing.
    expect(el.value).toBe("");
    await act(async () => { el.blur(); });
    expect(saves).toEqual([]); // "" normalizes to the stored "Daily": nothing to write
    expect(el.value).toBe("Daily");
    el.focus();
    await act(async () => { edit(el, "  Journal ", 10); });
    expect(el.value).toBe("  Journal ");
    await act(async () => { el.blur(); });
    expect(saves).toEqual(["Journal"]);
    expect(el.value).toBe("Journal");
  });

  it("saves a single-line field on Enter; a text area keeps Enter for its new lines", async () => {
    await act(async () => { root.render(<Field />); });
    let el = field();
    el.focus();
    await act(async () => { edit(el, "Inbox", 5); });
    await act(async () => { key(el, "Enter"); });
    expect(saves).toEqual(["Inbox"]);

    await act(async () => { root.render(<Field multiline />); });
    el = field();
    el.focus();
    await act(async () => { edit(el, "Line", 4); });
    await act(async () => { key(el, "Enter"); });
    expect(saves).toEqual(["Inbox"]);
  });

  it("saves a word left mid-way when the screen closes", async () => {
    await act(async () => { root.render(<Field />); });
    const el = field();
    el.focus();
    await act(async () => { edit(el, "Arch", 4); });
    await act(async () => { root.render(<></>); });
    expect(saves).toEqual(["Arch"]);
  });

  it("takes over a change from elsewhere while idle — never under the caret", async () => {
    await act(async () => { root.render(<Field />); });
    const el = field();
    await act(async () => { setStored("Synced"); });
    expect(el.value).toBe("Synced");

    el.focus();
    await act(async () => { edit(el, "Synced!", 7); });
    await act(async () => { setStored("From another device"); });
    // The person's text stays while they type ...
    expect(el.value).toBe("Synced!");
    await act(async () => { el.blur(); });
    // ... and what they typed is what they meant.
    expect(saves).toEqual(["Synced!"]);
  });

  it("writes nothing when a field was only visited, and keeps what arrived meanwhile", async () => {
    await act(async () => { root.render(<Field />); });
    const el = field();
    el.focus();
    await act(async () => { setStored("From another device"); });
    await act(async () => { el.blur(); });
    // Focusing and leaving is not an edit: the old text must not be written
    // over the change that came in while the field had the focus.
    expect(saves).toEqual([]);
    expect(el.value).toBe("From another device");
  });

  it("tries a failed save again instead of taking it for stored", async () => {
    await act(async () => { root.render(<Field />); });
    const el = field();
    el.focus();
    failNext = true;
    await act(async () => { edit(el, "Tagebuch", 8); });
    await act(async () => { vi.advanceTimersByTime(FIELD_DRAFT_DELAY_MS); });
    expect(saves).toEqual(["Tagebuch"]);
    // A key and its undo: the same text as the refused save, typed again.
    await act(async () => { edit(el, "Tagebuch!", 9); });
    await act(async () => { edit(el, "Tagebuch", 8); });
    await act(async () => { el.blur(); });
    expect(saves).toEqual(["Tagebuch", "Tagebuch"]);
  });
});

describe("desktop: Content & structure keeps the caret (E23)", () => {
  const persisted: string[] = [];

  /** The page with its date format wired the way SettingsModal wires it. */
  function Page() {
    const [format, setFormat] = useState("YYYY-MM-DD");
    const noop = () => {};
    const props: ContentPageProps = {
      isActiveVault: false,
      dailyNotesFolder: "", onDailyNotesFolder: noop, onBrowseDailyFolder: noop,
      dailyNotesFormat: format,
      onDailyNotesFormat: (v) => { setFormat(v); persisted.push(v); },
      templateFolder: "", folderTemplates: [], onFolderTemplates: noop, templateChoices: [], onBrowseRuleFolder: noop,
      typeTemplates: [], onTypeTemplates: noop, onTemplateFolder: noop, onBrowseTemplateFolder: noop,
      inboxFolder: "", onInboxFolder: noop, onBrowseInboxFolder: noop,
      attachmentFolder: "", onAttachmentFolder: noop, onBrowseAttachmentFolder: noop,
      textFileExtensions: "", onTextFileExtensions: noop,
      dailyNoteTemplate: "", onDailyNoteTemplate: noop, templateFiles: [],
      taskDatabase: "", onTaskDatabase: noop, baseFiles: [], onCreateTaskDb: noop, canCreateTaskDb: false,
      defaultNoteType: "", onDefaultNoteType: noop, dailyNoteType: "", onDailyNoteType: noop,
      journalHeading: "", onJournalHeading: noop, dayEndsAt: 0, onDayEndsAt: noop,
      journalMoodProperty: "", onJournalMoodProperty: noop, verifierName: "", onVerifierName: noop,
      okfViolations: null, okfVersionState: null,
      onShowOkfMigration: noop, onShowOkfWizard: noop, onShowOkfInfo: noop, onShowIndexManager: noop, onUpdateAllIndexes: noop,
      extendedDatabases: false, commentAnchors: false, onCommentAnchors: noop, onExtendedDatabases: noop,
    };
    return <ContentPage {...props} />;
  }

  beforeEach(() => {
    persisted.length = 0;
  });

  it("types a character the sanitizer rewrites without moving the caret, and sanitizes on leaving", async () => {
    await act(async () => { root.render(<Page />); });
    const el = host.querySelector<HTMLInputElement>('input[placeholder="YYYY-MM-DD"]')!;
    expect(el.value).toBe("YYYY-MM-DD");
    el.focus();
    el.setSelectionRange(4, 4);
    // A "/" is not allowed in a file name; the sanitizer turns it into "-".
    await act(async () => { typeAt(el, "/"); });
    expect(el.value).toBe("YYYY/-MM-DD");
    expect(el.selectionStart).toBe(5);
    expect(persisted).toEqual([]);
    await act(async () => { el.blur(); });
    expect(persisted).toEqual(["YYYY--MM-DD"]);
    expect(el.value).toBe("YYYY--MM-DD");
  });
});

describe("no desktop settings field rewrites its text under the caret (E23)", () => {
  it("a text field hands on what was typed; normalizing waits for the save", () => {
    // `onChange={(e) => p.onX(sanitize(e.target.value))}` is the binding that
    // moved the caret: React writes the rewritten text back into the field.
    // Use CommittedTextInput with `normalize`, which applies it when saving.
    // jsdom hands `import.meta.url` an http URL; Vitest runs in the package root.
    const dir = join(process.cwd(), "src", "components", "settings");
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => join(dir, f)),
      join(process.cwd(), "src", "components", "SettingsModal.tsx"),
    ];
    const NUMERIC = new Set(["number", "range", "checkbox", "radio", "color", "file", "time", "date"]);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const tag = node.tagName.getText(sf);
          if (["input", "TextInput", "textarea", "TextArea"].includes(tag)) {
            const attrs = new Map<string, string>();
            for (const a of node.attributes.properties) {
              if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(sf), a.initializer?.getText(sf) ?? "");
            }
            const type = (attrs.get("type") ?? "").replace(/["{}]/g, "");
            const onChange = attrs.get("onChange") ?? "";
            const rewrites = /[\w.]+\(\s*e\.target\.value\s*\)\s*\)/.test(onChange) || /e\.target\.value\.\w+\(/.test(onChange);
            if (!NUMERIC.has(type) && rewrites) {
              offenders.push(`${file.split(/[\\/]/).slice(-2).join("/")}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
