import { describe, expect, it } from "vitest";
import { createComposerDraftStore, isEmptyComposerDraft } from "@plainva/ui";

/**
 * The AI composer's drafts (plan Umsetzung 0.9.x, B7): per conversation, on this device, in one small file beside the
 * vault's other AI data. The storage answers later, like the shells' file stores — never at once.
 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function files(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    unreadable: false,
    async read(path: string) {
      await tick();
      if (this.unreadable) throw new Error("permission denied");
      return data.get(path) ?? null;
    },
    async write(path: string, text: string) {
      await tick();
      writes.push(path);
      data.set(path, text);
    },
    async remove(path: string) {
      await tick();
      data.delete(path);
    },
  };
}

describe("the composer's drafts", () => {
  it("keeps the words and the start's choices per conversation, and a new conversation under its own key", async () => {
    const storage = files();
    const store = createComposerDraftStore({ storage, file: "v/composer-drafts.json", now: () => 1000 });
    await store.save("new", { text: "First question", pins: ["Offer.md"], choice: { providerId: "anthropic", model: "m-1" }, web: true });
    await store.save("id7", { text: "Follow-up" });
    // A fresh store over the same file — the app started again — reads them back.
    const again = createComposerDraftStore({ storage, file: "v/composer-drafts.json", now: () => 2000 });
    expect(await again.load("new")).toEqual({ text: "First question", pins: ["Offer.md"], choice: { providerId: "anthropic", model: "m-1" }, web: true });
    expect(await again.load("id7")).toEqual({ text: "Follow-up" });
    expect(await again.load("id8")).toBeNull();
  });

  it("removes a draft that was sent, and the file with the last one", async () => {
    const storage = files();
    const store = createComposerDraftStore({ storage, file: "v/composer-drafts.json" });
    await store.save("new", { text: "Question" });
    await store.clear("new");
    expect(storage.data.has("v/composer-drafts.json")).toBe(false);
    // An empty draft is no draft.
    await store.save("id1", { text: "  " });
    expect(storage.data.has("v/composer-drafts.json")).toBe(false);
    expect(isEmptyComposerDraft({ text: "", pins: [] })).toBe(true);
    expect(isEmptyComposerDraft({ text: "", pins: ["a.md"] })).toBe(false);
  });

  it("keeps the order it was given: a clear after a save stays a clear, a save after a clear stays", async () => {
    const storage = files();
    const store = createComposerDraftStore({ storage, file: "v/composer-drafts.json" });
    // Not awaited one by one: the lane holds them in order.
    const work = [store.save("new", { text: "a" }), store.clear("new"), store.save("new", { text: "b" })];
    await Promise.all(work);
    expect((await store.load("new"))?.text).toBe("b");
  });

  it("never writes over a file it cannot read", async () => {
    const storage = files({ "v/composer-drafts.json": '{"version":1,"drafts":{"id1":{"text":"kept","savedAt":5}}}' });
    storage.unreadable = true;
    const store = createComposerDraftStore({ storage, file: "v/composer-drafts.json", now: () => 10 });
    await store.save("new", { text: "x" });
    expect(storage.writes).toEqual([]);
    storage.unreadable = false;
    expect((await createComposerDraftStore({ storage, file: "v/composer-drafts.json", now: () => 10 }).load("id1"))?.text).toBe("kept");
  });

  it("reads what has its shape and nothing else, forgets what is old, and keeps the newest past the bound", async () => {
    const day = 24 * 60 * 60 * 1000;
    const storage = files({
      "v/composer-drafts.json": JSON.stringify({ version: 1, drafts: { old: { text: "old", savedAt: 0 }, bad: { text: 3, savedAt: 1 }, "../x": { text: "y", savedAt: 40 * day }, ok: { text: "ok", savedAt: 40 * day, web: "yes", pins: ["a", 2] } } }),
    });
    // The clock moves on by a second with each look at it: the newer of two drafts is the later one.
    let clock = 40 * day;
    const store = createComposerDraftStore({ storage, file: "v/composer-drafts.json", now: () => (clock += 1000), maxEntries: 2 });
    expect(await store.load("old")).toBeNull();
    expect(await store.load("bad")).toBeNull();
    expect(await store.load("ok")).toEqual({ text: "ok", pins: ["a"] });
    await store.save("n1", { text: "1" });
    await store.save("n2", { text: "2" });
    const kept = JSON.parse(storage.data.get("v/composer-drafts.json")!) as { drafts: Record<string, unknown> };
    expect(Object.keys(kept.drafts).sort()).toEqual(["n1", "n2"]);
  });
});
