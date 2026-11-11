import { describe, expect, it } from "vitest";
import {
  acceptWorkspacePairing,
  approveWorkspacePairing,
  createPersonalWorkspaceBootstrap,
  createWorkspacePairingRequest,
  createWorkspaceRecoveryPackage,
  decodeWorkspaceInvite,
  encodeWorkspaceInvite,
  evaluateWorkspaceAccess,
  personalWorkspaceRuntime,
  restoreWorkspaceFromRecoveryPackage,
  workspaceDocumentHash,
} from "../src/index.js";

/**
 * Two devices of one person and one workspace (R8, TestFlight 2026-11-08: an
 * encrypted vault on Google Drive did not open on a second iPhone).
 *
 * What a second device needs is fixed by the construction and is not changed
 * here: the workspace's keys never travel in the cloud folder unencrypted, so
 * a device that only reaches the folder can read nothing. It comes in one of
 * two ways, and they are not alike:
 *
 *  - an invitation for your OWN membership, approved on a device that is in:
 *    the new device joins as you, and the first one stays;
 *  - the recovery file with its code: the new device becomes the only one, every
 *    other device is revoked.
 *
 * The phone offered only the second to a person with two phones. This pins the
 * difference the interface now states.
 */
describe("a second device of the same person", () => {
  async function firstDevice() {
    const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Me", deviceDisplayName: "iPhone 1", platform: "ios", minimumClientVersion: "0.5.0", now: "2026-11-08T17:00:00.000Z" });
    return { bootstrap, runtime: personalWorkspaceRuntime(bootstrap) };
  }

  it("joins with an invitation for the own membership, and the first device stays", async () => {
    const { runtime } = await firstDevice();
    const code = encodeWorkspaceInvite({ memberId: runtime.memberId, workspaceId: runtime.workspaceId, fingerprint: workspaceDocumentHash(runtime.genesis) });
    const invite = decodeWorkspaceInvite(code);
    const created = await createWorkspacePairingRequest({ workspaceId: invite.workspaceId, workspaceFingerprint: invite.fingerprint, memberId: invite.memberId, deviceDisplayName: "iPhone 2", platform: "ios", now: "2026-11-08T17:05:00.000Z" });
    const previousPolicy = runtime.policy;
    const approval = await approveWorkspacePairing({ token: created.token, runtime, now: "2026-11-08T17:06:00.000Z" });
    const second = await acceptWorkspacePairing({ created, genesis: runtime.genesis, previousPolicy, approval, now: "2026-11-08T17:07:00.000Z" });

    expect(second.memberId).toBe(runtime.memberId);
    const devices = second.policy.payload.devices;
    const stateOf = (deviceId: string) => devices.find((d) => d.deviceId === deviceId)?.state;
    expect(stateOf(runtime.device.publicIdentity.deviceId)).toBe("active");
    expect(stateOf(second.device.publicIdentity.deviceId)).toBe("active");
    for (const deviceId of [runtime.device.publicIdentity.deviceId, second.device.publicIdentity.deviceId]) {
      expect(evaluateWorkspaceAccess(second.policy.payload, { memberId: runtime.memberId, deviceId, capability: "content.write" }).allowed).toBe(true);
    }
  });

  it("restoring from the recovery file instead leaves the first device locked out", async () => {
    const { bootstrap, runtime } = await firstDevice();
    const recovery = createWorkspaceRecoveryPackage(bootstrap, { now: "2026-11-08T17:01:00.000Z" });
    // The phone's restore (recoverMobileWorkspace) passes revokeOtherDevices: true.
    const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: recovery.bytes, recoveryCode: recovery.recoveryCode, deviceDisplayName: "iPhone 2", platform: "ios", now: "2026-11-08T17:10:00.000Z", revokeOtherDevices: true });
    const first = restored.policy.payload.devices.find((d) => d.deviceId === runtime.device.publicIdentity.deviceId);
    expect(first?.state).toBe("revoked");
    expect(evaluateWorkspaceAccess(restored.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "content.read" }).allowed).toBe(false);
  });
});
