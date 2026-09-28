import { describe, expect, it } from "vitest";
import { encodeImapUtf7, imapListFields, imapSearchText, threadFields, threadRows, type ThreadableEnvelope } from "@plainva/ui/mail";

/**
 * IMAP response lines and sender headers are read in linear time (plan
 * Befunde 24.09., E6). Both are written by a server, and each hostile case
 * below is what an old pattern needed quadratic or cubic time for: a run of
 * blanks it could split several ways, then a line end that made it fail. The
 * protocol and grouping behaviour is pinned by imapClient and threadGrouping,
 * which ran unchanged; the pins here name the quirks kept on purpose.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("IMAP response lines", () => {
  it("splits a LIST line into flags, delimiter token and name", () => {
    expect(imapListFields('* LIST (\\HasNoChildren) "/" "INBOX"')).toEqual(["\\HasNoChildren", '"/"', '"INBOX"']);
    expect(imapListFields("* list () NIL Archive")).toEqual(["", "NIL", "Archive"]);
    // A name of blanks only still matches — the greedy blanks give one back.
    expect(imapListFields('* LIST () "/"   ')).toEqual(["", '"/"', " "]);
    expect(imapListFields('* LIST () "/" a\nb')).toBeUndefined();
    expect(imapListFields('* LIST () "/"')).toBeUndefined();
  });

  it("reads the UID list of a SEARCH line", () => {
    expect(imapSearchText("* SEARCH 5 7")).toBe("5 7");
    expect(imapSearchText("* SEARCH")).toBe("");
    expect(imapSearchText("* search\t 9 ")).toBe("9 ");
    expect(imapSearchText("* SEARCH 5\n")).toBeUndefined();
    expect(imapSearchText("* 3 EXISTS")).toBeUndefined();
  });

  it("keeps the modified UTF-7 padding rule", () => {
    expect(encodeImapUtf7("Entwürfe")).toBe("Entw&APw-rfe");
    expect(encodeImapUtf7("Ü")).toBe("&ANw-");
  });

  it("stays linear on a long run of blanks before a line end", () => {
    const blanks = " ".repeat(N);
    within(1_000, () => expect(imapListFields(`* LIST () "/"${blanks}x\n`)).toBeUndefined());
    within(1_000, () => expect(imapListFields(`* LIST () "/"${blanks}`)?.[2]).toBe(" "));
    within(1_000, () => expect(imapSearchText(`* SEARCH${blanks}1\n`)).toBeUndefined());
  });
});

describe("thread participants", () => {
  const env = (id: string, from: string): ThreadableEnvelope => ({
    id,
    subject: `Subject ${id}`,
    dateTs: Number(id),
    from,
    seen: true,
    flagged: false,
    ...threadFields({ messageId: `<${id}@x>` }),
  });

  it("names a sender by the display name, else by the whole value", () => {
    expect(threadRows([env("1", '"Ada Lovelace" <ada@x>')])[0].participants).toEqual(["Ada Lovelace"]);
    expect(threadRows([env("2", "Ben <ben@x> (work)")])[0].participants).toEqual(["Ben"]);
    expect(threadRows([env("3", "cleo@x")])[0].participants).toEqual(["cleo@x"]);
  });

  it("stays linear on a sender made of blanks", () => {
    const blanks = " ".repeat(N);
    within(1_000, () => expect(threadRows([env("4", `${blanks}!`)])[0].participants).toEqual(["!"]));
    within(1_000, () => expect(threadRows([env("5", `a${blanks}"${blanks}x<b>`)])[0].participants).toEqual([`a${blanks}"${blanks}x<b>`.trim()]));
  });
});
