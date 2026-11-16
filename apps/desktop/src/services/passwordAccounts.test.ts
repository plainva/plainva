import { describe, expect, it } from "vitest";
import { canonicalSecretId, type PimAccountRow } from "@plainva/core";
import {
  accountToAdoptInto,
  emptyAccountMap,
  importAccountMetadata,
  passwordAccountIdentity,
  pimAccountsForProfile,
  planEmptyPasswordDuplicates,
  reconcileCloudAccounts,
  removeEmptyPasswordDuplicates,
  reviewDuplicatePimRows,
  samePasswordAccount,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ObservedCloudState,
  type ProfileAccountMap,
} from "@plainva/ui";

/**
 * GitHub #174 (Fehlerliste C13, C14): one Nextcloud became several account
 * cards. Two ways were shown: a further connect added a calendar row beside
 * the first (an access with a password was never matched), and a second
 * device that spelled the address differently got a row of its own without a
 * sign-in. Decided 2026-11-16: server and user, normalized, are the account.
 */

const BASE = "https://cloud.example.com/remote.php/dav";

/** The table of cases the normalization is held to: [a, b, same account?]. */
const CASES: Array<[string, string, string, string, boolean, string]> = [
  [BASE, "anna", BASE, "anna", true, "the same address"],
  [BASE, "anna", `${BASE}/`, "anna", true, "a slash at the end"],
  [BASE, "anna", `${BASE}///`, "anna", true, "several slashes at the end"],
  [BASE, "anna", "HTTPS://CLOUD.EXAMPLE.COM/remote.php/dav", "anna", true, "scheme and host in capitals"],
  [BASE, "anna", BASE, "Anna", false, "the user in capitals (Radicale, Baïkal and DAViCal tell them apart)"],
  [BASE, "anna", BASE, "  anna ", true, "spaces around the user"],
  [BASE, "anna", "https://cloud.example.com:443/remote.php/dav", "anna", true, "port 443 written out"],
  ["http://cloud.example.com/remote.php/dav", "anna", "http://cloud.example.com:80/remote.php/dav", "anna", true, "port 80 written out for http"],
  [BASE, "anna", "https://cloud.example.com/remote.php/dav/calendars/anna/", "anna", true, "the calendar home"],
  [BASE, "anna", "https://cloud.example.com/remote.php/dav/files/anna/Vault/", "anna", true, "the files endpoint of a folder"],
  [BASE, "anna", "https://cloud.example.com/remote.php/caldav", "anna", true, "the old caldav endpoint"],
  [BASE, "anna", "https://cloud.example.com/remote.php/webdav/", "anna", true, "the old webdav endpoint"],
  [BASE, "anna", "https://cloud.example.com/Remote.PHP/DAV", "anna", true, "the endpoint in capitals"],
  [BASE, "anna", "https://cloud.example.com", "anna", true, "the bare server"],
  ["https://cloud.example.com/nextcloud/remote.php/dav", "anna", "https://cloud.example.com/nextcloud/", "anna", true, "a subpath, with and without the endpoint"],
  [BASE, "anna", "http://cloud.example.com/remote.php/dav", "anna", false, "http against https"],
  [BASE, "anna", "https://cloud.example.com:8443/remote.php/dav", "anna", false, "another port"],
  [BASE, "anna", "https://cloud.example.com/nextcloud/remote.php/dav", "anna", false, "a subpath against the root"],
  ["https://cloud.example.com/nextcloud/remote.php/dav", "anna", "https://cloud.example.com/Nextcloud/remote.php/dav", "anna", false, "a subpath in another case"],
  [BASE, "anna", "https://files.example.com/remote.php/dav", "anna", false, "another host"],
  [BASE, "anna", BASE, "bert", false, "another user"],
  ["https://dav.example.com/cal/anna/", "anna", "https://dav.example.com/cal/anna", "anna", true, "a plain CalDAV server, slash at the end"],
];

describe("passwordAccountIdentity", () => {
  for (const [urlA, userA, urlB, userB, same, name] of CASES) {
    it(`${same ? "joins" : "keeps apart"}: ${name}`, () => {
      const a = passwordAccountIdentity(urlA, userA);
      const b = passwordAccountIdentity(urlB, userB);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a === b).toBe(same);
    });
  }

  it("has no identity for an address it cannot read", () => {
    for (const url of ["cloud.example.com", "ftp://cloud.example.com", "https://anna:pw@cloud.example.com", "https://cloud.example.com/?x=1", "", "not a url"]) {
      expect(passwordAccountIdentity(url, "anna")).toBeNull();
    }
    expect(passwordAccountIdentity(BASE, "  ")).toBeNull();
    expect(passwordAccountIdentity(undefined, "anna")).toBeNull();
  });
});

describe("the principal the server confirmed", () => {
  const P = "https://cloud.example.com/remote.php/dav/principals/users/anna/";
  it("decides when both accesses carry one, whatever the user typed", () => {
    expect(samePasswordAccount({ url: BASE, user: "Anna", principal: P }, { url: BASE, user: "anna", principal: `${P}` })).toBe(true);
    expect(samePasswordAccount({ url: BASE, user: "anna", principal: P }, { url: BASE, user: "anna", principal: "https://cloud.example.com/remote.php/dav/principals/users/anna2/" })).toBe(false);
  });
  it("normalizes only scheme, host, default port and the slash at the end", () => {
    expect(samePasswordAccount({ url: BASE, user: "a", principal: P }, { url: BASE, user: "b", principal: "HTTPS://Cloud.Example.com:443/remote.php/dav/principals/users/anna" })).toBe(true);
    expect(samePasswordAccount({ url: BASE, user: "a", principal: P }, { url: BASE, user: "b", principal: P.replace("anna", "Anna") })).toBe(false);
    expect(samePasswordAccount({ url: BASE, user: "a", principal: P }, { url: BASE, user: "b", principal: P.replace("https:", "http:") })).toBe(false);
  });
  it("falls back to the address and the exact user when one side has none", () => {
    expect(samePasswordAccount({ url: BASE, user: "anna", principal: P }, { url: `${BASE}/`, user: "anna" })).toBe(true);
    expect(samePasswordAccount({ url: BASE, user: "Anna", principal: P }, { url: BASE, user: "anna" })).toBe(false);
    expect(samePasswordAccount({ url: BASE, user: "anna", principal: "not a url" }, { url: BASE, user: "anna", principal: P })).toBe(true);
  });
});

/**
 * The settings sync names a password by `canonicalSecretId`, a rule of its own.
 * Where the two differ is pinned here: the identity may keep apart what the
 * secret name joins only in the user's case (renaming those secrets would
 * retire their old names, and a device still on 0.8.7 applies a retirement by
 * deleting a working password); every other pair the secret name joins, the
 * identity joins too.
 */
describe("the identity and the settings sync's name for a password", () => {
  const secretName = (url: string, user: string) => canonicalSecretId({ service: "calendar", secretType: "caldav-password", user, endpoint: url });
  it("disagree only on the user's case where the secret name joins", () => {
    const joinedOnlyBySecret = CASES
      .filter(([urlA, userA, urlB, userB]) => secretName(urlA, userA) === secretName(urlB, userB))
      .filter(([urlA, userA, urlB, userB]) => passwordAccountIdentity(urlA, userA) !== passwordAccountIdentity(urlB, userB))
      .map(([, , , , , name]) => name);
    expect(joinedOnlyBySecret).toEqual(["the user in capitals (Radicale, Baïkal and DAViCal tell them apart)"]);
  });
  it("never join two servers the identity keeps apart", () => {
    for (const [urlA, userA, urlB, userB, same] of CASES) {
      if (same || userA.trim().toLowerCase() === userB.trim().toLowerCase() && urlA === urlB) continue;
      expect(secretName(urlA, userA) === secretName(urlB, userB)).toBe(false);
    }
  });
});

const caldav = (id: string, url = BASE, user = "anna"): PimAccountRow => ({
  id, provider: "caldav", label: `${user}@cloud.example.com`, config: { url, user }, enabled: true,
});

describe("a further connect of the same Nextcloud", () => {
  it("is adopted into the row that is already here (red before: always null)", () => {
    const rows = [caldav("p1")];
    expect(accountToAdoptInto(rows, { id: "p2", provider: "caldav", identity: null, config: { url: `${BASE}/`, user: " anna " } })?.id).toBe("p1");
  });

  it("prefers the row a card already binds for this connect", () => {
    const rows = [caldav("p1"), caldav("p3")];
    expect(accountToAdoptInto(rows, { id: "p9", provider: "caldav", identity: null, config: { url: BASE, user: "anna" } }, "p3")?.id).toBe("p3");
    expect(accountToAdoptInto(rows, { id: "p9", provider: "caldav", identity: null, config: { url: BASE, user: "anna" } })?.id).toBe("p1");
  });

  it("is not adopted into another user's, another scheme's or another subpath's row", () => {
    const rows = [caldav("p1")];
    for (const config of [{ url: BASE, user: "bert" }, { url: "http://cloud.example.com/remote.php/dav", user: "anna" }, { url: "https://cloud.example.com/nextcloud/remote.php/dav", user: "anna" }]) {
      expect(accountToAdoptInto(rows, { id: "p2", provider: "caldav", identity: null, config })).toBeNull();
    }
    expect(accountToAdoptInto(rows, { id: "p2", provider: "caldav", identity: null })).toBeNull();
  });
});

/** Two devices of one person, each with its rows, cards and account map. */
function device(pim: PimAccountRow[], cards: CloudAccountRecord[]) {
  let n = 0;
  const state = { pim: [...pim], cards: [...cards], map: emptyAccountMap() as ProfileAccountMap };
  const ports: AccountImportPorts = {
    listPimAccounts: async () => state.pim,
    upsertPimAccount: async (row) => { state.pim = [...state.pim.filter((p) => p.id !== row.id), row]; },
    deletePimAccount: async (id) => { state.pim = state.pim.filter((p) => p.id !== id); },
    listCalendars: async () => [], setCalendarSelected: async () => undefined,
    listTaskLists: async () => [], setTaskListSelected: async () => undefined,
    listMailAccounts: async () => [], replaceMailAccounts: async () => undefined,
    listCloudAccounts: async () => state.cards,
    replaceCloudAccounts: async (r) => { state.cards = [...r]; },
    pimSecretSlot: (id) => `pim:${id}`, mailSecretSlot: (id) => `mail:${id}`,
    loadAccountMap: async () => state.map, saveAccountMap: async (m) => { state.map = m; },
    newId: () => `new-${++n}`,
  };
  const publish = () => ({ pimAccounts: pimAccountsForProfile(state.pim, state.map), cloudAccounts: state.cards });
  return { state, ports, publish };
}
const nextcloudCard = (id: string, pimId: string): CloudAccountRecord => ({
  id, family: "webdav", flavor: "nextcloud", label: "anna@cloud.example.com", services: { files: { provider: "webdav" }, calendar: { pimAccountId: pimId } },
});

describe("the settings of a second device", () => {
  const joined = [
    ["port 443 written out", "https://cloud.example.com:443/remote.php/dav"],
    ["the calendar home", "https://cloud.example.com/remote.php/dav/calendars/anna/"],
    ["the endpoint in capitals", "https://CLOUD.example.com/remote.php/DAV/"],
  ] as const;
  for (const [name, urlB] of joined) {
    it(`find the row that is here: ${name} (red before: a second row without a sign-in)`, async () => {
      const a = device([caldav("pA")], [nextcloudCard("cA", "pA")]);
      const b = device([caldav("pB", urlB)], [nextcloudCard("cB", "pB")]);
      await importAccountMetadata(b.publish(), a.ports);
      expect(a.state.pim.map((row) => row.id)).toEqual(["pA"]);
    });
  }

  it("keep this device's spelling of the address, so the two never write each other's back", async () => {
    const a = device([caldav("pA")], [nextcloudCard("cA", "pA")]);
    const b = device([caldav("pB", "https://cloud.example.com:443/remote.php/dav/")], [nextcloudCard("cB", "pB")]);
    await importAccountMetadata(b.publish(), a.ports);
    expect(a.state.pim[0].config).toMatchObject({ url: BASE, user: "anna" });
    await importAccountMetadata(a.publish(), b.ports);
    expect(b.state.pim.map((row) => row.config.url)).toEqual(["https://cloud.example.com:443/remote.php/dav/"]);
  });

  const apart = [
    ["http against https", "http://cloud.example.com/remote.php/dav"],
    ["a subpath", "https://cloud.example.com/nextcloud/remote.php/dav"],
  ] as const;
  for (const [name, urlB] of apart) {
    it(`keep a row of its own when the address may be another server: ${name}`, async () => {
      const a = device([caldav("pA")], [nextcloudCard("cA", "pA")]);
      const b = device([caldav("pB", urlB)], [nextcloudCard("cB", "pB")]);
      await importAccountMetadata(b.publish(), a.ports);
      expect(a.state.pim).toHaveLength(2);
    });
  }
});

const observed = (pims: PimAccountRow[], syncIdentity?: string): ObservedCloudState => ({
  sync: { provider: "webdav", identity: "anna@cloud.example.com", flavor: "nextcloud", ...(syncIdentity ? { passwordIdentity: syncIdentity } : {}) },
  pim: pims.map((p) => ({
    id: p.id, provider: "caldav" as const, label: p.label,
    ...(passwordAccountIdentity(p.config.url, p.config.user) ? { passwordIdentity: passwordAccountIdentity(p.config.url, p.config.user)! } : {}),
  })),
  mail: [],
});

describe("the cards of one password access", () => {
  const filesIdentity = passwordAccountIdentity("https://cloud.example.com/remote.php/dav/files/anna/", "anna")!;

  it("show the calendar of the Nextcloud on the card of its files (red before: two cards)", () => {
    const files: CloudAccountRecord = { id: "c1", family: "webdav", flavor: "nextcloud", label: "anna@cloud.example.com", services: { files: { provider: "webdav" } } };
    const shown = reconcileCloudAccounts([files], observed([caldav("p1")], filesIdentity), () => "new");
    expect(shown).toHaveLength(1);
    expect(shown[0].services).toEqual({ files: { provider: "webdav" }, calendar: { pimAccountId: "p1" } });
  });

  it("show the files on the card of the calendar", () => {
    const calendar: CloudAccountRecord = { id: "c1", family: "webdav", label: "anna@cloud.example.com", services: { calendar: { pimAccountId: "p1" } } };
    const shown = reconcileCloudAccounts([calendar], observed([caldav("p1")], filesIdentity), () => "new");
    expect(shown).toHaveLength(1);
    expect(shown[0].services.files).toEqual({ provider: "webdav" });
  });

  it("keep a calendar of another server on a card of its own", () => {
    const files: CloudAccountRecord = { id: "c1", family: "webdav", label: "anna@cloud.example.com", services: { files: { provider: "webdav" } } };
    const shown = reconcileCloudAccounts([files], observed([caldav("p1", "http://cloud.example.com/remote.php/dav")], filesIdentity), () => "new");
    expect(shown).toHaveLength(2);
  });

  it("keep a second row of the same account on a card of its own (the guided repair decides)", () => {
    const card = nextcloudCard("c1", "p1");
    const shown = reconcileCloudAccounts([card], observed([caldav("p1"), caldav("p2")], filesIdentity), () => "new");
    expect(shown).toHaveLength(2);
    expect(shown[0].services.calendar).toEqual({ pimAccountId: "p1" });
  });
});

describe("empty duplicates", () => {
  const facts = (withSignIn: string[], withData: string[] = []) => (id: string) => ({
    hasCredentials: withSignIn.includes(id), hasCachedData: withData.includes(id),
  });
  const calendarCard = (id: string, pimId: string): CloudAccountRecord => ({ id, family: "webdav", label: "", services: { calendar: { pimAccountId: pimId } } });

  it("go when another row of the same access stays", () => {
    const rows = [caldav("pA"), caldav("pB", "https://cloud.example.com:443/remote.php/dav/")];
    expect(planEmptyPasswordDuplicates(rows, [nextcloudCard("cA", "pA"), calendarCard("cB", "pB")], facts(["pA"]))).toEqual(["pB"]);
  });

  it("stay when they have a sign-in, fetched something, or a card with another service binds them", () => {
    const rows = [caldav("pA"), caldav("pB")];
    expect(planEmptyPasswordDuplicates(rows, [], facts(["pA", "pB"]))).toEqual([]);
    expect(planEmptyPasswordDuplicates(rows, [], facts(["pA"], ["pB"]))).toEqual([]);
    expect(planEmptyPasswordDuplicates(rows, [nextcloudCard("cB", "pB")], facts(["pA"]))).toEqual([]);
  });

  it("leave one when every row of the access is empty, the one with the fullest card", () => {
    const rows = [caldav("pA"), caldav("pB"), caldav("pC")];
    expect(planEmptyPasswordDuplicates(rows, [calendarCard("c1", "pA"), { ...calendarCard("c2", "pC"), services: { calendar: { pimAccountId: "pC" } } }], facts([]))).toEqual(["pB", "pC"]);
  });

  it("never touch another server's row, an OAuth row or a row without an address", () => {
    const rows: PimAccountRow[] = [
      caldav("pA"),
      caldav("pB", "http://cloud.example.com/remote.php/dav"),
      caldav("pC", BASE, "bert"),
      { id: "g1", provider: "google", label: "x", config: {}, enabled: true },
      { id: "pD", provider: "caldav", label: "anna@cloud.example.com", config: {}, enabled: true },
    ];
    expect(planEmptyPasswordDuplicates(rows, [], facts(["pA"]))).toEqual([]);
  });

  it("are removed on this device, checked once more right before", async () => {
    const rows = [caldav("pA"), caldav("pB"), caldav("pC")];
    const deleted: string[] = [];
    let signedIn = new Set(["pA"]);
    let reads = 0;
    const removed = await removeEmptyPasswordDuplicates({
      listAccounts: async () => rows,
      listCalendars: async () => [],
      listTaskLists: async () => [],
      deleteAccount: async (id) => { deleted.push(id); },
      listCards: async () => [],
      hasCredentials: async (id) => {
        reads += 1;
        // A connect signs pC in after the plan was made.
        if (reads > 3) signedIn = new Set([...signedIn, "pC"]);
        return signedIn.has(id);
      },
    });
    expect(removed).toEqual(["pB"]);
    expect(deleted).toEqual(["pB"]);
  });

  it("count a sign-in that cannot be read as held", async () => {
    const rows = [caldav("pA"), caldav("pB")];
    const deleted: string[] = [];
    await removeEmptyPasswordDuplicates({
      listAccounts: async () => rows,
      listCalendars: async () => [],
      listTaskLists: async () => [],
      deleteAccount: async (id) => { deleted.push(id); },
      listCards: async () => [],
      hasCredentials: async () => { throw new Error("keychain locked"); },
    });
    expect(deleted).toEqual([]);
  });

  it("leave a row the brought card binds to files as well; the guided repair offers it", () => {
    // A leftover of an older import: the card of the other device's files and
    // calendar binds pB, and the profile map keeps pointing there. Removing pB
    // would leave that card's calendar on nothing, so it stays, and is shown.
    const rows = [caldav("pA"), caldav("pB", "https://cloud.example.com:443/remote.php/dav/")];
    const facts = (id: string) => ({ hasCredentials: id === "pA", hasCachedData: id === "pA" });
    expect(planEmptyPasswordDuplicates(rows, [calendarCard("cA", "pA"), nextcloudCard("cB", "pB")], facts)).toEqual([]);
    expect(reviewDuplicatePimRows(rows)).toEqual([{ reason: "same-identity", provider: "caldav", label: rows[0].label, accountIds: ["pA", "pB"] }]);
  });

  it("after the import of a second device's settings, one card is left (both ways of #174 together)", async () => {
    // Device A spelled the address with port 443 before this fix; its import
    // of device B's settings had added pB without a sign-in and a card for it.
    const a = device([caldav("pA"), caldav("pB", "https://cloud.example.com:443/remote.php/dav")], [nextcloudCard("cA", "pA"), calendarCard("cB", "pB")]);
    await removeEmptyPasswordDuplicates({
      listAccounts: async () => a.state.pim,
      listCalendars: async () => [],
      listTaskLists: async () => [],
      deleteAccount: async (id) => { a.state.pim = a.state.pim.filter((row) => row.id !== id); },
      listCards: async () => a.state.cards,
      hasCredentials: async (id) => id === "pA",
    });
    const shown = reconcileCloudAccounts(a.state.cards, observed(a.state.pim, passwordAccountIdentity(BASE, "anna")!), () => "new");
    expect(shown.map((card) => card.id)).toEqual(["cA"]);
    // The next import of B's row finds pA by the same identity instead of adding it again.
    const b = device([caldav("pB", "https://cloud.example.com:443/remote.php/dav")], [nextcloudCard("cB", "pB")]);
    await importAccountMetadata(b.publish(), a.ports);
    expect(a.state.pim.map((row) => row.id)).toEqual(["pA"]);
  });
});

describe("the guided repair", () => {
  it("offers two rows of one password access whatever their labels (red before: grouped by label only)", () => {
    const rows = [{ ...caldav("p1"), label: "Nextcloud" }, { ...caldav("p2", `${BASE}/calendars/anna/`), label: "anna@cloud.example.com" }, caldav("p3", BASE, "Anna")];
    expect(reviewDuplicatePimRows(rows)).toEqual([{ reason: "same-identity", provider: "caldav", label: "Nextcloud", accountIds: ["p1", "p2"] }]);
  });
});

/**
 * Two devices, one written by a phone before this fix (its CalDAV rows carry
 * `config: {}`), exchanging their settings round after round. Nothing may
 * wander: the documents settle, and the account is one row once the phone
 * writes the address.
 */
describe("two devices exchanging their settings", () => {
  const P = "https://cloud.example.com/remote.php/dav/principals/users/anna/";
  const fold = (d: ReturnType<typeof device>, signedIn: Set<string>) => removeEmptyPasswordDuplicates({
    listAccounts: async () => d.state.pim,
    listCalendars: async () => [],
    listTaskLists: async () => [],
    deleteAccount: async (id) => { d.state.pim = d.state.pim.filter((row) => row.id !== id); },
    listCards: async () => d.state.cards,
    hasCredentials: async (id) => signedIn.has(id),
  });
  const round = async (a: ReturnType<typeof device>, b: ReturnType<typeof device>) => {
    await importAccountMetadata(b.publish(), a.ports); await fold(a, new Set(["pA"]));
    await importAccountMetadata(a.publish(), b.ports); await fold(b, new Set(["pB"]));
  };
  const snapshot = (d: ReturnType<typeof device>) => JSON.stringify([...d.state.pim].sort((x, y) => x.id.localeCompare(y.id)));

  it("settle, and become one row once the phone writes the address", async () => {
    const a = device([{ ...caldav("pA"), config: { url: BASE, user: "anna", confirmedPrincipal: P } }], []);
    const b = device([{ ...caldav("pB"), config: {} }], []);
    await round(a, b);
    await round(a, b);
    const settledA = snapshot(a);
    const settledB = snapshot(b);
    await round(a, b);
    expect(snapshot(a)).toBe(settledA);
    expect(snapshot(b)).toBe(settledB);
    // The phone's row has no address: nothing can say it is the same account,
    // so it stays beside (Fehlerliste F36 A2) — untidy, never wrong.
    expect(a.state.pim).toHaveLength(2);

    // The updated phone fills the address in from its sign-in at start: from
    // then on its row and the desktop's are one account in both directions.
    b.state.pim = b.state.pim.map((row) => (row.id === "pB" ? { ...row, config: { url: `${BASE}/`, user: "anna" } } : row));
    await round(a, b);
    await round(a, b);
    expect(b.state.map.pimLocalToLogical.pB).toBe("pA");
    expect(a.state.pim.find((row) => row.id === "pA")!.config).toMatchObject({ url: BASE, confirmedPrincipal: P });
    const doneA = snapshot(a);
    const doneB = snapshot(b);
    await round(a, b);
    expect(snapshot(a)).toBe(doneA);
    expect(snapshot(b)).toBe(doneB);
    // What the old row left on both devices stays: an entry without an
    // address, without a sign-in, that nothing can prove to be the account
    // (reported, not removed: it would come back with every import).
    expect(a.state.pim.filter((row) => !row.config.url).map((row) => row.id)).toEqual(["pB"]);
  });
});
