// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InlineRelationEditor, type RelationSearchResult } from "./BaseInlineEditors";

/**
 * The relation editor of a database cell and the one link rule (finding
 * 2026-10-08).
 *
 * "Linked already" is a question about the NOTE. The editor used to answer it
 * with the link's text: a value stored as `[[Brief|Angebotsbrief]]` was no
 * longer recognised once a second `Brief.md` made the candidate's own text a
 * path, the note was offered again and linked twice. A note created from the
 * editor was linked by its bare title, which led to another note of that name
 * where one existed. The phone's sheet asks the rule since the same day; this
 * pins the desktop's side.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
const projectLetter: RelationSearchResult = { path: "Projekte/Brief.md", title: "Angebotsbrief", linkTarget: "Projekte/Brief" };
const oldLetter: RelationSearchResult = { path: "Archiv/Brief.md", title: "Brief", linkTarget: "Archiv/Brief" };

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});

/** Mounts the editor and waits for its first (debounced) search. */
async function mount(props: Partial<Parameters<typeof InlineRelationEditor>[0]> & { value: unknown }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const onCommit = vi.fn();
  await act(async () => {
    root.render(<InlineRelationEditor search={async () => [projectLetter, oldLetter]} onCommit={onCommit} onClose={() => {}} t={t} {...props} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  const offered = () => [...host.querySelectorAll<HTMLButtonElement>(".base-inline-result:not(.base-inline-create)")];
  return { host, onCommit, offered };
}

describe("InlineRelationEditor", () => {
  it("knows a linked note by where its link leads, however the link names it", async () => {
    // Stored with the file's name from the time it was the only `Brief`; the
    // candidate's own text has become a path since.
    const resolveTarget = (target: string) => (target === "Brief" ? "Projekte/Brief.md" : null);
    const { offered, onCommit } = await mount({ value: ["[[Brief|Angebotsbrief]]"], resolveTarget });
    expect(offered().map((b) => b.textContent)).toEqual(["Brief"]);

    // The other note of that name is a pick of its own: its path, and what it is called as the link's text.
    await act(async () => { offered()[0].click(); });
    expect(onCommit).toHaveBeenCalledWith(["[[Brief|Angebotsbrief]]", "[[Archiv/Brief|Brief]]"]);
  });

  it("marks a chip whose link leads nowhere, and only that one", async () => {
    const resolveTarget = (target: string) => (target === "Brief" ? "Projekte/Brief.md" : null);
    const { host } = await mount({ value: ["[[Brief]]", "[[Verschwunden]]"], resolveTarget });
    const chips = [...host.querySelectorAll<HTMLElement>(".base-inline-chips .pv-chip")];
    expect(chips.map((chip) => chip.classList.contains("pv-chip-broken"))).toEqual([false, true]);
  });

  it("compares link texts while there is no index to ask, as it used to", async () => {
    const { offered } = await mount({ value: ["[[Archiv/Brief]]"] });
    expect(offered().map((b) => b.textContent)).toEqual(["Angebotsbrief"]);
  });

  it("links a note it has just created by the name that leads to that note", async () => {
    // `Kunden/Meier.md` is new; a `Meier.md` lies elsewhere, so the bare name would lead there.
    const onCreateNew = vi.fn(async (): Promise<RelationSearchResult> => ({ path: "Kunden/Meier.md", title: "Meier", linkTarget: "Kunden/Meier" }));
    const { host, onCommit } = await mount({ value: [], onCreateNew, search: async () => [] });
    const input = host.querySelector<HTMLInputElement>(".base-inline-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Meier");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    await act(async () => { host.querySelector<HTMLButtonElement>(".base-inline-create")!.click(); });
    expect(onCreateNew).toHaveBeenCalledWith("Meier");
    expect(onCommit).toHaveBeenCalledWith(["[[Kunden/Meier|Meier]]"]);
  });
});
