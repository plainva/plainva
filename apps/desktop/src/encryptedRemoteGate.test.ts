import { describe, expect, it } from "vitest";
import { clearEncryptedRemote, decideEncryptedRemote, markEncryptedRemote, markEncryptedRemoteReleased, syncStateBindingFor, type EncryptedRemotePorts } from "@plainva/ui";

/**
 * When the plain file sync may start against a cloud folder (R8 follow-up).
 * One rule for both shells: the phone's start and the desktop's load call it
 * before they build the plain worker.
 */
function memory() {
  let stored: unknown = null;
  const ports: EncryptedRemotePorts = {
    load: async () => stored,
    save: async (fact) => { stored = structuredClone(fact); },
    clear: async () => { stored = null; },
  };
  return { ports, stored: () => stored };
}
const folder = syncStateBindingFor({ provider: "drive", folder: { path: "Notes", id: "folder-1" } });
const other = syncStateBindingFor({ provider: "drive", folder: { path: "Other", id: "folder-2" } });
const genesis = async () => new Uint8Array([1, 2, 3]);
const none = async () => null;
const offline = async (): Promise<Uint8Array | null> => { throw new Error("HTTP 503"); };

describe("the plain sync and an encrypted workspace in its folder", () => {
  it("an unknown vault whose probe fails starts the plain sync, as before", async () => {
    const m = memory();
    const gate = await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: offline });
    expect(gate.kind).toBe("plain");
    expect(gate.kind === "plain" && String(gate.probeError)).toContain("503");
    expect(m.stored()).toBeNull();
  });

  it("a probe that finds the genesis refuses, and remembers it for this folder", async () => {
    const m = memory();
    expect((await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis })).kind).toBe("pair-required");
    expect(m.stored()).toMatchObject({ state: "encrypted", binding: folder });
  });

  it("a vault known to sit on a workspace never starts the plain sync on a failed or empty probe", async () => {
    const m = memory();
    await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis });
    expect((await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: offline })).kind).toBe("unconfirmed");
    // A listing that missed the file is what a provider does on a bad day.
    expect((await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: none })).kind).toBe("unconfirmed");
  });

  it("the connect wizard's fact holds from the first start, for the folder that start finds", async () => {
    const m = memory();
    await markEncryptedRemote(m.ports);
    expect((await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: offline })).kind).toBe("unconfirmed");
    expect(m.stored()).toMatchObject({ state: "encrypted", binding: folder });
  });

  it("joining clears the fact; another folder forgets it", async () => {
    const m = memory();
    await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis });
    await clearEncryptedRemote(m.ports);
    expect(m.stored()).toBeNull();
    await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis });
    expect((await decideEncryptedRemote({ ports: m.ports, binding: other, readGenesis: offline })).kind).toBe("plain");
    expect(m.stored()).toBeNull();
  });

  it("a device that lifted or decommissioned the workspace syncs plainly, though the objects stay in the folder", async () => {
    const m = memory();
    await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis });
    await markEncryptedRemoteReleased(m.ports);
    expect((await decideEncryptedRemote({ ports: m.ports, binding: folder, readGenesis: genesis })).kind).toBe("plain");
  });
});
