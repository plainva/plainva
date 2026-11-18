import { describe, expect, it } from "vitest";
import { retiredBoot } from "./bootRetirement";

/** A vault as a boot hands it over, noting whether it was closed. */
function vault() {
  const v = { closed: false, dispose: async () => { v.closed = true; } };
  return v;
}

describe("a boot that is stopped leaves no vault open with an index that was called off", () => {
  it("a boot that had its answer is handed back as it is, and nothing is called off", async () => {
    const v = vault();
    let calledOff = false;
    expect(await retiredBoot(Promise.resolve(v), true, () => { calledOff = true; }, 1000)).toBe(v);
    expect(calledOff).toBe(false);
    expect(v.closed).toBe(false);
  });

  it("a boot called off that answers in time is closed, not handed back", async () => {
    const v = vault();
    let calledOff = false;
    let answer!: (value: typeof v) => void;
    const pending = new Promise<typeof v>((resolve) => { answer = resolve; });
    const retired = retiredBoot(pending, false, () => { calledOff = true; answer(v); }, 1000);
    expect(await retired, "the caller boots it anew, with an index of its own").toBeNull();
    expect(calledOff).toBe(true);
    expect(v.closed).toBe(true);
  });

  it("a boot that does not answer in time is closed whenever it does", async () => {
    const v = vault();
    let answer!: (value: typeof v) => void;
    const pending = new Promise<typeof v>((resolve) => { answer = resolve; });
    expect(await retiredBoot(pending, false, () => {}, 5)).toBeNull();
    answer(v);
    await pending;
    await Promise.resolve();
    expect(v.closed).toBe(true);
  });

  it("a boot that failed is no vault", async () => {
    expect(await retiredBoot(Promise.reject(new Error("no folder")), false, () => {}, 1000)).toBeNull();
  });
});
