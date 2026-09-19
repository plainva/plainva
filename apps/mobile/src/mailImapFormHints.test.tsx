// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { presetById, setPlatformServices, type PlatformServices } from "@plainva/ui";

vi.mock("./hooks/useLeaveGuard", () => ({ useLeaveGuard: () => {} }));

import { MailImapForm } from "./screens/mail/MailImapForm";

/**
 * What a provider demands, said on the PHONE too (finding 2026-09-19).
 *
 * A tester could not connect his Gmail mailbox: the phone's form knew the
 * preset from the address and showed its name and port — nothing about the app
 * password Google insists on, and no way to the page that issues one. The
 * desktop wizard has said all of that per preset since the catalog exists.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const opened: string[] = [];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  opened.length = 0;
  setPlatformServices({ openExternal: async (url: string) => void opened.push(url) } as unknown as PlatformServices);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (user: string) =>
  act(async () => {
    root.render(<MailImapForm busy={false} available onSubmit={() => {}} prefill={{ user }} />);
  });

describe("the phone's mail form says what the provider demands", () => {
  it("Gmail: the app-password sentence, the direct link and the help link", async () => {
    await render("anna@gmail.com");
    expect(container.querySelector('[data-testid="imap-hint-app-password"]')?.textContent).toContain("Gmail");
    const direct = container.querySelector<HTMLButtonElement>('[data-testid="imap-app-password-link"]');
    expect(direct?.textContent).toBe("Create an app password at Google");
    await act(async () => direct!.click());
    expect(opened).toEqual([presetById("gmail")!.appPasswordUrl]);
    expect(opened[0]).toBe("https://myaccount.google.com/apppasswords");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="imap-provider-help"]')!.click());
    expect(opened[1]).toBe(presetById("gmail")!.helpUrl);
  });

  it("a provider without a direct page gets the hint and the help link, not a dead button", async () => {
    await render("anna@yahoo.com");
    expect(container.querySelector('[data-testid="imap-hint-app-password"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="imap-app-password-link"]')).toBeNull();
    expect(container.querySelector('[data-testid="imap-provider-help"]')).not.toBeNull();
  });

  it("an address no preset knows gets none of it", async () => {
    await render("anna@example.org");
    expect(container.querySelector('[data-testid="imap-hint-app-password"]')).toBeNull();
    expect(container.querySelector('[data-testid="imap-provider-help"]')).toBeNull();
  });
});
