import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommentOperationError, prepareCommentOperation } from "@plainva/core";
import { clientCommentOperations } from "./clientCommentOperations";
const request = vi.hoisted(() => vi.fn());
vi.mock("./windowBus", () => ({ getWindowBus: async () => ({ request }) }));
beforeEach(() => request.mockReset());
const prepared = () => prepareCommentOperation({ contextKey: "/vault", authorKey: "bundle:desktop", notePath: "note.md", kind: "post", markers: [{ path: "note.md", body: "A reply" }] });

describe("comment operation replies across the window boundary", () => {
  it.each([null, {}, "", [null]])("rejects an invalid pending response instead of handing it to the editor: %j", async (reply) => {
    request.mockResolvedValue(reply);
    await expect(clientCommentOperations("/vault").pending("note.md")).rejects.toThrow();
    expect(request).toHaveBeenCalledWith("comment-operation-pending", { path: "note.md" }, { vaultPath: "/vault" });
  });
  it("accepts an empty history and rejects another vault or a duplicated identity", async () => {
    const client = clientCommentOperations("/vault"), op = prepared();
    request.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...op, contextKey: "/other" }]).mockResolvedValueOnce([op, op]);
    expect(await client.pending()).toEqual([]);
    await expect(client.pending()).rejects.toThrow();
    await expect(client.pending()).rejects.toThrow();
  });
  it("binds reads and completion to the requested operation", async () => {
    const client = clientCommentOperations("/vault"), op = prepared(), other = prepared();
    request.mockResolvedValueOnce(null).mockResolvedValueOnce(other).mockResolvedValueOnce({ ok: true, operation: op });
    expect(await client.read(op.operationId)).toBeNull();
    await expect(client.read(op.operationId)).rejects.toThrow();
    await expect(client.run(op)).rejects.toThrow();
    request.mockResolvedValue({ ok: true, operation: { ...op, phase: "completed", postedIds: op.markers.map((marker) => marker.identity.commentId) } });
    expect((await client.run(op)).phase).toBe("completed");
  });
  it("preserves a valid resumable failure and rejects malformed failures", async () => {
    const client = clientCommentOperations("/vault"), op = prepared();
    request.mockResolvedValueOnce({ ok: false, operationId: op.operationId, phase: "markers-pending", reason: "storage" });
    await expect(client.run(op)).rejects.toBeInstanceOf(CommentOperationError);
    for (const value of [null, { ok: false, operationId: op.operationId, phase: "missing", reason: "storage" }, { ok: false, operationId: prepared().operationId, phase: "prepared", reason: "storage" }]) {
      request.mockResolvedValue(value);
      await expect(client.run(op)).rejects.toThrow("Invalid comment operation reply");
    }
  });
  it("checks the prepared note and keeps the captured vault address", async () => {
    const client = clientCommentOperations("/vault"), op = prepared();
    const input = { notePath: "other.md", kind: "post" as const, markers: [{ path: "other.md", body: "Other reply" }] };
    request.mockResolvedValue(op);
    await expect(client.prepare(input)).rejects.toThrow();
    expect(request).toHaveBeenCalledWith("comment-operation-prepare", input, { vaultPath: "/vault" });
  });
});
