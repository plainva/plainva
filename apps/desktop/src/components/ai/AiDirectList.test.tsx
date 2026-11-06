// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppliedWrite, RunWrites } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiRunWrites, EMPTY_WRITE_DRAFTS } from "@plainva/ui";

/**
 * "Changed" under an answer (plan "KI direkt schreiben", W2): what a run wrote
 * directly, each note with "View" and "Undo", "Undo all" while more than one can
 * still be taken back — and, for a change that became a suggestion after all, the
 * line that says why. One component for both shells.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await i18n.changeLanguage("de");
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const entry = (patch: Partial<AppliedWrite>): AppliedWrite => ({ path: "Projekte/Website/Start.md", kind: "edit", created: false, passages: 3, properties: 0, before: ".plainva/backups/x.1.bak", after: "h", by: "chat", ...patch });

function show(writes: RunWrites, onUndo = vi.fn(), onOpenNote = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<AiRunWrites writes={writes} state={EMPTY_WRITE_DRAFTS} canCreate busy={false} onOpenNote={onOpenNote} onCreate={() => {}} onDiscard={() => {}} onUndo={onUndo} />));
  return { onUndo, onOpenNote };
}

const byTest = (id: string) => [...host!.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];

describe("the list of what was changed directly", () => {
  it("counts the notes, names each with what changed, and offers View, Undo and Undo all", () => {
    const { onUndo, onOpenNote } = show({
      rounds: [],
      drafts: [],
      plans: [],
      applied: [entry({}), entry({ path: "Projekte/Website/Texte.md", passages: 0, properties: 1 }), entry({ path: "Projekte/Website/Übersicht.md", created: true, passages: 0, before: null })],
    });
    expect(byTest("ai-direct-changed")[0]!.textContent).toContain("Geändert: 2 Notizen, 1 neu");
    expect(byTest("ai-direct-row").map((row) => row.querySelector("span")!.textContent)).toEqual(["Start · 3 Textstellen", "Texte · 1 Eigenschaft", "Übersicht · neu"]);
    act(() => byTest("ai-direct-undo")[1]!.click());
    expect(onUndo).toHaveBeenLastCalledWith("Projekte/Website/Texte.md");
    act(() => byTest("ai-direct-undo-all")[0]!.click());
    expect(onUndo).toHaveBeenLastCalledWith();
    act(() => byTest("ai-direct-view")[0]!.click());
    expect(onOpenNote).toHaveBeenCalledWith("Projekte/Website/Start.md");
  });

  it("shows a note that was taken back as such, and no Undo all for the one that is left", () => {
    show({ rounds: [], drafts: [], plans: [], applied: [entry({ undone: true }), entry({ path: "B.md" })] });
    expect(byTest("ai-direct-undone")).toHaveLength(1);
    expect(byTest("ai-direct-undo")).toHaveLength(1);
    expect(byTest("ai-direct-undo-all")).toHaveLength(0);
  });

  it("says why a change became a suggestion after all", () => {
    show({ rounds: [{ path: "Planung.md", blocks: 2, properties: 0, fallback: "unsaved" }], drafts: [], plans: [] });
    expect(byTest("ai-direct-fallback")[0]!.textContent).toBe("„Planung“ war im Editor offen und nicht gespeichert — dort liegt die Änderung als Vorschlag.");
    expect(byTest("ai-direct-changed")).toHaveLength(0);
  });
});
