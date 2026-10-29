import { describe, expect, it, vi } from "vitest";
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "vault" }) }));
import { connectAccessPlan, presetById, type CloudProviderFamily, type CloudServiceId } from "@plainva/ui";
import { phoneConnectRequest, requestServices, type ConnectFormValues } from "./connectForm";
import { probeConnectServices, type ProbeState } from "./connectProbe";
import { buildQueue } from "./connectQueue";

/**
 * The phone's one form of the sign-in step (settings plan 2026-10-29, E5):
 * one credential for every chosen service of a provider, read the way the
 * desktop wizard reads it, and every service trying it on its own.
 */

function request(family: CloudProviderFamily, services: CloudServiceId[], values: ConnectFormValues, otherOpen = false, flavor?: "nextcloud") {
  const plan = connectAccessPlan({ family, flavor, services, providerName: family, preset: family === "imap" ? presetById(values.mailProvider ?? "") ?? null : null });
  return phoneConnectRequest({ family, flavor, services, plan, values, otherOpen });
}

describe("one form for every chosen service", () => {
  it("Fastmail: the address and the app password reach all three services, at the catalog's endpoints", () => {
    const r = request("fastmail", ["files", "calendar", "mail"], { email: " ada@fastmail.com ", secret: "pw" });
    expect(r.files).toEqual({ provider: "webdav", creds: { url: "https://webdav.fastmail.com", user: "ada@fastmail.com", pass: "pw" } });
    expect(r.caldav).toEqual({ url: "https://caldav.fastmail.com", user: "ada@fastmail.com", pass: "pw" });
    expect(r.imap).toMatchObject({ email: "ada@fastmail.com", host: "imap.fastmail.com", port: 993, pass: "pw" });
    expect(requestServices(r)).toEqual(["files", "calendar", "mail"]);
  });

  it("Fastmail with the endpoints opened under 'Other sign-in': what was typed there counts", () => {
    const r = request("fastmail", ["files", "mail"], { email: "ada@fastmail.com", secret: "pw", filesUrl: "https://dav.mine.example/", imapHost: "imap.mine.example", imapPort: "143" }, true);
    expect(r.files).toEqual({ provider: "webdav", creds: { url: "https://dav.mine.example/", user: "ada@fastmail.com", pass: "pw" } });
    expect(r.imap).toMatchObject({ host: "imap.mine.example", port: 143 });
    expect(r.caldav).toBeUndefined();
  });

  it("Nextcloud: one address gives both endpoints; opened, the endpoints replace it", () => {
    const base = request("webdav", ["files", "calendar"], { server: "https://cloud.example.com", user: "ada", secret: "pw" }, false, "nextcloud");
    expect(base.files?.provider === "webdav" && base.files.creds.url).toContain("/remote.php/dav/files/ada");
    expect(base.caldav?.url).toContain("/remote.php/dav");
    const own = request("webdav", ["files"], { server: "https://ignored.example", user: "ada", secret: "pw", filesUrl: "https://dav.example/files/ada/" }, true, "nextcloud");
    expect(own.files).toEqual({ provider: "webdav", creds: { url: "https://dav.example/files/ada/", user: "ada", pass: "pw" } });
  });

  it("WebDAV of one's own: the addresses as typed, full-width forms folded", () => {
    const r = request("webdav", ["files", "calendar"], { filesUrl: "https：//dav.example/files/", caldavUrl: "https://dav.example/cal/", user: "ada", secret: "pw" });
    expect(r.files?.provider === "webdav" && r.files.creds.url).toBe("https://dav.example/files/");
    expect(r.caldav?.url).toBe("https://dav.example/cal/");
  });

  it("S3: the keys, region and path style defaulting as on the desktop", () => {
    const r = request("s3", ["files"], { endpoint: "https://s3.example", bucket: "notes", accessKeyId: "AKIA1", secret: "s" });
    expect(r.files).toEqual({ provider: "s3", creds: { endpoint: "https://s3.example", region: "us-east-1", bucket: "notes", accessKeyId: "AKIA1", secretAccessKey: "s", prefix: undefined, forcePathStyle: true } });
    const off = request("s3", ["files"], { endpoint: "https://s3.example", bucket: "notes", accessKeyId: "AKIA1", secret: "s", pathStyle: "off", region: "eu-1", prefix: "vault" }, true);
    expect(off.files?.provider === "s3" && off.files.creds).toMatchObject({ forcePathStyle: false, region: "eu-1", prefix: "vault" });
  });

  it("IMAP: a server of one's own", () => {
    const r = request("imap", ["mail"], { email: "ada@mine.example", imapHost: "imap.mine.example", imapPort: "993", smtpHost: "smtp.mine.example", smtpPort: "587", secret: "pw" });
    expect(r.imap).toEqual({ email: "ada@mine.example", host: "imap.mine.example", port: 993, smtpHost: "smtp.mine.example", smtpPort: 587, pass: "pw" });
  });
});

describe("every service tries the credential on its own", () => {
  it("a calendar the server turns away does not stop the mailbox after it", async () => {
    const r = request("fastmail", ["files", "calendar", "mail"], { email: "ada@fastmail.com", secret: "pw" });
    const states: Array<[CloudServiceId, ProbeState["state"]]> = [];
    const refused = new Error("401 Unauthorized");
    const result = await probeConnectServices(r, ["files", "calendar", "mail"], {
      listFiles: async () => [],
      findCalendars: async () => { throw refused; },
      checkMail: async () => [],
    }, (service, state) => states.push([service, state.state]));
    expect(result).toEqual({ ok: ["files", "mail"], failed: ["calendar"] });
    expect(states).toEqual([["files", "pending"], ["files", "ok"], ["calendar", "pending"], ["calendar", "error"], ["mail", "pending"], ["mail", "ok"]]);
  });
});

describe("a run that starts before its sign-in", () => {
  it("carries signedIn false, the Nextcloud name and the new vault's template; a failed service goes in as skipped", () => {
    const q = buildQueue("webdav", ["files", "calendar"], 1, { vaultId: "v" }, { signedIn: false, flavor: "nextcloud", createTemplateId: "", skipped: ["calendar"] })!;
    expect(q.signedIn).toBe(false);
    expect(q.flavor).toBe("nextcloud");
    expect(q.createTemplateId).toBe("");
    expect(q.pending).toEqual(["files"]);
    expect(q.skipped).toEqual(["calendar"]);
    // Google and Microsoft runs start after their sign-in: no field, signed in.
    expect(buildQueue("google", ["files"], 1)!.signedIn).toBeUndefined();
  });
});
