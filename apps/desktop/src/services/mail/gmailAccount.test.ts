import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_MAIL_SCOPES, plainvaGoogleClient, type CloudAccountRecord, type StoredAccountToken } from "@plainva/ui";
const state = vi.hoisted(() => ({ mailboxes: [] as import("@plainva/ui/mail").MailAccountConfig[], saveMail: vi.fn(), check: vi.fn() }));
vi.mock("../../../../../packages/ui/src/mail/mailAccounts", () => ({ listMailAccounts: async () => state.mailboxes, saveBrokerMailAccount: state.saveMail }));
vi.mock("../../../../../packages/ui/src/mail/transport", () => ({ mailTransport: () => ({ checkLogin: state.check }) }));
import { completeGmailSignIn } from "../../../../../packages/ui/src/mail/gmailAccount";
const source: CloudAccountRecord = { id: "account", family: "google", label: "person@example.test", verifiedProviderIdentity: { issuer: "google", subject: "subject" }, services: { calendar: { pimAccountId: "calendar" } } };
const token: StoredAccountToken = { clientId: "desktop-client", clientSecret: "installed-client-value", refreshToken: "refresh", scopes: GOOGLE_MAIL_SCOPES };
function ports() {
  let records = structuredClone([source]);
  return { read: vi.fn(async () => structuredClone(records)), write: vi.fn(async (next: CloudAccountRecord[]) => { records = structuredClone(next); }), saveGrant: vi.fn(), fetch: vi.fn(async () => Response.json({ sub: "subject", email: "person@example.test", email_verified: true })) };
}
beforeEach(() => { state.mailboxes = []; state.saveMail.mockReset(); state.check.mockReset().mockResolvedValue([{ name: "INBOX" }]); });
describe("Gmail account adoption", () => {
  it("adds verified mail to a calendar account only after checking mail access", async () => {
    const p = ports();
    p.saveGrant.mockImplementation(async () => expect(state.check).toHaveBeenCalled());
    const result = await completeGmailSignIn("vault", token, "access", p, source);
    expect(result.services.calendar).toEqual(source.services.calendar);
    expect(result.services.mail).toBeDefined();
    expect(state.saveMail).toHaveBeenCalledWith("vault", expect.objectContaining({ kind: "gmail", smtpHost: "smtp.gmail.com", user: source.label }), "connect");
    expect(p.saveGrant).toHaveBeenCalledWith(source.id, expect.objectContaining({ providerIdentity: source.verifiedProviderIdentity, scopes: GOOGLE_MAIL_SCOPES }));
  });
  it("preserves all existing services after the user selects another Google identity", async () => {
    const p = ports(); p.fetch.mockResolvedValueOnce(Response.json({ sub: "other", email: "other@example.test", email_verified: true }));
    await expect(completeGmailSignIn("vault", token, "access", p, source)).rejects.toThrow("different provider account");
    expect(p.saveGrant).not.toHaveBeenCalled(); expect(state.saveMail).not.toHaveBeenCalled();
  });
  it("never rebinds mail after failed grant persistence or a deleted account", async () => {
    const p = ports(); p.saveGrant.mockRejectedValueOnce(new Error("secure store unavailable"));
    await expect(completeGmailSignIn("vault", token, "access", p, source)).rejects.toThrow("secure store");
    expect(state.saveMail).not.toHaveBeenCalled();
    p.read.mockResolvedValueOnce([source]).mockResolvedValueOnce([]);
    await expect(completeGmailSignIn("vault", token, "access", p, source)).rejects.toThrow("account changed");
    expect(state.saveMail).not.toHaveBeenCalled();
  });
  it("keeps app-password mail intact instead of converting it without a separate decision", async () => {
    const p = ports(); state.mailboxes = [{ id: "password-mail", kind: "imap", host: "imap.gmail.com", port: 993, user: source.label, label: "Legacy" }];
    const old = { ...source, services: { ...source.services, mail: { mailAccountId: "password-mail" } } };
    p.read.mockResolvedValue([old]);
    await expect(completeGmailSignIn("vault", token, "access", p, old)).rejects.toThrow("own sign-in");
    expect(p.saveGrant).not.toHaveBeenCalled(); expect(state.saveMail).not.toHaveBeenCalled();
  });
  it("resumes an interrupted registry write with the same account and mailbox identifiers", async () => {
    const p = ports();
    state.saveMail.mockImplementation(async (_vault, mailbox) => { state.mailboxes = [mailbox]; });
    p.write.mockRejectedValueOnce(new Error("registry unavailable"));
    await expect(completeGmailSignIn("vault", token, "access", p, source)).rejects.toThrow("registry unavailable");
    const firstId = state.mailboxes[0].id;
    const result = await completeGmailSignIn("vault", token, "access", p, source);
    expect(result.services.mail?.mailAccountId).toBe(firstId);
    expect(p.saveGrant.mock.calls.map(call => call[0])).toEqual([source.id, source.id]);
  });
  it("recognizes a completed mailbox binding when the caller resumes after its acknowledgement was lost", async () => {
    const p = ports();
    state.saveMail.mockImplementation(async (_vault, mailbox) => { state.mailboxes = [mailbox]; });
    const first = await completeGmailSignIn("vault", token, "access", p, source);
    const replay = await completeGmailSignIn("vault", token, "access", p, source);
    expect(replay.services).toEqual(first.services);
  });
  it("ships a client exactly when the build is configured with one, whatever the publishing state", () => {
    const env = { VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: "123-test.apps.googleusercontent.com" };
    for (const state of [undefined, "testing", "production"]) {
      expect(plainvaGoogleClient({ ...env, VITE_PLAINVA_GOOGLE_MAIL_STATE: state }, "ios")).toEqual({ clientId: "123-test.apps.googleusercontent.com" });
    }
    expect(plainvaGoogleClient(env, "android")).toBeNull();
    expect(plainvaGoogleClient({ ...env, VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: "" }, "ios")).toBeNull();
    expect(plainvaGoogleClient({ VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_ID: "d.apps.googleusercontent.com" }, "desktop"), "a Desktop client needs its secret").toBeNull();
    expect(plainvaGoogleClient({}, "desktop")).toBeNull();
  });
});
