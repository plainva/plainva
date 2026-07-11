import { describe, expect, it } from "vitest";
import {
  currentMobileDialog,
  dismissMobileDialog,
  mConfirm,
  mPrompt,
  mSelect,
} from "./mobileDialogs";

describe("mobileDialogs store", () => {
  it("queues FIFO and resolves prompt/confirm/select through the host contract", async () => {
    const p1 = mPrompt({ title: "Name" });
    const p2 = mConfirm({ title: "Sure?", danger: true });
    const p3 = mSelect({ title: "Pick", options: [{ value: "a", label: "A" }] });

    const d1 = currentMobileDialog()!;
    expect(d1.kind).toBe("prompt");
    if (d1.kind === "prompt") d1.resolve({ value: "Alpha", cancelled: false });
    dismissMobileDialog(d1);
    await expect(p1).resolves.toEqual({ value: "Alpha", cancelled: false });

    const d2 = currentMobileDialog()!;
    expect(d2.kind).toBe("confirm");
    if (d2.kind === "confirm") d2.resolve(true);
    dismissMobileDialog(d2);
    await expect(p2).resolves.toBe(true);

    const d3 = currentMobileDialog()!;
    expect(d3.kind).toBe("select");
    if (d3.kind === "select") d3.resolve("a");
    dismissMobileDialog(d3);
    await expect(p3).resolves.toBe("a");

    expect(currentMobileDialog()).toBeNull();
  });

  it("gives every request a distinct id (host remount key)", () => {
    void mPrompt({ title: "one" });
    const a = currentMobileDialog()!;
    dismissMobileDialog(a);
    void mPrompt({ title: "two" });
    const b = currentMobileDialog()!;
    expect(a.id).not.toBe(b.id);
    dismissMobileDialog(b);
  });
});
