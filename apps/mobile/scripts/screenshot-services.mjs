/** Local service fixtures for the real mobile screens. No request is forwarded
 * to a provider, and every workspace uses newly generated, ephemeral keys. */
import { build } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join } from "node:path";

export async function workspaceFixtureStorage(vaultId) {
  const root = fileURLToPath(new URL("../../../packages/core", import.meta.url));
  const scratch = await mkdtemp(join(root, ".screenshot-runtime-"));
  if (dirname(scratch) !== root || !basename(scratch).startsWith(".screenshot-runtime-")) throw new Error("Invalid fixture scratch directory");
  try {
    await build({ configFile: false, root, logLevel: "error", build: {
      ssr: join(root, "src/index.ts"), outDir: scratch, emptyOutDir: false,
      rolldownOptions: { output: { format: "esm", entryFileNames: "runtime.mjs" } },
    } });
    const core = await import(pathToFileURL(join(scratch, "runtime.mjs")).href);
    const runtime = core.personalWorkspaceRuntime(await core.createPersonalWorkspaceBootstrap({
      ownerDisplayName: "Anna Beispiel", deviceDisplayName: "Pixel (Fixture)",
      platform: "android", minimumClientVersion: "0.8.2",
    }));
    const member = await core.inviteWorkspaceMember({ runtime, displayName: "Ben Beispiel", role: "Editor" });
    core.applyWorkspaceGovernanceUpdate(runtime, member);
    const group = await core.createWorkspaceGroup({ runtime, name: "Projektteam", memberIds: [runtime.memberId, member.memberId], role: "Editor" });
    core.applyWorkspaceGovernanceUpdate(runtime, group);
    const slice = core.createWorkspaceSlice({ runtime, name: "Team-Handbuch", definition: { kind: "folder", folder: "Team" }, materializedObjectIds: [] });
    runtime.policy = slice.policy;
    return {
      [`secret_workspace_runtime_mobile_${vaultId}`]: core.serializePersonalWorkspaceRuntime(runtime),
      [`workspace_status_mobile_${vaultId}`]: {
        version: 1, workspaceId: runtime.workspaceId,
        fingerprint: core.workspaceDocumentHash(runtime.genesis),
        deviceName: "Pixel (Fixture)", phase: "active", lastError: null,
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const FOLDERS = [
  ["inbox", "Posteingang"], ["archive", "Archiv"], ["deleteditems", "Papierkorb"],
  ["drafts", "Entwürfe"], ["sentitems", "Gesendet"], ["junkemail", "Junk-E-Mail"],
].map(([id, displayName]) => ({ id, displayName, childFolderCount: 0, unreadItemCount: id === "inbox" ? 1 : 0 }));

const MESSAGES = [
  { id: "fixture-3", subject: "Projektübersicht", conversationId: "project", bodyPreview: "Die neue Übersicht ist fertig.", isRead: false, hasAttachments: true },
  { id: "fixture-2", subject: "Re: Projektübersicht", conversationId: "project", bodyPreview: "Danke, ich habe die Termine ergänzt.", isRead: true, hasAttachments: false },
  { id: "fixture-1", subject: "Newsletter September", conversationId: "newsletter", bodyPreview: "Unsere Nachrichten aus dem September.", isRead: true, hasAttachments: false },
].map((m, i) => ({ ...m, from: { emailAddress: { name: "Ben Beispiel", address: "ben@example.org" } },
  toRecipients: [{ emailAddress: { name: "Anna Beispiel", address: "anna@example.org" } }],
  receivedDateTime: `2026-09-14T0${9 - i}:00:00Z`, flag: { flagStatus: "notFlagged" },
  body: { contentType: "text", content: `${m.bodyPreview}\n\nDie Projektplanung liegt im gemeinsamen Vault.\n\nViele Grüße\nBen` },
}));

/** The refresh token the fixture's own mailbox is seeded with (`screenshot-fixture.mjs`). */
export const FIXTURE_SIGN_IN = "local-fixture-only";

/**
 * The access token the fixture's token endpoint answers a sign-in with: the
 * fixture's own keeps the value it always had, every other gets one that
 * names it - so a request shows whose sign-in it travels with.
 */
export const fixtureAccessToken = (refreshToken) => (refreshToken === FIXTURE_SIGN_IN ? FIXTURE_SIGN_IN : `access-for:${refreshToken}`);

/** The file the third message carries, and what is in it. */
export const ATTACHMENT_TEXT = "Projektplan: Stand 14. September 26\n";
const FILE_ATTACHMENT = "#microsoft.graph.fileAttachment";
const DEFAULT_ATTACHMENTS = [{ id: "attachment-1", name: "Projektübersicht.txt", contentType: "text/plain", content: Buffer.from(ATTACHMENT_TEXT) }];

/** Install after the general external-request blocker: Playwright tries the
 * most recently registered matching route first. Unknown requests fail closed.
 *
 * `extra` adds messages to folders other than the inbox, by folder id
 * (`junkemail`, `archive` ...) - the inbox itself stays the three messages the
 * screenshot baseline counts. A list request with `$search` answers with the
 * messages whose subject or preview contains the term, like the server does;
 * `observed.searches` records what was asked. `POST /me/sendMail` is accepted
 * the way the server accepts it - 202, no body - and `observed.sent` keeps
 * what the mailbox was asked to send.
 *
 * `attachments` replaces the files of the message that carries one. Each is
 * `{ id, name, contentType, content?, size?, type?, failTimes? }`: `content`
 * (a Buffer) is what a request for the file answers with and gives the listed
 * size unless `size` says otherwise - a file listed large and never asked for
 * needs no content; `type` is its `@odata.type` (an Outlook item or a cloud
 * link has no bytes); `failTimes` makes the first requests for it fail.
 * `observed.attachmentFetches` records which files were asked for.
 *
 * A message that does not fit one request goes the way Microsoft describes
 * for several files - `POST /me/messages` (a draft), one
 * `POST .../attachments` per file, `POST .../send` - and arrives in
 * `observed.sent` like any other, marked `viaDraft`. `refuseSends` makes the
 * first sends fail with that HTTP status, either way.
 *
 * WHOSE sign-in a request travels with can be read back: the token endpoint
 * answers every sign-in with an access token of its own
 * (`fixtureAccessToken`) and hands the refresh token back unchanged, every
 * mailbox request is kept in `observed.requests` with the `Authorization` it
 * came with, and `observed.sentWith` holds the one of each message in
 * `observed.sent`. `signIns` names further accounts by their refresh token:
 * `{ [refreshToken]: { address, id?, messages? } }` - `/me` answers such a
 * token with that address, and `messages`, where given, is the inbox it sees
 * instead of the shared one. Graph answers `/me/...` for the account of the
 * token, whatever mailbox the app believes it is in; with one shared answer
 * for every token, two mailboxes could never be told apart here.
 *
 * The flagged list (`$filter=flag/flagStatus eq 'flagged'`) answers with the
 * flagged messages of the folder, after `flaggedDelay` milliseconds where
 * given; `observed.flaggedQueries` and `observed.flaggedAnswered` say when it
 * was asked and answered. `listDelay` slows the list of a folder down, by
 * folder id, read when the list is asked for (so a test can change it on the
 * way); `observed.listed` names each folder whose list has been answered.
 * `failList` makes the list of a folder fail, by folder id, with the given
 * status; `failListFor` every list of one sign-in, by its refresh token. */
export async function installMailFixture(context, { extra = {}, attachments = DEFAULT_ATTACHMENTS, refuseSends = { times: 0, status: 413 }, signIns = {}, flaggedDelay = 0, listDelay = {}, failList = {}, failListFor = {} } = {}) {
  const messages = structuredClone(MESSAGES);
  const files = attachments.map((file) => ({ ...file, failsLeft: file.failTimes ?? 0 }));
  const listed = (file) => ({ id: file.id, "@odata.type": file.type ?? FILE_ATTACHMENT, name: file.name, contentType: file.contentType, size: file.size ?? file.content?.length ?? 0 });
  const drafts = new Map();
  let refusalsLeft = refuseSends.times;
  const refused = () => {
    if (refusalsLeft <= 0) return null;
    refusalsLeft--;
    return { status: refuseSends.status, json: { error: { code: "RequestEntityTooLarge", message: "The request is larger than the mailbox takes." } } };
  };
  const others = Object.fromEntries(Object.entries(structuredClone(extra)).map(([folder, list]) => [folder, list.map((m, i) => ({
    from: { emailAddress: { name: "Ben Beispiel", address: "ben@example.org" } },
    toRecipients: [{ emailAddress: { name: "Anna Beispiel", address: "anna@example.org" } }],
    receivedDateTime: `2026-09-13T0${9 - i}:00:00Z`, flag: { flagStatus: "notFlagged" }, isRead: true, hasAttachments: false,
    bodyPreview: "", ...m,
  }))]));
  // The further accounts, by the access token their sign-in is answered with.
  const accounts = new Map(Object.entries(signIns).map(([refreshToken, account]) => [fixtureAccessToken(refreshToken), {
    id: account.id ?? `fixture-${account.address}`,
    address: account.address,
    inbox: account.messages ? account.messages.map((m, i) => ({
      from: { emailAddress: { name: "Ben Beispiel", address: "ben@example.org" } },
      toRecipients: [{ emailAddress: { address: account.address } }],
      receivedDateTime: `2026-09-12T0${9 - i}:00:00Z`, flag: { flagStatus: "notFlagged" }, isRead: true, hasAttachments: false,
      bodyPreview: "", body: { contentType: "text", content: m.bodyPreview ?? "" }, ...m,
    })) : null,
  }]));
  const everything = () => [...messages, ...Object.values(others).flat(), ...[...accounts.values()].flatMap(a => a.inbox ?? [])];
  const observed = { lists: 0, listed: [], bodies: 0, searches: [], flaggedQueries: [], flaggedAnswered: 0, sent: [], sentWith: [], attachmentFetches: [], tokenRefreshes: 0, tokenRequests: [], requests: [], unexpected: [] };
  await context.route("https://login.microsoftonline.com/**", async (route) => {
    if (!route.request().url().includes("/oauth2/v2.0/token")) return route.abort("blockedbyclient");
    observed.tokenRefreshes++;
    // Each sign-in is answered with an access token of its own, and keeps its
    // refresh token: handing every caller the fixture's own would rotate a
    // second mailbox onto the first one's sign-in.
    const refreshToken = new URLSearchParams(route.request().postData() ?? "").get("refresh_token") ?? FIXTURE_SIGN_IN;
    observed.tokenRequests.push(refreshToken);
    await route.fulfill({ json: { access_token: fixtureAccessToken(refreshToken), refresh_token: refreshToken, expires_in: 3600, token_type: "Bearer" } });
  });
  await context.route("https://graph.microsoft.com/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
    const authorization = request.headers().authorization ?? null;
    observed.requests.push({ method: request.method(), path, authorization });
    // The account the token belongs to; the fixture's own for every other.
    const account = accounts.get((authorization ?? "").replace(/^Bearer /, ""));
    if (request.method() === "GET") {
      if (path === "/me") {
        return route.fulfill({ json: account
          ? { id: account.id, mail: account.address, userPrincipalName: account.address, displayName: account.address }
          : { id: "fixture-anna", mail: "anna@example.org", userPrincipalName: "anna@example.org", displayName: "Anna Beispiel" } });
      }
      if (path === "/me/mailFolders") return route.fulfill({ json: { value: FOLDERS } });
      const folder = /^\/me\/mailFolders\/([^/]+)$/.exec(path);
      if (folder) return route.fulfill({ json: FOLDERS.find(f => f.id === folder[1]) ?? { id: folder[1], unreadItemCount: 0 } });
      const list = /^\/me\/mailFolders\/([^/]+)\/messages$/.exec(path);
      if (list) {
        const inFolder = list[1] === "inbox" ? account?.inbox ?? messages : others[list[1]] ?? [];
        const search = url.searchParams.get("$search");
        if (search !== null) {
          const term = search.replace(/^"|"$/g, "").toLowerCase();
          observed.searches.push({ folder: list[1], term });
          return route.fulfill({ json: { value: inFolder.filter(m => `${m.subject} ${m.bodyPreview}`.toLowerCase().includes(term)) } });
        }
        if (/flagStatus eq 'flagged'/.test(url.searchParams.get("$filter") ?? "")) {
          observed.flaggedQueries.push({ folder: list[1], authorization });
          if (flaggedDelay) await new Promise((done) => setTimeout(done, flaggedDelay));
          observed.flaggedAnswered++;
          return route.fulfill({ json: { value: inFolder.filter(m => m.flag?.flagStatus === "flagged") } });
        }
        observed.lists++;
        const failing = failList[list[1]] ?? Object.entries(failListFor).find(([token]) => authorization === `Bearer ${fixtureAccessToken(token)}`)?.[1];
        if (failing) return route.fulfill({ status: failing, json: { error: { code: "ServiceUnavailable", message: "The service is unavailable." } } });
        if (listDelay[list[1]]) await new Promise((done) => setTimeout(done, listDelay[list[1]]));
        observed.listed.push(list[1]);
        return route.fulfill({ json: { value: inFolder, "@odata.count": inFolder.length } });
      }
      if (path.endsWith("/messageRules")) return route.fulfill({ json: { value: [] } });
      const message = /^\/me\/messages\/([^/]+)$/.exec(path);
      if (message) {
        const item = everything().find(m => m.id === message[1]);
        if (item) { observed.bodies++; return route.fulfill({ json: item }); }
      }
      if (path.endsWith("/attachments")) return route.fulfill({ json: { value: files.map(listed) } });
      // One file's content - asked for by a forward, or by saving it.
      const one = /^\/me\/messages\/[^/]+\/attachments\/([^/]+)$/.exec(path);
      const file = one && files.find(f => f.id === one[1]);
      if (file) {
        observed.attachmentFetches.push(file.id);
        if (file.failsLeft > 0) {
          file.failsLeft--;
          return route.fulfill({ status: 503, json: { error: { code: "ServiceUnavailable", message: "The service is unavailable." } } });
        }
        return route.fulfill({ json: { ...listed(file), ...(file.content ? { contentBytes: file.content.toString("base64") } : {}) } });
      }
    }
    if (request.method() === "PATCH") {
      const item = everything().find(m => path === `/me/messages/${m.id}`);
      if (item) { Object.assign(item, request.postDataJSON()); return route.fulfill({ status: 204 }); }
    }
    if (request.method() === "POST" && path === "/me/sendMail") {
      const refusal = refused();
      if (refusal) return route.fulfill(refusal);
      observed.sent.push(request.postDataJSON());
      observed.sentWith.push(authorization);
      return route.fulfill({ status: 202, body: "" });
    }
    // The draft way: a draft, each file with a request of its own, then send.
    if (request.method() === "POST" && path === "/me/messages") {
      const id = `draft-${drafts.size + 1}`;
      drafts.set(id, { message: request.postDataJSON(), attachments: [] });
      return route.fulfill({ status: 201, json: { id } });
    }
    const step = /^\/me\/messages\/(draft-\d+)(?:\/(attachments|send))?$/.exec(path);
    const draft = step && drafts.get(step[1]);
    if (draft && request.method() === "POST" && step[2] === "attachments") {
      draft.attachments.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: `${step[1]}-file-${draft.attachments.length}` } });
    }
    if (draft && request.method() === "POST" && step[2] === "send") {
      const refusal = refused();
      if (refusal) return route.fulfill(refusal);
      drafts.delete(step[1]);
      observed.sent.push({ message: { ...draft.message, attachments: draft.attachments }, saveToSentItems: true, viaDraft: true });
      observed.sentWith.push(authorization);
      return route.fulfill({ status: 202, body: "" });
    }
    if (draft && request.method() === "DELETE" && !step[2]) {
      drafts.delete(step[1]);
      return route.fulfill({ status: 204, body: "" });
    }
    observed.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 501, json: { error: { message: "Unsupported local fixture request" } } });
  });
  return observed;
}
