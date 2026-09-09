import { describe, expect, it, vi } from "vitest";
import { beginPasswordChange, resumePasswordChange, readPasswordChangeStatus, type PasswordChangePorts, type PasswordChangeJournal } from "@plainva/ui";

function fixture() {
  const values = new Map([ ["files", "old-files"], ["calendar", "old-calendar"] ]);
  const writes: string[] = [];
  const state = { journal: null as unknown, failWrite: "", failCheckpoint: 0, checkpoints: 0, failClear: false, acknowledgeOnly: false, binding: "vault/account/targets", verified: true, activated: 0 };
  const status = vi.fn();
  const ports: PasswordChangePorts = {
    key: crypto.randomUUID(), owner: "vault/account", binding: state.binding, readBinding: async () => state.binding, onStatus: status,
    targets: async () => (["files", "calendar"] as const).map((service) => ({ service,
      read: async () => values.get(service)!, withPassword: (_old, pass) => pass,
      verify: async () => { if (!state.verified && service === "calendar") throw Error("rejected"); },
      write: async (expected, next) => {
        expect(values.get(service)).toBe(expected);
        expect(state.journal).not.toBeNull();
        if (state.failWrite === service) throw Error("write failed");
        writes.push(service);
        if (!state.acknowledgeOnly) values.set(service, next);
      },
    })),
    journal: {
      read: async () => structuredClone(state.journal),
      write: async (value, expected) => { expect(state.journal).toEqual(expected); if (++state.checkpoints === state.failCheckpoint) throw Error("journal failed"); state.journal = structuredClone(value); },
      clear: async (expected) => { expect(state.journal).toEqual(expected); if (state.failClear) throw Error("cleanup failed"); state.journal = null; },
    },
    activate: async () => { state.activated++; },
  };
  return { ports, values, writes, state, status };
}

describe("durable account password change", () => {
  it("verifies every target before storing an intent or changing credentials", async () => {
    const f = fixture(); f.state.verified = false;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "verification", service: "calendar" });
    expect(f.state.journal).toBeNull(); expect(f.writes).toEqual([]);
  });
  it("requires a durable intent before the first credential write", async () => {
    const f = fixture(); f.state.failCheckpoint = 1;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage" });
    expect(f.writes).toEqual([]); expect(f.state.activated).toBe(0);
  });
  it("keeps the first confirmed change and resumes the remaining target after restart", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage", service: "calendar" });
    expect(f.values.get("files")).toBe("new-secret"); expect(f.values.get("calendar")).toBe("old-calendar");
    expect(await readPasswordChangeStatus(f.ports)).toEqual({ phase: "repair", services: { files: "confirmed", calendar: "waiting" } });
    f.state.failWrite = "";
    await resumePasswordChange({ ...f.ports });
    expect(f.writes).toEqual(["files", "calendar"]); expect(f.state.journal).toBeNull(); expect(f.state.activated).toBe(1);
    expect(f.status).toHaveBeenLastCalledWith({ phase: "complete", services: { files: "confirmed", calendar: "confirmed" } });
    expect(JSON.stringify(f.status.mock.calls)).not.toContain("secret");
  });
  it("confirms a write whose following journal checkpoint was lost", async () => {
    const f = fixture(); f.state.failCheckpoint = 2;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage" });
    expect((f.state.journal as PasswordChangeJournal).targets[0].confirmed).toBe(false);
    await resumePasswordChange(f.ports);
    expect(f.writes).toEqual(["files", "calendar"]);
  });
  it("refuses a slot independently changed between failure and resume", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    f.values.set("calendar", "independent-secret"); f.state.failWrite = "";
    await expect(resumePasswordChange(f.ports)).rejects.toMatchObject({ phase: "changed", service: "calendar" });
    expect(f.values.get("calendar")).toBe("independent-secret"); expect(f.state.journal).not.toBeNull();
  });
  it("does not resurrect a removed account or changed service binding", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    f.state.binding = "different-target";
    await expect(resumePasswordChange(f.ports)).rejects.toMatchObject({ phase: "changed" });
    expect(f.writes).toEqual(["files"]);
  });
  it("keeps an unconfirmed credential write pending", async () => {
    const f = fixture(); f.state.acknowledgeOnly = true;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage" });
    expect((f.state.journal as PasswordChangeJournal).targets.every((t) => !t.confirmed)).toBe(true);
    expect(f.state.activated).toBe(0);
  });
  it("retries journal cleanup after all values were confirmed", async () => {
    const f = fixture(); f.state.failClear = true;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage" });
    f.state.failClear = false; await resumePasswordChange(f.ports);
    expect(f.writes).toEqual(["files", "calendar"]); expect(f.state.journal).toBeNull();
  });
  it("does not turn an absent resume intent into a success", async () => {
    const f = fixture(); await expect(resumePasswordChange(f.ports)).rejects.toMatchObject({ phase: "missing" });
    expect(f.status).not.toHaveBeenCalled();
  });
  it.each([{}, { version: 1, id: "x", binding: "x", targets: [] }, "invalid"])("keeps corrupt journal content and blocks replacement: %j", async (journal) => {
    const f = fixture(); f.state.journal = journal;
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toMatchObject({ phase: "storage" });
    expect(f.state.journal).toEqual(journal); expect(f.writes).toEqual([]);
  });
  it("does not replace a pending intent with a new password", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    const previous = structuredClone(f.state.journal);
    await expect(beginPasswordChange(f.ports, "another-secret")).rejects.toMatchObject({ phase: "pending" });
    expect(f.state.journal).toEqual(previous);
  });

  it("retains the pending repair when an explicit new password fails verification", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    const original = structuredClone(f.state.journal);
    f.state.verified = false;
    await expect(beginPasswordChange(f.ports, "another-secret", { replacePending: true })).rejects.toMatchObject({ phase: "verification" });
    expect(f.state.journal).toEqual(original);
    expect(f.writes).toEqual(["files"]);
  });

  it("can explicitly recheck a new password against independently changed sources", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    f.values.set("files", "independent-secret");
    f.state.failWrite = "";
    await beginPasswordChange(f.ports, "verified-secret", { replacePending: true });
    expect([...f.values.values()]).toEqual(["verified-secret", "verified-secret"]);
    expect(f.state.journal).toBeNull();
  });

  it("offers rechecking a changed binding but cannot replace another owner's intent", async () => {
    const f = fixture(); f.state.failWrite = "calendar";
    await expect(beginPasswordChange(f.ports, "new-secret")).rejects.toThrow();
    expect(await readPasswordChangeStatus({ ...f.ports, binding: "new-target" })).toMatchObject({ bindingChanged: true });
    const original = structuredClone(f.state.journal);
    await expect(beginPasswordChange({ ...f.ports, owner: "other-vault/account" }, "new", { replacePending: true })).rejects.toMatchObject({ phase: "changed" });
    expect(f.state.journal).toEqual(original);
  });
});
