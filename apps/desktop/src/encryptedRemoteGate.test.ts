import { describe, expect, it } from "vitest";
import { applyWorkspaceGovernanceUpdate, createPersonalWorkspaceBootstrap, encodeWorkspaceDocument, FatalSyncProtocolError, inviteWorkspaceMember, personalWorkspaceRuntime, SyncRootMissingError, type ISyncTarget } from "@plainva/core";
import {
  classifyGenesisReadError,
  decideHeldFolder,
  dismissEncryptedRemote,
  encryptedRemoteDismissable,
  encryptedRemoteFactFor,
  encryptedRemoteFilePorts,
  markEncryptedRemote,
  markEncryptedRemoteDeparted,
  markEncryptedRemoteJoined,
  plainWorkspaceListed,
  settingsOnlyFolderCheck,
  syncStateBindingFor,
  workspaceDeparture,
  type EncryptedRemoteFact,
  type EncryptedRemotePorts,
} from "@plainva/ui";

/**
 * The plain sync and an encrypted workspace in its folder (R8, third review).
 * A vault that knows nothing about its folder pays nothing; only a vault with
 * a fact is held, and the folder's content lifts every fact.
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
const broken: EncryptedRemotePorts = { load: async () => { throw new Error("disk"); }, save: async () => { throw new Error("disk"); }, clear: async () => { throw new Error("disk"); } };
const folder = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example/Notes", user: "u" } });
const other = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example/Other", user: "u" } });
async function workspace(name = "Owner") {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: name, deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.5.0" });
  const runtime = personalWorkspaceRuntime(bootstrap);
  return { runtime, bytes: encodeWorkspaceDocument(runtime.genesis) };
}
const refused = async (): Promise<Uint8Array | null> => { throw Object.assign(new Error("WebDAV GET failed: 403"), { status: 403 }); };
const offline = async (): Promise<Uint8Array | null> => { throw new Error("network down"); };
const none = async () => null;
async function held(m: ReturnType<typeof memory>, readGenesis: () => Promise<Uint8Array | null>, provider = "webdav", binding = folder) {
  const fact = await encryptedRemoteFactFor(m.ports, binding);
  if (!fact) return { kind: "no-fact" } as const;
  return decideHeldFolder({ ports: m.ports, binding, fact, provider, readGenesis });
}

describe("what a vault knows about its folder (R8)", () => {
  it("nearly every vault knows nothing - and a store that fails is 'nothing known', never a stopped start", async () => {
    expect(await encryptedRemoteFactFor(memory().ports, folder)).toBeNull();
    expect(await encryptedRemoteFactFor(broken, folder)).toBeNull();
    await expect(markEncryptedRemote(broken)).resolves.toBeUndefined();
    await expect(markEncryptedRemoteJoined(broken)).resolves.toBeUndefined();
  });

  it("a fact written before the folder was read takes the folder its first start finds; another folder forgets it", async () => {
    const m = memory();
    await markEncryptedRemote(m.ports);
    expect(await encryptedRemoteFactFor(m.ports, folder)).toMatchObject({ state: "encrypted", binding: folder });
    expect(await encryptedRemoteFactFor(m.ports, other)).toBeNull();
  });
});

describe("a held folder (R8)", () => {
  it("a genesis this device has not joined: pair required, and the workspace is remembered", async () => {
    const m = memory();
    const { bytes } = await workspace();
    await markEncryptedRemote(m.ports);
    expect(await held(m, async () => bytes)).toEqual({ kind: "pair-required" });
    expect(m.stored()).toMatchObject({ state: "encrypted", workspace: expect.any(String) });
  });

  it("one clean 'not found' is not trusted; three in a row make it a normal folder again, whatever the fact said", async () => {
    for (const state of ["encrypted", "joined", "left"] as const) {
      const m = memory();
      await m.ports.save({ v: 2, state, peers: "others" } as EncryptedRemoteFact);
      expect(await held(m, none)).toEqual({ kind: "waiting" });
      expect(await held(m, none)).toEqual({ kind: "waiting" });
      expect(await held(m, none)).toEqual({ kind: "plain" });
      expect(m.stored()).toBeNull();
    }
  });

  it("a server that will not show the hidden path is not asked forever: the person gets the way out", async () => {
    const m = memory();
    await markEncryptedRemote(m.ports);
    expect(await held(m, refused)).toEqual({ kind: "refused" });
    expect(await encryptedRemoteDismissable(m.ports)).toBe(true);
    expect(await dismissEncryptedRemote(m.ports)).toBe(true);
    expect(await encryptedRemoteFactFor(m.ports, folder)).toBeNull();
  });

  it("classifies a read failure by provider: a 403 of WebDAV or S3 is a refusal, of Drive a passing error; a missing folder is the worker's", () => {
    const forbidden = Object.assign(new Error("403"), { status: 403 });
    expect(classifyGenesisReadError(forbidden, "webdav")).toBe("refused");
    expect(classifyGenesisReadError(forbidden, "s3")).toBe("refused");
    expect(classifyGenesisReadError(Object.assign(new Error("405"), { status: 405 }), "webdav")).toBe("refused");
    expect(classifyGenesisReadError(forbidden, "drive")).toBe("transient");
    expect(classifyGenesisReadError(Object.assign(new Error("500"), { status: 500 }), "webdav")).toBe("transient");
    expect(classifyGenesisReadError(new SyncRootMissingError("Notes", "Google Drive"), "drive")).toBe("root-missing");
  });

  it("a network failure waits; a missing folder passes to the worker's own recovery", async () => {
    const m = memory();
    await markEncryptedRemote(m.ports);
    expect(await held(m, offline)).toEqual({ kind: "waiting" });
    expect(await held(m, async () => { throw new SyncRootMissingError("Notes", "Google Drive"); }, "drive")).toEqual({ kind: "root-missing" });
  });

  it("released means exactly the workspace this device ended; another workspace refuses", async () => {
    const m = memory();
    const ended = await workspace("Ended");
    const another = await workspace("Another");
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(ended.runtime));
    expect(await held(m, async () => ended.bytes)).toEqual({ kind: "plain" });
    expect(await held(m, async () => another.bytes)).toEqual({ kind: "pair-required" });
  });

  it("released written offline, then another folder: the release does not travel with the vault", async () => {
    const m = memory();
    const ended = await workspace("Ended");
    const another = await workspace("Another");
    await markEncryptedRemoteDeparted(m.ports, workspaceDeparture(ended.runtime));
    expect(await held(m, async () => another.bytes, "webdav", other)).toEqual({ kind: "pair-required" });
  });

  it("a device that is not the only one has left the folder to the others; a locked one cannot tell, and says so", async () => {
    const { runtime, bytes } = await workspace();
    applyWorkspaceGovernanceUpdate(runtime, await inviteWorkspaceMember({ runtime, displayName: "Anna", role: "Editor" }));
    const others = memory();
    await markEncryptedRemoteDeparted(others.ports, workspaceDeparture(runtime));
    expect(await held(others, async () => bytes)).toEqual({ kind: "left", peers: "others" });
    expect(await encryptedRemoteDismissable(others.ports)).toBe(false);
    // Decommissioned while locked: no runtime, so nobody knows whether it was the only device.
    const locked = memory();
    await markEncryptedRemoteDeparted(locked.ports, workspaceDeparture(null));
    expect(await held(locked, async () => bytes)).toEqual({ kind: "left", peers: "unknown" });
    expect(await encryptedRemoteDismissable(locked.ports)).toBe(true);
  });

  it("a lifted workspace whose objects stay: plain for the device that ended it, pair-required for any other", async () => {
    const lifted = await workspace();
    const ender = memory();
    await markEncryptedRemoteDeparted(ender.ports, workspaceDeparture(lifted.runtime));
    expect(await held(ender, async () => lifted.bytes)).toEqual({ kind: "plain" });
    const second = memory();
    await markEncryptedRemote(second.ports);
    expect(await held(second, async () => lifted.bytes)).toEqual({ kind: "pair-required" });
  });

  it("never rejects: a store that fails inside is a decision, not a crash", async () => {
    const { bytes } = await workspace();
    const fact = { v: 2, state: "encrypted" } as EncryptedRemoteFact;
    await expect(decideHeldFolder({ ports: broken, binding: folder, fact, provider: "webdav", readGenesis: async () => bytes })).resolves.toEqual({ kind: "pair-required" });
    await expect(decideHeldFolder({ ports: broken, binding: folder, fact, provider: "webdav", readGenesis: none })).resolves.toEqual({ kind: "waiting" });
  });
});

describe("the listing net and the settings-only look (R8)", () => {
  const target = {} as ISyncTarget;
  it("a listed genesis stops the plain worker and records it; the workspace this device ended lets it on", async () => {
    const m = memory();
    const { bytes, runtime } = await workspace();
    await expect(plainWorkspaceListed({ ports: m.ports, binding: folder, readGenesis: async () => bytes })(target)).rejects.toMatchObject({ reason: "encrypted-workspace" });
    expect(m.stored()).toMatchObject({ state: "encrypted" });
    const ender = memory();
    await markEncryptedRemoteDeparted(ender.ports, workspaceDeparture(runtime));
    await expect(plainWorkspaceListed({ ports: ender.ports, binding: folder, readGenesis: async () => bytes })(target)).resolves.toBeUndefined();
  });

  it("the settings-only look of a vault that knows nothing stops nothing on a refusing server, and holds at a genesis", async () => {
    const m = memory();
    await expect(settingsOnlyFolderCheck({ ports: m.ports, binding: folder, provider: "webdav", target, readGenesis: refused })()).resolves.toBeUndefined();
    const { bytes } = await workspace();
    await expect(settingsOnlyFolderCheck({ ports: m.ports, binding: folder, provider: "webdav", target, readGenesis: async () => bytes })()).rejects.toBeInstanceOf(FatalSyncProtocolError);
  });

  it("the desktop keeps the fact inside the vault folder, so it moves with the vault", async () => {
    const files = new Map<string, string>();
    const vault = { exists: async (p: string) => files.has(p), readTextFile: async (p: string) => files.get(p)!, writeTextFile: async (p: string, v: string) => { files.set(p, v); }, deleteItem: async (p: string) => { files.delete(p); } };
    const ports = encryptedRemoteFilePorts(vault);
    await markEncryptedRemote(ports);
    expect([...files.keys()]).toEqual([".plainva/encrypted-remote.json"]);
    expect(await encryptedRemoteFactFor(ports, folder)).toMatchObject({ state: "encrypted" });
  });
});
