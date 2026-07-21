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
    // Well-known folder lookup (single folder, id only) — Graph answers these
    // regardless of the mailbox language.
    const wellKnown = url.match(/\/me\/mailFolders\/([a-z]+)\?\$select=id$/);
    if (wellKnown) {
      const id = { inbox: "AAAinbox", drafts: "BBBdrafts", deleteditems: "CCCtrash" }[wellKnown[1]];
      return id ? json({ id }) : json({ error: "not found" }, 404);
    }
    // Child folders of "Projekte" (id PPP) — nested reachability.
    if (url.includes("/mailFolders/PPP/childFolders")) {
      return json({ value: [{ id: "KKK", displayName: "Kunde A", childFolderCount: 0 }] });
    }
    if (url.includes("/childFolders")) return json({ value: [] });
    if (url.includes("/me/mailFolders") && !url.includes("/messages")) {
      // A GERMAN mailbox — the real-world case that broke the IMAP-flavored
      // "INBOX" lookup (maintainer report 2026-07-20). Paginated across two
      // pages to pin the @odata.nextLink follow.
      if (url.includes("$skiptoken=page2")) {
        return json({ value: [{ id: "CCCtrash", displayName: "Gelöschte Elemente", childFolderCount: 0 }] });
      }
      return json({
        value: [
          { id: "AAAinbox", displayName: "Posteingang", childFolderCount: 0 },
          { id: "BBBdrafts", displayName: "Entwürfe", childFolderCount: 0 },
          { id: "PPP", displayName: "Projekte", childFolderCount: 1 },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName,childFolderCount&$top=100&$skiptoken=page2",
      });
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
  graphSetFlagged,
  graphDeleteMessage,
  graphListFlaggedEnvelopes,
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
  it("lists folders across pages + child folders, with the backend-stated role", async () => {
    const boxes = await graphListFolders("/vault", account);
    // Page 1 + page 2 (nextLink) + the nested child of "Projekte". Graph nests
    // with "/", stated so the UI splits labels at that separator.
    expect(boxes).toEqual([
      { name: "Posteingang", role: "inbox", delimiter: "/" },
      { name: "Entwürfe", role: "drafts", delimiter: "/" },
      { name: "Projekte", role: undefined, delimiter: "/" },
      { name: "Gelöschte Elemente", role: "trash", delimiter: "/" },
      { name: "Projekte/Kunde A", role: undefined, delimiter: "/" },
    ]);
    const folderCall = calls.find((c) => c.url.includes("/me/mailFolders"));
    expect(folderCall?.headers.Authorization).toBe("Bearer ACCESS");
    // The nested folder resolves by its full path for a subsequent list.
    await graphListEnvelopes("/vault", account, "Projekte/Kunde A", 0, 10);
    const nested = calls.find((c) => c.url.includes("/mailFolders/KKK/messages"));
    expect(nested).toBeTruthy();
  });

  it("resolves the IMAP role name INBOX to Graph's well-known folder WITHOUT a lookup", async () => {
    // The reported failure: a German mailbox has no folder called "INBOX", so
    // the displayName lookup threw "Graph mail folder not found: INBOX".
    const page = await graphListEnvelopes("/vault", account, "INBOX", 0, 50);
    expect(page.total).toBe(1);
    const msgCall = calls.find((c) => c.url.includes("/messages") && c.url.includes("$orderby"));
    expect(msgCall?.url).toContain("/me/mailFolders/inbox/messages");
    // No folder listing was needed to get there.
    expect(calls.some((c) => c.url.includes("$select=id,displayName"))).toBe(false);
  });

  it("lists envelopes newest-first, resolving a real folder name to its id", async () => {
    const page = await graphListEnvelopes("/vault", account, "Posteingang", 0, 50);
    expect(page.total).toBe(1);
    expect(page.messages[0]).toMatchObject({ id: "AAMkmsg1==", subject: "Rechnung", from: "Anna <anna@example.org>", seen: false });
    const msgCall = calls.find((c) => c.url.includes("/messages") && c.url.includes("$orderby"));
    expect(msgCall?.url).toContain("/me/mailFolders/AAAinbox/messages"); // resolved to its Graph id
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
    await graphMove("/vault", account, "Posteingang", "AAMkmsg1==", "Gelöschte Elemente");
    const move = calls.find((c) => c.url.includes("/move"));
    expect(move?.method).toBe("POST");
    expect(JSON.parse(move?.body ?? "{}")).toEqual({ destinationId: "CCCtrash" });
  });

  it("flags, lists flagged, and permanently deletes through Graph", async () => {
    await graphSetFlagged("/vault", account, "INBOX", "AAMkmsg1==", true);
    const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/me/messages/AAMkmsg1%3D%3D"));
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ flag: { flagStatus: "flagged" } });

    const flagged = await graphListFlaggedEnvelopes("/vault", account, "INBOX");
    expect(flagged[0]).toMatchObject({ id: "AAMkmsg1==", flagged: false });
    const list = calls.find((c) => c.url.includes("flag%2FflagStatus") || c.url.includes("flag/flagStatus"));
    expect(list?.url).toContain("$filter=");

    await graphDeleteMessage("/vault", account, "INBOX", "AAMkmsg1==");
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/me/messages/AAMkmsg1%3D%3D"))).toBe(true);
  });

  it("moves via the well-known name when the caller passes a role name", async () => {
    await graphMove("/vault", account, "INBOX", "AAMkmsg1==", "Trash");
    const move = calls.find((c) => c.url.includes("/move"));
    expect(JSON.parse(move?.body ?? "{}")).toEqual({ destinationId: "deleteditems" });
  });
});
