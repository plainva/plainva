import { describe, expect, it } from "vitest";

import {
  QUEUE_TTL_MS,
  buildQueue,
  countsAsConnected,
  isExpired,
  nextService,
  withCompleted,
  type ConnectQueue,
} from "./services/connectQueue";

const T0 = 1_700_000_000_000;

describe("building a connect run (S0b1)", () => {
  it("keeps the files → calendar → mail order regardless of tick order", () => {
    const q = buildQueue("google", ["mail", "files", "calendar"], T0);
    expect(q?.pending).toEqual(["files", "calendar", "mail"]);
  });

  /**
   * Files FIRST is not cosmetic. On mobile the files service creates the vault
   * container and switches into it; calendar and mail bind to the ACTIVE vault.
   * Any other order puts one account's services into two different vaults.
   */
  it("puts files first even when only files and mail were ticked", () => {
    expect(buildQueue("google", ["mail", "files"], T0)?.pending).toEqual(["files", "mail"]);
  });

  it("drops services the family cannot carry", () => {
    // Apple has no files: iCloud Drive has no third-party API.
    expect(buildQueue("apple", ["files", "calendar", "mail"], T0)?.pending).toEqual(["calendar", "mail"]);
    // Dropbox is files-only.
    expect(buildQueue("dropbox", ["files", "calendar"], T0)?.pending).toEqual(["files"]);
  });

  it("is null when nothing survives the filter", () => {
    expect(buildQueue("dropbox", ["calendar", "mail"], T0)).toBeNull();
    expect(buildQueue("google", [], T0)).toBeNull();
  });
});

describe("walking the run", () => {
  const run = (): ConnectQueue => buildQueue("google", ["files", "calendar", "mail"], T0)!;

  it("hands out the next service in order", () => {
    let q: ConnectQueue | null = run();
    expect(nextService(q)).toBe("files");
    q = withCompleted(q, "files");
    expect(nextService(q)).toBe("calendar");
    q = withCompleted(q, "calendar");
    expect(nextService(q)).toBe("mail");
  });

  it("ends the run when the last service is done", () => {
    let q: ConnectQueue | null = run();
    for (const s of ["files", "calendar", "mail"] as const) q = withCompleted(q, s);
    expect(q).toBeNull();
    expect(nextService(q)).toBeNull();
  });

  it("remembers what is already connected", () => {
    const q = withCompleted(run(), "files");
    expect(q?.done).toEqual(["files"]);
    expect(q?.pending).toEqual(["calendar", "mail"]);
  });

  /**
   * A screen can be reached directly (no queue) or re-entered after a cold
   * start. Neither is an error — it just means there is nothing to advance.
   */
  it("ignores a completion that is not pending", () => {
    const q = run();
    expect(withCompleted(q, "calendar")?.pending).toEqual(["files", "mail"]);
    expect(withCompleted(null, "files")).toBeNull();
    const onlyFiles = buildQueue("dropbox", ["files"], T0)!;
    expect(withCompleted(onlyFiles, "mail")).toBe(onlyFiles);
  });
});

describe("an abandoned run does not resurface", () => {
  it("expires exactly at the TTL", () => {
    const q = buildQueue("google", ["files"], T0)!;
    expect(isExpired(q, T0 + QUEUE_TTL_MS - 1)).toBe(false);
    expect(isExpired(q, T0 + QUEUE_TTL_MS)).toBe(true);
  });
});

/**
 * The run advances on the same events the account screens already fire when
 * their lists change — and those fire for deletes and edits too. Counting is
 * the whole reason the queue carries a baseline: only a list that GREW past its
 * starting size means the sign-in landed.
 */
describe("what counts as connected (S0b2)", () => {
  const q = buildQueue("google", ["files", "calendar", "mail"], T0, { files: 2, calendar: 1, mail: 0 })!;

  it("advances when the waited-for list grew", () => {
    expect(countsAsConnected(q, "files", 3)).toBe(true);
    expect(countsAsConnected(withCompleted(q, "files"), "calendar", 2)).toBe(true);
  });

  it("does not advance on a delete or an unchanged list", () => {
    expect(countsAsConnected(q, "files", 2)).toBe(false);
    expect(countsAsConnected(q, "files", 1)).toBe(false);
  });

  it("ignores growth on a service the run is not waiting for", () => {
    // Adding a mailbox while the run sits on files must not skip the files step.
    expect(countsAsConnected(q, "mail", 5)).toBe(false);
  });

  it("says nothing when there is no run at all", () => {
    expect(countsAsConnected(null, "files", 99)).toBe(false);
  });

  /**
   * A first account is the case that would break a naive "the list is not
   * empty" check the other way round: baseline 0, one account, and that has to
   * count.
   */
  it("counts the very first account of a service", () => {
    const fresh = buildQueue("apple", ["calendar", "mail"], T0, { calendar: 0, mail: 0 })!;
    expect(countsAsConnected(fresh, "calendar", 1)).toBe(true);
  });
});
