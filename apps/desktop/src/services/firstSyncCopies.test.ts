// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sayFirstSyncConflictCopies, toast, toastStore } from "@plainva/ui";

/**
 * A first sync onto a folder that already holds notes keeps both versions of
 * every file the two sides hold differently - and said nothing about it
 * (review 2026-10-27). Both shells now say it in one line, with a way to see
 * them.
 */
const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? " " + JSON.stringify(options) : ""}`;

afterEach(() => { for (const item of toastStore.get()) toast.dismiss(item.id); });

describe("the conflict copies of a first sync", () => {
  it("are named in one line, with a button that opens the first", () => {
    const show = vi.fn();
    sayFirstSyncConflictCopies(["a.CONFLICT-1.md", "b.CONFLICT-1.md", "c.CONFLICT-1.md"], t, show);

    const items = toastStore.get();
    const item = items[items.length - 1];
    expect(item.message).toBe('sync.firstSyncConflictCopies {"names":"a.CONFLICT-1.md, b.CONFLICT-1.md +1"}');
    expect(item.action?.label).toBe("common.show");
    item.action!.run();
    expect(show).toHaveBeenCalledWith("a.CONFLICT-1.md");
  });

  it("say nothing when there are none", () => {
    const before = toastStore.get().length;
    sayFirstSyncConflictCopies([], t, vi.fn());
    expect(toastStore.get().length).toBe(before);
  });
});
