import { describe, expect, it } from "vitest";
import { BOOT_MODULE_RETRY_MS, loadBootModules } from "./bootModules";

/** The boot's late modules are tried again and their failure is said (review of L5, 2026-11-25). */
describe("the boot's late modules", () => {
  it("say a failed load once and try again until it lands", async () => {
    expect.hasAssertions();
    let calls = 0;
    const failures: unknown[] = [];
    const waits: number[] = [];
    const loaded = await loadBootModules({
      load: async () => {
        calls++;
        if (calls < 5) throw new Error("chunk");
        return "modules";
      },
      current: () => true,
      onFailure: (error) => failures.push(error),
      wait: async (ms) => { waits.push(ms); },
    });
    expect(loaded).toBe("modules");
    expect(failures).toHaveLength(1);
    expect(waits).toEqual([BOOT_MODULE_RETRY_MS[0], BOOT_MODULE_RETRY_MS[1], BOOT_MODULE_RETRY_MS[2], BOOT_MODULE_RETRY_MS[2]]);
  });

  it("stop trying once the boot is no longer the current one", async () => {
    expect.hasAssertions();
    let live = true;
    let calls = 0;
    const loaded = await loadBootModules({
      load: async () => { calls++; throw new Error("chunk"); },
      current: () => live,
      onFailure: () => undefined,
      wait: async () => { live = false; },
    });
    expect(loaded).toBeNull();
    expect(calls).toBe(1);
  });
});
