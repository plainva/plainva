import { describe, expect, it, vi } from "vitest";
import { applyRelationWrite, reverseColumnState, reverseIntentFor, serializeBaseConfig } from "@plainva/ui";

function adapterWith(files: Record<string, string>) {
  return {
    readTextFile: vi.fn(async (p: string) => files[p] ?? ""),
    writeTextFile: vi.fn(async (p: string, text: string) => {
      files[p] = text;
    }),
  };
}

const targetBase = () =>
  serializeBaseConfig({
    filters: { and: ['file.folder == "Projects"'] },
    views: [{ type: "table", name: "All", order: ["file.name"] }],
  } as any);

describe("relation writes", () => {
  it("writes the target base when the reverse column lives elsewhere", async () => {
    const files = { "Projects.base": targetBase() };
    const adapter = adapterWith(files);
    const saveOwn = vi.fn(async () => {});
    const ok = await applyRelationWrite(
      adapter,
      { basePath: "Tasks.base", property: "project", relationBase: "Projects.base", reverseIntent: { action: "create", name: "tasks" } },
      saveOwn,
    );
    expect(ok).toBe(true);
    // The owning base is saved on its own; the target gets the computed column.
    expect(saveOwn).toHaveBeenCalledWith(null);
    expect(files["Projects.base"]).toContain("tasks");
    expect(files["Projects.base"]).toContain("Tasks.base");
  });

  it("folds a self-relation into the ONE save", async () => {
    // Writing the same file twice would either lose the schema change or race
    // with it — the reverse column has to travel with the owning save.
    const adapter = adapterWith({});
    let folded: ((cfg: any) => any) | null = null;
    const ok = await applyRelationWrite(
      adapter,
      { basePath: "Tasks.base", property: "parent", relationBase: "Tasks.base", reverseIntent: { action: "create", name: "subitems" } },
      async (f) => {
        folded = f;
      },
    );
    expect(ok).toBe(true);
    expect(folded).toBeTypeOf("function");
    expect(adapter.writeTextFile).not.toHaveBeenCalled();
    const cfg = folded!({ views: [{ type: "table", name: "All" }] });
    expect(cfg.columns.subitems.reverseOf).toEqual({ base: "Tasks.base", property: "parent" });
  });

  it("saves the owning base even when the target cannot be written", async () => {
    const adapter = {
      readTextFile: vi.fn(async () => {
        throw new Error("gone");
      }),
      writeTextFile: vi.fn(async () => {}),
    };
    const saveOwn = vi.fn(async () => {});
    const ok = await applyRelationWrite(
      adapter,
      { basePath: "Tasks.base", property: "project", relationBase: "Missing.base", reverseIntent: { action: "create", name: "tasks" } },
      saveOwn,
    );
    // A relation without its reverse column, not a half-written pair.
    expect(ok).toBe(false);
    expect(saveOwn).toHaveBeenCalledOnce();
  });

  it("does nothing beyond the own save without an intent", async () => {
    const adapter = adapterWith({});
    const saveOwn = vi.fn(async () => {});
    await applyRelationWrite(adapter, { basePath: "T.base", property: "p", relationBase: "P.base" }, saveOwn);
    expect(adapter.writeTextFile).not.toHaveBeenCalled();
    expect(saveOwn).toHaveBeenCalledWith(null);
  });

  it("derives the intent from what the target already has", () => {
    expect(reverseIntentFor(true, null, " tasks ")).toEqual({ action: "create", name: "tasks" });
    expect(reverseIntentFor(false, "tasks", "x")).toEqual({ action: "remove", name: "tasks" });
    // Already there / already absent: nothing to write.
    expect(reverseIntentFor(true, "tasks", "tasks")).toBeUndefined();
    expect(reverseIntentFor(false, null, "")).toBeUndefined();
  });

  it("finds an existing reverse column in the target", () => {
    const cfg = { columns: { tasks: { reverseOf: { base: "Tasks.base", property: "project" } } } };
    expect(reverseColumnState(cfg, "Tasks.base", "project").existing).toBe("tasks");
    expect(reverseColumnState(cfg, "Tasks.base", "other").existing).toBeNull();
  });
});
