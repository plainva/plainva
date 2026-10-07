// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  applyInlineTrigger, InlineSuggestProvider, inlineTriggerAt, JournalCaptureField, searchLinkTargets, searchTags, suggestForTrigger, TaskCaptureField,
  type CaptureResult, type TriggerQuerySource,
} from "@plainva/ui";

/**
 * `[[` and `#` in the capture fields (plan Befunde 2026-10-06, W5). The journal
 * and the task capture are plain inputs; they offer the vault's notes and tags
 * through the searches the note editor's completion reads. Pinned here: where a
 * trigger stands, what a pick writes, and that the list takes Enter before the
 * field does — in the two fields both shells mount.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const value = lookup(key);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});

const FILES = [
  { path: "Projects/Roof repair.md", title: "Roof repair", is_attachment: 0 },
  { path: "Projects/Roof quote.pdf", title: null, is_attachment: 1 },
];
const TAGS = [{ tag: "#client", count: 4 }, { tag: "#clinic", count: 1 }, { tag: "home", count: 9 }];

function source(): TriggerQuerySource & { asked: Array<{ sql: string; params: unknown[] }> } {
  const asked: Array<{ sql: string; params: unknown[] }> = [];
  return {
    asked,
    db: {
      query: async (sql, params = []) => {
        asked.push({ sql, params });
        const term = String(params[0]).replace(/%/g, "").toLowerCase();
        return FILES.filter((file) => (file.title ?? file.path).toLowerCase().includes(term) || file.path.toLowerCase().includes(term));
      },
    },
    getAllTags: async () => TAGS,
  };
}

describe("where a trigger stands", () => {
  const at = (text: string) => inlineTriggerAt(text, text.length);

  it("reads the open link the caret is in", () => {
    expect(at("Call about [[Roo")).toEqual({ kind: "link", from: 11, to: 16, term: "Roo" });
    expect(at("[[")).toEqual({ kind: "link", from: 0, to: 2, term: "" });
    // The second link of a line: the first one is closed and does not count.
    expect(at("[[A]] and [[B")).toMatchObject({ kind: "link", from: 10, term: "B" });
  });

  it("offers nothing behind a closed link, for an embed, a heading or an alias", () => {
    expect(at("see [[Roof repair]] ")).toBeNull();
    expect(at("![[Roo")).toBeNull();
    expect(at("[[Roof repair#Cos")).toBeNull();
    expect(at("[[Roof repair|the r")).toBeNull();
    // A link does not run on over a line break.
    expect(at("[[Roo\nnext")).toBeNull();
  });

  it("reads a tag with at least one character and a boundary in front", () => {
    expect(at("Milk #ho")).toEqual({ kind: "tag", from: 5, to: 8, term: "ho" });
    expect(at("#cli")).toEqual({ kind: "tag", from: 0, to: 4, term: "cli" });
    expect(at("(#work/pro")).toMatchObject({ kind: "tag", term: "work/pro" });
  });

  it("does not take a bare #, an anchor or C# for a tag", () => {
    expect(at("Milk #")).toBeNull();
    expect(at("# ")).toBeNull();
    expect(at("example.com/page#sec")).toBeNull();
    expect(at("C#")).toBeNull();
  });

  it("reads the trigger at the caret, not at the end of the text", () => {
    const text = "Call [[Roo about #client";
    expect(inlineTriggerAt(text, 10)).toMatchObject({ kind: "link", term: "Roo" });
    expect(inlineTriggerAt(text, 4)).toBeNull();
  });
});

describe("what the vault offers", () => {
  it("lists notes by title and attachments by path — the editor's own search", async () => {
    const vault = source();
    const hits = await searchLinkTargets(vault, "roof");
    expect(hits).toEqual([
      { kind: "note", label: "Roof repair", insert: "[[Roof repair]]", detail: "Projects/Roof repair.md" },
      { kind: "attachment", label: "Roof quote.pdf", insert: "[[Projects/Roof quote.pdf]]", detail: "Projects/Roof quote.pdf" },
    ]);
    expect(vault.asked[0].params).toEqual(["%roof%", "%roof%", "roof%"]);
    expect(vault.asked[0].sql).toContain("path NOT LIKE '%.base'");
  });

  it("lists the tags that begin with what was typed, whatever case", async () => {
    expect((await searchTags(source(), "CL")).map((hit) => [hit.insert, hit.count])).toEqual([["#client", 4], ["#clinic", 1]]);
    expect((await searchTags(source(), "h")).map((hit) => hit.insert)).toEqual(["#home"]);
  });

  it("offers nothing for a tag that is written out in full, even when a longer one begins the same way", async () => {
    const vault = source();
    expect(await suggestForTrigger(vault, { kind: "tag", from: 0, to: 5, term: "home" })).toEqual([]);
    expect((await suggestForTrigger(vault, { kind: "tag", from: 0, to: 3, term: "cl" })).length).toBe(2);
    // `#client` is complete although `#clientele` exists: Enter must save the entry.
    const longer: typeof vault = { ...vault, getAllTags: async () => [{ tag: "client", count: 4 }, { tag: "clientele", count: 1 }] };
    expect(await suggestForTrigger(longer, { kind: "tag", from: 0, to: 7, term: "Client" })).toEqual([]);
    expect((await suggestForTrigger(longer, { kind: "tag", from: 0, to: 8, term: "cliente" })).map((hit) => hit.insert)).toEqual(["#clientele"]);
  });
});

describe("what a pick writes", () => {
  it("replaces the trigger, adds a space and puts the caret behind it", () => {
    const text = "Call about [[Roo";
    expect(applyInlineTrigger(text, inlineTriggerAt(text, text.length)!, "[[Roof repair]]")).toEqual({ text: "Call about [[Roof repair]] ", caret: 27 });
  });

  it("consumes brackets that already close the link", () => {
    const text = "Call [[Roo]] today";
    expect(applyInlineTrigger(text, inlineTriggerAt(text, 10)!, "[[Roof repair]]")).toEqual({ text: "Call [[Roof repair]] today", caret: 21 });
  });

  it("completes a tag in the middle of a line without doubling the space", () => {
    const text = "Milk #cl today";
    expect(applyInlineTrigger(text, inlineTriggerAt(text, 8)!, "#client")).toEqual({ text: "Milk #client today", caret: 13 });
  });
});

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});
async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(node); });
  return host;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const options = () => [...document.querySelectorAll<HTMLElement>('[data-testid="inline-suggest-option"]')];

/** Types into a controlled field the way React sees it: the native setter, then an input event. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
async function press(field: HTMLElement, key: string) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
  });
  return event;
}

function Journal({ onSubmit, onCancel }: { onSubmit: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  return <JournalCaptureField value={value} onChange={setValue} asTask={false} onAsTask={() => {}} onSubmit={() => onSubmit(value)} onCancel={onCancel} />;
}
function Task({ onSubmit }: { onSubmit: (result: CaptureResult) => void }) {
  const [value, setValue] = useState("");
  return <TaskCaptureField value={value} onChange={setValue} todayKey="2026-10-06" onSubmit={onSubmit} />;
}

describe("the journal's capture field", () => {
  it("offers notes after [[, and Enter takes the highlighted one instead of saving", async () => {
    const onSubmit = vi.fn();
    const host = await mount(<InlineSuggestProvider source={source()}><Journal onSubmit={onSubmit} onCancel={() => {}} /></InlineSuggestProvider>);
    const field = host.querySelector<HTMLTextAreaElement>('[data-testid="journal-capture-input"]')!;
    await type(field, "Call about [[roo");
    expect(options().map((option) => option.textContent)).toEqual(["Roof repair", "Roof quote.pdf"]);

    await press(field, "ArrowDown");
    await press(field, "Enter");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe("Call about [[Projects/Roof quote.pdf]] ");
    expect(options()).toEqual([]);

    // With the list gone, Enter is the field's again.
    await press(field, "Enter");
    expect(onSubmit).toHaveBeenCalledWith("Call about [[Projects/Roof quote.pdf]] ");
  });

  it("Escape puts the list away and leaves the dialog around the field alone", async () => {
    const onCancel = vi.fn();
    const host = await mount(<InlineSuggestProvider source={source()}><Journal onSubmit={() => {}} onCancel={onCancel} /></InlineSuggestProvider>);
    const field = host.querySelector<HTMLTextAreaElement>('[data-testid="journal-capture-input"]')!;
    await type(field, "#cl");
    expect(options().map((option) => option.textContent)).toEqual(["#client4×", "#clinic1×"]);
    const escape = await press(field, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(options()).toEqual([]);
    expect(onCancel).not.toHaveBeenCalled();
    await press(field, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stays a plain field where no vault index is in reach", async () => {
    const onSubmit = vi.fn();
    const host = await mount(<Journal onSubmit={onSubmit} onCancel={() => {}} />);
    const field = host.querySelector<HTMLTextAreaElement>('[data-testid="journal-capture-input"]')!;
    await type(field, "Call [[roo");
    expect(options()).toEqual([]);
    await press(field, "Enter");
    expect(onSubmit).toHaveBeenCalledWith("Call [[roo");
  });
});

describe("the task capture field", () => {
  it("completes a tag, which then counts as a recognised brick like a typed one", async () => {
    const onSubmit = vi.fn();
    const host = await mount(<InlineSuggestProvider source={source()}><Task onSubmit={onSubmit} /></InlineSuggestProvider>);
    const field = host.querySelector<HTMLInputElement>('[data-testid="task-capture-input"]')!;
    await type(field, "Send the offer #cl");
    expect(options().length).toBe(2);
    await press(field, "Tab");
    expect(field.value).toBe("Send the offer #client ");
    expect(onSubmit).not.toHaveBeenCalled();
    await press(field, "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: "Send the offer", tags: ["client"] });
  });

  it("keeps a link in the title", async () => {
    const onSubmit = vi.fn();
    const host = await mount(<InlineSuggestProvider source={source()}><Task onSubmit={onSubmit} /></InlineSuggestProvider>);
    const field = host.querySelector<HTMLInputElement>('[data-testid="task-capture-input"]')!;
    await type(field, "Check [[roof r");
    await press(field, "Enter");
    await press(field, "Enter");
    expect(onSubmit.mock.calls[0][0].title).toBe("Check [[Roof repair]]");
  });
});
