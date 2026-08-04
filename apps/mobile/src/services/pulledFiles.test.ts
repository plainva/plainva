import { describe, expect, it } from "vitest";
import { notifyPulledFiles } from "./pulledFiles";

/**
 * A pulled file must reach the open editor (S45).
 *
 * Before this, the phone reported a sync pull only as a generic
 * "m-vault-changed" for the lists. The editor listens for
 * "m-external-update" — and its only source, the indexer, is structurally
 * unable to fire for a pulled file, because the worker advances the recorded
 * hash to the content it just wrote before reporting. So the editor never
 * learned, and its next save overwrote the version that had just arrived.
 */
describe("notifyPulledFiles", () => {
  const collect = () => {
    const seen: Array<{ type: string; path?: string }> = [];
    return {
      seen,
      dispatch: (e: Event) => {
        seen.push({ type: e.type, path: (e as CustomEvent).detail?.path });
      },
    };
  };

  it("announces every pulled path to the editor", () => {
    const { seen, dispatch } = collect();
    notifyPulledFiles(["a.md", "sub/b.md"], dispatch);
    expect(seen.filter((e) => e.type === "m-external-update").map((e) => e.path)).toEqual(["a.md", "sub/b.md"]);
  });

  it("still refreshes the lists once", () => {
    const { seen, dispatch } = collect();
    notifyPulledFiles(["a.md", "b.md"], dispatch);
    expect(seen.filter((e) => e.type === "m-vault-changed")).toHaveLength(1);
  });

  it("says nothing about a conflict copy", () => {
    // A .CONFLICT file is the editor's own draft being preserved, not a change
    // to the note under it; announcing it would make the editor react to itself.
    const { seen, dispatch } = collect();
    notifyPulledFiles(["note.md", "note.CONFLICT-2026-08-04.md"], dispatch);
    expect(seen.filter((e) => e.type === "m-external-update").map((e) => e.path)).toEqual(["note.md"]);
  });

  it("reports nothing per path when the pull brought nothing", () => {
    const { seen, dispatch } = collect();
    notifyPulledFiles([], dispatch);
    expect(seen.map((e) => e.type)).toEqual(["m-vault-changed"]);
  });
});
