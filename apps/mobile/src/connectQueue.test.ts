import { describe, expect, it } from "vitest";

import {
  QUEUE_TTL_MS,
  buildQueue,
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
