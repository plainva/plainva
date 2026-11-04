import type { CloudServiceId } from "@plainva/ui";
import type { PhoneConnectRequest } from "./connectForm";

/**
 * The sign-in of a provider with credentials or keys, service by service
 * (settings plan 2026-10-29, § 5.1, step 4): each chosen service tries the
 * one credential on its own server and says its own result, and a calendar
 * the server turns away does not stop the mailbox after it. Nothing is bound
 * here - the run's steps bind each service with what proved to work.
 */

export type ProbeState = { state: "pending" } | { state: "ok" } | { state: "error"; error: unknown };

export interface ConnectProbePorts {
  /** Files: list the root of the WebDAV or S3 target. */
  listFiles(target: NonNullable<PhoneConnectRequest["files"]>): Promise<unknown>;
  /** Calendar: find the calendars behind the CalDAV address. */
  findCalendars(creds: NonNullable<PhoneConnectRequest["caldav"]>): Promise<unknown>;
  /** Mail: sign in to the IMAP server. */
  checkMail(imap: NonNullable<PhoneConnectRequest["imap"]>): Promise<unknown>;
}

export async function probeConnectServices(
  request: PhoneConnectRequest,
  services: readonly CloudServiceId[],
  ports: ConnectProbePorts,
  onState: (service: CloudServiceId, state: ProbeState) => void,
): Promise<{ ok: CloudServiceId[]; failed: CloudServiceId[] }> {
  const ok: CloudServiceId[] = [];
  const failed: CloudServiceId[] = [];
  for (const service of services) {
    onState(service, { state: "pending" });
    try {
      if (service === "files") {
        if (!request.files) throw new Error("missing files address");
        await ports.listFiles(request.files);
      } else if (service === "calendar") {
        if (!request.caldav) throw new Error("missing calendar address");
        await ports.findCalendars(request.caldav);
      } else {
        if (!request.imap) throw new Error("missing mail server");
        await ports.checkMail(request.imap);
      }
      ok.push(service);
      onState(service, { state: "ok" });
    } catch (error) {
      failed.push(service);
      onState(service, { state: "error", error });
    }
  }
  return { ok, failed };
}

/** The phone's real probes, loaded on demand (the sync and calendar modules are large). */
export async function phoneProbePorts(): Promise<ConnectProbePorts> {
  const [{ listProviderFolders }, { probeCalDav }, { checkMailLogin }] = await Promise.all([
    import("./syncService"),
    import("./pim/pimService"),
    import("@plainva/ui/mail"),
  ]);
  return {
    listFiles: (target) => listProviderFolders(target, ""),
    findCalendars: (creds) => probeCalDav(creds),
    checkMail: (imap) => checkMailLogin({ host: imap.host, port: imap.port, user: imap.email, kind: "imap" }, imap.pass),
  };
}
