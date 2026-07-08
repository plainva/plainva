import { describe, it, expect, beforeEach, vi } from "vitest";
import { activeDocument, createDocChannel } from "./activeDocument";

describe("activeDocument", () => {
  // The channel is a module-level singleton — reset between tests.
  beforeEach(() => {
    activeDocument.clear();
  });

  it("starts (and clears) to the empty none-state", () => {
    expect(activeDocument.get()).toEqual({ path: null, content: "", kind: "none", meta: {} });
  });

  it("merges partial updates and keeps untouched fields", () => {
    activeDocument.set({ path: "a.md", content: "# A", kind: "markdown", meta: {} });
    activeDocument.set({ content: "# A edited" });
    expect(activeDocument.get()).toEqual({ path: "a.md", content: "# A edited", kind: "markdown", meta: {} });
  });

  it("notifies subscribers synchronously with the new value", () => {
    const seen: string[] = [];
    activeDocument.subscribe((doc) => seen.push(doc.content));
    activeDocument.set({ content: "one" });
    activeDocument.set({ content: "two" });
    expect(seen).toEqual(["one", "two"]);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = activeDocument.subscribe(listener);
    activeDocument.set({ content: "one" });
    unsubscribe();
    activeDocument.set({ content: "two" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps notifying later subscribers when one listener throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    const unsubBad = activeDocument.subscribe(() => { throw new Error("boom"); });
    const unsubGood = activeDocument.subscribe(good);
    activeDocument.set({ content: "x" });
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    // subscriptions survive clear(), so drop them explicitly
    unsubBad();
    unsubGood();
    errorSpy.mockRestore();
  });

  it("applyFrontmatter reports false while no editor is registered", () => {
    expect(activeDocument.applyFrontmatter("---\ntitle: x\n---\n")).toBe(false);
  });

  it("applyFrontmatter forwards to the registered editor bridge", () => {
    const apply = vi.fn();
    activeDocument.registerApplyFrontmatter(apply);
    expect(activeDocument.applyFrontmatter("new content")).toBe(true);
    expect(apply).toHaveBeenCalledWith("new content");
  });

  it("clear() drops the registered frontmatter bridge", () => {
    activeDocument.registerApplyFrontmatter(vi.fn());
    activeDocument.clear();
    expect(activeDocument.applyFrontmatter("x")).toBe(false);
  });
});

describe("createDocChannel (scoped peek channel)", () => {
  beforeEach(() => {
    activeDocument.clear();
  });

  it("produces independent channels that don't cross-notify", () => {
    const a = createDocChannel();
    const b = createDocChannel();
    const seenA: string[] = [];
    const seenB: string[] = [];
    a.subscribe((d) => seenA.push(d.content));
    b.subscribe((d) => seenB.push(d.content));
    a.set({ content: "from-a" });
    b.set({ content: "from-b" });
    expect(seenA).toEqual(["from-a"]);
    expect(seenB).toEqual(["from-b"]);
    expect(a.get().content).toBe("from-a");
    expect(b.get().content).toBe("from-b");
  });

  it("a scoped channel never touches the global activeDocument", () => {
    const scoped = createDocChannel();
    const globalSeen = vi.fn();
    const unsub = activeDocument.subscribe(globalSeen);
    scoped.set({ path: "peek.md", content: "peek", kind: "markdown", meta: {} });
    expect(globalSeen).not.toHaveBeenCalled();
    expect(activeDocument.get().path).toBeNull();
    unsub();
  });

  it("scoped applyFrontmatter routes to its own bridge, not the global one", () => {
    const scoped = createDocChannel();
    const globalApply = vi.fn();
    const scopedApply = vi.fn();
    activeDocument.registerApplyFrontmatter(globalApply);
    scoped.registerApplyFrontmatter(scopedApply);
    expect(scoped.applyFrontmatter("scoped")).toBe(true);
    expect(scopedApply).toHaveBeenCalledWith("scoped");
    expect(globalApply).not.toHaveBeenCalled();
  });
});
