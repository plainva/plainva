// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A file larger than one Graph request goes through an upload session
 * (Sammelplan § 3.95 Nr. 3), against a fake Graph that does what Microsoft's
 * reference says (https://learn.microsoft.com/en-us/graph/outlook-large-attachments):
 * `createUploadSession` on the draft answers an address on outlook.office.com,
 * each PUT of a range answers 200 with the next expected range, the last one
 * 201 Created. No real mailbox ever answered these requests.
 */

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}
const calls: Call[] = [];
const UPLOAD = "https://outlook.office.com/api/v2.0/Users('u')/Messages('draft1')/AttachmentSessions('s1')?authtoken=SESSION";
/** The bytes the fake session received, by offset. */
let received = new Map<number, Uint8Array>();
let sessionTotal = 0;
/** Per PUT (by count), an answer the fake gives instead of taking the range. */
let putFaults: Array<number | "throw" | null> = [];
let sessionRefusal: { status: number; code: string } | null = null;
let putCount = 0;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (out[k] = v));
  return out;
}

const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  calls.push({ method, url, headers: headersOf(init), body: init?.body });
  if (url === UPLOAD) {
    if (method === "DELETE") return new Response(null, { status: 204 });
    const fault = putFaults[putCount++] ?? null;
    if (fault === "throw") throw new Error("network down");
    if (typeof fault === "number") return json({ error: { message: "fault" } }, fault);
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headersOf(init)["content-range"] ?? "");
    if (!range) return json({ error: { message: "no range" } }, 400);
    const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
    const bytes = init?.body as Uint8Array;
    if (bytes.length !== end - start + 1 || total !== sessionTotal) return json({ error: { message: "bad range" } }, 416);
    received.set(start, bytes);
    if (end + 1 >= total) return new Response(null, { status: 201, headers: { Location: "https://outlook.office.com/api/v2.0/Attachments('A1')" } });
    return json({ nextExpectedRanges: [`${end + 1}-`] });
  }
  const path = decodeURIComponent(url.replace("https://graph.microsoft.com/v1.0", ""));
  if (method === "POST" && path === "/me/messages") return json({ id: "draft1" }, 201);
  if (method === "POST" && path === "/me/messages/draft1/attachments/createUploadSession") {
    if (sessionRefusal) return json({ error: { code: sessionRefusal.code, message: "refused" } }, sessionRefusal.status);
    sessionTotal = (JSON.parse(String(init?.body)) as { AttachmentItem: { size: number } }).AttachmentItem.size;
    return json({ uploadUrl: UPLOAD, expirationDateTime: "2026-10-30T12:00:00Z", nextExpectedRanges: ["0-"] }, 201);
  }
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
  GRAPH_DIRECT_FILE_LIMIT,
  GRAPH_FILE_LIMIT,
  GRAPH_UPLOAD_ATTEMPTS,
  GRAPH_UPLOAD_CHUNK,
  attachmentLimits,
  forgetGraphMailRuntime,
  graphAppendDraft,
  graphSendMail,
  mailErrorText,
  mailSecretKey,
  setGraphUploadBackoffForTests,
  setMailPlatform,
  type MailAccountConfig,
  type MailAttachment,
  type MailTransport,
} from "@plainva/ui/mail";
import { setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

const account: MailAccountConfig = { id: "acc1", label: "me@outlook.com", host: "", port: 993, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };
const secrets = new Map<string, unknown>();

beforeEach(() => {
  calls.length = 0;
  received = new Map();
  sessionTotal = 0;
  putFaults = [];
  putCount = 0;
  sessionRefusal = null;
  setGraphUploadBackoffForTests(() => 0);
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
  const transport = new Proxy({} as MailTransport, {
    get: () => () => {
      throw new Error("the Graph backend must not use the IMAP transport");
    },
  });
  setMailPlatform({ transport, http: { api: fakeFetch as unknown as typeof fetch, token: fakeFetch as unknown as typeof fetch } });
});
afterEach(() => setGraphUploadBackoffForTests(null));

const MB = 1024 * 1024;

/** A file whose every byte names its place, so a range in the wrong place shows. */
function patterned(name: string, size: number): { file: MailAttachment; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  let binary = "";
  for (let i = 0; i < size; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { file: { name, mime: "video/mp4", contentBase64: btoa(binary) }, bytes };
}

function reassembled(): Uint8Array {
  const out = new Uint8Array(sessionTotal);
  for (const [start, part] of received) out.set(part, start);
  return out;
}

const steps = () =>
  calls.map((c) => (c.url === UPLOAD ? `${c.method} session ${c.headers["content-range"] ?? ""}`.trim() : `${c.method} ${decodeURIComponent(c.url.replace("https://graph.microsoft.com/v1.0", ""))}`));

describe("a file over one request goes through an upload session", () => {
  it("sends a 5 MB file in ranges of 320 KiB multiples, in order, byte for byte, without the token", async () => {
    const { file, bytes } = patterned("Film.mp4", 5 * MB);
    const small = patterned("Notiz.md", 1024).file;

    await graphSendMail("/vault", account, "anna@example.org", "Film", "<p>x</p>", [small, file]);

    expect(GRAPH_UPLOAD_CHUNK % (320 * 1024)).toBe(0);
    expect(GRAPH_UPLOAD_CHUNK).toBeLessThan(4_000_000);
    const total = 5 * MB;
    expect(steps()).toEqual([
      "POST /me/messages",
      // The small file goes as before, in a request of its own …
      "POST /me/messages/draft1/attachments",
      // … the large one through a session on the same draft …
      "POST /me/messages/draft1/attachments/createUploadSession",
      `PUT session bytes 0-${GRAPH_UPLOAD_CHUNK - 1}/${total}`,
      `PUT session bytes ${GRAPH_UPLOAD_CHUNK}-${total - 1}/${total}`,
      // … and then the draft is sent.
      "POST /me/messages/draft1/send",
    ]);
    const session = calls.find((c) => c.url.endsWith("/createUploadSession"))!;
    expect(JSON.parse(String(session.body))).toEqual({ AttachmentItem: { attachmentType: "file", name: "Film.mp4", size: total, contentType: "video/mp4" } });
    expect(Buffer.from(reassembled()).equals(Buffer.from(bytes))).toBe(true);
    // The session's address carries its own authorisation: the token never goes to outlook.office.com.
    for (const put of calls.filter((c) => c.url === UPLOAD)) {
      expect(put.headers.authorization).toBeUndefined();
      expect(put.headers["content-type"]).toBe("application/octet-stream");
    }
  });

  it("follows the range the session says it expects next", async () => {
    const { file, bytes } = patterned("Film.mp4", 4 * MB);
    // The first PUT answers as if the service had kept only the first 1 MB of it.
    const original = fakeFetch.getMockImplementation()!;
    let first = true;
    fakeFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === UPLOAD && init?.method === "PUT" && first) {
        first = false;
        calls.push({ method: "PUT", url, headers: headersOf(init), body: init.body });
        received.set(0, (init.body as Uint8Array).subarray(0, MB));
        return json({ nextExpectedRanges: [`${MB}-`] });
      }
      return original(url, init);
    });
    try {
      await graphSendMail("/vault", account, "anna@example.org", "Film", "<p>x</p>", [file]);
    } finally {
      fakeFetch.mockImplementation(original);
    }
    expect(steps().filter((s) => s.startsWith("PUT"))).toEqual([
      `PUT session bytes 0-${GRAPH_UPLOAD_CHUNK - 1}/${4 * MB}`,
      `PUT session bytes ${MB}-${4 * MB - 1}/${4 * MB}`,
    ]);
    expect(Buffer.from(reassembled()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("tries a range again after a server error, throttling or no answer at all", async () => {
    const { file, bytes } = patterned("Film.mp4", 4 * MB);
    putFaults = [503, "throw", 429, null];
    await graphSendMail("/vault", account, "anna@example.org", "Film", "<p>x</p>", [file]);
    expect(steps().filter((s) => s.startsWith("PUT"))).toEqual([
      ...Array(4).fill(`PUT session bytes 0-${GRAPH_UPLOAD_CHUNK - 1}/${4 * MB}`),
      `PUT session bytes ${GRAPH_UPLOAD_CHUNK}-${4 * MB - 1}/${4 * MB}`,
    ]);
    expect(Buffer.from(reassembled()).equals(Buffer.from(bytes))).toBe(true);
    expect(steps().slice(-1)).toEqual(["POST /me/messages/draft1/send"]);
  });

  it("refuses the send after the last try: the session is cancelled, the draft discarded, the reason names the file", async () => {
    const { file } = patterned("Film.mp4", 4 * MB);
    putFaults = Array(GRAPH_UPLOAD_ATTEMPTS).fill(503);
    const sending = graphSendMail("/vault", account, "anna@example.org", "Film", "<p>x</p>", [file]);
    await expect(sending).rejects.toThrow(/Film\.mp4/);
    expect(steps().slice(-2)).toEqual(["DELETE session", "DELETE /me/messages/draft1"]);
    expect(steps()).not.toContain("POST /me/messages/draft1/send");
    expect(steps().filter((s) => s.startsWith("PUT"))).toHaveLength(GRAPH_UPLOAD_ATTEMPTS);
    // What the composer's notice reads.
    const error = await sending.catch((e: unknown) => e);
    expect(mailErrorText(error, (key, opts) => i18n.t(key, opts))).toBe(i18n.t("mail.sendUploadFailed", { name: "Film.mp4" }));
    expect(i18n.t("mail.sendUploadFailed", { name: "Film.mp4" })).toContain("Film.mp4");
  });

  it("does not try again what cannot go better: a refused range ends the send at once", async () => {
    const { file } = patterned("Film.mp4", 4 * MB);
    putFaults = [403];
    await expect(graphSendMail("/vault", account, "anna@example.org", "Film", "<p>x</p>", [file])).rejects.toThrow("403");
    expect(steps().filter((s) => s.startsWith("PUT"))).toHaveLength(1);
    expect(steps().slice(-2)).toEqual(["DELETE session", "DELETE /me/messages/draft1"]);
  });

  it("sends a file the session finds too small for itself in one request after all", async () => {
    const { file } = patterned("knapp.bin", GRAPH_DIRECT_FILE_LIMIT + 1024);
    sessionRefusal = { status: 400, code: "ErrorAttachmentSizeShouldNotBeLessThanMinimumSize" };
    await graphSendMail("/vault", account, "anna@example.org", "x", "<p>x</p>", [file]);
    expect(steps()).toEqual([
      "POST /me/messages",
      "POST /me/messages/draft1/attachments/createUploadSession",
      "POST /me/messages/draft1/attachments",
      "POST /me/messages/draft1/send",
    ]);
  });

  it("files a draft with a large file the same way, and keeps it a draft", async () => {
    const { file, bytes } = patterned("Film.mp4", 4 * MB);
    await graphAppendDraft("/vault", account, "anna@example.org", "Entwurf", "<p>x</p>", [file]);
    expect(steps()).toEqual([
      "POST /me/messages",
      "POST /me/messages/draft1/attachments/createUploadSession",
      `PUT session bytes 0-${GRAPH_UPLOAD_CHUNK - 1}/${4 * MB}`,
      `PUT session bytes ${GRAPH_UPLOAD_CHUNK}-${4 * MB - 1}/${4 * MB}`,
    ]);
    expect(Buffer.from(reassembled()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("holds a Microsoft mailbox's files against 150 MB, no longer against one request", () => {
    expect(GRAPH_FILE_LIMIT).toBe(150 * MB);
    expect(attachmentLimits(account).perFile).toBe(GRAPH_FILE_LIMIT);
  });
});
