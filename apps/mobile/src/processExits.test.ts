import { describe, expect, it } from "vitest";
import { classifyProcessExit, mergeProcessExits, processExitLabelKey, type ProcessExitRecord } from "./services/processExits";

/**
 * Android 17's memory limiter kills silently (plan 2026-09-04, P1). What the
 * app keeps of the system's exit record decides whether "was it memory?" is
 * ever answerable — so the classification and the folding are pinned here.
 */
describe("process exits", () => {
  it("recognises the memory limiter by its description, whatever the reason code", () => {
    expect(classifyProcessExit({ reason: 13, description: "MemoryLimiter:AnonSwap" })).toBe("memory-limiter");
    expect(classifyProcessExit({ reason: 2, description: "MemoryLimiter:AnonSwap" })).toBe("memory-limiter");
  });

  it("keeps the exits a person can act on and drops the rest", () => {
    expect(classifyProcessExit({ reason: 3 })).toBe("low-memory");
    expect(classifyProcessExit({ reason: 9 })).toBe("excessive-resources");
    expect(classifyProcessExit({ reason: 4 })).toBe("crash");
    expect(classifyProcessExit({ reason: 5 })).toBe("crash");
    expect(classifyProcessExit({ reason: 6 })).toBe("anr");
    // Swiped away, updated, exited on its own: noise.
    expect(classifyProcessExit({ reason: 10 })).toBeNull();
    expect(classifyProcessExit({ reason: 16 })).toBeNull();
    expect(classifyProcessExit({ reason: 1 })).toBeNull();
    expect(classifyProcessExit({ reason: 13, description: "" })).toBeNull();
  });

  it("adds only exits newer than the last look, newest first, and keeps ten", () => {
    const known: ProcessExitRecord[] = [{ at: "2026-09-01T10:00:00.000Z", kind: "crash" }];
    const t = (iso: string) => new Date(iso).getTime();
    const fresh = [
      { reason: 13, description: "MemoryLimiter:AnonSwap", timestamp: t("2026-09-04T08:00:00.000Z"), importance: 400 },
      { reason: 10, description: null, timestamp: t("2026-09-04T07:00:00.000Z"), importance: 400 }, // noise, but counts as seen
      { reason: 6, description: null, timestamp: t("2026-08-30T07:00:00.000Z"), importance: 400 }, // older than the last look
    ];
    const out = mergeProcessExits(known, fresh, t("2026-09-01T12:00:00.000Z"));
    expect(out.records.map((r) => r.kind)).toEqual(["memory-limiter", "crash"]);
    expect(out.records[0]).toEqual({ at: "2026-09-04T08:00:00.000Z", kind: "memory-limiter", description: "MemoryLimiter:AnonSwap" });
    expect(out.seenUntil).toBe(t("2026-09-04T08:00:00.000Z"));

    const many = Array.from({ length: 14 }, (_, i) => ({ reason: 4, description: null, timestamp: t("2026-09-05T00:00:00.000Z") + i * 1000, importance: 100 }));
    expect(mergeProcessExits([], many, 0).records).toHaveLength(10);
  });

  it("leaves the marker alone when the system has nothing new", () => {
    const out = mergeProcessExits([], [], 42);
    expect(out).toEqual({ records: [], seenUntil: 42 });
  });

  it("names every kind for the user", () => {
    expect(processExitLabelKey("memory-limiter")).toBe("settingsSync.diagExitMemory");
    expect(processExitLabelKey("low-memory")).toBe("settingsSync.diagExitMemory");
    expect(processExitLabelKey("crash")).toBe("settingsSync.diagExitCrash");
    expect(processExitLabelKey("anr")).toBe("settingsSync.diagExitAnr");
  });
});
