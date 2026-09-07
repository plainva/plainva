// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { IVaultAdapter } from "@plainva/core";
import { createNoteFromLink } from "./createNoteFromLink";

/**
 * The note behind an unresolved wiki link (finding 2026-09-07): one decision
 * for both shells. The central window used to own this inline; an auxiliary
 * window — same editor, same click — created nothing. These pin the rules
 * the shells share, so the second caller cannot drift from the first.
 */

function adapter(files: Set<string>, log: string[]): IVaultAdapter {
  return {
    exists: async (p: string) => files.has(p),
    createDir: async (p: string) => {
      log.push("mkdir:" + p);
      files.add(p);
    },
    writeTextFile: async (p: string, content: string) => {
      log.push("write:" + p + ":" + (content.includes("# Neu") || content.includes("Neu") ? "titled" : "plain"));
      files.add(p);
    },
  } as unknown as IVaultAdapter;
}

const deps = (files: Set<string>, log: string[], opts: { ask?: boolean; confirm?: boolean; index?: boolean } = {}) => ({
  vaultAdapter: adapter(files, log),
  noteType: async () => "plain",
  askFirst: async () => opts.ask ?? false,
  confirm: async (title: string) => {
    log.push("confirm:" + title);
    return opts.confirm ?? true;
  },
  index: opts.index ? async (p: string) => { log.push("index:" + p); } : undefined,
});

describe("createNoteFromLink", () => {
  it("opens an existing target without writing", async () => {
    const files = new Set(["Neu.md"]);
    const log: string[] = [];
    const result = await createNoteFromLink("Neu", "Host.md", deps(files, log));
    expect(result).toEqual({ outcome: "exists", path: "Neu.md" });
    expect(log).toEqual([]);
  });

  it("creates the note, its folder and the index entry, and announces the file op", async () => {
    const files = new Set<string>();
    const log: string[] = [];
    const ops: unknown[] = [];
    const on = (e: Event) => ops.push((e as CustomEvent).detail.ops);
    window.addEventListener("plainva-file-ops", on);

    const result = await createNoteFromLink("Projekte/Neu", "Host.md", deps(files, log, { index: true }));

    expect(result).toEqual({ outcome: "created", path: "Projekte/Neu.md" });
    expect(log).toEqual(["mkdir:Projekte", "write:Projekte/Neu.md:titled", "index:Projekte/Neu.md"]);
    expect(ops).toEqual([[{ type: "create", path: "Projekte/Neu.md" }]]);
    window.removeEventListener("plainva-file-ops", on);
  });

  it("asks first when the setting says so, and a no writes nothing", async () => {
    const files = new Set<string>();
    const log: string[] = [];
    const result = await createNoteFromLink("Neu", undefined, deps(files, log, { ask: true, confirm: false }));
    expect(result).toEqual({ outcome: "declined" });
    expect(log).toEqual(["confirm:Neu"]);
  });

  it("does nothing for a link without a title", async () => {
    const files = new Set<string>();
    const log: string[] = [];
    expect(await createNoteFromLink("", undefined, deps(files, log))).toEqual({ outcome: "no-title" });
    expect(log).toEqual([]);
  });
});
