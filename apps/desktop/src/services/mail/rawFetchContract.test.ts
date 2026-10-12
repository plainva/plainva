import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * One raw message, three ways to get it — and one reader (finding 2026-10-09).
 *
 * "+ .eml" stores a message as the server holds it. `fetchRawMessage` promises
 * the original as base64, and three transports stand behind it: the desktop's
 * Rust command (`mail_fetch_raw`), Microsoft Graph (`/$value`) and the phone's
 * socket client. Two kept the promise. The third returned the message as a
 * decoded text, and `saveEmlFile`, which decodes base64, failed with "Invalid
 * character" — on the phone, on an IMAP mailbox, after the note had been
 * written.
 *
 * So the three are held together here: the same bytes in, the same base64 out,
 * and the same file on disk. The bytes are a mail no text decoder leaves alone
 * — UTF-8, a lone Latin-1 byte, a NUL and a bare line feed. `mail_imap.rs` pins
 * the same bytes and the same base64 for the Rust side
 * (`raw_message_is_standard_base64_of_the_untouched_bytes`): what this file
 * hands the desktop transport as the command's answer is what that test proves
 * the command gives.
 */

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: async () => new Response("") }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: async () => new Response("") }));
vi.mock("@plainva/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, refreshOneDriveAccessToken: vi.fn(async () => ({ accessToken: "ACCESS", expiresIn: 3600 })) };
});

import { setPlatformServices } from "@plainva/ui";
import {
  createSocketMailTransport,
  fetchRawMessage,
  forgetGraphMailRuntime,
  mailSecretKey,
  releaseSocketSessions,
  saveEmlFile,
  setMailPlatform,
  setMailSocket,
  type MailAccountConfig,
  type MailCaptureAdapter,
  type MailHttp,
  type MailSocket,
  type MailTransport,
} from "@plainva/ui/mail";
import { tauriMailTransport } from "./tauriMailTransport";

const ORIGINAL: Uint8Array = Buffer.from("Subject: Gr\xc3\xbc\xc3\x9fe\r\n\r\nM\xfcnchen \x00 \xff\n", "latin1");
/** Standard alphabet (the "/" would be "_" in the URL-safe one), padded, no line breaks. */
const BASE64 = "U3ViamVjdDogR3LDvMOfZQ0KDQpN/G5jaGVuIAAg/wo=";

const imapAccount: MailAccountConfig = { id: "imap1", label: "me@example.org", host: "imap.example.org", port: 993, user: "me@example.org" };
const graphAccount: MailAccountConfig = { id: "ms1", label: "me@outlook.com", host: "", port: 993, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };

/** The least IMAP server that hands out one message: OK to everything, and a
 * FETCH answered with the message as a counted literal. */
function oneMessageServer(raw: Uint8Array): MailSocket {
  const queue: Buffer[] = [Buffer.from("* OK ready\r\n")];
  return {
    open: async () => "s1",
    startTls: async () => {},
    write: async (_id, dataBase64) => {
      for (const line of Buffer.from(dataBase64, "base64").toString("latin1").split("\r\n")) {
        const tag = line.split(" ")[0];
        if (!tag) continue;
        if (line.includes(" UID FETCH ")) {
          queue.push(Buffer.concat([Buffer.from(`* 1 FETCH (UID 7 BODY[] {${raw.length}}\r\n`), Buffer.from(raw), Buffer.from(`)\r\n${tag} OK done\r\n`)]));
        } else {
          queue.push(Buffer.from(`${tag} OK done\r\n`));
        }
      }
    },
    read: async () => queue.shift()?.toString("base64") ?? "",
    close: async () => {},
  };
}

const noHttp: MailHttp = {
  api: (async () => { throw new Error("this transport makes no HTTP request"); }) as typeof fetch,
  token: (async () => { throw new Error("this transport makes no HTTP request"); }) as typeof fetch,
};
const noImap = new Proxy({} as MailTransport, {
  get: () => () => { throw new Error("the Graph backend must not use the IMAP transport"); },
});

/** Each way as the app reaches it: the platform it registers, and the account that selects it. */
const WAYS: Array<{ name: string; account: MailAccountConfig; id: string; register: () => void }> = [
  {
    name: "the phone's socket client (IMAP)",
    account: imapAccount,
    id: "7",
    register: () => {
      setMailSocket(oneMessageServer(ORIGINAL));
      setMailPlatform({ transport: createSocketMailTransport(), http: noHttp });
    },
  },
  {
    name: "the desktop's Rust command (IMAP)",
    account: imapAccount,
    id: "7",
    register: () => {
      // The command's answer for these bytes — the string its own test pins.
      tauri.invoke.mockImplementation(async (command: string) => {
        if (command === "mail_fetch_raw") return BASE64;
        throw new Error(`unexpected command ${command}`);
      });
      setMailPlatform({ transport: tauriMailTransport, http: noHttp });
    },
  },
  {
    name: "Microsoft Graph",
    account: graphAccount,
    id: "AAMk-raw-1",
    register: () => {
      const api = (async (url: string) => {
        if (!String(url).endsWith("/me/messages/AAMk-raw-1/$value")) throw new Error(`unexpected request ${url}`);
        return new Response(Buffer.from(ORIGINAL), { status: 200, headers: { "content-type": "text/plain" } });
      }) as unknown as typeof fetch;
      setMailPlatform({ transport: noImap, http: { api, token: api } });
    },
  },
];

describe("the raw message, by every way it can be fetched", () => {
  const secrets = new Map<string, unknown>();

  beforeEach(async () => {
    await releaseSocketSessions();
    setMailSocket(null);
    tauri.invoke.mockReset();
    forgetGraphMailRuntime("/vault", graphAccount.id);
    secrets.clear();
    secrets.set(mailSecretKey("/vault", imapAccount.id), { pass: "app-pw" });
    secrets.set(mailSecretKey("/vault", graphAccount.id), { refreshToken: "REFRESH" });
    setPlatformServices({
      loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
      credentials: {
        readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
        writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, value); },
        removeSecret: async (key: string) => { secrets.delete(key); },
      },
      openExternal: async () => {},
    });
  });

  it("the fixture is the base64 it claims to be, and no text", () => {
    expect(Buffer.from(ORIGINAL).toString("base64")).toBe(BASE64);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(ORIGINAL)).toThrow();
  });

  it.each(WAYS)("$name answers with base64 of the bytes, and the .eml is the original", async ({ account, id, register }) => {
    register();
    const raw = await fetchRawMessage("/vault", account, "INBOX", id);

    const files = new Map<string, Uint8Array>();
    const adapter: MailCaptureAdapter = {
      readTextFile: async () => "",
      writeTextFile: async () => {},
      writeBinaryFile: async (path, data) => {
        files.set(path, data);
      },
      exists: async (path) => files.has(path),
      createDir: async () => {},
    };
    // What "+ .eml" does with the answer.
    const path = await saveEmlFile(adapter, { subject: "Grüße", dateTs: Date.UTC(2026, 6, 1, 12) }, raw, "Mail");
    expect(Buffer.from(files.get(path) ?? []).equals(Buffer.from(ORIGINAL))).toBe(true);
    expect(raw).toBe(BASE64);
  });

  it("the desktop transport passes the command's answer on as it is", async () => {
    tauri.invoke.mockResolvedValue(BASE64);
    const answer = await tauriMailTransport.fetchRaw({ host: "imap.example.org", port: 993, user: "me@example.org", pass: "app-pw" }, { mailbox: "INBOX", uid: 7 });
    expect(answer).toBe(BASE64);
    expect(tauri.invoke).toHaveBeenCalledWith("mail_fetch_raw", { host: "imap.example.org", port: 993, user: "me@example.org", pass: "app-pw", mailbox: "INBOX", uid: 7 });
  });
});
