import { describe, expect, it } from "vitest";
import {
  currentMobileDialog,
  dismissMobileDialog,
  mConfirm,
  mConfirmOption,
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
    if (d1.kind === "prompt") d1.resolve({ value: "Alpha", cancelled: false, checked: false });
    dismissMobileDialog(d1);
    await expect(p1).resolves.toEqual({ value: "Alpha", cancelled: false, checked: false });

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

describe("a prompt that carries one more decision (S17)", () => {
  it("passes the checkbox through and reports its state", async () => {
    // The phone's creation sheet asks title AND "also create at the provider"
    // in one act — a follow-up dialog for the second half would be a second
    // decision where the user made one.
    const p = mPrompt({ title: "New task", checkbox: { label: "Also create in Inbox", initial: true } });
    const d = currentMobileDialog()!;
    expect(d.kind).toBe("prompt");
    if (d.kind === "prompt") {
      expect(d.checkbox).toEqual({ label: "Also create in Inbox", initial: true });
      d.resolve({ value: "Buy milk", cancelled: false, checked: false });
    }
    dismissMobileDialog(d);
    await expect(p).resolves.toEqual({ value: "Buy milk", cancelled: false, checked: false });
  });

  it("carries no checkbox when none was asked for", async () => {
    const p = mPrompt({ title: "Rename" });
    const d = currentMobileDialog()!;
    if (d.kind === "prompt") {
      expect(d.checkbox).toBeUndefined();
      d.resolve({ value: "x", cancelled: false, checked: false });
    }
    dismissMobileDialog(d);
    await expect(p).resolves.toEqual({ value: "x", cancelled: false, checked: false });
  });
});

describe("a confirmation that carries one more decision", () => {
  // Adopting a note as a folder's overview asks whether to prepare it on the
  // way (finding 2026-10-11): one act, so one sheet — the choice the desktop's
  // dialog offers beside its list.
  const ask = () => mConfirmOption({ title: "Adopt: MOC.md", message: "Links are updated.", checkbox: { label: "Prepare for OKF", initial: true } });

  it("hands the option to the host and answers with the state it was confirmed in", async () => {
    const p = ask();
    const d = currentMobileDialog()!;
    expect(d.kind).toBe("confirm");
    if (d.kind === "confirm") {
      expect(d.checkbox).toEqual({ label: "Prepare for OKF", initial: true });
      d.resolve(true, false);
    }
    dismissMobileDialog(d);
    await expect(p).resolves.toEqual({ confirmed: true, checked: false });
  });

  it("answers a cancelled sheet with the state it was opened in, and not confirmed", async () => {
    const p = ask();
    const d = currentMobileDialog()!;
    // The host cancels a confirmation the way it always did: with a bare `false`.
    if (d.kind === "confirm") d.resolve(false);
    dismissMobileDialog(d);
    await expect(p).resolves.toEqual({ confirmed: false, checked: true });
  });

  it("leaves a plain confirmation what it was: no option, a bare yes or no", async () => {
    const p = mConfirm({ title: "Sure?" });
    const d = currentMobileDialog()!;
    if (d.kind === "confirm") {
      expect(d.checkbox).toBeUndefined();
      // The host hands the option's state to every confirmation; a plain one takes the answer alone.
      d.resolve(true, false);
    }
    dismissMobileDialog(d);
    await expect(p).resolves.toBe(true);
  });
});
