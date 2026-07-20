import { describe, it, expect } from "vitest";
import {
  reconcileCloudAccounts,
  familyOfSyncProvider,
  familyOfMailAccount,
  identityKey,
  looksLikeNextcloud,
  parseDriveAboutIdentity,
  parseDropboxAccountIdentity,
  accountServices,
  hasCloudService,
  type CloudAccountRecord,
  type ObservedCloudState,
} from "@plainva/ui";

/** Deterministic id source so reconcile output is assertable. */
function ids() {
  let n = 0;
  return () => `acct${++n}`;
}

const empty: ObservedCloudState = { sync: undefined, pim: [], mail: [] };

describe("cloud account reconcile", () => {
  it("returns nothing for an empty world", () => {
    expect(reconcileCloudAccounts([], empty, ids())).toEqual([]);
  });

  it("re-deriving from an empty store keeps the id-less shape stable (event-storm guard basis)", () => {
    // A store that cannot persist hands reconcile an empty `stored` forever;
    // apart from the random id, the derived records must be identical so the
    // desktop-side shape guard can stop the save→event→save loop.
    const observed: ObservedCloudState = {
      sync: { provider: "webdav", identity: "marco@cloud.example.org", flavor: "nextcloud" },
      pim: [],
      mail: [],
    };
    const strip = (rs: CloudAccountRecord[]) => rs.map(({ id: _id, ...rest }) => rest);
    const a = reconcileCloudAccounts([], observed, () => "id-a");
    const b = reconcileCloudAccounts([], observed, () => "id-b");
    expect(a).toHaveLength(1);
    expect(strip(a)).toEqual(strip(b));
  });

  it("groups a Graph calendar and a Graph mailbox with the same identity into ONE Microsoft account", () => {
    const observed: ObservedCloudState = {
      sync: undefined,
      pim: [{ id: "p1", provider: "microsoft", label: "marco@outlook.com" }],
      mail: [{ id: "m1", kind: "microsoft", label: "marco@outlook.com", user: "marco@outlook.com", host: "" }],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("microsoft");
    expect(out[0].label).toBe("marco@outlook.com");
    expect(out[0].services).toEqual({ calendar: { pimAccountId: "p1" }, mail: { mailAccountId: "m1" } });
  });

  it("keeps accounts with different identities apart", () => {
    const observed: ObservedCloudState = {
      sync: undefined,
      pim: [{ id: "p1", provider: "microsoft", label: "work@outlook.com" }],
      mail: [{ id: "m1", kind: "microsoft", label: "home@outlook.com", user: "home@outlook.com", host: "" }],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(2);
  });

  it("never merges a sync slot without identity — an identity-less OneDrive stays its own card", () => {
    const observed: ObservedCloudState = {
      sync: { provider: "onedrive" },
      pim: [{ id: "p1", provider: "microsoft", label: "marco@outlook.com" }],
      mail: [],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(2);
    const files = out.find((r) => r.services.files);
    expect(files?.family).toBe("microsoft");
    expect(identityKey(files?.label)).toBeNull();
  });

  it("merges WebDAV files and a CalDAV calendar on the exact same user@host (the Nextcloud case)", () => {
    const observed: ObservedCloudState = {
      sync: { provider: "webdav", identity: "marco@cloud.beispiel.de", flavor: "nextcloud" },
      pim: [{ id: "p1", provider: "caldav", label: "marco@cloud.beispiel.de" }],
      mail: [],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("webdav");
    expect(out[0].flavor).toBe("nextcloud");
    expect(accountServices(out[0])).toEqual(["files", "calendar"]);
  });

  it("treats a Gmail app-password inbox as the google family and merges it with the calendar account", () => {
    const observed: ObservedCloudState = {
      sync: undefined,
      pim: [{ id: "p1", provider: "google", label: "marco@gmail.com" }],
      mail: [{ id: "m1", kind: "imap", label: "Gmail", user: "marco@gmail.com", host: "imap.gmail.com" }],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("google");
    expect(accountServices(out[0])).toEqual(["calendar", "mail"]);
  });

  it("keeps a foreign IMAP box its own imap-family account", () => {
    const observed: ObservedCloudState = {
      sync: undefined,
      pim: [{ id: "p1", provider: "google", label: "marco@gmail.com" }],
      mail: [{ id: "m1", kind: "imap", label: "web.de", user: "marco@web.de", host: "imap.web.de" }],
    };
    const out = reconcileCloudAccounts([], observed, ids());
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.services.mail)?.family).toBe("imap");
  });

  it("drops a stored account whose only subsystem entry vanished", () => {
    const stored: CloudAccountRecord[] = [
      { id: "a1", family: "webdav", label: "x@host.de", services: { calendar: { pimAccountId: "gone" } } },
    ];
    expect(reconcileCloudAccounts(stored, empty, ids())).toEqual([]);
  });

  it("is idempotent and keeps stored ids stable", () => {
    const observed: ObservedCloudState = {
      sync: { provider: "drive", byoClientId: "my-client" },
      pim: [{ id: "p1", provider: "google", label: "marco@gmail.com" }],
      mail: [],
    };
    const first = reconcileCloudAccounts([], observed, ids());
    const second = reconcileCloudAccounts(first, observed, ids());
    expect(second).toEqual(first);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it("rebinds files when the vault's sync provider changed", () => {
    const stored: CloudAccountRecord[] = [
      { id: "a1", family: "google", label: "", byoClientId: "cid", services: { files: { provider: "drive" } } },
    ];
    const out = reconcileCloudAccounts(stored, { sync: { provider: "onedrive" }, pim: [], mail: [] }, ids());
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("microsoft");
    expect(out[0].services.files).toEqual({ provider: "onedrive" });
  });

  it("adopts a byo client id from the subsystem entry", () => {
    const observed: ObservedCloudState = {
      sync: undefined,
      pim: [{ id: "p1", provider: "google", label: "marco@gmail.com", byoClientId: "own-id" }],
      mail: [],
    };
    expect(reconcileCloudAccounts([], observed, ids())[0].byoClientId).toBe("own-id");
  });
});

describe("cloud account helpers", () => {
  it("maps sync providers onto families", () => {
    expect(familyOfSyncProvider("drive")).toBe("google");
    expect(familyOfSyncProvider("onedrive")).toBe("microsoft");
    expect(familyOfSyncProvider("webdav")).toBe("webdav");
    expect(familyOfSyncProvider("dropbox")).toBe("dropbox");
    expect(familyOfSyncProvider("s3")).toBe("s3");
  });

  it("classifies mail accounts", () => {
    expect(familyOfMailAccount({ kind: "microsoft", user: "a@outlook.com", host: "" })).toBe("microsoft");
    expect(familyOfMailAccount({ kind: "imap", user: "a@googlemail.com", host: "imap.gmail.com" })).toBe("google");
    expect(familyOfMailAccount({ kind: "imap", user: "a@web.de", host: "imap.web.de" })).toBe("imap");
  });

  it("detects nextcloud-style webdav urls", () => {
    expect(looksLikeNextcloud("https://c.example.de/remote.php/dav/files/marco/")).toBe(true);
    expect(looksLikeNextcloud("https://dav.example.de/notes/")).toBe(false);
  });

  it("parses backfill responses defensively", () => {
    expect(parseDriveAboutIdentity({ user: { emailAddress: "m@gmail.com" } })).toBe("m@gmail.com");
    expect(parseDriveAboutIdentity({ user: {} })).toBeNull();
    expect(parseDriveAboutIdentity(null)).toBeNull();
    expect(parseDropboxAccountIdentity({ email: "m@example.com" })).toBe("m@example.com");
    expect(parseDropboxAccountIdentity({ email: "not-an-email" })).toBeNull();
  });

  it("reports service presence for gating", () => {
    const records: CloudAccountRecord[] = [
      { id: "a", family: "webdav", label: "", services: { files: { provider: "webdav" } } },
    ];
    expect(hasCloudService(records, "files")).toBe(true);
    expect(hasCloudService(records, "mail")).toBe(false);
  });
});
