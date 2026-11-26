import { describe, expect, it, vi } from "vitest";
import { FakeWorkspaceObjectStore, parseWorkspaceDocument, workspaceDocumentHash, type WorkspaceOperationPayload, type WorkspaceSignedDocument } from "../src/workspace/index.js";
import { restoreKnownOperationCopies } from "../src/workspace/operationRecovery.js";
import { commentShellWorkspace } from "./helpers/commentShellWorkspace.js";

describe("verified missing operation recovery", () => {
  it("does not advance an accepted head when payload verification fails", async () => {
    const fixture = await commentShellWorkspace();
    try {
      const info = (await fixture.remote.list(".pvws/operations/")).items[0];
      const bytes = (await fixture.remote.get(info.key))!;
      const document = parseWorkspaceDocument(bytes) as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
      const meta = (await fixture.state.loadMeta())!;
      meta.operationHeads = {};
      const before = structuredClone(meta);
      fixture.remote.tamper(`.pvws/objects/${document.payload.objectId}/${document.payload.payloadHash}.pvobj`, new Uint8Array([1, 2, 3]));
      await expect(fixture.worker["applyIncoming"](document, workspaceDocumentHash(document), meta, fixture.runtime.policy.payload)).rejects.toThrow("missing or changed");
      expect(meta).toEqual(before);
    } finally { await fixture.cleanup(); }
  });
  it("restores exact signed bytes from an intact local chain without changing trust anchors", async () => {
    const fixture = await commentShellWorkspace();
    try {
      const before = await fixture.state.loadMeta();
      const destination = new FakeWorkspaceObjectStore();
      const result = await restoreKnownOperationCopies({ state: fixture.state, store: destination, workspaceId: fixture.runtime.workspaceId,
        policies: new Map([[workspaceDocumentHash(fixture.runtime.policy), fixture.runtime.policy.payload]]), listedKeys: new Set() });
      expect(result).toEqual({ restored: 1, unavailable: 0 });
      const entries = (await destination.list(".pvws/operations/")).items;
      expect(entries).toHaveLength(1);
      expect(await destination.get(entries[0].key)).toEqual(await fixture.remote.get(entries[0].key));
      expect(await fixture.state.loadMeta()).toEqual(before);
      expect(await fixture.raw.readTextFile("note.md")).toBe("Original note.");
    } finally { await fixture.cleanup(); }
  });
  it("keeps a chain blocked when no complete copy exists", async () => {
    const fixture = await commentShellWorkspace();
    try {
      const before = await fixture.state.loadMeta();
      vi.spyOn(fixture.state, "getOperationDocument").mockResolvedValue(null);
      const destination = new FakeWorkspaceObjectStore();
      const result = await restoreKnownOperationCopies({ state: fixture.state, store: destination, workspaceId: fixture.runtime.workspaceId,
        policies: new Map([[workspaceDocumentHash(fixture.runtime.policy), fixture.runtime.policy.payload]]), listedKeys: new Set() });
      expect(result).toEqual({ restored: 0, unavailable: 1 });
      expect((await destination.list(".pvws/operations/")).items).toEqual([]);
      expect(await fixture.state.loadMeta()).toEqual(before);
    } finally { await fixture.cleanup(); }
  });
  it("refuses damaged local copies and mismatching immutable remote contents", async () => {
    const fixture = await commentShellWorkspace();
    try {
      const key = (await fixture.remote.list(".pvws/operations/")).items[0].key;
      const destination = new FakeWorkspaceObjectStore();
      destination.tamper(key, new Uint8Array([1, 2, 3]));
      const input = { state: fixture.state, store: destination, workspaceId: fixture.runtime.workspaceId,
        policies: new Map([[workspaceDocumentHash(fixture.runtime.policy), fixture.runtime.policy.payload]]), listedKeys: new Set<string>() };
      await expect(restoreKnownOperationCopies(input)).rejects.toThrow();
      expect(await destination.get(key)).toEqual(new Uint8Array([1, 2, 3]));
      vi.spyOn(fixture.state, "getOperationDocument").mockResolvedValue("AQID");
      await expect(restoreKnownOperationCopies({ ...input, store: new FakeWorkspaceObjectStore() })).rejects.toThrow("hash mismatch");
    } finally { await fixture.cleanup(); }
  });
});
