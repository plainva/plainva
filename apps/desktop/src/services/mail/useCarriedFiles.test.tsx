// @vitest-environment jsdom
import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import {
  GRAPH_FILE_LIMIT,
  MAIL_MAILBOX_CHANGED,
  setMailPlatform,
  useCarriedFiles,
  type CarriedFilesState,
  type CarriedSnapshot,
  type FetchedAttachment,
  type ForwardSource,
  type MailAccountConfig,
  type MailAttachment,
  type MailTransport,
  type UseCarriedFilesOptions,
} from "@plainva/ui/mail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The files of a forwarded original inside one composer (plan "Weiterleiten
 * nimmt die Anhänge mit", B2) — the hook both shells call, against a mailbox
 * that answers when the test says so.
 *
 * Held here: it asks once per message and only for what goes, a file that did
 * not come waits for `retry`, taking a file off is final whatever arrives
 * afterwards, the sender decides the bound, and a composer that changed
 * windows goes on where it was.
 */

const imap: MailAccountConfig = { id: "i1", label: "IMAP", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org" };
const microsoft: MailAccountConfig = { id: "m1", label: "Microsoft", host: "", port: 993, user: "me@example.com", kind: "microsoft", clientId: "cid" };

const MB = 1024 * 1024;
const source: ForwardSource = {
  accountId: "i1",
  mailbox: "INBOX",
  messageId: "7",
  uidValidity: 42,
  files: [
    { index: 0, name: "Angebot.pdf", mime: "application/pdf", size: 400 * 1024 },
    { index: 1, name: "Lageplan.png", mime: "image/png", size: 2 * MB },
    { index: 2, name: "Begehung.mp4", mime: "video/mp4", size: 7 * MB },
  ],
};

/** One call to the mailbox, answered by the test. */
interface Batch {
  args: { mailbox: string; uid: number; indexes: number[]; uidValidity?: number };
  resolve(found: FetchedAttachment[]): void;
  reject(error: Error): void;
}
let batches: Batch[] = [];

let root: Root | null = null;
let host: HTMLDivElement;
let latest: CarriedFilesState;

function Probe(props: UseCarriedFilesOptions) {
  const state = useCarriedFiles(props);
  // Handed out after the render has settled, never during it.
  useEffect(() => {
    latest = state;
  });
  return null;
}

/** Lets effects, the credential lookup and a settled answer play out. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const base: UseCarriedFilesOptions = { vaultPath: "/vault", source, accounts: [imap, microsoft], sender: imap, others: [] };

async function mount(props: Partial<UseCarriedFilesOptions> = {}, strict = false) {
  root = createRoot(host);
  const element = <Probe {...base} {...props} />;
  await act(async () => {
    root!.render(strict ? <StrictMode>{element}</StrictMode> : element);
  });
  await settle();
}

async function rerender(props: Partial<UseCarriedFilesOptions>) {
  await act(async () => {
    root!.render(<Probe {...base} {...props} />);
  });
  await settle();
}

const states = () => latest.rows.map((row) => `${row.file.index}:${row.state}${row.why ? `/${row.why}` : ""}`);
const answer = async (batch: Batch, found: FetchedAttachment[]) => {
  await act(async () => batch.resolve(found));
  await settle();
};

beforeEach(() => {
  batches = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  const transport = {
    fetchAttachments: (_creds: unknown, args: Batch["args"]) =>
      new Promise<FetchedAttachment[]>((resolve, reject) => {
        batches.push({ args, resolve, reject });
      }),
  } as unknown as MailTransport;
  setMailPlatform({ transport, http: { api: fetch, token: fetch } });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host.remove();
});

describe("loading the files of a forwarded original", () => {
  it("asks the mailbox once, for all of them, under the epoch the message was read in", async () => {
    await mount();

    expect(batches).toHaveLength(1);
    expect(batches[0].args).toEqual({ mailbox: "INBOX", uid: 7, indexes: [0, 1, 2], uidValidity: 42 });
    expect(states()).toEqual(["0:loading", "1:loading", "2:loading"]);
    expect(latest.loading).toBe(true);
    expect(latest.attachments).toEqual([]);

    await answer(batches[0], [
      { index: 0, contentBase64: "JVBERi0=" },
      { index: 1, contentBase64: "AAEC" },
      { index: 2, contentBase64: "AAAA" },
    ]);

    expect(states()).toEqual(["0:ready", "1:ready", "2:ready"]);
    expect(latest.loading).toBe(false);
    expect(latest.attachments).toEqual([
      { name: "Angebot.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" },
      { name: "Lageplan.png", mime: "image/png", contentBase64: "AAEC" },
      { name: "Begehung.mp4", mime: "video/mp4", contentBase64: "AAAA" },
    ]);
    expect(latest.left).toEqual([]);
    // Nothing is asked for a second time.
    expect(batches).toHaveLength(1);
  });

  it("asks once under StrictMode too — an effect that runs twice is one request", async () => {
    await mount({}, true);
    expect(batches).toHaveLength(1);
  });

  it("waits until the mailboxes are known: the bound is the sender's", async () => {
    await mount({ accounts: null, sender: null });
    expect(batches).toHaveLength(0);
    // Not asked yet, but wanted: Send must wait all the same.
    expect(latest.loading).toBe(true);

    await rerender({});
    expect(batches).toHaveLength(1);
  });

  it("asks nobody when the draft forwards nothing", async () => {
    await mount({ source: undefined });
    expect(batches).toHaveLength(0);
    expect(latest.rows).toEqual([]);
    expect(latest.loading).toBe(false);
    expect(latest.snapshot()).toBeUndefined();
  });

  it("says so when the mailbox the message lies in is not connected", async () => {
    await mount({ accounts: [microsoft], sender: microsoft, source: { ...source, files: [source.files[0]] } });
    expect(batches).toHaveLength(0);
    expect(latest.rows.map((row) => [row.state, row.file.failure])).toEqual([["failed", "account"]]);
    expect(latest.loading).toBe(false);
  });
});

describe("a file that did not come", () => {
  it("is failed for every file asked when the call fails, and is not asked again on its own", async () => {
    await mount();
    await act(async () => batches[0].reject(new Error("examine failed: connection reset")));
    await settle();

    expect(states()).toEqual(["0:failed", "1:failed", "2:failed"]);
    expect(latest.rows[0].file.detail).toContain("connection reset");
    expect(latest.loading).toBe(false);
    expect(latest.left.map((l) => [l.name, l.why])).toEqual([
      ["Angebot.pdf", "failed"],
      ["Lageplan.png", "failed"],
      ["Begehung.mp4", "failed"],
    ]);
    await settle();
    expect(batches).toHaveLength(1);
  });

  it("comes with retry — all of them in one call again", async () => {
    await mount();
    await act(async () => batches[0].reject(new Error("offline")));
    await settle();

    await act(async () => latest.retry());
    await settle();

    expect(batches).toHaveLength(2);
    expect(batches[1].args.indexes).toEqual([0, 1, 2]);
    expect(states()).toEqual(["0:loading", "1:loading", "2:loading"]);
    await answer(batches[1], [{ index: 0, contentBase64: "AA==" }, { index: 1, contentBase64: "AA==" }, { index: 2, contentBase64: "AA==" }]);
    expect(states()).toEqual(["0:ready", "1:ready", "2:ready"]);
  });

  it("is asked for alone when only that one is retried, and the others keep what they are", async () => {
    await mount();
    await answer(batches[0], [{ index: 0, contentBase64: "AA==" }, { index: 2, contentBase64: "AA==" }]);
    // The mailbox had no file under index 1 any more.
    expect(states()).toEqual(["0:ready", "1:failed", "2:ready"]);
    expect(latest.rows[1].file.failure).toBe("missing");

    await act(async () => latest.retry(1));
    await settle();
    expect(batches[1].args.indexes).toEqual([1]);
    expect(states()).toEqual(["0:ready", "1:loading", "2:ready"]);
  });

  it("names a renumbered mailbox as what it is", async () => {
    await mount();
    await act(async () => batches[0].reject(new Error(MAIL_MAILBOX_CHANGED)));
    await settle();
    expect(latest.rows.map((row) => row.file.failure)).toEqual(["changed", "changed", "changed"]);
    // The code is not a sentence anyone should read.
    expect(latest.rows[0].file.detail).toBeUndefined();
  });

  it("is never asked for again when it is not a file", async () => {
    // What a Microsoft mailbox answers for an attached Outlook item or a link:
    // asking again would not change it, so it stays behind and `retry` passes it.
    const restore: CarriedSnapshot = { source, files: [{ index: 0, name: "Besprechung", mime: "", size: 0, load: "failed", failure: "notAFile" }] };
    await mount({ source: undefined, restore });
    expect(states()).toEqual(["0:left/notAFile"]);

    await act(async () => latest.retry());
    await settle();

    expect(batches).toHaveLength(0);
    expect(states()).toEqual(["0:left/notAFile"]);
    expect(latest.left).toEqual([{ name: "Besprechung", size: 0, why: "notAFile" }]);
  });
});

describe("taking a file off", () => {
  it("is final, whatever arrives afterwards", async () => {
    await mount();
    await act(async () => latest.remove(1));
    await settle();
    expect(states()).toEqual(["0:loading", "2:loading"]);

    await answer(batches[0], [
      { index: 0, contentBase64: "AA==" },
      { index: 1, contentBase64: "AA==" },
      { index: 2, contentBase64: "AA==" },
    ]);
    expect(states()).toEqual(["0:ready", "2:ready"]);
    expect(latest.attachments.map((a) => a.name)).toEqual(["Angebot.pdf", "Begehung.mp4"]);
  });

  it("is what the leave question sees: opened with three, two are left", async () => {
    await mount();
    expect(latest.openedIndexes).toEqual([0, 1, 2]);
    expect(latest.indexes).toEqual([0, 1, 2]);
    await act(async () => latest.remove(0));
    expect(latest.openedIndexes).toEqual([0, 1, 2]);
    expect(latest.indexes).toEqual([1, 2]);
  });

  it("frees Send when the last file on its way is taken off", async () => {
    await mount({ source: { ...source, files: [source.files[2]] } });
    expect(latest.loading).toBe(true);
    await act(async () => latest.remove(2));
    expect(latest.loading).toBe(false);
  });
});

describe("the sender decides the bound", () => {
  it("does not ask for a file a Microsoft mailbox does not take", async () => {
    await mount({ sender: microsoft });
    // 7 MB is over the bound: it stays behind, by name, and costs nothing.
    expect(batches[0].args.indexes).toEqual([0, 1]);
    expect(states()).toEqual(["0:loading", "1:loading", "2:left/tooLarge"]);
    await answer(batches[0], [{ index: 0, contentBase64: "AA==" }, { index: 1, contentBase64: "AA==" }]);
    expect(latest.loading).toBe(false);
    expect(latest.left).toEqual([{ name: "Begehung.mp4", size: 7 * MB, why: "tooLarge" }]);
  });

  it("asks for it once the sender takes it", async () => {
    await mount({ sender: microsoft });
    await answer(batches[0], [{ index: 0, contentBase64: "AA==" }, { index: 1, contentBase64: "AA==" }]);

    await rerender({ sender: imap });
    expect(batches).toHaveLength(2);
    expect(batches[1].args.indexes).toEqual([2]);
    expect(states()).toEqual(["0:ready", "1:ready", "2:loading"]);
  });

  it("leaves a file behind that has arrived when the new sender does not take it — and keeps its bytes", async () => {
    await mount();
    const big = btoa("\0".repeat(GRAPH_FILE_LIMIT + 1));
    await answer(batches[0], [{ index: 0, contentBase64: "AA==" }, { index: 1, contentBase64: "AA==" }, { index: 2, contentBase64: big }]);
    expect(states()).toEqual(["0:ready", "1:ready", "2:ready"]);

    await rerender({ sender: microsoft });
    expect(states()).toEqual(["0:ready", "1:ready", "2:left/tooLarge"]);
    expect(latest.attachments.map((a) => a.name)).toEqual(["Angebot.pdf", "Lageplan.png"]);

    await rerender({ sender: imap });
    // Back again without a second download.
    expect(states()).toEqual(["0:ready", "1:ready", "2:ready"]);
    expect(batches).toHaveLength(1);
  });

  it("holds a file attached by hand against the mailbox's bound, and says which go", async () => {
    const note: MailAttachment = { name: "Notiz.md", mime: "text/markdown", contentBase64: "IyBI" };
    const video: MailAttachment = { name: "Film.mp4", mime: "video/mp4", contentBase64: btoa("\0".repeat(GRAPH_FILE_LIMIT + 1)) };
    const others = [note, video];
    await mount({ source: undefined, sender: microsoft, others });
    expect(latest.othersGo).toEqual([true, false]);
    expect(latest.left).toEqual([{ name: "Film.mp4", size: GRAPH_FILE_LIMIT + 1, why: "tooLarge" }]);
    // The bound it was held against is handed out with the answer: the
    // composer names it, and does not ask a second time.
    expect(latest.limits.perFile).toBe(GRAPH_FILE_LIMIT);

    await rerender({ source: undefined, sender: imap, others });
    expect(latest.othersGo).toEqual([true, true]);
    expect(latest.left).toEqual([]);
    expect(latest.limits.perFile).toBeNull();
  });

  it("keeps the bounds as one value while the sender's bound stays the same", async () => {
    // The plan hangs on this value: a new one on every render would plan again
    // for nothing, and hand every consumer a new list each time.
    await mount({ sender: imap });
    const first = latest.limits;
    const rows = latest.rows;
    await rerender({ sender: { ...imap } });
    expect(latest.limits).toBe(first);
    expect(latest.rows).toBe(rows);
  });
});

describe("a composer that changes windows", () => {
  it("takes along what has arrived and asks again only for what was on its way", async () => {
    await mount();
    await act(async () => latest.remove(1));
    const taken = latest.snapshot() as CarriedSnapshot;
    // Still loading in the first window: the second one asks for them itself.
    expect(taken.files.map((f) => [f.index, f.load])).toEqual([[0, "idle"], [2, "idle"]]);
    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }, { index: 2, contentBase64: "AA==" }]);
    const arrived = latest.snapshot() as CarriedSnapshot;
    expect(arrived.files.map((f) => [f.index, f.load])).toEqual([[0, "ready"], [2, "ready"]]);
    await act(async () => root!.unmount());
    root = null;

    // The new window: nothing to load, the same files, the same opening state.
    batches = [];
    await mount({ source: undefined, restore: arrived });
    expect(batches).toHaveLength(0);
    expect(states()).toEqual(["0:ready", "2:ready"]);
    expect(latest.attachments[0]).toEqual({ name: "Angebot.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" });
    // A draft does not become untouched by changing windows: it opened with
    // three files, and one was taken off.
    expect(latest.openedIndexes).toEqual([0, 1, 2]);
    expect(latest.indexes).toEqual([0, 2]);
  });

  it("loads in the new window what had not arrived in the old one", async () => {
    const restore: CarriedSnapshot = {
      source,
      files: [
        { index: 0, name: "Angebot.pdf", mime: "application/pdf", size: 400 * 1024, load: "ready", attachment: { name: "Angebot.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" } },
        { index: 1, name: "Lageplan.png", mime: "image/png", size: 2 * MB, load: "loading" },
      ],
    };
    await mount({ source: undefined, restore });
    expect(batches).toHaveLength(1);
    expect(batches[0].args.indexes).toEqual([1]);
    expect(states()).toEqual(["0:ready", "1:loading"]);
  });
});

describe("a composer that is gone", () => {
  it("is not answered: a late answer and a late failure find nobody, ask for nothing again and complain about nothing", async () => {
    // What can be seen from outside of an answer that arrives too late: no
    // second call, and no complaint — neither from React about a composer
    // that no longer exists, nor as a rejection nobody took.
    const complaints: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void complaints.push(args);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await mount();
      const answered = batches[0];
      await act(async () => root!.unmount());
      await act(async () => answered.resolve([{ index: 0, contentBase64: "AA==" }]));
      await settle();

      root = createRoot(host);
      await act(async () => root!.render(<Probe {...base} />));
      await settle();
      const refused = batches[1];
      await act(async () => root!.unmount());
      root = null;
      await act(async () => refused.reject(new Error("connection reset")));
      await settle();

      expect(batches).toHaveLength(2);
      expect(complaints).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      console.error = error;
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
