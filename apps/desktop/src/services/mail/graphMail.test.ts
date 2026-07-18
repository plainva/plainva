// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Microsoft Graph mail adapter: pure outgoing transforms + request shaping
 * (URLs, bodies, folder-id resolution) against a fake fetch — mirrors how the
 * sync provider adapters are pinned. The OAuth loopback + native login are
 * verified by the maintainer (not reachable in the harness).
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
const calls: Call[] = [];

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body });
    if (url.includes("/me/mailFolders") && !url.includes("/messages")) {
      return json({ value: [{ id: "AAAinbox", displayName: "Inbox" }, { id: "BBBdrafts", displayName: "Drafts" }, { id: "CCCtrash", displayName: "Deleted Items" }] });
    }
    if (url.includes("/messages")) {
      return json({
        value: [
          { id: "AAMkmsg1==", subject: "Rechnung", from: { emailAddress: { name: "Anna", address: "anna@example.org" } }, receivedDateTime: "2026-07-20T09:00:00Z", isRead: false },
        ],
        "@odata.count": 1,
      });
    }
    if (url.endsWith("/sendMail")) return new Response("", { status: 202 });
    if (url.includes("/move")) return json({ id: "moved" });
    if (url.endsWith("/me/messages")) return json({ id: "draft1" });
    return json({});
  }),
}));

vi.mock("./mailAccounts", () => ({
  getMailRefreshToken: vi.fn(async () => "REFRESH"),
  saveMailRefreshToken: vi.fn(async () => {}),
}));

vi.mock("@plainva/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, refreshOneDriveAccessToken: vi.fn(async () => ({ accessToken: "ACCESS", expiresIn: 3600 })) };
});

import {
  toRecipients,
  graphAttachments,
  graphListFolders,
  graphListEnvelopes,
  graphSendMail,
  graphMove,
  forgetGraphMailRuntime,
} from "./graphMail";
import type { MailAccountConfig } from "./mailAccounts";

const account: MailAccountConfig = { id: "acc1", label: "me@outlook.com", host: "", port: 993, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };

beforeEach(() => {
  calls.length = 0;
  forgetGraphMailRuntime("acc1");
});

describe("graphMail pure transforms", () => {
  it("parses recipients from a comma/semicolon list, unwrapping Name <addr>", () => {
    expect(toRecipients("a@b.de, Max <max@c.de>; x@y.de")).toEqual([
      { emailAddress: { address: "a@b.de" } },
      { emailAddress: { address: "max@c.de" } },
      { emailAddress: { address: "x@y.de" } },
    ]);
    expect(toRecipients("  ")).toEqual([]);
  });

  it("shapes attachments as Graph fileAttachment payloads", () => {
    expect(graphAttachments([{ name: "a.pdf", mime: "application/pdf", contentBase64: "QUJD" }])).toEqual([
      { "@odata.type": "#microsoft.graph.fileAttachment", name: "a.pdf", contentType: "application/pdf", contentBytes: "QUJD" },
    ]);
  });
});

describe("graphMail request shaping", () => {
  it("lists folders by displayName and sends the bearer token", async () => {
    const boxes = await graphListFolders("/vault", account);
    expect(boxes.map((b) => b.name)).toEqual(["Inbox", "Drafts", "Deleted Items"]);
    const folderCall = calls.find((c) => c.url.includes("/me/mailFolders"));
    expect(folderCall?.headers.Authorization).toBe("Bearer ACCESS");
  });

  it("lists envelopes newest-first, resolving the folder id + $count header", async () => {
    const page = await graphListEnvelopes("/vault", account, "Inbox", 0, 50);
    expect(page.total).toBe(1);
    expect(page.messages[0]).toMatchObject({ id: "AAMkmsg1==", subject: "Rechnung", from: "Anna <anna@example.org>", seen: false });
    const msgCall = calls.find((c) => c.url.includes("/messages") && c.url.includes("$orderby"));
    expect(msgCall?.url).toContain("/me/mailFolders/AAAinbox/messages"); // "Inbox" resolved to its Graph id
    expect(msgCall?.url).toContain("$orderby=receivedDateTime desc");
    expect(msgCall?.headers.ConsistencyLevel).toBe("eventual"); // $count=true
  });

  it("sends via /me/sendMail with an HTML body and saveToSentItems", async () => {
    await graphSendMail("/vault", account, "b@c.de", "Hi", "<p>x</p>");
    const send = calls.find((c) => c.url.endsWith("/sendMail"));
    expect(send?.method).toBe("POST");
    const body = JSON.parse(send?.body ?? "{}");
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>x</p>" });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "b@c.de" } }]);
  });

  it("moves a message to a folder resolved by displayName", async () => {
    await graphMove("/vault", account, "Inbox", "AAMkmsg1==", "Deleted Items");
    const move = calls.find((c) => c.url.includes("/move"));
    expect(move?.method).toBe("POST");
    expect(JSON.parse(move?.body ?? "{}")).toEqual({ destinationId: "CCCtrash" });
  });
});
