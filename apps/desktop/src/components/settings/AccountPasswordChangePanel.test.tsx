// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountPasswordChangePanel, type PasswordChangeJournal, type PasswordChangePorts } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function fixture(id: string) {
  let journal: PasswordChangeJournal | null = { version: 1, id, owner: id, binding: id, targets: [{ service: "calendar", previous: "old", next: "new", confirmed: false }] };
  const state = { value: "old", failClear: false };
  const ports: PasswordChangePorts = {
    key: id, owner: id, binding: id, readBinding: async () => id,
    targets: async () => [{ service: "calendar", read: async () => state.value, withPassword: (_previous, password) => password, verify: async () => {}, write: async (_previous, next) => { state.value = next; } }],
    journal: { read: async () => structuredClone(journal), write: async (next) => { journal = structuredClone(next); }, clear: async () => { if (state.failClear) throw Error("storage"); journal = null; } },
  };
  return { ports, state };
}

it("keeps resume available after unconfirmed cleanup and shows success only after confirmation", async () => {
  const f = fixture("account"); f.state.failClear = true;
  await act(async () => root.render(<AccountPasswordChangePanel ports={f.ports} />));
  const resume = () => host.querySelector<HTMLButtonElement>('[data-testid="password-change-resume"]')!;
  expect(resume()).not.toBeNull();
  await act(async () => resume().click());
  expect(f.state.value).toBe("new");
  expect(host.textContent).toContain(i18n.t("cloudAccounts.passwordStorageError"));
  expect(host.textContent).not.toContain(i18n.t("cloudAccounts.passwordUpdated"));
  expect(resume()).not.toBeNull();
  f.state.failClear = false;
  await act(async () => resume().click());
  expect(host.textContent).toContain(i18n.t("cloudAccounts.passwordUpdated"));
  expect(resume()).toBeNull();
});

it("ignores a late protected-storage response belonging to the previous vault", async () => {
  const first = fixture("vault-a"), second = fixture("vault-b");
  const firstJournal = await first.ports.journal.read();
  let release!: (value: unknown) => void;
  first.ports.journal.read = () => new Promise((resolve) => { release = resolve; });
  second.ports.journal.read = async () => null;
  await act(async () => root.render(<AccountPasswordChangePanel ports={first.ports} />));
  await act(async () => root.render(<AccountPasswordChangePanel ports={second.ports} />));
  await act(async () => release(firstJournal));
  expect(host.querySelector('[data-testid="password-change-resume"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-testid="cloudacct-new-password"]')?.disabled).toBe(false);
  expect(first.state.value).toBe("old"); expect(second.state.value).toBe("old");
});
