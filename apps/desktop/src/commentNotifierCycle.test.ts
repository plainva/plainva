import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import {
  commentLockState,
  drawCommentNotificationBaseline,
  runCommentNotificationCycle,
  type CommentLockState,
  type CommentNotificationCycle,
  type CommentNotificationNote,
} from "@plainva/ui";

/**
 * Locked means: do not look, do not write, do not speak (plan Befunde 24.09.,
 * E7). A locked store lists NO remarks — an empty list, not an error — and the
 * cycle used to take that list at its word: the seen-ledger was pruned to
 * nothing, and after unlocking every old, open remark was announced again, with
 * its preview. On the phone that happened on every return to the app while the
 * workspace runtime was still loading.
 */

function remark(commentId: string): WorkspaceCommentRecord {
  return {
    commentId,
    targetObjectId: "notes/Report.md",
    parentCommentId: null,
    authorMemberId: "them",
    authorDeviceId: "device-them",
    body: "The figure in paragraph three does not match",
    anchor: null,
    suggestion: null,
    createdAt: "2026-09-24T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
  } as WorkspaceCommentRecord;
}

/** A vault whose lock a test can turn, and whose store lists nothing while locked — as the real stores do. */
function fakeVault(comments: WorkspaceCommentRecord[]) {
  let lock: CommentLockState = "open";
  let ledger: string[] = [];
  const announce = vi.fn(async () => {});
  const writeSeen = vi.fn(async (ids: string[]) => { ledger = ids; });
  const listNotes = vi.fn(async (): Promise<CommentNotificationNote[]> =>
    lock === "locked" ? [] : [{ path: "notes/Report.md", comments }]);
  const cycle: CommentNotificationCycle = {
    lockState: async () => lock,
    settings: async () => ({ enabled: true, level: "all", preview: true, mutedPaths: [] }),
    listNotes,
    readSeen: async () => new Set(ledger),
    writeSeen,
    names: async () => new Map(),
    identity: async () => ({ memberId: "me", deviceId: "device-me" }),
    announce,
  };
  return {
    cycle, announce, writeSeen, listNotes,
    setLock: (next: CommentLockState) => { lock = next; },
    ledger: () => ledger,
  };
}

describe("the notification cycle and the lock", () => {
  it("c1 -> locked -> c1 again: nothing is announced a second time", async () => {
    const vault = fakeVault([remark("c1")]);

    const first = await runCommentNotificationCycle(vault.cycle);
    expect(first?.kind).toBe("single");
    expect(vault.announce).toHaveBeenCalledTimes(1);
    expect(vault.ledger()).toEqual(["c1"]);

    vault.setLock("locked");
    expect(await runCommentNotificationCycle(vault.cycle)).toBeNull();
    // The ledger was not pruned to the empty list a locked store answers with.
    expect(vault.ledger()).toEqual(["c1"]);

    vault.setLock("open");
    const third = await runCommentNotificationCycle(vault.cycle);
    expect(third?.kind).toBe("none");
    expect(vault.announce).toHaveBeenCalledTimes(1);
  });

  it("a locked vault is not even read", async () => {
    const vault = fakeVault([remark("c1")]);
    vault.setLock("locked");
    const waiting = vi.fn();
    expect(await runCommentNotificationCycle({ ...vault.cycle, reportWaiting: waiting })).toBeNull();
    expect(vault.listNotes).not.toHaveBeenCalled();
    expect(vault.writeSeen).not.toHaveBeenCalled();
    expect(waiting).not.toHaveBeenCalled();
    expect(vault.announce).not.toHaveBeenCalled();
  });

  it("a lock that comes while the remarks are listed keeps the ledger as it was", async () => {
    const vault = fakeVault([remark("c1")]);
    await runCommentNotificationCycle(vault.cycle);
    vault.writeSeen.mockClear();
    // Open when asked first, locked by the time the list is back.
    let asked = 0;
    const racing = { ...vault.cycle, lockState: async (): Promise<CommentLockState> => (asked++ === 0 ? "open" : "locked"), listNotes: async () => [] };
    expect(await runCommentNotificationCycle(racing)).toBeNull();
    expect(vault.writeSeen).not.toHaveBeenCalled();
    expect(vault.ledger()).toEqual(["c1"]);
  });

  it("a lock right before the message silences it", async () => {
    const vault = fakeVault([remark("c1")]);
    let asked = 0;
    const racing = { ...vault.cycle, lockState: async (): Promise<CommentLockState> => (asked++ < 2 ? "open" : "locked") };
    const plan = await runCommentNotificationCycle(racing);
    expect(plan?.kind).toBe("single");
    expect(vault.announce).not.toHaveBeenCalled();
  });

  it("with notifications off, a locked vault keeps its ledger too", async () => {
    const vault = fakeVault([remark("c1")]);
    const off = { ...vault.cycle, settings: async () => ({ enabled: false, level: "all" as const, preview: true, mutedPaths: [] }) };
    await runCommentNotificationCycle(off);
    expect(vault.ledger()).toEqual(["c1"]);
    vault.setLock("locked");
    await runCommentNotificationCycle(off);
    expect(vault.ledger()).toEqual(["c1"]);
  });

  it("switching on draws no baseline from a locked vault", async () => {
    const vault = fakeVault([remark("c1")]);
    await drawCommentNotificationBaseline(vault.cycle);
    expect(vault.ledger()).toEqual(["c1"]);
    vault.setLock("locked");
    await drawCommentNotificationBaseline(vault.cycle);
    expect(vault.writeSeen).toHaveBeenCalledTimes(1);
    expect(vault.ledger()).toEqual(["c1"]);
  });
});

describe("commentLockState", () => {
  it("is open only when the store can read and the workspace is not sealed", () => {
    expect(commentLockState({ mode: "plain" }, false)).toBe("open");
    expect(commentLockState({ mode: "workspace" }, false)).toBe("open");
    expect(commentLockState({ mode: "sealed" }, false)).toBe("open");
    expect(commentLockState({ mode: "locked" }, false)).toBe("locked");
    // An unlocked workspace whose older sideband history is still sealed lists too little.
    expect(commentLockState({ mode: "workspace", legacyLocked: true }, false)).toBe("locked");
    expect(commentLockState({ mode: "workspace" }, true)).toBe("locked");
    // No store to ask: the answer is the lock.
    expect(commentLockState(null, false)).toBe("locked");
  });
});
