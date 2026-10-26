import { describe, expect, it } from "vitest";
import { cardSignInState, createPasswordCredentialTarget, isSignedOutSlot, removeAccountCard, retiredServiceSignIn, signInActionKey, signOutAccountHere, withoutSignOutMark, type CloudServiceId } from "@plainva/ui";

/**
 * Plan "Verbinden", V0: the state of an account card is its own sign-in, and
 * "sign out on this device" removes everything this device holds to sign the
 * card in - in both shells, from one rule (`packages/ui/src/lib/accountSignOut.ts`).
 */

function memoryStore(seed: Record<string, unknown>) {
  const data = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    data,
    store: {
      read: async (key: string) => data.get(key) ?? null,
      compareAndSet: async (key: string, expected: string | null, value: string | null) => {
        if ((data.get(key) ?? null) !== expected) return false;
        if (value === null) data.delete(key);
        else data.set(key, value);
        return true;
      },
    },
  };
}

describe("cardSignInState", () => {
  it("is the card's own sign-in for Google and Microsoft, whatever the service slots say", () => {
    // TestFlight 144: a calendar without a slot of its own made a signed-in card read "anmelden".
    expect(cardSignInState({ family: "google", cardGrant: true, serviceStates: ["active", "signin"] })).toBe("active");
    // Signed out here: the emptied service slots must not keep it "signed in".
    expect(cardSignInState({ family: "microsoft", cardGrant: false, serviceStates: ["active", "active"] })).toBe("signin");
  });

  it("still reports a service that stopped working", () => {
    expect(cardSignInState({ family: "google", cardGrant: true, serviceStates: ["active", "expired"] })).toBe("expired");
  });

  it("keeps the worst of the services for a card without a sign-in of its own", () => {
    expect(cardSignInState({ family: "icloud", cardGrant: null, serviceStates: ["active", "signin"] })).toBe("signin");
    expect(cardSignInState({ family: "google", cardGrant: null, serviceStates: ["signin", "expired"] })).toBe("expired");
    expect(cardSignInState({ family: "webdav", cardGrant: null, serviceStates: [] })).toBeUndefined();
  });

  it("names the button with the plan's two words", () => {
    expect(signInActionKey("signin")).toBe("deviceSignIn.submit");
    expect(signInActionKey("expired")).toBe("cloudAccounts.reconnect");
  });
});

describe("signOutAccountHere", () => {
  it("empties the services' own sign-ins, keeps everything else, then clears the card's grant", async () => {
    const { data, store } = memoryStore({
      pim_v_cal: { kind: "google", clientId: "c", refreshToken: "left-over" },
      files_v: { provider: "drive", creds: { clientId: "c", refreshToken: "", nativeGoogle: { email: "anna@gmail.com" }, rootFolderName: "Wiki" } },
      mail_v_m: { password: "app-password" },
    });
    const calls: string[] = [];
    await signOutAccountHere({
      store,
      serviceSlots: [{ keys: ["files_v"], nested: "creds" }, { keys: ["pim_v_cal_new", "pim_v_cal"] }, { keys: ["mail_v_m"] }, { keys: ["absent"] }],
      clearCardGrant: async () => {
        calls.push("grant");
      },
    });
    expect(JSON.parse(data.get("pim_v_cal")!)).toEqual({ kind: "google", clientId: "c", refreshToken: "" });
    // Android's system sign-in is a marker, not a token: it goes too, the folder stays.
    expect(JSON.parse(data.get("files_v")!)).toEqual({ provider: "drive", creds: { clientId: "c", refreshToken: "", rootFolderName: "Wiki" } });
    // A password IS a sign-in (plan "Verbinden", V2): emptied, the field stays, and the slot is marked.
    expect(JSON.parse(data.get("mail_v_m")!)).toEqual({ password: "", signedOutHere: true });
    expect(calls).toEqual(["grant"]);
  });

  it("signs a password account out by emptying its password, keeping server and user, and marking the slot", () => {
    const webdav = retiredServiceSignIn({ provider: "webdav", creds: { url: "https://dav.example", user: "lena", pass: "secret" } }, "creds");
    expect(webdav).toEqual({ provider: "webdav", creds: { url: "https://dav.example", user: "lena", pass: "", signedOutHere: true } });
    expect(isSignedOutSlot(webdav, "creds")).toBe(true);
    const caldav = retiredServiceSignIn({ kind: "caldav", url: "https://dav.example", user: "lena", pass: "secret" });
    expect(caldav).toEqual({ kind: "caldav", url: "https://dav.example", user: "lena", pass: "", signedOutHere: true });
    expect(isSignedOutSlot(caldav)).toBe(true);
    expect(retiredServiceSignIn({ endpoint: "https://s3.example", accessKeyId: "AK", secretAccessKey: "SK" })).toEqual({ endpoint: "https://s3.example", accessKeyId: "AK", secretAccessKey: "", signedOutHere: true });
    // Dropbox's token is its own sign-in: marked; a Google service slot is the card's: not.
    expect(retiredServiceSignIn({ appKey: "k", refreshToken: "t" })).toEqual({ appKey: "k", refreshToken: "", signedOutHere: true });
    expect(retiredServiceSignIn({ provider: "dropbox", creds: { refreshToken: "t" } }, "creds")).toEqual({ provider: "dropbox", creds: { refreshToken: "", signedOutHere: true } });
    expect(retiredServiceSignIn({ kind: "google", clientId: "c", refreshToken: "t" })).toEqual({ kind: "google", clientId: "c", refreshToken: "" });
    expect(isSignedOutSlot({ url: "u", user: "lena", pass: "x" })).toBe(false);
    // An OAuth slot emptied by the one sign-in (K2) is not "signed out".
    expect(isSignedOutSlot({ kind: "google", clientId: "c", refreshToken: "" })).toBe(false);
  });

  it("an empty password without the sign-out mark is a server without a password, not a sign-out (review finding 2)", () => {
    // The phone lets a WebDAV vault be set up without a password; it must keep syncing.
    expect(isSignedOutSlot({ url: "u", user: "lena", pass: "" })).toBe(false);
    expect(isSignedOutSlot({ provider: "webdav", creds: { url: "u", user: "", pass: "" } }, "creds")).toBe(false);
    expect(isSignedOutSlot({ kind: "caldav", url: "u", user: "lena", pass: "" })).toBe(false);
    expect(isSignedOutSlot({ password: "" })).toBe(false);
  });

  it("a sign-in clears the mark: a new secret outweighs it, and the password change drops it", () => {
    expect(isSignedOutSlot({ url: "u", pass: "new", signedOutHere: true })).toBe(false);
    expect(withoutSignOutMark({ url: "u", pass: "", signedOutHere: true })).toEqual({ url: "u", pass: "" });
    expect(withoutSignOutMark({ provider: "webdav", creds: { url: "u", pass: "x", signedOutHere: true } }, "creds")).toEqual({ provider: "webdav", creds: { url: "u", pass: "x" } });
    const untouched = { url: "u", pass: "x" };
    expect(withoutSignOutMark(untouched)).toBe(untouched);
  });

  it("leaves a slot without a sign-in of its own byte for byte", () => {
    expect(retiredServiceSignIn({ kind: "google", clientId: "c", refreshToken: "" })).toBeNull();
    expect(retiredServiceSignIn({ provider: "drive", creds: { clientId: "c", refreshToken: "" } }, "creds")).toBeNull();
  });

  it("keeps the card signed in when a service slot changed under it", async () => {
    const { store } = memoryStore({ pim: { kind: "google", clientId: "c", refreshToken: "x" } });
    const racing = { ...store, compareAndSet: async () => false };
    let cleared = false;
    await expect(signOutAccountHere({ store: racing, serviceSlots: [{ keys: ["pim"] }], clearCardGrant: async () => { cleared = true; } })).rejects.toThrow();
    expect(cleared).toBe(false);
  });
});

describe("removeAccountCard", () => {
  it("turns every service off, then the grant, then the card", async () => {
    const calls: string[] = [];
    await removeAccountCard({
      services: ["mail", "files"] as CloudServiceId[],
      disable: async (service) => { calls.push(service); },
      clearCardGrant: async () => { calls.push("grant"); throw new Error("no grant"); },
      dropRecord: async () => { calls.push("record"); },
    });
    expect(calls).toEqual(["files", "mail", "grant", "record"]);
  });
});

describe("signing in again through the password entry (review finding 2)", () => {
  it("writes the new password without the sign-out mark", () => {
    const target = createPasswordCredentialTarget<{ provider: string; creds: Record<string, unknown> }, { provider: string }>({
      service: "files",
      key: "files_v",
      store: memoryStore({}).store,
      read: async () => null,
      readBinding: async () => ({ provider: "webdav" }),
      withPassword: (value, pass) => ({ ...value, creds: { ...value.creds, pass } }),
      verify: async () => undefined,
    });
    const previous = JSON.stringify({ credential: { provider: "webdav", creds: { url: "u", user: "lena", pass: "", signedOutHere: true } }, binding: { provider: "webdav" } });
    expect(JSON.parse(target.withPassword(previous, "new")).credential).toEqual({ provider: "webdav", creds: { url: "u", user: "lena", pass: "new" } });
  });
});
