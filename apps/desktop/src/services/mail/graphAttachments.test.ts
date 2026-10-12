// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Files and a Microsoft mailbox (plan "Weiterleiten nimmt die Anhänge mit", A4
 * and B6), against a fake Graph:
 *
 *  - fetching the files of one message: the list once, then one request per
 *    file, and a file that is not one says so instead of failing;
 *  - sending them: one request while they fit one, and otherwise a draft with
 *    each file attached on its own — the way Microsoft describes for several
 *    files — which is taken out of the mailbox again when a step fails.
 *
 * No real mailbox ever answered these requests; the fake does what Microsoft's
 * reference says the service does.
 */

interface Call {
  method: string;
  path: string;
  body?: string;
}
const calls: Call[] = [];
/** Requests the fake refuses: "METHOD /path" → status. */
const refuse = new Map<string, number>();
/** What the attachment list and the single attachments answer. */
let attachmentList: Array<Record<string, unknown>> = [];
let attachmentItems: Record<string, Record<string, unknown>> = {};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

const fakeFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? "GET";
  const path = decodeURIComponent(url.replace("https://graph.microsoft.com/v1.0", ""));
  calls.push({ method, path, body: init?.body });
  const refused = refuse.get(`${method} ${path}`);
  if (refused) return json({ error: { message: "refused by the fake" } }, refused);
  if (method === "GET" && path === "/me/messages/msg1/attachments?$select=id") return json({ value: attachmentList });
  const item = /^\/me\/messages\/msg1\/attachments\/([^/?]+)$/.exec(path);
  if (method === "GET" && item) return json(attachmentItems[item[1]] ?? {}, attachmentItems[item[1]] ? 200 : 404);
  if (method === "POST" && path === "/me/sendMail") return new Response("", { status: 202 });
  if (method === "POST" && path === "/me/messages") return json({ id: "draft1" }, 201);
  if (method === "POST" && path === "/me/messages/draft1/attachments") return json({ id: "att" }, 201);
  if (method === "POST" && path === "/me/messages/draft1/send") return new Response("", { status: 202 });
  if (method === "DELETE" && path === "/me/messages/draft1") return new Response(null, { status: 204 });
  return json({ error: { message: `the fake does not know ${method} ${path}` } }, 501);
});

vi.mock("@plainva/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, refreshOneDriveAccessToken: vi.fn(async () => ({ accessToken: "ACCESS", expiresIn: 3600 })) };
});

import {
  GRAPH_FILE_LIMIT,
  fetchAttachments,
  forgetGraphMailRuntime,
  graphAppendDraft,
  graphFetchAttachments,
  graphSendMail,
  mailSecretKey,
  setMailPlatform,
  type MailAccountConfig,
  type MailAttachment,
  type MailTransport,
} from "@plainva/ui/mail";
import { setPlatformServices } from "@plainva/ui";

const account: MailAccountConfig = { id: "acc1", label: "me@outlook.com", host: "", port: 993, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };
const secrets = new Map<string, unknown>();

beforeEach(() => {
  calls.length = 0;
  refuse.clear();
  attachmentList = [];
  attachmentItems = {};
  forgetGraphMailRuntime("/vault", "acc1");
  secrets.clear();
  secrets.set(mailSecretKey("/vault", "acc1"), { refreshToken: "REFRESH" });
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: {
      readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
      writeSecret: async <T,>(key: string, value: T) => {
        secrets.set(key, value);
      },
      removeSecret: async (key: string) => {
        secrets.delete(key);
      },
    },
    openExternal: async () => {},
  });
  // Graph never touches the IMAP transport; a throwing stub proves that.
  const transport = new Proxy({} as MailTransport, {
    get: () => () => {
      throw new Error("the Graph backend must not use the IMAP transport");
    },
  });
  setMailPlatform({ transport, http: { api: fakeFetch as unknown as typeof fetch, token: fakeFetch as unknown as typeof fetch } });
});

const MB = 1024 * 1024;
/** A real file of `bytes` zero bytes, packed. */
const fileOf = (name: string, bytes: number): MailAttachment => ({ name, mime: "application/octet-stream", contentBase64: btoa("\0".repeat(bytes)) });
const mailboxCalls = () => calls.filter((c) => c.path.startsWith("/me/")).map((c) => `${c.method} ${c.path}`);

describe("the files of one Microsoft message", () => {
  const FILE = "#microsoft.graph.fileAttachment";

  it("reads the list once and then each file with one request", async () => {
    attachmentList = [{ "@odata.type": FILE, id: "A" }, { "@odata.type": FILE, id: "B" }, { "@odata.type": FILE, id: "C" }];
    attachmentItems = { A: { contentBytes: "QUFB" }, B: { contentBytes: "QkJC" }, C: { contentBytes: "Q0ND" } };

    const answers = await graphFetchAttachments("/vault", account, "Posteingang", "msg1", [0, 1, 2]);

    expect(answers).toEqual([
      { index: 0, contentBase64: "QUFB" },
      { index: 1, contentBase64: "QkJC" },
      { index: 2, contentBase64: "Q0ND" },
    ]);
    // Four requests for three files — file by file it was six.
    expect(mailboxCalls()).toEqual([
      "GET /me/messages/msg1/attachments?$select=id",
      "GET /me/messages/msg1/attachments/A",
      "GET /me/messages/msg1/attachments/B",
      "GET /me/messages/msg1/attachments/C",
    ]);
  });

  it("asks only for the files that were named, and answers in the order asked", async () => {
    attachmentList = [{ "@odata.type": FILE, id: "A" }, { "@odata.type": FILE, id: "B" }, { "@odata.type": FILE, id: "C" }];
    attachmentItems = { A: { contentBytes: "QUFB" }, C: { contentBytes: "Q0ND" } };

    const answers = await graphFetchAttachments("/vault", account, "Posteingang", "msg1", [2, 0, 7]);

    expect(answers).toEqual([
      { index: 2, contentBase64: "Q0ND" },
      { index: 0, contentBase64: "QUFB" },
      // The message has three attachments; there is no eighth.
      { index: 7, failure: "missing" },
    ]);
    expect(mailboxCalls().filter((c) => c.endsWith("/B"))).toEqual([]);
  });

  it("says of an attachment that is not a file that it is not one — without asking for bytes it does not have", async () => {
    attachmentList = [
      { "@odata.type": "#microsoft.graph.itemAttachment", id: "MAIL" },
      { "@odata.type": "#microsoft.graph.referenceAttachment", id: "LINK" },
      { "@odata.type": FILE, id: "EMPTY" },
      { id: "UNTYPED" },
    ];
    // An empty file IS a file; a list entry without a type is asked, and has no bytes.
    attachmentItems = { EMPTY: { contentBytes: "" }, UNTYPED: { "@odata.type": "#microsoft.graph.itemAttachment", name: "Besprechung" } };

    const answers = await graphFetchAttachments("/vault", account, "Posteingang", "msg1", [0, 1, 2, 3]);

    expect(answers).toEqual([
      { index: 0, failure: "notAFile" },
      { index: 1, failure: "notAFile" },
      { index: 2, contentBase64: "" },
      { index: 3, failure: "notAFile" },
    ]);
    expect(mailboxCalls()).not.toContain("GET /me/messages/msg1/attachments/MAIL");
    expect(mailboxCalls()).not.toContain("GET /me/messages/msg1/attachments/LINK");
  });

  it("a file that fails does not take the others with it", async () => {
    attachmentList = [{ "@odata.type": FILE, id: "A" }, { "@odata.type": FILE, id: "B" }];
    attachmentItems = { A: { contentBytes: "QUFB" }, B: { contentBytes: "QkJC" } };
    refuse.set("GET /me/messages/msg1/attachments/A", 503);

    const answers = await graphFetchAttachments("/vault", account, "Posteingang", "msg1", [0, 1]);

    expect(answers[0].index).toBe(0);
    expect(answers[0].failure).toBe("failed");
    expect(answers[0].detail).toContain("503");
    expect(answers[1]).toEqual({ index: 1, contentBase64: "QkJC" });
  });

  it("rejects the call when the list itself cannot be read", async () => {
    refuse.set("GET /me/messages/msg1/attachments?$select=id", 503);
    await expect(graphFetchAttachments("/vault", account, "Posteingang", "msg1", [0])).rejects.toThrow("503");
  });

  it("is what the mail client asks for a Microsoft mailbox", async () => {
    attachmentList = [{ "@odata.type": FILE, id: "A" }];
    attachmentItems = { A: { contentBytes: "QUFB" } };
    // The epoch means nothing to Graph, whose ids do not move.
    expect(await fetchAttachments("/vault", account, "Posteingang", "msg1", [0, 0], 42)).toEqual([{ index: 0, contentBase64: "QUFB" }]);
  });
});

describe("sending files from a Microsoft mailbox", () => {
  const small = fileOf("a.bin", 1024);

  it("keeps a message that fits one request in one request", async () => {
    await graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [small]);

    expect(mailboxCalls()).toEqual(["POST /me/sendMail"]);
    const sent = JSON.parse(calls.find((c) => c.path === "/me/sendMail")!.body!);
    expect(sent.saveToSentItems).toBe(true);
    expect(sent.message.attachments).toEqual([
      { "@odata.type": "#microsoft.graph.fileAttachment", name: "a.bin", contentType: "application/octet-stream", contentBytes: small.contentBase64 },
    ]);
  });

  it("sends a message without files exactly as before", async () => {
    await graphSendMail("/vault", account, "anna@example.org", "Hallo", "<p>x</p>");
    expect(mailboxCalls()).toEqual(["POST /me/sendMail"]);
    expect(JSON.parse(calls[calls.length - 1].body!).message).not.toHaveProperty("attachments");
  });

  it("takes the draft way when the files do not fit one request: each file on its own, then send", async () => {
    // Two files of 2 MB: each is under the bound, together they are 5.3 MB packed.
    const one = fileOf("eins.bin", 2 * MB);
    const two = fileOf("zwei.bin", 2 * MB);

    await graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [one, two], "carla@example.org");

    expect(mailboxCalls()).toEqual([
      "POST /me/messages",
      "POST /me/messages/draft1/attachments",
      "POST /me/messages/draft1/attachments",
      "POST /me/messages/draft1/send",
    ]);
    const posts = calls.filter((c) => c.method === "POST");
    // The draft is the message without its files …
    const draft = JSON.parse(posts[0].body!);
    expect(draft).toMatchObject({ subject: "Fwd", toRecipients: [{ emailAddress: { address: "anna@example.org" } }], ccRecipients: [{ emailAddress: { address: "carla@example.org" } }] });
    expect(draft).not.toHaveProperty("attachments");
    expect(draft).not.toHaveProperty("saveToSentItems");
    // … the files follow in the order they were put on, each in a request of
    // its own that Graph takes …
    expect(JSON.parse(posts[1].body!).name).toBe("eins.bin");
    expect(JSON.parse(posts[2].body!).name).toBe("zwei.bin");
    for (const post of [posts[1], posts[2]]) expect(new TextEncoder().encode(post.body!).length).toBeLessThan(4_000_000);
    // … and sending carries no body at all.
    expect(posts[3].body).toBeUndefined();
  });

  it("a file at the bound goes, on the draft way", async () => {
    const largest = fileOf("groesste.bin", GRAPH_FILE_LIMIT);
    await graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [largest]);
    expect(mailboxCalls()).toEqual(["POST /me/messages", "POST /me/messages/draft1/attachments", "POST /me/messages/draft1/send"]);
    const attach = calls.find((c) => c.path === "/me/messages/draft1/attachments")!;
    expect(new TextEncoder().encode(attach.body!).length).toBeLessThan(4_000_000);
  });

  it("takes the draft out of the mailbox again when a file is refused, and reports that refusal", async () => {
    refuse.set("POST /me/messages/draft1/attachments", 413);
    await expect(graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)])).rejects.toThrow("413");
    expect(mailboxCalls()).toEqual(["POST /me/messages", "POST /me/messages/draft1/attachments", "DELETE /me/messages/draft1"]);
  });

  it("takes the draft out again when sending it fails", async () => {
    refuse.set("POST /me/messages/draft1/send", 503);
    await expect(graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)])).rejects.toThrow("503");
    expect(mailboxCalls().slice(-2)).toEqual(["POST /me/messages/draft1/send", "DELETE /me/messages/draft1"]);
  });

  it("reports the failure that happened even when the clean-up fails too", async () => {
    refuse.set("POST /me/messages/draft1/send", 503);
    refuse.set("DELETE /me/messages/draft1", 500);
    await expect(graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)])).rejects.toThrow("503");
  });

  it("leaves nothing behind when the draft cannot be created", async () => {
    refuse.set("POST /me/messages", 503);
    await expect(graphSendMail("/vault", account, "anna@example.org", "Fwd", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)])).rejects.toThrow("503");
    expect(mailboxCalls()).toEqual(["POST /me/messages"]);
  });
});

describe("filing a draft with files in a Microsoft mailbox", () => {
  it("is one request while it fits one", async () => {
    await graphAppendDraft("/vault", account, "anna@example.org", "Entwurf", "<p>x</p>", [fileOf("a.bin", 1024)]);
    expect(mailboxCalls()).toEqual(["POST /me/messages"]);
    expect(JSON.parse(calls[calls.length - 1].body!).attachments).toHaveLength(1);
  });

  it("attaches each file on its own when they do not fit, and stays a draft", async () => {
    await graphAppendDraft("/vault", account, "anna@example.org", "Entwurf", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)]);
    expect(mailboxCalls()).toEqual(["POST /me/messages", "POST /me/messages/draft1/attachments", "POST /me/messages/draft1/attachments"]);
  });

  it("does not leave half a draft when a file is refused", async () => {
    refuse.set("POST /me/messages/draft1/attachments", 413);
    await expect(graphAppendDraft("/vault", account, "anna@example.org", "Entwurf", "<p>x</p>", [fileOf("a.bin", 2 * MB), fileOf("b.bin", 2 * MB)])).rejects.toThrow("413");
    expect(mailboxCalls().slice(-1)).toEqual(["DELETE /me/messages/draft1"]);
  });
});
