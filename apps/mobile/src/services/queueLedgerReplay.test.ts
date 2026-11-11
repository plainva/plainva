// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseQueueLedger, replayQueueLedger, serializeQueueLedger, type PermissionedVaultAdapter, type QueueLedgerStore, type SqlWorkspaceStateStore } from "@plainva/core";
import { workspaceLedgerTarget } from "./queueLedgerReplay";

/**
 * The queue ledger handed to an encrypted workspace (stability plan R5): the
 * workspace's rules decide each entry, and a workspace that cannot decide
 * keeps the ledger.
 */

const REMOTE = "s3:https://s3.example/bucket/";

function store(text: string | null) {
  const state = { text };
  const s: QueueLedgerStore = {
    load: async () => state.text,
    save: async (t) => { state.text = t; },
    clear: async () => { state.text = null; },
    setAside: async () => { state.text = null; },
  };
  return { s, state };
}

function workspace(allow: (path: string) => boolean) {
  const enqueued: string[] = [];
  const asked: string[] = [];
  const permissioned = {
    authorizeExternalChange: async (path: string) => { asked.push(path); return allow(path); },
  } as unknown as PermissionedVaultAdapter;
  const state = {
    enqueue: async (operation: string, path: string, newPath?: string | null) => { enqueued.push(newPath ? `${operation} ${path} -> ${newPath}` : `${operation} ${path}`); return 1; },
  } as unknown as SqlWorkspaceStateStore;
  return { permissioned, state, enqueued, asked };
}

const disk = (paths: string[]) => ({ exists: async (p: string) => paths.includes(p) });

describe("the queue ledger in an encrypted workspace", () => {
  it("stays as it is while the workspace's runtime is not open: nothing is decided, nothing is dropped", async () => {
    const text = serializeQueueLedger(REMOTE, [{ op: "delete", paths: ["Secret.md"] }, { op: "rename", from: "A.md", to: "B.md" }]);
    const { s, state } = store(text);
    const ws = workspace(() => true);
    const denied: string[] = [];
    const result = await replayQueueLedger(s, workspaceLedgerTarget(ws.permissioned, ws.state, disk(["B.md"]), () => false, (p) => denied.push(p)), { binding: REMOTE });
    expect(result.stoppedBy).toBeInstanceOf(Error);
    expect(ws.asked).toEqual([]);
    expect(ws.enqueued).toEqual([]);
    expect(state.text).toBe(text);
  });

  it("queues what the rules allow, and a denied entry once: it is not asked again at the next start", async () => {
    const { s, state } = store(serializeQueueLedger(REMOTE, [
      { op: "delete", paths: ["Mine.md", "Theirs.md"] },
      { op: "rename", from: "A.md", to: "B.md" },
      { op: "write", path: "B.md" },
    ]));
    const ws = workspace((path) => path !== "Theirs.md");
    const denied: string[] = [];
    const target = workspaceLedgerTarget(ws.permissioned, ws.state, disk(["B.md"]), () => true, (p) => denied.push(p));
    expect((await replayQueueLedger(s, target, { binding: REMOTE })).handed).toBe(3);
    expect(ws.enqueued).toEqual(["delete Mine.md", "rename A.md -> B.md", "write B.md"]);
    expect(denied).toEqual(["Theirs.md"]);
    expect(state.text).toBeNull();
    // The next start finds nothing: the denial is not asked for, nor forked, again.
    await replayQueueLedger(s, target, { binding: REMOTE });
    expect(denied).toEqual(["Theirs.md"]);
    expect(parseQueueLedger(state.text)).toBeNull();
  });
});
