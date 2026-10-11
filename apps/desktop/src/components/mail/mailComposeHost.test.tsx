// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The composer outlives its vault being loaded again (finding 2026-10-09).
 *
 * The central window shows the loading screen in place of its shell whenever
 * the vault is reloaded — "rebuild the index", but also a changed password, a
 * newly connected sync, a different sync interval, an encrypted workspace
 * locked or unlocked. The composer was part of that shell, so a message written
 * beside the settings went with it, without a word. Most of those cannot be
 * asked about first, so the composer is hosted NEXT to the shell and waits
 * instead: out of sight while the vault loads, there again with everything in
 * it.
 *
 * Rendered here with the composer's own form and state, the real floating
 * window, the real dialog host and the real window guard. Stand-ins are the
 * vault around it ("the vault is loading" is all the host reads), the body
 * editor (a plain field where the app has CodeMirror — so the cursor and the
 * undo history of a waiting composer are NOT what this file proves), the
 * account list and the two ways out, sending and the pop-out. The shell
 * really being replaced under a composer is e2e/mail.spec.ts.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  vault: { path: "/vault" as string | null, loading: false },
  popped: [] as unknown[],
}));

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: mocks.vault.path, vaultAdapter: null, isLoading: mocks.vault.loading }),
}));

vi.mock("./ComposeEditor", () => ({
  ComposeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="draft-body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../TemplatePickerModal", () => ({ TemplatePickerModal: () => null }));

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => mocks.accounts,
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

vi.mock("../../services/mail/sendQueue", () => ({ submitSend: async () => {}, submitDraft: async () => {} }));
vi.mock("../../services/mail/composeWindow", () => ({
  popOutCompose: async (_vault: string, snapshot: unknown) => {
    mocks.popped.push(snapshot);
  },
}));

import { MailComposeHost } from "./MailComposeHost";
// The host loads the composer lazily. Loaded here first, the chunk is in the
// module cache and the host only has to wait a tick for it, not for a compile.
import "./MailDraftModal";
import { DialogHost } from "../ui/DialogHost";
import { dialogStore } from "../../services/appDialogs";
import { askHeldWork, holdsUnsavedWork, resetWindowCloseGuardForTest } from "../../services/windowCloseGuard";
import { resetWindowParamsForTest } from "../../services/windowContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signing = { id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org", signature: "Marco" };

let container: HTMLDivElement;
let root: Root;

/** The shell's neighbours as `main.tsx` mounts them: the host and the app's dialog host. */
function render() {
  act(() =>
    root.render(
      <>
        <MailComposeHost />
        <DialogHost />
      </>,
    ),
  );
}

beforeEach(() => {
  mocks.accounts = [signing];
  mocks.vault.path = "/vault";
  mocks.vault.loading = false;
  mocks.popped.length = 0;
  resetWindowCloseGuardForTest();
  // The central window: it is the one with a loading screen.
  resetWindowParamsForTest("");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
  resetWindowCloseGuardForTest();
  resetWindowParamsForTest();
});

/** Lets the lazy composer, the account lookups and a dialog's answer land. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

// From the DOCUMENT: the floating window renders through a portal.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const value = (id: string) => byTestId<HTMLInputElement | HTMLTextAreaElement>(id)!.value;
const chips = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}-chip"]`)].map((chip) => chip.textContent?.trim());
const question = () => document.querySelector<HTMLElement>(".pv-overlay--dialog");

/** Anything in the app asks for the composer through this event. */
async function compose(detail: { subject?: string; markdown?: string; to?: string; attachments?: unknown[] }) {
  act(() => {
    window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail }));
  });
  // The composer is a lazy chunk; wait for it rather than for a fixed count.
  for (let i = 0; i < 50 && !byTestId("draft-form"); i += 1) await settle();
  expect(byTestId("draft-form"), "the composer opened").not.toBeNull();
  await settle();
}

/** React tracks the value itself, so the NATIVE setter has to write it. */
function type(id: string, text: string) {
  const el = byTestId(id)!;
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const desc = Object.getOwnPropertyDescriptor(p, "value");
    if (desc?.set) {
      desc.set.call(el, text);
      break;
    }
  }
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(id: string) {
  const el = byTestId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

/** The vault under the window is loaded again / is back. */
async function vaultLoads(loading: boolean) {
  mocks.vault.loading = loading;
  render();
  await settle();
}

describe("the window's composer", () => {
  it("opens with what the request carries", async () => {
    await compose({ subject: "Angebot", markdown: "Hallo Anna,", to: "anna@example.org" });
    expect(value("draft-subject")).toBe("Angebot");
    expect(chips("draft-to")).toEqual(["anna@example.org"]);
    expect(value("draft-body")).toContain("Hallo Anna,");
    expect(value("draft-body"), "signed by the composer").toContain("Marco");
  });

  it("hands the vault it stands on to the pop-out", async () => {
    await compose({ subject: "Angebot", markdown: "" });
    await click("draft-popout");
    expect(mocks.popped).toHaveLength(1);
    expect(byTestId("draft-form"), "two composers on one draft would be two drafts").toBeNull();
  });

  it("is not drawn in a window that shows no vault", async () => {
    mocks.vault.path = null;
    render();
    act(() => {
      window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail: { subject: "Angebot", markdown: "" } }));
    });
    for (let i = 0; i < 5; i += 1) await settle();
    expect(byTestId("draft-form")).toBeNull();
  });
});

describe("the vault is loaded again under a written message", () => {
  it("keeps the composer: out of sight while the vault loads, back with everything typed, and nobody is asked", async () => {
    await compose({ subject: "Angebot", markdown: "Hallo Anna,", to: "anna@example.org" });
    type("draft-subject", "Angebot, zweite Fassung");
    type("draft-body", `${value("draft-body")}\n\nDanke, passt!`);
    const written = value("draft-body");

    await vaultLoads(true);
    expect(byTestId("draft-form"), "nothing to type into or send from while the vault is taken apart").toBeNull();
    expect(question(), "a reload cannot be asked about, so it must not need to be").toBeNull();

    await vaultLoads(false);
    expect(byTestId("draft-form"), "the composer is back").not.toBeNull();
    expect(value("draft-subject")).toBe("Angebot, zweite Fassung");
    expect(value("draft-body")).toBe(written);
    expect(chips("draft-to")).toEqual(["anna@example.org"]);
    expect(question()).toBeNull();
  });

  it("stays a changed draft while it waits: the window still holds its question", async () => {
    // What the loading screen's "cancel" meets — it closes the vault, and
    // closing a vault over a changed draft asks.
    await compose({ subject: "Angebot", markdown: "" });
    type("draft-subject", "Angebot, zweite Fassung");
    await settle();
    expect(holdsUnsavedWork()).toBe(true);

    await vaultLoads(true);
    expect(holdsUnsavedWork()).toBe(true);
    let answered: boolean | null = null;
    act(() => {
      void askHeldWork().then((go) => {
        answered = go;
      });
    });
    await settle();
    expect(question(), "the composer's own question, although the composer is not drawn").not.toBeNull();
    act(() => {
      question()!.querySelector<HTMLButtonElement>(".pv-modal-footer button")!.click();
    });
    await settle();
    expect(answered, "Cancel").toBe(false);

    await vaultLoads(false);
    expect(value("draft-subject")).toBe("Angebot, zweite Fassung");
  });

  it("keeps a recipient that was typed but not yet confirmed", async () => {
    // The field is gone while the composer waits and comes back empty. What
    // was typed into it must neither vanish nor be sent to without being shown.
    await compose({ subject: "Angebot", markdown: "", to: "anna@example.org" });
    type("draft-to", "ben@example.org");
    expect(chips("draft-to"), "typed, not confirmed").toEqual(["anna@example.org"]);

    await vaultLoads(true);
    await vaultLoads(false);
    expect(chips("draft-to")).toEqual(["anna@example.org", "ben@example.org"]);
    expect(value("draft-to")).toBe("");
  });

  it("confirms it the way the field would have: several at once, and none a second time", async () => {
    await compose({ subject: "Angebot", markdown: "", to: "anna@example.org" });
    // An address that is a chip already, and two typed in one go.
    type("draft-to", "anna@example.org; ben@example.org, cleo@example.org");

    await vaultLoads(true);
    await vaultLoads(false);
    expect(chips("draft-to")).toEqual(["anna@example.org", "ben@example.org", "cleo@example.org"]);
    expect(value("draft-to")).toBe("");
  });

  it("comes back without taking the keyboard: what it waited for was started somewhere else", async () => {
    // A password changed in the settings reloads the vault, and the settings
    // are open again in the moment the composer returns. A composer that
    // reached for the focus then would get what is typed for the settings.
    await compose({ subject: "Angebot", markdown: "" });
    expect(document.activeElement, "a new composer starts in its recipient field").toBe(byTestId("draft-to"));
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      await vaultLoads(true);
      await vaultLoads(false);
      expect(byTestId("draft-form")).not.toBeNull();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("brings an untouched composer back too, and holds nothing for it", async () => {
    await compose({ subject: "Angebot", markdown: "Hallo Anna,", to: "anna@example.org" });
    expect(holdsUnsavedWork()).toBe(false);
    await vaultLoads(true);
    expect(holdsUnsavedWork()).toBe(false);
    await vaultLoads(false);
    expect(value("draft-subject")).toBe("Angebot");
    // Still untouched: it closes without a question, as it would have before.
    await click("draft-close");
    expect(question()).toBeNull();
    expect(byTestId("draft-form")).toBeNull();
  });

  it("does not bring back a composer that was closed before", async () => {
    await compose({ subject: "Angebot", markdown: "" });
    await click("draft-close");
    expect(byTestId("draft-form")).toBeNull();
    await vaultLoads(true);
    await vaultLoads(false);
    expect(byTestId("draft-form")).toBeNull();
  });
});
