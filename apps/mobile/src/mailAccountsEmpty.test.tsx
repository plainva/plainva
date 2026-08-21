// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import { MailAccountsScreen } from "./screens/MailAccountsScreen";
import { clearConnectSecrets, rememberConnectSecrets } from "./services/connectSecrets";

/**
 * The way into a mailbox, when there is none yet (Befund 2026-08-20).
 *
 * The screen offered "Postfach hinzufügen" inside the branch that renders the
 * LIST — so with no account it rendered one sentence and nothing else, and the
 * only surface that can connect a mailbox could not be used until a mailbox
 * already existed. Arriving from the connect wizard made it worse: step 3 of 3
 * IS "connect the mailbox", and it was the step that could not be completed.
 *
 * This asserts the BEHAVIOUR, not the shape: a source-text guard would have
 * passed all along, because the row's testid was in the file the whole time —
 * two branches away from ever being rendered.
 */

const accounts: unknown[] = [];

vi.mock("./services/mail/mailRuntime", () => ({
  MAIL_CHANGED_EVENT: "m-mail-changed",
  connectMicrosoftMail: vi.fn(),
  listMobileMailAccounts: vi.fn(async () => accounts),
  mailVaultId: () => "/vault",
  notifyMailChanged: vi.fn(),
  removeMobileMailAccount: vi.fn(),
}));
vi.mock("./services/deviceSignIn", () => ({ deviceSignInStates: vi.fn(async () => new Map()) }));
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ mailFolder: "Mail" }),
  updateMobileSettings: vi.fn(async () => {}),
}));
vi.mock("./adapters/mailNet", () => ({ hasNativeMailSocket: () => true }));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMailRules: vi.fn(async () => []),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  accounts.length = 0;
  clearConnectSecrets();
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      save: async () => {},
    }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const vault = { vaultId: "/vault" } as never;

const render = async (props: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(<MailAccountsScreen bump={0} vault={vault} {...props} />);
  });
  await act(async () => {});
};

describe("the mailbox screen with no mailbox", () => {
  it("still offers the way in", async () => {
    await render();
    expect(container.querySelector('[data-testid="mail-account-add"]')).not.toBeNull();
  });

  it("opens the form itself when the connect wizard sent the user here", async () => {
    await render({ family: "google" });
    expect(container.querySelector(".m-sheet")).not.toBeNull();
  });

  /**
   * Step 3 of a run must not look like a fresh, unrelated form (P4e/P4d,
   * finding 2026-08-21). The family decides the backend — Gmail is IMAP with an
   * app password, so the microsoft/imap switch has nothing left to ask — and an
   * address the run already collected belongs in the field rather than in the
   * user's memory.
   */
  it("arrives on the right backend and with what the run already knows", async () => {
    rememberConnectSecrets({ email: "ada@example.com", password: "app-pw" });
    await render({ family: "google" });
    const address = container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]');
    expect(address?.value).toBe("ada@example.com");
    // No provider switch: the family answered that question one screen earlier.
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  /**
   * A screen opened directly carries no family, so a credential left over from
   * an earlier run must not surface there — that would be a password appearing
   * in a form the user opened for something else.
   */
  it("never prefills outside a run", async () => {
    rememberConnectSecrets({ email: "ada@example.com", password: "app-pw" });
    await render();
    const add = container.querySelector<HTMLElement>('[data-testid="mail-account-add"]');
    await act(async () => add?.click());
    // Without a family the form starts on Microsoft and the switch is offered;
    // the IMAP side is where a prefill could show up at all.
    const imap = container.querySelectorAll<HTMLElement>('[role="radio"]')[1];
    await act(async () => imap?.click());
    const address = container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]');
    expect(address).not.toBeNull();
    expect(address?.value).toBe("");
  });

  it("does not take that decision once a mailbox exists", async () => {
    accounts.push({ id: "m1", label: "someone@example.com", host: "imap.example.com", port: 993, user: "someone@example.com", kind: "imap" });
    await render({ family: "google" });
    expect(container.querySelector(".m-sheet")).toBeNull();
    expect(container.querySelector('[data-testid="mail-account-add"]')).not.toBeNull();
  });
});
