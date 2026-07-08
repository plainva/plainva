import { describe, it, expect } from "vitest";
import { baseNeedsRefresh } from "./baseRefreshScope";

const folderCfg = (folder: string, extra: Record<string, unknown> = {}) => ({
  filters: { and: [`file.folder == "${folder}"`] },
  properties: {},
  ...extra,
});

describe("baseNeedsRefresh (P2.7 refresh scoping)", () => {
  it("refreshes on global/unknown bumps", () => {
    expect(baseNeedsRefresh(folderCfg("Tasks"), null)).toBe(true);
    expect(baseNeedsRefresh(folderCfg("Tasks"), undefined)).toBe(true);
    expect(baseNeedsRefresh(folderCfg("Tasks"), [])).toBe(true);
    expect(baseNeedsRefresh(null, ["x.md"])).toBe(true);
  });

  it("refreshes when a .base file changed (could be this config)", () => {
    expect(baseNeedsRefresh(folderCfg("Tasks"), ["Databases/Tasks.base"])).toBe(true);
    expect(baseNeedsRefresh(folderCfg("Tasks"), ["Other.BASE"])).toBe(true);
  });

  it("always refreshes bases with tag sources (tags match anywhere)", () => {
    const cfg = { filters: { and: ['file.hasTag("projekt")'] }, properties: {} };
    expect(baseNeedsRefresh(cfg, ["Elsewhere/note.md"])).toBe(true);
  });

  it("always refreshes bases with relation or reverse columns", () => {
    const rel = folderCfg("Tasks", {
      properties: { projekt: { displayName: "Projekt", plainva: { relationBase: "Projekte.base" } } },
    });
    const rev = folderCfg("Projekte", {
      properties: { aufgaben: { displayName: "Aufgaben", plainva: { reverseOf: "Tasks.base#projekt" } } },
    });
    expect(baseNeedsRefresh(rel, ["Elsewhere/note.md"])).toBe(true);
    expect(baseNeedsRefresh(rev, ["Elsewhere/note.md"])).toBe(true);
  });

  it("matches changed paths against the folder sources", () => {
    const cfg = folderCfg("Tasks");
    expect(baseNeedsRefresh(cfg, ["Tasks/todo.md"])).toBe(true);
    expect(baseNeedsRefresh(cfg, ["Tasks\\sub\\deep.md"])).toBe(true);
    expect(baseNeedsRefresh(cfg, ["Taskserweiterung/x.md"])).toBe(false); // sibling prefix, not the folder
    expect(baseNeedsRefresh(cfg, ["Elsewhere/note.md"])).toBe(false);
  });

  it("treats a root folder source as matching everything", () => {
    expect(baseNeedsRefresh(folderCfg(""), ["anywhere.md"])).toBe(true);
  });

  it("stays conservative without a recognizable folder source", () => {
    const cfg = { filters: { and: ['status == "open"'] }, properties: {} };
    expect(baseNeedsRefresh(cfg, ["Elsewhere/note.md"])).toBe(true);
  });

  it("understands nested filter groups", () => {
    const cfg = {
      filters: { and: [{ or: ['file.folder == "Deep"', 'status == "x"'] }] },
      properties: {},
    };
    expect(baseNeedsRefresh(cfg, ["Deep/note.md"])).toBe(true);
    expect(baseNeedsRefresh(cfg, ["Shallow/note.md"])).toBe(false);
  });
});
