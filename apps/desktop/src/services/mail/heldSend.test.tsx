// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { ToastHost, toast, toastStore } from "@plainva/ui";
import { HeldSends, isMailTooLarge, mailErrorText } from "@plainva/ui/mail";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A message the mail server refused is kept until it is open again (plan
 * "Weiterleiten nimmt die Anhänge mit", part D) — the rule both shells read.
 *
 * Held here against the REAL toast host: what matters is what a person can do
 * with the notice. It stays for as long as the message is held, it cannot be
 * closed by hand, and asking for the way back does not take it down — only a
 * composer that has the message does.
 */

interface Message {
  subject: string;
}

let container: HTMLDivElement;
let root: Root;
let opened: Array<{ id: number; subject: string }>;
/** How the next attempt to bring a message back ends. */
let attempt: { resolve: () => void; reject: (reason: Error) => void } | null;

const held = () =>
  new HeldSends<Message>({
    text: (reason) => ({ message: `Not sent: ${reason}`, action: "Open again" }),
    open: (id, payload) =>
      new Promise<void>((resolve, reject) => {
        opened.push({ id, subject: payload.subject });
        attempt = { resolve, reject };
      }),
    settleMs: 2000,
  });

beforeEach(() => {
  vi.useFakeTimers();
  toast.clearAll();
  opened = [];
  attempt = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ToastHost />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  toast.clearAll();
  vi.useRealTimers();
});

const notices = () => [...container.querySelectorAll<HTMLElement>(".pv-toast")];
const action = () => container.querySelector<HTMLButtonElement>(".pv-toast-action");
const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("a refused message is held, and its notice is the way back", () => {
  it("says why, offers the way back, and cannot be closed by hand", async () => {
    const queue = held();
    act(() => void queue.hold({ subject: "Angebot" }, "the mailbox is full"));

    expect(queue.size).toBe(1);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].className).toContain("pv-toast--error");
    expect(notices()[0].textContent).toContain("Not sent: the mailbox is full");
    expect(action()?.textContent).toBe("Open again");
    // No way to wave it off: closing a notice must not be what loses a message.
    expect(container.querySelector(".pv-toast-x")).toBeNull();
    // And it does not go by itself, however long nobody looks.
    await tick(10 * 60_000);
    expect(notices()).toHaveLength(1);
    expect(toastStore.get()[0].persistent).toBe(true);
  });

  it("stays while the way back is only asked for, and goes when a composer has the message", async () => {
    const queue = held();
    let id = 0;
    act(() => void (id = queue.hold({ subject: "Angebot" }, "refused")));

    act(() => action()!.click());
    await tick();
    expect(opened).toEqual([{ id, subject: "Angebot" }]);
    // The window is on its way. The message is still the queue's.
    expect(notices()).toHaveLength(1);
    expect(queue.read(id)).toEqual({ subject: "Angebot" });

    act(() => queue.claim(id));
    expect(notices()).toHaveLength(0);
    expect(queue.size).toBe(0);
    expect(queue.read(id)).toBeUndefined();
  });

  it("does not bring the same message up twice while an attempt runs", async () => {
    const queue = held();
    act(() => void queue.hold({ subject: "Angebot" }, "refused"));

    act(() => action()!.click());
    act(() => action()!.click());
    await tick();
    expect(opened).toHaveLength(1);

    // The window came up; its composer claims the message a moment later. A
    // click in that moment must not open a second one either.
    await act(async () => attempt!.resolve());
    act(() => action()!.click());
    await tick(1000);
    expect(opened).toHaveLength(1);
  });

  it("keeps the message when the way back failed, and the action answers again", async () => {
    const queue = held();
    let id = 0;
    act(() => void (id = queue.hold({ subject: "Angebot" }, "refused")));

    act(() => action()!.click());
    await tick();
    await act(async () => attempt!.reject(new Error("the window did not come up")));
    await tick();
    expect(queue.read(id)).toEqual({ subject: "Angebot" });
    expect(notices()).toHaveLength(1);

    act(() => action()!.click());
    await tick();
    expect(opened).toHaveLength(2);
  });

  it("keeps the message when the attempt ended and nobody claimed it — a writer who kept the draft that was in the way", async () => {
    const queue = held();
    let id = 0;
    act(() => void (id = queue.hold({ subject: "Angebot" }, "refused")));

    act(() => action()!.click());
    await tick();
    await act(async () => attempt!.resolve());
    await tick(2000);
    expect(queue.read(id)).toEqual({ subject: "Angebot" });
    expect(notices()).toHaveLength(1);
    // The action answers again once the attempt has settled.
    act(() => action()!.click());
    await tick();
    expect(opened).toHaveLength(2);
  });

  it("holds each message with a notice of its own", async () => {
    const queue = held();
    let first = 0;
    let second = 0;
    act(() => {
      first = queue.hold({ subject: "Eins" }, "refused");
      second = queue.hold({ subject: "Zwei" }, "refused");
    });
    expect(notices()).toHaveLength(2);

    act(() => queue.claim(first));
    expect(notices()).toHaveLength(1);
    expect(queue.read(second)).toEqual({ subject: "Zwei" });
    // Claiming what is not held is nothing: a window that asks twice.
    act(() => queue.claim(first));
    act(() => queue.claim(undefined));
    expect(queue.size).toBe(1);
  });

  it("leaves every other notice as it was: a close button, and gone with its action", () => {
    act(() => void toast.error("Fehlgeschlagen", { label: "Nochmal", run: () => {} }));
    expect(container.querySelector(".pv-toast-x")).not.toBeNull();
    act(() => action()!.click());
    expect(notices()).toHaveLength(0);
  });
});

describe("a refusal for size is said as one", () => {
  const t = (key: string) => key;

  it("recognises it however the backend words it", () => {
    for (const refusal of [
      // The desktop's SMTP path and the phone's, each in its own wording.
      "smtp error (552): 5.3.4 Message size exceeds fixed maximum message size",
      "the server rejected the message: 552-5.2.3 Your message exceeded Google's message size limits.",
      "smtp error (554): 5.3.4 Message too big for system",
      "smtp error (552): Message size exceeds fixed limit",
      // Microsoft: the request, or the message.
      "Graph mail POST /me/sendMail failed: 413 Request Entity Too Large",
      'Graph mail POST /me/messages/AAMk=/send failed: 400 {"error":{"code":"ErrorMessageSizeExceeded","message":"The message exceeds the maximum supported size."}}',
    ]) {
      expect(isMailTooLarge(new Error(refusal)), refusal).toBe(true);
      expect(mailErrorText(new Error(refusal), t), refusal).toBe("mail.sendTooLarge");
    }
  });

  it("leaves every other refusal its own words", () => {
    for (const refusal of [
      // 552 is also "the recipient's mailbox is full" — not the message's size.
      "smtp error (552): 5.2.2 Mailbox full",
      "smtp error (550): 5.1.1 The email account that you tried to reach does not exist",
      "the server rejected ben@example.org: 550 mailbox unavailable",
      "Graph mail POST /me/sendMail failed: 429 Too Many Requests",
      "connect failed: timed out",
    ]) {
      expect(isMailTooLarge(new Error(refusal)), refusal).toBe(false);
      expect(mailErrorText(new Error(refusal), t), refusal).toBe(refusal);
    }
  });
});
