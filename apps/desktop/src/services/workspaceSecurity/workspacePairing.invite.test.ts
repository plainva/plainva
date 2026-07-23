import { describe, expect, it } from "vitest";
import { createPersonalWorkspaceBootstrap, encodeWorkspaceDocument, workspaceDocumentHash, FakeWorkspaceObjectStore, workspaceSha256Hex } from "@plainva/core";
import { decodeWorkspaceInvite, encodeWorkspaceInvite, detectRemoteWorkspace } from "./workspacePairing";

describe("workspace invite codec (package C3)", () => {
  it("round-trips an invite code", () => {
    const invite = { memberId: "aa".repeat(16), workspaceId: "01".repeat(16), fingerprint: "bb".repeat(16), role: "Editor" };
    const decoded = decodeWorkspaceInvite(encodeWorkspaceInvite(invite));
    expect(decoded).toEqual(invite);
  });

  it("tolerates surrounding whitespace", () => {
    const invite = { memberId: "cc".repeat(16), workspaceId: "02".repeat(16), fingerprint: "dd".repeat(16) };
    expect(decodeWorkspaceInvite(`  ${encodeWorkspaceInvite(invite)}\n`)).toEqual(invite);
  });

  it("rejects a code with the wrong prefix or missing fields", () => {
    expect(() => decodeWorkspaceInvite("not-an-invite")).toThrow("invite-code-invalid");
    // valid prefix but payload missing the required fields
    const bad = "PVINVITE1." + btoa(JSON.stringify({ memberId: "x" })).replace(/=+$/g, "");
    expect(() => decodeWorkspaceInvite(bad)).toThrow("invite-code-invalid");
  });
});

describe("detectRemoteWorkspace (package C1)", () => {
  it("returns null when the remote carries no workspace", async () => {
    const store = new FakeWorkspaceObjectStore();
    expect(await detectRemoteWorkspace(store)).toBeNull();
  });

  it("reports the workspaceId and fingerprint of a remote genesis", async () => {
    const bootstrap = await createPersonalWorkspaceBootstrap({
      ownerDisplayName: "Owner",
      deviceDisplayName: "First device",
      platform: "desktop",
      minimumClientVersion: "0.5.0",
    });
    const store = new FakeWorkspaceObjectStore();
    const bytes = encodeWorkspaceDocument(bootstrap.genesis);
    await store.putImmutable(".pvws/genesis.pvgen", bytes, workspaceSha256Hex(bytes));

    const detected = await detectRemoteWorkspace(store);
    expect(detected).toEqual({ workspaceId: bootstrap.workspaceId, fingerprint: workspaceDocumentHash(bootstrap.genesis) });
  });
});
