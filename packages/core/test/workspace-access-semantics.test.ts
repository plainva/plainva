import { describe, expect, it } from "vitest";
import {
  createPersonalWorkspaceBootstrap,
  evaluateWorkspaceAccess,
  listBrokenWorkspaceSlices,
  personalWorkspaceRuntime,
  previewWorkspaceMoveAccess,
  refreshWorkspaceSliceMaterialization,
  toBase64,
  workspaceGroupNames,
  workspaceRecipientGroupIds,
  workspaceSliceCoversObject,
  workspaceSliceIdsForObject,
  type WorkspacePolicyPayload,
  type WorkspacePolicySlice,
} from "../src/index.js";

const GROUP = "20".repeat(16);
const MEMBER = "10".repeat(16);
const DEVICE = "50".repeat(16);
const objectA = { objectId: "a1".repeat(16), path: "Projects/A.md", tags: ["shared"], contentKind: "text" as const };
const objectB = { objectId: "b2".repeat(16), path: "Private/B.md", tags: ["private"], contentKind: "text" as const };

function policyWith(
  slices: WorkspacePolicySlice[],
  capabilities: WorkspacePolicyPayload["assignments"][number]["capabilities"] = ["content.read"]
): WorkspacePolicyPayload {
  return {
    policyVersion: 1,
    previousPolicyHash: null,
    minimumClientVersion: "0.5.0",
    algorithmSuites: [1],
    members: [{ memberId: MEMBER, displayName: "C", state: "active" }],
    devices: [
      {
        deviceId: DEVICE,
        memberId: MEMBER,
        displayName: "D",
        platform: "desktop",
        state: "active",
        signingPublicKey: toBase64(new Uint8Array(32)),
        hpkePublicKey: toBase64(new Uint8Array(32)),
        addedAt: "2026-08-25T00:00:00.000Z",
        revokedAt: null,
      },
    ],
    groups: [{ groupId: GROUP, name: "Team", memberIds: [MEMBER], keyEpoch: 1, hpkePublicKey: toBase64(new Uint8Array(32)) }],
    assignments: [
      {
        assignmentId: "30".repeat(16),
        subjectKind: "group",
        subjectId: GROUP,
        role: "Reader",
        capabilities,
        scopeKind: "slice",
        scopeId: slices[0].sliceId,
      },
    ],
    slices,
    objectOverrides: [],
    revocations: [],
  } satisfies WorkspacePolicyPayload;
}

describe("P3 - one answer to slice membership", () => {
  it("closes a slice whose definition cannot be read, materialized list included", () => {
    // The old `catch` returned false from the rule but left the materialized list intact,
    // so a definition nobody could check kept handing out access.
    const broken: WorkspacePolicySlice = {
      sliceId: "01".repeat(16),
      name: "Broken",
      kind: "dynamic",
      definition: "{not json",
      materializedObjectIds: [objectA.objectId],
    };
    const policy = policyWith([broken]);

    expect(workspaceSliceCoversObject(broken, objectA)).toBe(false);
    expect(workspaceSliceIdsForObject(policy, objectA)).toEqual([]);
    expect(workspaceRecipientGroupIds(policy, objectA)).toEqual([]);
    expect(listBrokenWorkspaceSlices(policy)).toEqual([{ sliceId: broken.sliceId, name: "Broken", reason: "rules-unreadable" }]);
    expect(
      evaluateWorkspaceAccess(policy, {
        memberId: MEMBER,
        deviceId: DEVICE,
        capability: "content.read",
        objectId: objectA.objectId,
        sliceIds: [],
        object: objectA,
      }).allowed
    ).toBe(false);

    // Red counterproof: the same object under a readable rule is allowed - the denial above
    // is the broken definition, not a policy that denies everything.
    const readable: WorkspacePolicySlice = {
      ...broken,
      definition: JSON.stringify({ all: [{ field: "tag", operator: "equals", value: "shared" }] }),
      materializedObjectIds: [],
    };
    expect(workspaceSliceCoversObject(readable, objectA)).toBe(true);
    expect(listBrokenWorkspaceSlices(policyWith([readable]))).toEqual([]);
  });

  it("authorizes what the recipient set encrypts for - rule match counts, not just materialization", () => {
    // B5: `workspaceRecipientGroupIds` accepted a rule match, `isScopeMatch` demanded a
    // materialized id. The key reached the right people while the check said no.
    const slice: WorkspacePolicySlice = {
      sliceId: "02".repeat(16),
      name: "Shared",
      kind: "dynamic",
      definition: JSON.stringify({ all: [{ field: "tag", operator: "equals", value: "shared" }] }),
      materializedObjectIds: [],
    };
    const policy = policyWith([slice]);

    expect(workspaceRecipientGroupIds(policy, objectA)).toEqual([GROUP]);
    expect(
      evaluateWorkspaceAccess(policy, {
        memberId: MEMBER,
        deviceId: DEVICE,
        capability: "content.read",
        objectId: objectA.objectId,
        sliceIds: workspaceSliceIdsForObject(policy, objectA),
        object: objectA,
      }).allowed
    ).toBe(true);

    // And without a precomputed slice list: this is the path B5 lived on. A caller that only
    // has the object must get the same answer as the recipient set, or the key reaches people
    // the permission check turns away.
    expect(
      evaluateWorkspaceAccess(policy, {
        memberId: MEMBER,
        deviceId: DEVICE,
        capability: "content.read",
        objectId: objectA.objectId,
        object: objectA,
      }).allowed
    ).toBe(true);

    // Red counterproof: an object the rule does not describe stays denied on both sides.
    expect(workspaceRecipientGroupIds(policy, objectB)).toEqual([]);
    expect(
      evaluateWorkspaceAccess(policy, {
        memberId: MEMBER,
        deviceId: DEVICE,
        capability: "content.read",
        objectId: objectB.objectId,
        sliceIds: workspaceSliceIdsForObject(policy, objectB),
        object: objectB,
      }).allowed
    ).toBe(false);
  });

  it("lets a Contributor write what they created and nothing else", () => {
    // B4: Contributor holds `content.create` but not `content.write`, and `checkWrite` maps an
    // existing file to `content.write` - so the first autosave of their own note was denied.
    const slice: WorkspacePolicySlice = {
      sliceId: "03".repeat(16),
      name: "All",
      kind: "folder",
      definition: "Projects",
      materializedObjectIds: [objectA.objectId],
    };
    const policy = policyWith([slice], ["content.read", "content.create"]);
    const ask = (author: string | null) =>
      evaluateWorkspaceAccess(policy, {
        memberId: MEMBER,
        deviceId: DEVICE,
        capability: "content.write",
        objectId: objectA.objectId,
        sliceIds: workspaceSliceIdsForObject(policy, objectA),
        object: objectA,
        objectAuthorMemberId: author,
      });

    expect(ask(MEMBER)).toMatchObject({ allowed: true, reason: "allowed-own-content" });
    expect(ask("99".repeat(16)).allowed).toBe(false);
    // An object written before authorship was recorded stays denied - the answer the code
    // gave before the column existed.
    expect(ask("").allowed).toBe(false);
    expect(ask(null).allowed).toBe(false);
  });
});

describe("P3 - materialization keeps up with the vault", () => {
  it("recomputes stale object lists and stays quiet when nothing changed", async () => {
    const runtime = personalWorkspaceRuntime(
      await createPersonalWorkspaceBootstrap({
        ownerDisplayName: "Owner",
        deviceDisplayName: "Desktop",
        platform: "desktop",
        minimumClientVersion: "0.5.0",
        now: "2026-08-25T08:00:00.000Z",
      })
    );
    const stale: WorkspacePolicySlice = {
      sliceId: "04".repeat(16),
      name: "Projects",
      kind: "folder",
      definition: "Projects",
      materializedObjectIds: [],
    };
    const broken: WorkspacePolicySlice = {
      sliceId: "05".repeat(16),
      name: "Broken",
      kind: "dynamic",
      definition: "{not json",
      materializedObjectIds: [objectB.objectId],
    };
    runtime.policy = { ...runtime.policy, payload: { ...runtime.policy.payload, slices: [stale, broken] } };

    const refreshed = refreshWorkspaceSliceMaterialization({ runtime, objects: [objectA, objectB] });
    expect(refreshed?.changedSliceIds).toEqual([stale.sliceId]);
    const next = refreshed!.policy.payload.slices;
    expect(next.find((slice) => slice.sliceId === stale.sliceId)?.materializedObjectIds).toEqual([objectA.objectId]);
    // A broken slice is skipped, not emptied: its list is evidence of what someone chose, and
    // coverage already ignores it.
    expect(next.find((slice) => slice.sliceId === broken.sliceId)?.materializedObjectIds).toEqual([objectB.objectId]);

    // Red counterproof: running it again publishes nothing.
    runtime.policy = refreshed!.policy;
    expect(refreshWorkspaceSliceMaterialization({ runtime, objects: [objectA, objectB] })).toBeNull();
  });
});

describe("P3 - a move can take a file out of reach", () => {
  it("names the groups that lose access", () => {
    const slice: WorkspacePolicySlice = {
      sliceId: "06".repeat(16),
      name: "Projects",
      kind: "folder",
      definition: "Projects",
      materializedObjectIds: [],
    };
    const policy = policyWith([slice]);

    const impact = previewWorkspaceMoveAccess(policy, objectA, "Private/A.md", "99".repeat(16));
    expect(impact.removedGroupIds).toEqual([GROUP]);
    expect(workspaceGroupNames(policy, impact.removedGroupIds)).toEqual(["Team"]);
    // An id we cannot resolve is still better evidence than a silently shortened list.
    expect(workspaceGroupNames(policy, ["ff".repeat(16)])).toEqual(["ff".repeat(16)]);

    // Red counterproof: a move inside the slice takes nothing away.
    expect(previewWorkspaceMoveAccess(policy, objectA, "Projects/Sub/A.md", MEMBER).removedGroupIds).toEqual([]);
  });
});
