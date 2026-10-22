// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast, toastStore, type ToastAction, type ToastItem } from "@plainva/ui";
import { useConnectRun } from "./useConnectRun";
import { initialNavState, navTop, type NavState } from "../navigation";
import { clearConnectQueue, type ConnectQueue } from "../services/connectQueue";
import { resetFlowVaultForTest, whileEntering } from "../services/flowVault";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "../services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "../services/mobileDialogs";

/**
 * A connect run that goes back to its vault (finding 2026-10-12).
 *
 * The files step of a run copies into a vault of its own and activates it. If
 * the app ends between the two, the run finds itself in the old vault on the
 * next start and activates its destination — that is what this hook is for.
 * It did so whenever it found the two apart, whatever was on screen: with a
 * message being written there, the switch took it, and nothing asked.
 *
 * The hook and the run's queue are the real ones; the settings store under
 * the queue and the vault switch are stand-ins.
 */

const state = vi.hoisted(() => ({
  active: "",
  names: {} as Record<string, string>,
  settings: new Map<string, unknown>(),
  switched: [] as string[],
  /** Vaults deleted from the registry. */
  gone: new Set<string>(),
  /** How often the hook asked which vault is on screen: once per run it found. */
  looked: 0,
}));
const switchVault = vi.hoisted(() => vi.fn());

vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({
    loadSettings: async () => ({
      get: async (key: string) => structuredClone(state.settings.get(key)),
      set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
      delete: async (key: string) => { state.settings.delete(key); },
      save: async () => {},
    }),
  }),
}));
vi.mock("@plainva/ui/i18n", () => ({
  default: { t: (key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key) },
}));
vi.mock("../services/vaultRegistry", () => ({
  getActiveVaultEntry: async () => {
    state.looked += 1;
    return { id: state.active, name: state.names[state.active] ?? "" };
  },
  getVaultEntry: async (id: string) => (state.gone.has(id) ? null : { id, name: state.names[id] ?? "" }),
}));
vi.mock("../services/vaultService", () => ({ switchVault }));
// The route table pulls in every screen of the app; the hook needs one function of it.
vi.mock("../routes", () => ({
  screenForService: (service: string) => (service === "files" ? "sync" : service === "calendar" ? "pimaccounts" : "mailaccounts"),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Long enough for the hook to have read its queue and acted on it. */
const quiet = async () => {
  for (let i = 0; i < 6; i += 1) await settle();
};
const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
const OWN_FORM = { id: "vault-connect", message: "The credentials you entered will be lost." };
const QUEUE = "mobileConnectQueue";

/** A run whose files were copied into "target" and connected there — and that was never activated. */
const interrupted = (): ConnectQueue => ({
  id: "run-1",
  family: "fastmail",
  context: { vaultId: "target", runId: "run-1", cloudAccountId: "account" },
  pending: ["files", "calendar"],
  done: [],
  outcomes: { files: { state: "connected", bindingId: "target" } },
  selectionConfirmed: false,
  createdAt: Date.now(),
  preparedVaultId: "target",
  sourceVaultId: "source",
});
/** The run's own event, as its queue raises it on every change. */
const runChanged = () => window.dispatchEvent(new CustomEvent("m-connect-run-changed"));

type Offer = ToastItem & { action: ToastAction };
const offers = () => toastStore.get().filter((item): item is Offer => item.action !== undefined);
const press = (notice: Offer) => {
  notice.action.run();
  toast.dismiss(notice.id);
};
const answer = (discard: boolean) => {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") throw new Error("no question");
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let nav: NavState;
/** Stable, like the shell's state setter: the hook's effect hangs on it. */
const setNav = (step: (current: NavState) => NavState) => {
  nav = step(nav);
};
function Shell() {
  useConnectRun(setNav);
  return null;
}
const start = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Shell />));
};

beforeEach(async () => {
  await clearConnectQueue();
  state.settings.clear();
  state.names = { source: "Notes", target: "Fastmail" };
  state.active = "source";
  state.switched.length = 0;
  state.gone.clear();
  state.looked = 0;
  switchVault.mockReset().mockImplementation(async (id: string) => {
    state.switched.push(id);
    state.active = id;
    window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
  });
  nav = initialNavState("notes");
  resetLeaveGuard();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  resetFlowVaultForTest();
  toast.clearAll();
  resetLeaveGuard();
});

describe("a connect run whose vault was never activated", () => {
  it("activates it and goes on, when nothing is at stake", async () => {
    state.settings.set(QUEUE, interrupted());

    await start();

    await vi.waitFor(() => expect(navTop(nav)?.kind).toBe("pimaccounts"));
    expect(state.switched).toEqual(["target"]);
    expect(offers()).toEqual([]);
  });

  it("does not take the vault from under a message being written: it offers the way, and its button asks first", async () => {
    state.settings.set(QUEUE, interrupted());
    armLeaveGuard(MESSAGE);

    await start();
    await quiet();

    // THE DEFECT: the run switched vaults by itself and pushed its next screen, and the message went with the stacks.
    expect(state.switched, "the vault was taken from under the message").toEqual([]);
    expect(navTop(nav), "nothing is put over the message").toBeUndefined();
    expect(activeLeaveGuard()).toEqual(MESSAGE);

    const all = offers();
    expect(all, "one notice offers the way to the vault").toHaveLength(1);
    expect(all[0].message).toBe("mobile.flowVaultOffer(Fastmail)");

    // "Cancel" keeps the message; the run waits.
    press(all[0]);
    await settle();
    answer(false);
    await quiet();
    expect(state.switched).toEqual([]);
    expect(navTop(nav)).toBeUndefined();
    expect(offers(), "the offer stands again").toHaveLength(1);

    // "Discard": the vault is switched, and the run goes on with its next service.
    press(offers()[0]);
    await settle();
    answer(true);
    await vi.waitFor(() => expect(navTop(nav)?.kind).toBe("pimaccounts"));
    expect(state.switched).toEqual(["target"]);
    expect(offers()).toEqual([]);
  });

  it("does not offer again on every sign of life of the run", async () => {
    state.settings.set(QUEUE, interrupted());
    armLeaveGuard(MESSAGE);
    await start();
    await quiet();
    expect(state.switched).toEqual([]);
    expect(offers()).toHaveLength(1);

    // The run's own event, and the notice closed by hand in between.
    const looked = state.looked;
    runChanged();
    await quiet();
    expect(state.looked, "the hook came by again").toBeGreaterThan(looked);
    expect(offers()).toHaveLength(1);
    toast.dismiss(offers()[0].id);
    runChanged();
    await quiet();

    expect(offers(), "closed means not now").toEqual([]);
    expect(state.switched).toEqual([]);
  });

  it("takes its notice down when the run is given up", async () => {
    state.settings.set(QUEUE, interrupted());
    armLeaveGuard(MESSAGE);
    await start();
    await quiet();
    expect(offers()).toHaveLength(1);

    await clearConnectQueue();
    await quiet();

    expect(offers(), "a notice for a run that is over").toEqual([]);
    expect(state.switched).toEqual([]);
  });

  it("leaves a transfer alone that is activating its vault right now", async () => {
    // The files step commits its result and switches next, with its own form —
    // and that form's guard — still on screen. The run's event reaches the
    // hook in between: it must neither switch a second time nor offer anything.
    armLeaveGuard(OWN_FORM);
    await start();
    await quiet();
    let land!: () => void;
    const landing = new Promise<void>((resolve) => {
      land = resolve;
    });
    const looked = state.looked;
    const transfer = whileEntering("target", async () => {
      state.settings.set(QUEUE, interrupted());
      runChanged();
      await landing;
      await switchVault("target");
    });

    await quiet();
    expect(state.looked, "the event reached the hook, and it found the run").toBeGreaterThan(looked);
    expect(state.switched).toEqual([]);
    expect(offers()).toEqual([]);
    expect(currentMobileDialog()).toBeNull();

    land();
    await transfer;
    await vi.waitFor(() => expect(navTop(nav)?.kind).toBe("pimaccounts"));
    expect(state.switched, "the transfer's own switch, and no other").toEqual(["target"]);
    expect(offers()).toEqual([]);
  });

  it("offers the vault once a transfer has left it unopened under someone else's input", async () => {
    // The copy outlived its form: a message is being written by the time it is
    // done, so the transfer does not switch (accountVaultTransfer.ts). What it
    // leaves is what an interrupted activation leaves, and the hook offers it.
    armLeaveGuard(MESSAGE);
    await start();
    await quiet();

    await whileEntering("target", async () => {
      state.settings.set(QUEUE, interrupted());
      runChanged();
      await quiet();
    });
    expect(offers(), "nothing is offered while the transfer is still at work").toEqual([]);
    runChanged();
    await quiet();

    expect(state.switched).toEqual([]);
    expect(navTop(nav)).toBeUndefined();
    const all = offers();
    expect(all).toHaveLength(1);
    expect(all[0].message).toBe("mobile.flowVaultOffer(Fastmail)");
  });

  it("stays out of a vault that is not the one its files were copied into", async () => {
    // A run without a prepared destination is nobody's reason to change vaults.
    state.settings.set(QUEUE, { ...interrupted(), preparedVaultId: undefined, outcomes: {} });

    await start();
    await quiet();

    expect(state.looked, "the hook found the run").toBeGreaterThan(0);
    expect(state.switched).toEqual([]);
    expect(navTop(nav)).toBeUndefined();
    expect(offers()).toEqual([]);
  });

  it("leaves the person in the vault they pick once the run was offered: not now means not now", async () => {
    state.settings.set(QUEUE, interrupted());
    armLeaveGuard(MESSAGE);
    await start();
    await quiet();
    expect(offers()).toHaveLength(1);

    // The notice closed, the message sent, and another vault picked from the list.
    toast.dismiss(offers()[0].id);
    resetLeaveGuard();
    await switchVault("elsewhere");
    await quiet();

    expect(state.active, "the run took the vault the person had just picked").toBe("elsewhere");
    expect(state.switched).toEqual(["elsewhere"]);
    expect(navTop(nav)).toBeUndefined();

    // Opened by the person, the run goes on there.
    await switchVault("target");
    await vi.waitFor(() => expect(navTop(nav)?.kind).toBe("pimaccounts"));
    expect(state.switched).toEqual(["elsewhere", "target"]);
  });

  it("does not pull the person back once it has gone on past its files", async () => {
    // Activated and on to the calendar — then the person opens another vault.
    state.settings.set(QUEUE, { ...interrupted(), pending: ["calendar"], done: ["files"] });

    await start();
    await quiet();

    expect(state.looked, "the hook found the run").toBeGreaterThan(0);
    expect(state.switched, "the vault the person is in is theirs").toEqual([]);
    expect(navTop(nav)).toBeUndefined();
    expect(offers()).toEqual([]);
  });
});

describe("a connect run whose vault was deleted", () => {
  it("is over the moment the vault goes: no switch into nothing, and its notice goes", async () => {
    state.settings.set(QUEUE, interrupted());
    armLeaveGuard(MESSAGE);
    await start();
    await quiet();
    expect(offers()).toHaveLength(1);

    state.gone.add("target");
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
    await quiet();

    expect(state.settings.has(QUEUE), "the run is given up, as its banner would").toBe(false);
    expect(offers()).toEqual([]);
    expect(state.switched).toEqual([]);
  });

  it("is over when the app finds it so on its next start, with nothing at stake", async () => {
    state.settings.set(QUEUE, interrupted());
    state.gone.add("target");

    await start();
    await quiet();

    expect(state.switched, "a switch would stop the sync on screen before it failed").toEqual([]);
    expect(state.settings.has(QUEUE)).toBe(false);
    expect(toastStore.get().filter((item) => item.kind === "error")).toEqual([]);
  });

  it("does not put its screen on top when another vault is renamed, paused or deleted", async () => {
    // At the calendar step, in its own vault: the run's screen was shown, and the person went elsewhere.
    state.active = "target";
    state.settings.set(QUEUE, { ...interrupted(), pending: ["calendar"], done: ["files"] });
    await start();
    await vi.waitFor(() => expect(navTop(nav)?.kind).toBe("pimaccounts"));
    nav = initialNavState("notes");
    armLeaveGuard(MESSAGE);

    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
    state.gone.add("archive");
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
    await quiet();

    expect(navTop(nav), "nothing is put over the message being written").toBeUndefined();
    expect(state.settings.has(QUEUE), "the run is still on").toBe(true);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
  });

  it("is over the moment its vault goes, also when nothing was offered for it", async () => {
    // At the calendar step, in another vault by the person's choice: no notice stands for the run.
    state.settings.set(QUEUE, { ...interrupted(), pending: ["calendar"], done: ["files"] });
    await start();
    await quiet();
    expect(offers()).toEqual([]);
    expect(state.settings.has(QUEUE)).toBe(true);

    state.gone.add("target");
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));
    await quiet();

    expect(state.settings.has(QUEUE), "the run is given up at once").toBe(false);
    expect(state.switched).toEqual([]);
    expect(navTop(nav)).toBeUndefined();
  });

  it("is over at any step, not only while its files wait for the vault", async () => {
    state.settings.set(QUEUE, { ...interrupted(), pending: ["calendar"], done: ["files"] });
    state.gone.add("target");

    await start();
    await quiet();

    expect(state.settings.has(QUEUE)).toBe(false);
    expect(state.switched).toEqual([]);
  });
});
