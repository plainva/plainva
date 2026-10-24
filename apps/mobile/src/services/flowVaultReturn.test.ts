// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, toastStore, type ToastAction, type ToastItem } from "@plainva/ui";
import { APP_URL } from "./appScheme";
import { resetFlowVaultForTest } from "./flowVault";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";
import { beginOAuth, cancelConnect, finishConnect, getPendingConnect, handleOAuthRedirect } from "./oauthService";
import { beginPimOAuth, handlePimOAuthRedirect, resumePimOAuthResult } from "./pim/pimOAuth";

/**
 * A sign-in that comes back into another vault (finding 2026-10-12).
 *
 * A consent carries the vault it was begun in and finishes there. By the time
 * the browser returns, another vault can be on screen — and both returns went
 * back by themselves: the calendar and mail sign-in the moment the redirect
 * arrived, the file connection when its folder was picked. `switchVault` drops
 * every stack and only the screen on top is rendered, so a message being
 * written in the vault on screen went with it, and nothing asked.
 *
 * The flows are the real ones, from the consent URL to the stored grant; what
 * is replaced is the platform underneath (secure storage, the browser, the
 * token endpoints) and the vault switch itself, which is recorded.
 */

const state = vi.hoisted(() => ({
  active: "",
  names: {} as Record<string, string>,
  secrets: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
  urls: [] as string[],
  switched: [] as string[],
  /** Vaults deleted from the registry. */
  gone: new Set<string>(),
  /** A secure-storage key whose next write fails. */
  failWrite: "",
  /** An Android phone with Play services: a Google sign-in goes through the system dialog. */
  playServices: false,
}));
const calls = vi.hoisted(() => ({
  switchVault: vi.fn(),
  connectProvider: vi.fn(),
  addPimAccount: vi.fn(),
  startPim: vi.fn(),
  authorizeNativeGoogle: vi.fn(),
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: async ({ url }: { url: string }) => { state.urls.push(url); }, close: async () => {} },
}));
vi.mock("./googleNativeAuthorization", () => ({
  authorizeNativeGoogle: calls.authorizeNativeGoogle,
  hasGooglePlayServices: () => state.playServices,
  googleSignInFlow: () => (state.playServices ? "native" : "browser"),
}));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  generatePkcePair: async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  exchangeDropboxCode: async () => ({ accessToken: "access", refreshToken: "refresh" }),
  exchangeOneDriveCode: async () => ({ accessToken: "access", refreshToken: "refresh", scope: "Calendars.ReadWrite" }),
}));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({
    credentials: {
      readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
      writeSecret: async (key: string, value: unknown) => {
        if (state.failWrite === key) {
          state.failWrite = "";
          throw new Error("storage unavailable");
        }
        state.secrets.set(key, structuredClone(value));
      },
      removeSecret: async (key: string) => { state.secrets.delete(key); },
    },
    loadSettings: async () => ({
      get: async (key: string) => structuredClone(state.settings.get(key)),
      set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
      delete: async (key: string) => { state.settings.delete(key); },
      save: async () => {},
    }),
  }),
}));
// The texts as their keys, a name in brackets behind it: what is said, not how.
vi.mock("@plainva/ui/i18n", () => ({
  default: { t: (key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key) },
}));
vi.mock("./syncService", () => ({
  connectProvider: calls.connectProvider,
  createProviderVault: vi.fn(),
  createProviderFolder: vi.fn(),
  listProviderFolders: vi.fn(async () => []),
  getStoredProvider: vi.fn(async () => null),
  reauthorizeVault: vi.fn(),
}));
vi.mock("./accountLogin", () => ({ beginAccountLogin: vi.fn() }));
vi.mock("./accountBroker", () => ({ fileGrantProbe: vi.fn(), getAccountToken: vi.fn(async () => null), tokenCoversService: () => false }));
vi.mock("./cloudAccountsStore", () => ({ loadCloudAccounts: async () => [] }));
vi.mock("./vaultRegistry", () => ({
  getActiveVaultEntry: async () => ({ id: state.active, name: state.names[state.active] ?? "" }),
  getVaultEntry: async (id: string) => (state.gone.has(id) ? null : { id, name: state.names[id] ?? "" }),
}));
vi.mock("./vaultService", () => ({
  switchVault: calls.switchVault,
  getMobileVault: async () => ({ vaultId: state.active }),
}));
vi.mock("./pim/pimService", () => ({ addPimAccount: calls.addPimAccount, reauthorizePimAccount: vi.fn(), startPim: calls.startPim }));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: async () => null }));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The composer's guard, as `useLeaveGuard` arms it for a changed message. */
const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
const RECEIVED = "pim_oauth_received";

type Offer = ToastItem & { action: ToastAction };
/** The notices that carry a button. */
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
/** Answers the leave question the way the dialog host does: the promise first, then off the screen. */
const answer = (discard: boolean) => {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") throw new Error("no question");
  expect(dialog.message).toBe(MESSAGE.message);
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
};
const lastUrl = () => new URL(state.urls[state.urls.length - 1]);
const errors = () => toastStore.get().filter((item) => item.kind === "error").map((item) => item.message);

beforeEach(() => {
  state.secrets.clear();
  state.settings.clear();
  state.urls.length = 0;
  state.switched.length = 0;
  state.gone.clear();
  state.failWrite = "";
  state.playServices = false;
  state.names = { home: "Home", work: "Work" };
  for (const call of Object.values(calls)) call.mockReset();
  // The switch as the shell sees it: the registry names the vault, the event follows.
  calls.switchVault.mockImplementation(async (id: string) => {
    state.switched.push(id);
    state.active = id;
    window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
  });
  calls.addPimAccount.mockResolvedValue("pim-1");
  calls.authorizeNativeGoogle.mockResolvedValue({
    accessToken: "native-access",
    scope: "https://www.googleapis.com/auth/calendar",
    profile: { identity: { issuer: "google", subject: "subject" }, label: "person@example.test" },
  });
  resetLeaveGuard();
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  cancelConnect();
  resetFlowVaultForTest();
  toast.clearAll();
  resetLeaveGuard();
});

/** The vault is opened some other way: the registry names it, the event follows. */
const openVault = (id: string) => {
  state.active = id;
  window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
};

describe("a calendar sign-in that comes back while another vault is on screen", () => {
  /** A Microsoft calendar is connected in "home"; returns the redirect the browser comes back with. */
  const signInAtHome = async () => {
    state.active = "home";
    await beginPimOAuth("microsoft", { clientId: "", label: "Work calendar", serviceContext: { vaultId: "home" } });
    return `${APP_URL}oauth?code=code&state=${lastUrl().searchParams.get("state")}`;
  };
  /** "work" is on screen by the time the browser is done, with a message being written in it. */
  const returnOverAMessage = async () => {
    const redirect = await signInAtHome();
    state.active = "work";
    armLeaveGuard(MESSAGE);
    expect(await handlePimOAuthRedirect(redirect)).toBe(true);
  };

  it("does not take the vault from under a message being written: it offers the way, and its button asks first", async () => {
    await returnOverAMessage();

    // THE DEFECT: the return switched vaults by itself, and the message went with the stacks.
    expect(state.switched, "the vault was taken from under the message").toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
    expect(calls.addPimAccount, "nothing is stored in the vault on screen").not.toHaveBeenCalled();
    expect(state.secrets.has(RECEIVED), "the grant is kept until its vault is open").toBe(true);
    expect(errors()).toEqual([]);

    // The way on is offered: a notice that names the vault the sign-in belongs to.
    const offered = offer();
    expect(offered.message).toBe("mobile.flowVaultOffer(Home)");
    expect(offered.action.label).toBe("sidebar.switchVault");
    expect(offered.persistent, "it waits for the person, not for a timer").toBe(true);

    // Its button asks the composer's own question. "Cancel": nothing moved, and the offer stands again.
    press(offered);
    await settle();
    answer(false);
    await settle();
    expect(state.switched).toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
    expect(state.secrets.has(RECEIVED)).toBe(true);

    // "Discard": the vault is switched, and the sign-in is finished where it belongs.
    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
    expect(calls.addPimAccount.mock.calls[0][0]).toBe("microsoft");
    expect(calls.addPimAccount.mock.calls[0][1]).toBe("Work calendar");
    expect(calls.addPimAccount.mock.calls[0][3]).toEqual({ vaultId: "home" });
    // The calendar runtime of that vault is up before the account is added to it.
    expect(calls.startPim.mock.invocationCallOrder[0]).toBeLessThan(calls.addPimAccount.mock.invocationCallOrder[0]);
    await vi.waitFor(() => expect(state.secrets.has(RECEIVED)).toBe(false));
    expect(offers()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it("is finished as soon as its vault is opened another way", async () => {
    await returnOverAMessage();
    expect(state.switched).toEqual([]);
    offer();

    // The message is sent, and "home" is picked from the vault list.
    resetLeaveGuard();
    openVault("home");

    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
    expect(offers(), "the notice goes with its reason").toEqual([]);
    expect(state.switched, "nobody switched a second time").toEqual([]);
  });

  it("is still taken when the message took longer than a replay may: it waited for the person, not for us", async () => {
    await returnOverAMessage();
    expect(state.switched).toEqual([]);

    // A quarter of an hour of writing later. A replay after a restart would drop a grant this old.
    const kept = state.secrets.get(RECEIVED) as { flow: { createdAt: number } };
    state.secrets.set(RECEIVED, { ...kept, flow: { ...kept.flow, createdAt: Date.now() - 15 * 60 * 1000 } });

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
    await vi.waitFor(() => expect(state.secrets.has(RECEIVED)).toBe(false));
  });

  it("is kept through a replay while it waits at its offer, however old", async () => {
    await returnOverAMessage();
    const notice = offer();
    const kept = state.secrets.get(RECEIVED) as { flow: { createdAt: number } };
    state.secrets.set(RECEIVED, { ...kept, flow: { ...kept.flow, createdAt: Date.now() - 15 * 60 * 1000 } });

    // "Retry" on a run's banner, or a Play-services sign-in, replays what is stored.
    await resumePimOAuthResult();

    expect(state.secrets.has(RECEIVED), "it waits for the person, not for us").toBe(true);
    expect(offers().map((item) => item.id)).toEqual([notice.id]);
    expect(state.switched).toEqual([]);
    resetLeaveGuard();
    openVault("home");
    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
  });

  it("runs out on the replay after a restart, when nothing holds it back any more", async () => {
    await returnOverAMessage();
    offer();
    const kept = state.secrets.get(RECEIVED) as { flow: { createdAt: number } };
    state.secrets.set(RECEIVED, { ...kept, flow: { ...kept.flow, createdAt: Date.now() - 15 * 60 * 1000 } });

    // The app ends: what was offered was this session's, the grant is in storage.
    resetFlowVaultForTest();
    toast.clearAll();
    await resumePimOAuthResult();

    expect(state.secrets.has(RECEIVED)).toBe(false);
    expect(offers()).toEqual([]);
    expect(state.switched).toEqual([]);
    openVault("home");
    await settle();
    expect(calls.addPimAccount).not.toHaveBeenCalled();
  });

  it("keeps waiting, notice and all, when a later sign-in cannot be stored", async () => {
    await returnOverAMessage();
    const notice = offer();
    const waiting = structuredClone(state.secrets.get(RECEIVED));

    await beginPimOAuth("microsoft", { clientId: "", label: "Second calendar", serviceContext: { vaultId: "work" } });
    state.failWrite = RECEIVED;
    expect(await handlePimOAuthRedirect(`${APP_URL}oauth?code=code&state=${lastUrl().searchParams.get("state")}`)).toBe(true);

    expect(errors(), "the failed sign-in says so").toHaveLength(1);
    expect(state.secrets.get(RECEIVED), "the first grant is still the one stored").toEqual(waiting);
    expect(offers().map((item) => item.id), "and its notice still offers its vault").toEqual([notice.id]);
    resetLeaveGuard();
    openVault("home");
    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
    expect(calls.addPimAccount.mock.calls[0][1]).toBe("Work calendar");
  });

  it("is over when its vault is deleted: the grant goes, and so does the notice", async () => {
    await returnOverAMessage();
    offer();

    state.gone.add("home");
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));

    await vi.waitFor(() => expect(state.secrets.has(RECEIVED)).toBe(false));
    expect(offers()).toEqual([]);
    expect(state.switched).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it("is over when its vault was deleted while the browser was open, and switches nowhere", async () => {
    const redirect = await signInAtHome();
    state.active = "work";
    state.gone.add("home");

    expect(await handlePimOAuthRedirect(redirect)).toBe(true);

    expect(state.switched, "a switch into a deleted vault stops the sync on screen before it fails").toEqual([]);
    expect(state.secrets.has(RECEIVED)).toBe(false);
    expect(calls.addPimAccount).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it("gives way to a sign-in through Play services as it does to one through the browser", async () => {
    await returnOverAMessage();
    offer();

    // A Google calendar is connected in "work" through the system dialog.
    state.playServices = true;
    await beginPimOAuth("google", { clientId: "", label: "Google calendar", serviceContext: { vaultId: "work" } });

    expect(errors(), "not refused because another sign-in waits at its offer").toEqual([]);
    expect(calls.authorizeNativeGoogle).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(calls.addPimAccount).toHaveBeenCalledTimes(1));
    expect(calls.addPimAccount.mock.calls[0][0]).toBe("google");
    expect(offers(), "the first one's grant was written over; nothing waits for \"home\" any more").toEqual([]);
    expect(state.switched).toEqual([]);
  });

  it("gives way to a sign-in that comes after it: one grant waits at a time, and so does one notice", async () => {
    await returnOverAMessage();
    offer();

    // A second calendar is connected in "work" itself, where the message is.
    await beginPimOAuth("microsoft", { clientId: "", label: "Second calendar", serviceContext: { vaultId: "work" } });
    expect(await handlePimOAuthRedirect(`${APP_URL}oauth?code=code&state=${lastUrl().searchParams.get("state")}`)).toBe(true);

    expect(calls.addPimAccount).toHaveBeenCalledTimes(1);
    expect(calls.addPimAccount.mock.calls[0][1]).toBe("Second calendar");
    expect(offers(), "the first one's grant was written over; nothing waits for \"home\" any more").toEqual([]);
    expect(state.switched).toEqual([]);
    openVault("home");
    await settle();
    expect(calls.addPimAccount).toHaveBeenCalledTimes(1);
  });

  it("goes back to its vault by itself, as before, when nothing is at stake", async () => {
    const redirect = await signInAtHome();
    state.active = "work";

    expect(await handlePimOAuthRedirect(redirect)).toBe(true);

    expect(state.switched).toEqual(["home"]);
    expect(calls.addPimAccount).toHaveBeenCalledTimes(1);
    expect(state.secrets.has(RECEIVED)).toBe(false);
    expect(offers()).toEqual([]);
    expect(currentMobileDialog()).toBeNull();
  });
});

describe("the folder pick of a file connection begun in another vault", () => {
  /** A Dropbox connection is begun in "home" and its consent returns: the folder is still to be picked. */
  const consentAtHome = async () => {
    state.active = "home";
    await beginOAuth("dropbox", { serviceContext: { vaultId: "home" } });
    expect(await handleOAuthRedirect(`${APP_URL}oauth?code=code&state=${lastUrl().searchParams.get("state")}`)).toBe(true);
    expect(getPendingConnect()).toMatchObject({ provider: "dropbox" });
  };

  it("does not take the vault from under a message being written: it offers the way, and its button asks first", async () => {
    await consentAtHome();
    state.active = "work";
    armLeaveGuard(MESSAGE);

    await finishConnect("Notes");

    // THE DEFECT: picking the folder switched vaults by itself, and the message went with the stacks.
    expect(state.switched, "the vault was taken from under the message").toEqual([]);
    expect(activeLeaveGuard()).toEqual(MESSAGE);
    expect(calls.connectProvider).not.toHaveBeenCalled();
    expect(getPendingConnect(), "the connection waits, with its sign-in").not.toBeNull();
    const offered = offer();
    expect(offered.message).toBe("mobile.flowVaultOffer(Home)");

    press(offered);
    await settle();
    answer(false);
    await settle();
    expect(state.switched).toEqual([]);
    expect(calls.connectProvider).not.toHaveBeenCalled();

    press(offer());
    await settle();
    answer(true);
    await vi.waitFor(() => expect(calls.connectProvider).toHaveBeenCalledTimes(1));
    expect(state.switched).toEqual(["home"]);
    // The folder that was picked is the folder that is connected, in the vault the sign-in began in.
    expect(calls.connectProvider.mock.calls[0][0]).toEqual({ vaultId: "home" });
    expect(calls.connectProvider.mock.calls[0][1]).toMatchObject({ provider: "dropbox", creds: { refreshToken: "refresh", rootPath: "Notes" } });
    expect(calls.connectProvider.mock.calls[0][2]).toEqual({ vaultId: "home" });
    await vi.waitFor(() => expect(getPendingConnect()).toBeNull());
    expect(offers()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it("takes its notice down when the connection is given up", async () => {
    await consentAtHome();
    state.active = "work";
    armLeaveGuard(MESSAGE);
    await finishConnect("Notes");
    expect(state.switched).toEqual([]);
    offer();

    cancelConnect();

    expect(offers(), "a notice for a connection that is over").toEqual([]);
    resetLeaveGuard();
    openVault("home");
    await settle();
    expect(calls.connectProvider).not.toHaveBeenCalled();
  });

  it("does not use the folder for a sign-in that came after the one it was picked for", async () => {
    await consentAtHome();
    state.active = "work";
    armLeaveGuard(MESSAGE);
    await finishConnect("Notes");
    expect(state.switched).toEqual([]);
    offer();

    // A second consent for "home" returns before the first was finished: its folder is still to be picked.
    const first = getPendingConnect();
    await beginOAuth("dropbox", { serviceContext: { vaultId: "home" } });
    expect(await handleOAuthRedirect(`${APP_URL}oauth?code=code&state=${lastUrl().searchParams.get("state")}`)).toBe(true);
    expect(getPendingConnect()).not.toBe(first);
    expect(offers(), "the first connection's notice went with it").toEqual([]);

    resetLeaveGuard();
    openVault("home");
    await settle();
    await settle();

    expect(calls.connectProvider, "\"Notes\" was picked for the first sign-in").not.toHaveBeenCalled();
    expect(getPendingConnect(), "the second waits for its own pick").not.toBeNull();
  });

  it("is given up when its vault is deleted: the sign-in and the picked folder go with the notice", async () => {
    await consentAtHome();
    state.active = "work";
    armLeaveGuard(MESSAGE);
    await finishConnect("Notes");
    offer();

    state.gone.add("home");
    window.dispatchEvent(new CustomEvent("m-vaults-changed"));

    await vi.waitFor(() => expect(getPendingConnect()).toBeNull());
    expect(offers()).toEqual([]);
    expect(calls.connectProvider).not.toHaveBeenCalled();
    expect(state.switched).toEqual([]);
  });

  it("asks nobody in its own vault: the connect form's typed credentials are what is being connected", async () => {
    await consentAtHome();
    // Still in "home", on the form the sign-in was started from; its own guard is armed.
    armLeaveGuard({ id: "vault-connect", message: "The credentials you entered will be lost." });

    await finishConnect("Notes");

    expect(calls.connectProvider).toHaveBeenCalledTimes(1);
    expect(currentMobileDialog()).toBeNull();
    expect(offers()).toEqual([]);
    expect(state.switched).toEqual([]);
  });
});
