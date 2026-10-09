// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";

/**
 * The composer in a window of its own, at the moment it is done (finding
 * 2026-10-09).
 *
 * The central window asks a window that holds a changed draft before it
 * destroys it. A message that was just sent still stands in the composer's
 * fields, so the window has to LET GO before it closes itself — otherwise the
 * writer is asked whether to discard a message that is already on its way,
 * which is the fault the phone's composer had until 28a2a74c. The composer
 * reaches this window through one callback; what is pinned here is what that
 * callback does, and in which order.
 */

const log = vi.hoisted(() => [] as string[]);
const SNAPSHOT: ComposeSnapshot = {
  accountId: "a1",
  fromAddress: "me@example.org",
  to: "anna@example.org",
  cc: "",
  bcc: "",
  showCc: false,
  subject: "Angebot",
  body: "Hallo Anna,",
  attachments: [],
  mailbox: "Drafts",
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: async () => {
      log.push("close");
    },
  }),
}));
vi.mock("../../services/windowCloseGuard", () => ({
  releaseWindowClose: () => {
    log.push("let go");
  },
}));
vi.mock("../../services/windowBus", () => ({
  getWindowBus: async () => ({ request: async (kind: string) => (kind === "compose-draft" ? SNAPSHOT : null) }),
}));
// The composer itself is covered next door; here it is the thing that says "done".
vi.mock("./MailDraftModal", () => ({
  MailDraftModal: ({ onClose, restore, variant }: { onClose: () => void; restore?: ComposeSnapshot; variant?: string }) => (
    <button type="button" data-testid="composer-done" data-variant={variant} onClick={onClose}>
      {restore?.subject}
    </button>
  ),
}));

import { ComposeWindow } from "./ComposeWindow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  log.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("the compose window, once its composer is done", () => {
  it("lets go of the draft first and closes second", async () => {
    act(() => root.render(<ComposeWindow label="compose-1" />));
    await settle();
    const done = container.querySelector<HTMLButtonElement>('[data-testid="composer-done"]');
    // The draft it was opened for, framed as a window.
    expect(done?.textContent).toBe("Angebot");
    expect(done?.dataset.variant).toBe("window");

    act(() => done!.click());
    await settle();
    expect(log).toEqual(["let go", "close"]);
  });
});
