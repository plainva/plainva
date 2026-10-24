// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, toastStore, type ToastAction, type ToastItem } from "@plainva/ui";
import { CONNECT_FORM_GUARD, enterFlowVault, enterMadeVault, foreignInputOnScreen, releaseFlowVault, resetFlowVaultForTest, whileEntering } from "./flowVault";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";

/**
 * A vault switch the program starts (finding 2026-10-12).
 *
 * A sign-in that returns, a folder pick, an interrupted run, the end of a file
 * connection: each belongs to a vault and used to go there by itself —
 * whatever was on screen in the vault it left. What they go through now is
 * pinned here: nothing changes while nothing of anyone else's is at stake;
 * with unsaved input on screen the switch is offered, its button asks the
 * surface's own question, and the flow goes on the moment its vault is the one
 * on screen. The notice stands exactly as long as a flow waits behind it.
 *
 * The flows themselves are in flowVaultReturn.test.ts,
 * hooks/useConnectRun.test.tsx and accountVaultTransfer.test.ts.
 */

const state = vi.hoisted(() => ({
  active: "work",
  names: {} as Record<string, string>,
  gone: new Set<string>(),
  /** Vaults whose entry cannot be read: the registry fails, which says nothing about the vault. */
  unreadable: new Set<string>(),
  switched: [] as string[],
  fails: false,
}));

vi.mock("@plainva/ui/i18n", () => ({
  default: { t: (key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key) },
}));
vi.mock("./vaultRegistry", () => ({
  getActiveVaultEntry: async () => ({ id: state.active, name: state.names[state.active] ?? "" }),
  getVaultEntry: async (id: string) => {
    if (state.unreadable.has(id)) throw new Error("storage unavailable");
    return state.gone.has(id) ? null : { id, name: state.names[id] ?? "" };
  },
}));
vi.mock("./vaultService", () => ({
  switchVault: async (id: string) => {
    if (state.fails) throw new Error("storage unavailable");
    state.switched.push(id);
    state.active = id;
    window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
  },
}));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
const OWN_FORM = { id: CONNECT_FORM_GUARD, message: "The credentials you entered will be lost." };

type Offer = ToastItem & { action: ToastAction };
const offers = () => toastStore.get().filter((item): item is Offer => item.action !== undefined);
const offer = () => {
  const all = offers();
  expect(all, "one notice offers the way to the vault").toHaveLength(1);
  return all[0];
};
/** A tap on a notice's button, the way the toast host does it: the action runs, the notice goes. */
const press = (notice: Offer) => {
  notice.action.run();
  toast.dismiss(notice.id);
};
const question = () => {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") throw new Error("no question");
  return dialog;
};
const answer = (discard: boolean) => {
  const dialog = question();
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
};
/** A flow that stopped short of its vault: what it would go on with, whether it still waits, and how it ends. */
const flow = (waits = true) => ({ resume: vi.fn(), waits: vi.fn(() => waits), gone: vi.fn() });
/** The vault list changed — `removeVault` says so after a delete. */
const listChanged = () => window.dispatchEvent(new CustomEvent("m-vaults-changed"));
/** The vault is opened some other way: the registry names it, the event follows. */
const open = (id: string) => {
  state.active = id;
  window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
};

beforeEach(() => {
  state.active = "work";
  state.names = { home: "Home", work: "Work" };
  state.gone.clear();
  state.unreadable.clear();
  state.switched.length = 0;
  state.fails = false;
  resetLeaveGuard();
});

afterEach(() => {
  const dialog = currentMobileDialog();
  if (dialog) dismissMobileDialog(dialog);
  resetFlowVaultForTest();
  toast.clearAll();
  resetLeaveGuard();
});

describe("a flow that has to get to its vault", () => {
  it("is there already when its vault is the one on screen", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    expect(await enterFlowVault("work", "sign-in", step)).toBe(true);
    expect(state.switched).toEqual([]);
    expect(offers()).toEqual([]);
    expect(step.resume, "the caller goes on itself").not.toHaveBeenCalled();
  });

  it("switches at once while nothing is at stake, exactly as before", async () => {
    const step = flow();
    expect(await enterFlowVault("home", "sign-in", step)).toBe(true);
    expect(state.switched).toEqual(["home"]);
    expect(offers()).toEqual([]);
    expect(currentMobileDialog()).toBeNull();
    expect(step.resume, "the caller goes on itself").not.toHaveBeenCalled();
  });

  it("offers the switch instead of making it while a surface holds unsaved input", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();

    expect(await enterFlowVault("home", "sign-in", step)).toBe(false);

    expect(state.switched).toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
    expect(currentMobileDialog(), "the flow asks nothing on its own").toBeNull();
    const offered = offer();
    expect(offered.message).toBe("mobile.flowVaultOffer(Home)");
    expect(offered.action.label).toBe("sidebar.switchVault");
    expect(offered.kind).toBe("info");
    expect(offered.persistent).toBe(true);
    expect(step.resume).not.toHaveBeenCalled();
  });

  it("names the vault on this device by what the vault list calls it", async () => {
    state.names = {};
    armLeaveGuard(MESSAGE);
    await enterFlowVault("local", "sign-in", flow());
    expect(offer().message).toBe("mobile.flowVaultOffer(mobile.vaultLocal)");
  });

  it("asks the surface's own question at the button; Cancel keeps the message and the offer", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);

    press(offer());
    await settle();
    expect(question().message).toBe(MESSAGE.message);
    expect(question().danger).toBe(true);
    expect(offers(), "nothing under the question").toEqual([]);
    expect(state.switched).toEqual([]);

    answer(false);
    await settle();
    expect(state.switched).toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
    expect(step.resume).not.toHaveBeenCalled();
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
  });

  it("switches on Discard and lets the flow go on in its vault", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
    expect(offers()).toEqual([]);
    // The message was given up for the switch, and its guard goes with it —
    // not later, when the surface's own clean-up gets to it (`keepArmed`).
    expect(activeLeaveGuard()).toBeNull();
    // And it went on once: the switch and its announcement are one arrival.
    await settle();
    expect(step.resume).toHaveBeenCalledTimes(1);
  });

  it("lets what goes on after Discard find nothing at stake any more — so a connection of its own is not offered a second time", async () => {
    armLeaveGuard(MESSAGE);
    const seen: boolean[] = [];
    await enterFlowVault("home", "file-connection", { resume: () => void seen.push(foreignInputOnScreen()), waits: () => true });

    press(offer());
    await settle();
    answer(true);

    await vi.waitFor(() => expect(seen).toEqual([false]));
  });

  it("lets go of the given-up guard only: a guard another surface arms meanwhile stays", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    press(offer());
    await settle();
    // The question is up; by the time it is answered another surface holds input.
    const other = { id: "pim-accounts", message: "The account settings will be lost." };
    const dialog = question();
    armLeaveGuard(other);
    dialog.resolve(true);
    dismissMobileDialog(dialog);

    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
    expect(activeLeaveGuard()).toEqual(other);
  });

  it("switches without a question once the message is gone", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    resetLeaveGuard(); // sent

    press(offer());
    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
    expect(currentMobileDialog()).toBeNull();
    expect(state.switched).toEqual(["home"]);
  });

  it("goes on when the vault is opened another way, and takes its notice down", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    offer();

    // Picked from the vault list, which asked its own question on the way.
    open("home");

    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
    expect(offers()).toEqual([]);
    expect(state.switched, "nobody switched a second time").toEqual([]);
  });

  it("is not moved by another vault being opened, or the same one loading again", async () => {
    state.names.archive = "Archive";
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);

    window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id: "archive" } }));
    window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id: "work" } }));
    window.dispatchEvent(new CustomEvent("m-vault-switched"));
    await settle();

    expect(step.resume).not.toHaveBeenCalled();
    expect(offers()).toHaveLength(1);
  });

  it("asks nobody to give something up for a flow that is over", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow(false);
    await enterFlowVault("home", "sign-in", step);

    press(offer());
    await settle();

    expect(currentMobileDialog()).toBeNull();
    expect(state.switched).toEqual([]);
    expect(step.resume).not.toHaveBeenCalled();
    // And it is forgotten: the vault opened later starts nothing.
    open("home");
    await settle();
    expect(step.resume).not.toHaveBeenCalled();
    expect(offers()).toEqual([]);
  });

  it("raises one notice for two flows of one vault, and lets both go on", async () => {
    armLeaveGuard(MESSAGE);
    const signIn = flow();
    const run = flow();
    await Promise.all([enterFlowVault("home", "sign-in", signIn), enterFlowVault("home", "connect-run", run)]);
    expect(offers()).toHaveLength(1);

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(run.resume).toHaveBeenCalledTimes(1));
    expect(signIn.resume).toHaveBeenCalledTimes(1);
    expect(state.switched).toEqual(["home"]);
  });

  it("lets the flows that still wait go on, without the one that is over", async () => {
    armLeaveGuard(MESSAGE);
    const over = flow(false);
    const waiting = flow();
    await enterFlowVault("home", "sign-in", over);
    await enterFlowVault("home", "connect-run", waiting);

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(waiting.resume).toHaveBeenCalledTimes(1));
    expect(over.resume).not.toHaveBeenCalled();
  });

  it("keeps one of a kind per vault: a flow that comes by again replaces its step and raises nothing", async () => {
    armLeaveGuard(MESSAGE);
    const first = flow();
    const second = flow();
    await enterFlowVault("home", "connect-run", first);
    const notice = offer();
    expect(await enterFlowVault("home", "connect-run", second)).toBe(false);
    expect(offers().map((item) => item.id)).toEqual([notice.id]);

    // Closed by hand means "not now": coming by again does not bring it back …
    toast.dismiss(notice.id);
    expect(await enterFlowVault("home", "connect-run", second)).toBe(false);
    expect(offers()).toEqual([]);
    // … and the flow still goes on once its vault is on screen.
    open("home");
    await vi.waitFor(() => expect(second.resume).toHaveBeenCalledTimes(1));
    expect(first.resume).not.toHaveBeenCalled();
  });

  it("offers again when another kind of flow turns up after the notice was closed", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "connect-run", flow());
    toast.dismiss(offer().id);

    await enterFlowVault("home", "sign-in", flow());
    expect(offers()).toHaveLength(1);
  });

  it("keeps a vault apart from another: one notice each", async () => {
    state.names.archive = "Archive";
    armLeaveGuard(MESSAGE);
    const home = flow();
    const archive = flow();
    await enterFlowVault("home", "sign-in", home);
    await enterFlowVault("archive", "new-vault", archive);
    expect(offers().map((item) => item.message).sort()).toEqual(["mobile.flowVaultOffer(Archive)", "mobile.flowVaultOffer(Home)"]);

    open("archive");
    await vi.waitFor(() => expect(archive.resume).toHaveBeenCalledTimes(1));
    expect(home.resume).not.toHaveBeenCalled();
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
  });

  it("says so when the switch fails, and leaves the offer where it was", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    state.fails = true;

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(toastStore.get().some((item) => item.kind === "error")).toBe(true));
    expect(step.resume).not.toHaveBeenCalled();
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
  });

  it("reports what a resumed flow throws instead of losing it", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "sign-in", { resume: () => Promise.reject(new Error("accountChanged")), waits: () => true });

    open("home");

    await vi.waitFor(() => expect(toastStore.get().filter((item) => item.kind === "error")).toHaveLength(1));
  });
});

describe("the notice stands exactly as long as a flow waits behind it", () => {
  it("goes with a flow that ended some other way", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "file-connection", step);
    offer();

    releaseFlowVault("file-connection");

    expect(offers(), "nothing is left to offer").toEqual([]);
    open("home");
    await settle();
    expect(step.resume, "and nothing is left to go on").not.toHaveBeenCalled();
  });

  it("stays for the flow that still waits when another one ends", async () => {
    armLeaveGuard(MESSAGE);
    const connection = flow();
    const signIn = flow();
    await enterFlowVault("home", "file-connection", connection);
    await enterFlowVault("home", "sign-in", signIn);

    releaseFlowVault("file-connection");

    expect(offers()).toHaveLength(1);
    open("home");
    await vi.waitFor(() => expect(signIn.resume).toHaveBeenCalledTimes(1));
    expect(connection.resume).not.toHaveBeenCalled();
  });

  it("keeps the offer of the vault a flow still heads for, and ends the one it left", async () => {
    state.names.archive = "Archive";
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "connect-run", flow());
    await enterFlowVault("archive", "connect-run", flow());
    expect(offers()).toHaveLength(2);

    releaseFlowVault("connect-run", "archive");

    expect(offer().message).toBe("mobile.flowVaultOffer(Archive)");
  });

  it("is never raised for a vault that is gone: the flow is told it is over", async () => {
    state.gone.add("home");
    armLeaveGuard(MESSAGE);
    const step = flow();

    expect(await enterFlowVault("home", "sign-in", step)).toBe(false);

    expect(offers()).toEqual([]);
    expect(state.switched).toEqual([]);
    expect(step.gone).toHaveBeenCalledTimes(1);
  });

  it("does not switch into a vault that is gone, with nothing at stake either", async () => {
    // A run left unopened under a message, and the vault deleted since: the
    // switch would stop the sync of the vault on screen before it failed.
    state.gone.add("home");
    const step = flow();

    expect(await enterFlowVault("home", "connect-run", step)).toBe(false);

    expect(state.switched).toEqual([]);
    expect(step.gone).toHaveBeenCalledTimes(1);
    expect(toastStore.get().filter((item) => item.kind === "error"), "nothing failed: the flow is over").toEqual([]);
    expect(offers()).toEqual([]);
  });

  it("goes the moment its vault is deleted, and ends the flows that waited for it", async () => {
    armLeaveGuard(MESSAGE);
    const signIn = flow();
    const run = flow();
    await enterFlowVault("home", "sign-in", signIn);
    await enterFlowVault("home", "connect-run", run);
    offer();

    state.gone.add("home");
    listChanged();

    await vi.waitFor(() => expect(offers()).toEqual([]));
    await vi.waitFor(() => expect(run.gone).toHaveBeenCalledTimes(1));
    expect(signIn.gone).toHaveBeenCalledTimes(1);
    expect(signIn.resume).not.toHaveBeenCalled();
  });

  it("stays when another vault is deleted, or one is renamed", async () => {
    state.names.archive = "Archive";
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    const notice = offer();

    state.gone.add("archive");
    listChanged();
    await settle();

    expect(offers().map((item) => item.id)).toEqual([notice.id]);
    expect(step.gone).not.toHaveBeenCalled();
  });

  it("ends at the button when its vault was deleted meanwhile: no question, and nothing comes back", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "connect-run", step);
    state.gone.add("home");

    press(offer());
    await settle();

    expect(currentMobileDialog(), "nobody is asked to give up anything for it").toBeNull();
    expect(state.switched).toEqual([]);
    expect(offers()).toEqual([]);
    expect(step.waits, "the vault is asked for first").not.toHaveBeenCalled();
    expect(step.gone, "and the flow learns that it is over").toHaveBeenCalledTimes(1);
    // The flow comes by again: a vault that is gone is still nobody's way on.
    expect(await enterFlowVault("home", "connect-run", step)).toBe(false);
    expect(offers()).toEqual([]);
  });
});

describe("what the person has been offered is theirs to open", () => {
  it("is not taken by the flow when it comes by again, even with nothing at stake by then", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "connect-run", step);
    const notice = offer();

    resetLeaveGuard(); // sent
    expect(await enterFlowVault("home", "connect-run", step)).toBe(false);
    expect(state.switched, "the notice still stands, and the vault is the person's to open").toEqual([]);
    expect(offers().map((item) => item.id)).toEqual([notice.id]);

    // "Not now", and another vault picked by hand: the run comes by on the switch, and leaves it be.
    toast.dismiss(notice.id);
    open("archive");
    expect(await enterFlowVault("home", "connect-run", step)).toBe(false);
    expect(state.active).toBe("archive");
    expect(state.switched).toEqual([]);
    expect(offers()).toEqual([]);

    // Opened by the person, it goes on.
    open("home");
    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
  });

  it("holds for a flow that joined a notice raised for another one", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "sign-in", flow());
    offer();
    const run = flow();
    await enterFlowVault("home", "connect-run", run);
    expect(offers()).toHaveLength(1);

    resetLeaveGuard();
    expect(await enterFlowVault("home", "connect-run", run)).toBe(false);
    expect(state.switched).toEqual([]);
  });

  it("holds for every flow of the vault: one that turns up after the notice was closed brings it back, and takes nothing", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "connect-run", flow());
    toast.dismiss(offer().id);
    resetLeaveGuard();

    // A sign-in begun in the same vault returns, with nothing at stake by now.
    const signIn = flow();
    expect(await enterFlowVault("home", "sign-in", signIn)).toBe(false);

    expect(state.switched, "the vault is still the person's to open").toEqual([]);
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
    open("home");
    await vi.waitFor(() => expect(signIn.resume).toHaveBeenCalledTimes(1));
  });

  it("switches nothing when the flows ended while the question was up: the input stays", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "sign-in", flow());
    press(offer());
    await settle();
    question();

    releaseFlowVault("sign-in");
    answer(true);
    await settle();

    expect(state.switched).toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
  });

  it("switches nothing when the vault was deleted while the question was up", async () => {
    armLeaveGuard(MESSAGE);
    const step = flow();
    await enterFlowVault("home", "sign-in", step);
    press(offer());
    await settle();
    question();

    state.gone.add("home");
    listChanged();
    await vi.waitFor(() => expect(step.gone).toHaveBeenCalledTimes(1));
    answer(true);
    await settle();

    expect(state.switched, "a switch into a deleted vault stops the sync before it fails").toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
  });

  it("starts afresh for a flow that ended and begins again", async () => {
    armLeaveGuard(MESSAGE);
    await enterFlowVault("home", "sign-in", flow());
    offer();
    releaseFlowVault("sign-in");
    resetLeaveGuard();

    // A new sign-in, nothing at stake: it goes back to its vault by itself, as always.
    expect(await enterFlowVault("home", "sign-in", flow())).toBe(true);
    expect(state.switched).toEqual(["home"]);
  });
});

describe("when the vault list cannot be read", () => {
  it("names no vault at all rather than the wrong one, and raises the notice the next time by", async () => {
    armLeaveGuard(MESSAGE);
    state.unreadable.add("home");
    const step = flow();

    expect(await enterFlowVault("home", "sign-in", step)).toBe(false);
    expect(offers(), "\"On this device\" would name another vault").toEqual([]);
    expect(state.switched).toEqual([]);

    state.unreadable.delete("home");
    expect(await enterFlowVault("home", "sign-in", step)).toBe(false);
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
  });

  it("takes the vault the next time by when nothing is at stake then, and goes on once", async () => {
    armLeaveGuard(MESSAGE);
    state.unreadable.add("home");
    const first = flow();
    await enterFlowVault("home", "sign-in", first);
    state.unreadable.delete("home");
    resetLeaveGuard();

    const again = flow();
    expect(await enterFlowVault("home", "sign-in", again)).toBe(true);
    expect(state.switched).toEqual(["home"]);
    await settle();
    expect(first.resume, "the caller goes on itself, not a second time on the switch").not.toHaveBeenCalled();
    expect(again.resume).not.toHaveBeenCalled();
  });

  it("keeps a flow at the button that cannot say whether it still waits", async () => {
    armLeaveGuard(MESSAGE);
    const step = { resume: vi.fn(), waits: vi.fn(() => Promise.reject(new Error("storage unavailable"))) };
    await enterFlowVault("home", "sign-in", step);

    press(offer());
    await settle();
    answer(true);

    await vi.waitFor(() => expect(step.resume).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
  });
});

describe("the end of a file connection: the vault it has just made", () => {
  it("tells the connect form's own input from anyone else's", () => {
    expect(foreignInputOnScreen(CONNECT_FORM_GUARD)).toBe(false);
    armLeaveGuard(OWN_FORM);
    expect(foreignInputOnScreen(CONNECT_FORM_GUARD)).toBe(false);
    expect(foreignInputOnScreen(), "a flow without a form of its own").toBe(true);
    armLeaveGuard(MESSAGE);
    expect(foreignInputOnScreen(CONNECT_FORM_GUARD)).toBe(true);
  });

  it("opens the vault and runs what needs it, with nothing at stake", async () => {
    const after = vi.fn(() => {
      expect(state.active, "the vault is the active one by then").toBe("home");
    });
    await enterMadeVault("home", after);
    expect(state.switched).toEqual(["home"]);
    expect(after).toHaveBeenCalledTimes(1);
    expect(offers()).toEqual([]);
  });

  it("asks nobody about the form it was started from: what was typed there is what was connected", async () => {
    armLeaveGuard(OWN_FORM);
    const after = vi.fn();
    await enterMadeVault("home", after);
    expect(state.switched).toEqual(["home"]);
    expect(after).toHaveBeenCalledTimes(1);
    expect(currentMobileDialog()).toBeNull();
    expect(offers()).toEqual([]);
  });

  it("is offered, not opened, over someone else's unsaved input — and what needs it waits for it", async () => {
    // A consent that returned late: its folder picker opened over a message.
    armLeaveGuard(MESSAGE);
    const after = vi.fn();

    await enterMadeVault("home", after);

    expect(state.switched, "the vault was taken from under the message").toEqual([]);
    expect(after, "the new vault's settings are not written into the one on screen").not.toHaveBeenCalled();
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
    await settle();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("needs nothing afterwards when the flow has nothing to do there", async () => {
    await enterMadeVault("home");
    expect(state.switched).toEqual(["home"]);
  });
});

describe("a flow that activates the vault it has just made", () => {
  it("is not switched for a second time, and nothing is offered, by whoever comes by meanwhile", async () => {
    // Its own form is still on screen, with its own guard armed.
    armLeaveGuard(OWN_FORM);
    const run = flow();
    let land!: () => void;
    const landing = new Promise<void>((resolve) => {
      land = resolve;
    });
    const { switchVault } = await import("./vaultService");
    const entry = whileEntering("home", async () => {
      await landing;
      await switchVault("home");
    });

    expect(await enterFlowVault("home", "connect-run", run)).toBe(false);
    expect(state.switched).toEqual([]);
    expect(offers()).toEqual([]);
    expect(currentMobileDialog()).toBeNull();

    land();
    await entry;
    await vi.waitFor(() => expect(run.resume).toHaveBeenCalledTimes(1));
    expect(state.switched, "the flow's own switch, and no other").toEqual(["home"]);
    expect(offers()).toEqual([]);
  });

  it("is waited for even with nothing at stake: one switch, not two", async () => {
    const run = flow();
    let land!: () => void;
    const landing = new Promise<void>((resolve) => {
      land = resolve;
    });
    const { switchVault } = await import("./vaultService");
    const entry = whileEntering("home", async () => {
      await landing;
      await switchVault("home");
    });

    expect(await enterFlowVault("home", "connect-run", run)).toBe(false);
    expect(state.switched).toEqual([]);
    land();
    await entry;
    await vi.waitFor(() => expect(run.resume).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
  });

  it("forgets who waited when the switch does not come; the next time by is an ordinary one", async () => {
    armLeaveGuard(MESSAGE);
    const waited = flow();
    const entry = whileEntering("home", async () => {
      expect(await enterFlowVault("home", "connect-run", waited)).toBe(false);
      throw new Error("storage unavailable");
    });
    await expect(entry).rejects.toThrow("storage unavailable");
    expect(offers()).toEqual([]);

    const again = flow();
    expect(await enterFlowVault("home", "connect-run", again)).toBe(false);
    expect(offer().message).toBe("mobile.flowVaultOffer(Home)");
    open("home");
    await vi.waitFor(() => expect(again.resume).toHaveBeenCalledTimes(1));
    expect(waited.resume).not.toHaveBeenCalled();
  });

  it("leaves alone who had been offered the vault before, when the switch does not come", async () => {
    // A sign-in waits for an existing vault, its notice closed by hand; then a
    // transfer into that same vault fails on its last step.
    armLeaveGuard(MESSAGE);
    const signIn = flow();
    await enterFlowVault("home", "sign-in", signIn);
    toast.dismiss(offer().id);
    const run = flow();

    const entry = whileEntering("home", async () => {
      // Both come by while the entry is under way; only the run is new.
      expect(await enterFlowVault("home", "sign-in", signIn)).toBe(false);
      expect(await enterFlowVault("home", "connect-run", run)).toBe(false);
      throw new Error("storage unavailable");
    });
    await expect(entry).rejects.toThrow("storage unavailable");

    open("home");
    await vi.waitFor(() => expect(signIn.resume).toHaveBeenCalledTimes(1));
    expect(run.resume, "it comes by again on its own").not.toHaveBeenCalled();
  });

  it("hands on what the flow returns", async () => {
    await expect(whileEntering("home", async () => "done")).resolves.toBe("done");
  });
});
