import { accountLoginBinding, beginPasswordChange, createPasswordChangeJournal, createPasswordCredentialTarget, keychainSlotName, passwordServicesOf, PasswordChangeError, type CloudAccountRecord, type PasswordChangePorts, type PasswordChangeStatus, type PasswordChangeTarget } from "@plainva/ui";
import { getMailPassword, listMailAccounts, mailAccountKind, mailSecretKey, checkMailLogin, type MailAccountConfig } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { protectedSecrets } from "./protectedSecrets";
import { loadCloudAccounts } from "./cloudAccounts";
import { slot } from "./keychainSlots";
import { buildWebDavTarget } from "./syncTargets";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { checkCalDavLogin } from "./pim/pimAccounts";
import { restartPimAccountAfterLogin, type PimRuntime } from "./pim/pimRuntime";
import type { ServiceStatusCb } from "./cloudAccountsActions";

export function desktopPasswordChangePorts(vaultPath: string, record: CloudAccountRecord, runtime: PimRuntime | null, onStatus?: (status: PasswordChangeStatus) => void): PasswordChangePorts {
  record = structuredClone(record);
  const binding = (value: CloudAccountRecord) => JSON.stringify([vaultPath, accountLoginBinding(value)]);
  const journalKey = keychainSlotName({ vaultKey: vaultPath, service: "repair", account: `password-change-${record.id}` });
  return {
    key: journalKey,
    owner: JSON.stringify([vaultPath, record.id]),
    binding: binding(record),
    readBinding: async () => {
      const current = (await loadCloudAccounts(vaultPath)).find((r) => r.id === record.id);
      if (!current) throw new PasswordChangeError("changed");
      return binding(current);
    },
    journal: createPasswordChangeJournal(protectedSecrets, journalKey),
    onStatus,
    targets: async () => {
      const targets: PasswordChangeTarget[] = [];
      for (const service of passwordServicesOf(record)) {
        if (service === "files") targets.push(createPasswordCredentialTarget({
          service, key: slot.files(vaultPath, "webdav"), store: protectedSecrets,
          read: async () => {
            const value = await credentialManager.getWebDavCredentials(vaultPath);
            if (value && typeof value.pass !== "string") throw new PasswordChangeError("missing", service);
            return value;
          },
          readBinding: async () => {
            const others = await Promise.all([
              credentialManager.getDriveCredentials(vaultPath), credentialManager.getOneDriveCredentials(vaultPath),
              credentialManager.getDropboxCredentials(vaultPath), credentialManager.getS3Credentials(vaultPath),
            ]);
            if (others.some(Boolean)) throw new PasswordChangeError("changed", service);
            return { provider: "webdav" };
          },
          withPassword: (value, pass) => ({ ...value, pass }),
          verify: (value, _binding, pass) => buildWebDavTarget({ ...value, pass }).listFolders("").then(() => {}),
        }));
        else if (service === "calendar") {
          const id = record.services.calendar!.pimAccountId;
          targets.push(createPasswordCredentialTarget({
            service, key: pimSecretKey(vaultPath, id), store: protectedSecrets,
            read: async () => {
              const value = await getPimCredentials(vaultPath, id);
              if (value && value.kind !== "caldav") throw new PasswordChangeError("changed", service);
              return value;
            },
            readBinding: async () => ({ pimAccountId: id }),
            withPassword: (value, pass) => ({ ...value, pass, loginRevision: crypto.randomUUID() }),
            verify: (value, _binding, pass) => {
              if (value.kind !== "caldav") throw new PasswordChangeError("changed", service);
              return checkCalDavLogin({ ...value, pass });
            },
          }));
        } else {
          const id = record.services.mail!.mailAccountId;
          targets.push(createPasswordCredentialTarget({
            service, key: mailSecretKey(vaultPath, id), store: protectedSecrets,
            read: async () => {
              await getMailPassword(vaultPath, id); // migrate a legacy slot before conditional writes
              const value = await credentialManager.readSecret<{ pass: string }>(mailSecretKey(vaultPath, id));
              if (value && typeof value.pass !== "string") throw new PasswordChangeError("changed", service);
              return value;
            },
            readBinding: async () => {
              const account = (await listMailAccounts(vaultPath)).find((a) => a.id === id);
              if (!account || mailAccountKind(account) !== "imap") throw new PasswordChangeError("changed", service);
              return mailEndpoint(account);
            },
            withPassword: (value, pass) => ({ ...value, pass }),
            verify: (_value, endpoint, pass) => checkMailLogin(endpoint, pass).then(() => {}),
          }));
        }
      }
      return targets;
    },
    activate: async () => {
      window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: false, vaultPath } }));
      if (record.services.calendar && passwordServicesOf(record).includes("calendar")) await restartPimAccountAfterLogin(runtime, record.services.calendar.pimAccountId);
    },
  };
}

function mailEndpoint(account: MailAccountConfig) {
  return { kind: "imap" as const, host: account.host, port: account.port, user: account.user,
    smtpHost: account.smtpHost, smtpPort: account.smtpPort, sieveHost: account.sieveHost, sievePort: account.sievePort };
}

/** Compatibility for existing callers; all writes now go through the journal. */
export async function updateAccountPassword(vaultPath: string, runtime: PimRuntime | null, record: CloudAccountRecord, pass: string, onStatus: ServiceStatusCb): Promise<void> {
  const seen = new Map<string, string>();
  await beginPasswordChange(desktopPasswordChangePorts(vaultPath, record, runtime, (status) => {
    for (const service of passwordServicesOf(record)) {
      const result = status.services[service];
      if (result && seen.get(service) !== result) {
        seen.set(service, result);
        onStatus(service, { state: result === "confirmed" ? "ok" : result === "failed" ? "error" : "pending" });
      }
    }
  }), pass);
}
