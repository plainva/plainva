import { describe, expect, it } from "vitest";
import { createPersonalWorkspaceBootstrap, encodeWorkspaceDocument, FatalSyncProtocolError, inviteWorkspaceMember, applyWorkspaceGovernanceUpdate, personalWorkspaceRuntime, type ISyncTarget } from "@plainva/core";
import {
  decideEncryptedRemote,
  dismissEncryptedRemote,
  encryptedRemoteDismissable,
  markEncryptedRemote,
  markEncryptedRemoteDeparted,
  markEncryptedRemoteJoined,
  plainRemoteGuard,
  syncStateBindingFor,
  workspaceDeparture,
  type EncryptedRemotePorts,
} from "@plainva/ui";

/**
 * When the plain sync may touch a cloud folder (R8). One rule for both
 * shells: the phone's start, the desktop's load and the per-cycle guard of the
 * core all ask it.
 */
function memory() {
  let stored: unknown = null;
  const ports: EncryptedRemotePorts = {
    load: async () => stored,
    save: async (fact) => { stored = structuredClone(fact); },
    clear: async () => { stored = null; },
  };
  return { ports, stored: () => stored as Record<string, unknown> | null };
}
const folder = syncStateBindingFor({ provider: "drive", folder: { path: "Notes", id: "folder-1" } });
const other = syncStateBindingFor({ provider: "drive", folder: { path: "Other", id: "folder-2" } });
async function workspace(name = "Owner") {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: name, deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0" });
  const runtime = personalWorkspaceRuntime(bootstrap);
  return { runtime, bytes: encodeWorkspaceDocument(runtime.genesis) };
}
const offline = async (): Promise<Uint8Array | null> => { throw new Error("HTTP 503"); };
const none = async () => null;
const never = async () => false;
const always = async () => true;
const decide = (ports: EncryptedRemotePorts, readGenesis: () => Promise<Uint8Array | null>, opts: { binding?: typeof folder; syncedPlainlyBefore?: () => Promise<boolean> } = {}) =>
  decideEncryptedRemote({ ports, binding: opts.binding ?? folder, readGenesis, syncedPlainlyBefore: opts.syncedPlainlyBefore ?? never });

describe("the plain sync and an encrypted workspace in its folder (R8)", () => {
  it("a folder that never synced plainly waits through a failed probe; one that did may ride it out", async () => {
    const m = memory();
    expect(await decide(m.ports, offline)).toMatchObject({ kind: "unconfirmed", why: "first" });
    expect((await decide(m.ports, offline, { syncedPlainlyBefore: always })).kind).toBe("plain");
    expect((await decide(m.ports, none)).kind).toBe("plain");
  });

  it("a probe that finds a genesis refuses and remembers the workspace for this folder", async () => {
    const m = memory();
    const { bytes, runtime } = await workspace();
    expect((await decide(m.ports, async () => bytes)).kind).toBe("pair-required");
    expect(m.stored()).toMatchObject({ v: 2, state: "encrypted", binding: folder, workspace: personalHash(runtime) });
  });

  it("a known workspace never lets the plain sync start on a failed or empty probe - even one that synced plainly before", async () => {
    const m = memory();
    const { bytes } = await workspace();
    await decide(m.ports, async () => bytes);
    expect(await decide(m.ports, offline, { syncedPlainlyBefore: always })).toMatchObject({ kind: "unconfirmed", why: "known", mayDismiss: false });
    expect(await decide(m.ports, none)).toMatchObject({ kind: "unconfirmed", why: "known", mayDismiss: false });
  });

  it("the connect wizard's fact holds from the first start, for the folder that start finds", async () => {
    const m = memory();
    await markEncryptedRemote(m.ports);
    expect((await decide(m.ports, offline, { syncedPlainlyBefore: always })).kind).toBe("unconfirmed");
    expect(m.stored()).toMatchObject({ state: "encrypted", binding: folder });
  });

  it("joining keeps the knowledge as membership; only another folder forgets it", async () => {
    const m = memory();
    const { bytes } = await workspace();
    await decide(m.ports, async () => bytes);
    await markEncryptedRemoteJoined(m.ports);
    expect(m.stored()).toMatchObject({ state: "joined", binding: folder });
    // A member without its keys whose probe fails: never the plain sync.
    expect((await decide(m.ports, offline, { syncedPlainlyBefore: always })).kind).toBe("unconfirmed");
    expect((await decide(m.ports, offline, { binding: other })).kind).toBe("unconfirmed");
    expect(m.stored()).toBeNull();
  });

  it("released means exactly the workspace this device ended: another one in the folder refuses", async () => {
    const m = memory();
    const ended = await workspace("Ended");
    const another = await workspace("Another");
    await decide(m.ports, async () => ended.bytes);
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(ended.runtime));
    expect((await decide(m.ports, async () => ended.bytes)).kind).toBe("plain");
    expect((await decide(m.ports, none)).kind).toBe("plain");
    expect((await decide(m.ports, async () => another.bytes)).kind).toBe("pair-required");
  });

  it("released while offline, then another folder: the release does not travel with the vault", async () => {
    const m = memory();
    const ended = await workspace("Ended");
    const another = await workspace("Another");
    // Written before any start read the folder (the reload never reached the gate).
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(ended.runtime));
    expect((await decide(m.ports, async () => another.bytes, { binding: other })).kind).toBe("pair-required");
  });

  it("a device that is not the workspace's only one leaves the folder to the others", async () => {
    const m = memory();
    const { runtime, bytes } = await workspace();
    applyWorkspaceGovernanceUpdate(runtime, await inviteWorkspaceMember({ runtime, displayName: "Anna", role: "Editor" }));
    expect(workspaceDeparture(runtime).sole).toBe(false);
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(runtime));
    expect((await decide(m.ports, async () => bytes)).kind).toBe("left");
    expect((await decide(m.ports, none)).kind).toBe("left");
  });

  it("repeated clean 'not found' answers open the way out, and only those", async () => {
    const m = memory();
    const { bytes } = await workspace();
    await decide(m.ports, async () => bytes);
    expect(await dismissEncryptedRemote(m.ports)).toBe(false);
    await decide(m.ports, offline); // a failure counts for nothing
    await decide(m.ports, none);
    await decide(m.ports, none);
    expect(await encryptedRemoteDismissable(m.ports)).toBe(false);
    expect(await decide(m.ports, none)).toMatchObject({ kind: "unconfirmed", mayDismiss: true });
    expect(await dismissEncryptedRemote(m.ports)).toBe(true);
    expect((await decide(m.ports, none)).kind).toBe("plain");
    // ... and a genesis that turns up after all refuses again.
    expect((await decide(m.ports, async () => bytes)).kind).toBe("pair-required");
  });
});

describe("the per-cycle guard (R8)", () => {
  const target = {} as ISyncTarget;
  it("stops the plain sync at a genesis this device has not joined, and records the fact", async () => {
    const m = memory();
    const { bytes } = await workspace();
    const guard = plainRemoteGuard({ ports: m.ports, binding: folder, readGenesis: async () => bytes });
    await expect(guard(target)).rejects.toBeInstanceOf(FatalSyncProtocolError);
    await expect(guard(target)).rejects.toMatchObject({ reason: "encrypted-workspace" });
    expect(m.stored()).toMatchObject({ state: "encrypted", binding: folder });
  });

  it("lets it pass for no genesis and for the one this device ended; a failed probe skips the step", async () => {
    const m = memory();
    const ended = await workspace();
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(ended.runtime));
    await expect(plainRemoteGuard({ ports: m.ports, binding: folder, readGenesis: none })(target)).resolves.toBeUndefined();
    await expect(plainRemoteGuard({ ports: m.ports, binding: folder, readGenesis: async () => ended.bytes })(target)).resolves.toBeUndefined();
    await expect(plainRemoteGuard({ ports: m.ports, binding: folder, readGenesis: offline })(target)).rejects.toThrow("503");
  });
});

function personalHash(runtime: Awaited<ReturnType<typeof workspace>>["runtime"]): string {
  return workspaceDeparture(runtime).workspace!;
}
