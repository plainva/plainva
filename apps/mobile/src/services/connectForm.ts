import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import {
  foldMachineText,
  nextcloudEndpoints,
  suiteProvider,
  type CloudProviderFamily,
  type CloudServiceId,
  type ConnectAccessPlan,
  type ConnectField,
  type ConnectFieldId,
} from "@plainva/ui";

/**
 * The phone's one form of the sign-in step for a provider with credentials or
 * keys (settings plan 2026-10-29, E5): what the person typed, turned into what
 * each chosen service connects with. The same reading of the form as the
 * desktop wizard's - one credential for every service of a suite, the
 * endpoints from the catalog unless "Other sign-in" holds them open, Nextcloud
 * from its one address.
 *
 * Pure: no network, no storage. What it returns lives in memory for the run
 * (`connectSecrets`), never on the disk.
 */

export type ConnectFormValues = Partial<Record<ConnectFieldId, string>>;

export interface PhoneConnectRequest {
  /** The files service, without the folder (the files step chooses it). */
  files?: { provider: "webdav"; creds: WebDavCredentials } | { provider: "s3"; creds: S3Credentials };
  caldav?: { url: string; user: string; pass: string };
  imap?: { email: string; host: string; port: number; smtpHost?: string; smtpPort?: number; pass: string };
}

function valueOf(values: ConnectFormValues, fields: readonly ConnectField[], id: ConnectFieldId): string {
  const field = fields.find((entry) => entry.id === id);
  return (values[id] ?? field?.prefill ?? "").trim();
}

export function phoneConnectRequest(input: {
  family: CloudProviderFamily;
  flavor?: "nextcloud";
  services: readonly CloudServiceId[];
  plan: Pick<ConnectAccessPlan, "fields" | "other">;
  values: ConnectFormValues;
  /** "Other sign-in" is open: its fields are what counts. */
  otherOpen: boolean;
}): PhoneConnectRequest {
  const { family, flavor, services, plan, values, otherOpen } = input;
  const all = [...plan.fields, ...(plan.other?.fields ?? [])];
  const text = (id: ConnectFieldId) => valueOf(values, all, id);
  // Addresses as a machine reads them: a keyboard set to Japanese types full-width forms no server answers to.
  const address = (id: ConnectFieldId) => foldMachineText(text(id));
  const secret = values.secret ?? "";
  const endpointsOpen = otherOpen && plan.other?.holds === "endpoints";
  const request: PhoneConnectRequest = {};

  if (family === "s3") {
    if (services.includes("files")) {
      request.files = {
        provider: "s3",
        creds: {
          endpoint: address("endpoint"),
          region: address("region") || "us-east-1",
          bucket: address("bucket"),
          accessKeyId: address("accessKeyId"),
          secretAccessKey: secret,
          prefix: text("prefix") || undefined,
          forcePathStyle: text("pathStyle") !== "off",
        },
      };
    }
    return request;
  }

  const suite = suiteProvider(family);
  let filesUrl = "";
  let caldavUrl = "";
  let user = "";
  if (family === "webdav" && flavor === "nextcloud" && !endpointsOpen) {
    user = text("user");
    const derived = nextcloudEndpoints(address("server"), user);
    filesUrl = derived?.files ?? "";
    caldavUrl = derived?.caldav ?? "";
  } else if (family === "webdav") {
    user = text("user");
    filesUrl = address("filesUrl");
    caldavUrl = address("caldavUrl");
  } else if (suite) {
    user = text("email");
    filesUrl = endpointsOpen ? address("filesUrl") : (suite.endpoints.webdavUrl ?? "");
    caldavUrl = endpointsOpen ? address("caldavUrl") : (suite.endpoints.caldavUrl ?? "");
  }
  if (services.includes("files") && filesUrl) request.files = { provider: "webdav", creds: { url: filesUrl, user, pass: secret } };
  if (services.includes("calendar") && caldavUrl) request.caldav = { url: caldavUrl, user, pass: secret };

  if (services.includes("mail") && (family === "imap" || suite)) {
    const fromCatalog = !!suite && !endpointsOpen;
    request.imap = fromCatalog
      ? { email: text("email"), host: suite!.endpoints.imapHost ?? "", port: suite!.endpoints.imapPort ?? 993, smtpHost: suite!.endpoints.smtpHost, smtpPort: suite!.endpoints.smtpPort, pass: secret }
      : {
          email: text("email"),
          host: address("imapHost"),
          port: Number(text("imapPort")) || 993,
          smtpHost: address("smtpHost") || undefined,
          smtpPort: Number(text("smtpPort")) || undefined,
          pass: secret,
        };
  }
  return request;
}

/** The services a request can try - a service without its address cannot. */
export function requestServices(request: PhoneConnectRequest): CloudServiceId[] {
  return [...(request.files ? ["files" as const] : []), ...(request.caldav ? ["calendar" as const] : []), ...(request.imap ? ["mail" as const] : [])];
}
