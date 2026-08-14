// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildNoteEmbedCoreExtension, type NoteEmbedRenderer } from "@plainva/ui";

/** Mounts a view with the embed core and a synchronous test renderer. */
function mount(doc: string, hideSyntax = true) {
  const cleanup = vi.fn();
  const rendered: string[] = [];
  const renderer: NoteEmbedRenderer = {
    render(container, target) {
      rendered.push(target);
      const card = document.createElement("span");
      card.className = "m-embed-card";
      card.textContent = target;
      container.appendChild(card);
      return cleanup;
    },
  };
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [buildNoteEmbedCoreExtension(renderer, hideSyntax)] }),
    parent,
  });
  return { view, parent, rendered, cleanup };
}

describe("noteEmbedCore (M3E package H)", () => {
  it("replaces a ![[Note]] line with the injected widget", () => {
    const { parent, rendered, view } = mount("Intro\n![[Ziel Notiz]]\nOutro");
    expect(rendered).toEqual(["Ziel Notiz"]);
    expect(parent.querySelectorAll(".cm-note-embed .m-embed-card").length).toBe(1);
    view.destroy();
  });

  it("skips image targets (they belong to the image plugin)", () => {
    const { rendered, view } = mount("![[foto.png]]\n![[Echte Notiz]]");
    expect(rendered).toEqual(["Echte Notiz"]);
    view.destroy();
  });

  it("cleans up the renderer when the widget leaves", () => {
    const { view, cleanup } = mount("![[A]]");
    view.destroy();
    expect(cleanup).toHaveBeenCalled();
  });

  it("keeps raw syntax visible when hideSyntax is off (source mode)", () => {
    const { parent, view } = mount("![[A]]", false);
    // widget renders BESIDE the syntax instead of replacing it
    expect(parent.textContent).toContain("![[A]]");
    expect(parent.querySelectorAll(".cm-note-embed").length).toBe(1);
    view.destroy();
  });
});

describe("the desktop embed converges on the core (C12/S20)", () => {
  // A behaviour test cannot tell the core apart from an identical private copy
  // — that is exactly how the second implementation survived unnoticed until
  // the core had no caller at all. So this one reads the source.
  const source = readFileSync(join(__dirname, "NoteEmbedPlugin.tsx"), "utf8");

  it("takes the mechanics from the shared core", () => {
    expect(source).toContain("buildNoteEmbedCoreExtension");
  });

  it("does not build its own decoration plugin any more", () => {
    // The mechanics live in one place; a second ViewPlugin here would drift.
    expect(source).not.toContain("ViewPlugin.fromClass");
    expect(source).not.toContain("RangeSetBuilder");
    expect(source).not.toMatch(/Decoration\.(replace|widget)\b/);
  });

  it("keeps only the preview, which is what makes it the desktop's", () => {
    // The React root reaches vault context, i18n and the .base viewer — none
    // of which the shell-neutral core may know about.
    expect(source).toContain("createRoot");
    expect(source).toContain("VaultContext.Provider");
    expect(source).toContain("root.unmount()");
  });
});
