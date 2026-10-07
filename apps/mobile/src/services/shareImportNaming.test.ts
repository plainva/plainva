import { describe, expect, it, vi } from "vitest";
import type { IVaultAdapter } from "@plainva/core";
import { importSharedContent, type ShareImportContext } from "./shareImport";
import type { PendingShare, ShareImportPlan, ShareTargetPort } from "./shareTarget";

/**
 * How a shared note gets its name (plan Offene Punkte, P2).
 *
 * It used to carry the first eight characters of the share's id — "Buy stamps
 * (5a4e0001)" — because that was the cheap way to keep two shares with one
 * title apart. The note is now named after its title and numbered like every
 * other note; what the id did is done by looking at the files AND at the plans
 * other shares have made but not written yet.
 */

const clone = <T,>(value: T): T => structuredClone(value);
const share = (id: string, subject: string): PendingShare => ({ version: 1, id, createdAt: 1, status: "ready", text: "shared text", subject, files: [] }) as PendingShare;

function world(entries: PendingShare[]) {
  const contents = new Map<string, string>();
  const pending = new Map(entries.map((entry) => [entry.id, clone(entry)]));
  const port: ShareTargetPort = {
    listPendingShares: vi.fn(async () => ({ entries: [...pending.values()].map(clone) })),
    beginImport: vi.fn(async ({ id, plan }: { id: string; plan: ShareImportPlan }) => {
      const entry = pending.get(id)!;
      entry.plan ??= clone(plan);
      return { entry: clone(entry) };
    }),
    readFileChunk: vi.fn(async () => ({ data: "" })),
    markImported: vi.fn(async ({ id, note }: { id: string; note?: boolean }) => {
      if (note) pending.get(id)!.noteWritten = true;
    }),
    finishShare: vi.fn(async ({ id }: { id: string }) => {
      pending.delete(id);
    }),
  } as unknown as ShareTargetPort;
  const files = {
    exists: vi.fn(async (path: string) => contents.has(path)),
    writeTextFile: vi.fn(async (path: string, text: string) => {
      contents.set(path, text);
    }),
    readTextFile: vi.fn(async (path: string) => contents.get(path) as string),
  };
  const context: ShareImportContext = { vaultId: "v", files: files as unknown as IVaultAdapter, folder: "Inbox", ensureOpen: vi.fn(async () => {}) };
  return { port, context, contents, pending };
}

const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";

describe("a shared note is named after its title", () => {
  it("carries no part of the share's id", async () => {
    const w = world([share(A, "Buy stamps")]);
    expect(await importSharedContent(w.port, w.pending.get(A)!, w.context)).toBe("Inbox/Buy stamps.md");
  });

  it("is numbered like any other note when a note of that name exists", async () => {
    const w = world([share(A, "Buy stamps")]);
    w.contents.set("Inbox/Buy stamps.md", "# Buy stamps\n\nan older one\n");
    expect(await importSharedContent(w.port, w.pending.get(A)!, w.context)).toBe("Inbox/Buy stamps 2.md");
    expect(w.contents.get("Inbox/Buy stamps.md")).toContain("an older one");
  });

  it("steps aside for a name another share has planned but not written yet", async () => {
    const earlier = share(B, "Buy stamps");
    earlier.plan = { version: 1, vaultId: "v", notePath: "Inbox/Buy stamps.md", noteText: "# Buy stamps\n\nshared text\n", files: [] } as ShareImportPlan;
    const w = world([share(A, "Buy stamps"), earlier]);
    expect(await importSharedContent(w.port, w.pending.get(A)!, w.context)).toBe("Inbox/Buy stamps 2.md");
  });

  it("does not step aside for a plan that belongs to another vault", async () => {
    const elsewhere = share(B, "Buy stamps");
    elsewhere.plan = { version: 1, vaultId: "other", notePath: "Inbox/Buy stamps.md", noteText: "x", files: [] } as ShareImportPlan;
    const w = world([share(A, "Buy stamps"), elsewhere]);
    expect(await importSharedContent(w.port, w.pending.get(A)!, w.context)).toBe("Inbox/Buy stamps.md");
  });

  it("gives two shares with one title, imported side by side, two names — and both notes arrive", async () => {
    const w = world([share(A, "Buy stamps"), share(B, "Buy stamps")]);
    const paths = await Promise.all([
      importSharedContent(w.port, w.pending.get(A)!, w.context),
      importSharedContent(w.port, w.pending.get(B)!, w.context),
    ]);
    expect([...paths].sort()).toEqual(["Inbox/Buy stamps 2.md", "Inbox/Buy stamps.md"]);
    expect(w.contents.size).toBe(2);
  });

  it("keeps the name a plan already has: a retry does not rename", async () => {
    const planned = share(A, "Buy stamps");
    planned.plan = { version: 1, vaultId: "v", notePath: "Inbox/Buy stamps (aaaaaaaa).md", noteText: "# Buy stamps\n\nshared text\n", files: [] } as ShareImportPlan;
    const w = world([planned]);
    // A plan made by an earlier version of the app is finished as planned.
    expect(await importSharedContent(w.port, w.pending.get(A)!, w.context)).toBe("Inbox/Buy stamps (aaaaaaaa).md");
  });
});
