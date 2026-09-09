import { CalDavPimTarget, WebDavSyncTarget } from "@plainva/core";
import { accountLoginBinding, createPasswordChangeJournal, createPasswordCredentialTarget, getPlatformServices, passwordServicesOf, PasswordChangeError, type CloudAccountRecord, type PasswordChangePorts, type PasswordChangeStatus, type PasswordChangeTarget } from "@plainva/ui";
import { getMailPassword, listMailAccounts, mailAccountKind, mailSecretKey, checkMailLogin } from "@plainva/ui/mail";
import { protectedSecrets } from "../platform/protectedSecrets";
import { allowHttpOrigin, webdavFetch } from "../adapters/webdavHttp";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { getStoredProvider, resumeProvider, stopSyncAndDrain } from "./syncService";
import { syncProviderSlot } from "./syncSlot";
import { getActiveVaultEntry } from "./vaultRegistry";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { restartPimAccountAfterLogin } from "./pim/pimService";
import { notifyMailChanged } from "./mail/mailRuntime";

export function mobilePasswordChangePorts(vaultId: string, record: CloudAccountRecord, onStatus?: (status: PasswordChangeStatus) => void): PasswordChangePorts {
  record = structuredClone(record);
  const binding = (value: CloudAccountRecord) => JSON.stringify([vaultId, accountLoginBinding(value)]);
  const journalKey = `password_change_${encodeURIComponent(vaultId)}|${encodeURIComponent(record.id)}`;
  return {
    key: journalKey,
    owner: JSON.stringify([vaultId, record.id]),
    binding: binding(record),
    readBinding: async () => {
      const current = (await loadCloudAccounts(vaultId)).find((r) => r.id === record.id);
      if (!current) throw new PasswordChangeError("changed");
      return binding(current);
    },
    journal: createPasswordChangeJournal(protectedSecrets, journalKey),
    onStatus,
    targets: async () => {
      const targets: PasswordChangeTarget[] = [];
      for (const service of passwordServicesOf(record)) {
        if (service === "files") targets.push(createPasswordCredentialTarget({
          service, key: syncProviderSlot(vaultId), store: protectedSecrets,
          read: async () => {
            const value = await getStoredProvider(vaultId);
            if (value && value.provider !== "webdav") throw new PasswordChangeError("changed", service);
            return value;
          },
          readBinding: async () => ({ provider: "webdav" }),
          withPassword: (value, pass) => ({ ...value, creds: { ...value.creds, pass } }),
          verify: async (value, _binding, pass) => {
            allowHttpOrigin(value.creds.url);
            await new WebDavSyncTarget({ ...value.creds, pass }, webdavFetch).listFolders("");
          },
          beforeWrite: async () => {
            if ((await getActiveVaultEntry()).id === vaultId) await stopSyncAndDrain();
          },
        }));
        else if (service === "calendar") {
          const id = record.services.calendar!.pimAccountId;
          targets.push(createPasswordCredentialTarget({
            service, key: pimSecretKey(vaultId, id), store: protectedSecrets,
            read: async () => {
              const value = await getPimCredentials(vaultId, id);
              if (value && value.kind !== "caldav") throw new PasswordChangeError("changed", service);
              return value;
            },
            readBinding: async () => ({ pimAccountId: id }),
            withPassword: (value, pass) => ({ ...value, pass, loginRevision: crypto.randomUUID() }),
            verify: async (value, _binding, pass) => {
              allowHttpOrigin(value.url);
              const calendars = await new CalDavPimTarget({ ...value, pass }, webdavFetch).listCalendars();
              if (!calendars.length) throw new PasswordChangeError("verification", service);
            },
          }));
        } else {
          const id = record.services.mail!.mailAccountId;
          targets.push(createPasswordCredentialTarget({
            service, key: mailSecretKey(vaultId, id), store: protectedSecrets,
            read: async () => {
              await getMailPassword(vaultId, id);
              const value = await getPlatformServices().credentials.readSecret<{ pass: string }>(mailSecretKey(vaultId, id));
              if (value && typeof value.pass !== "string") throw new PasswordChangeError("changed", service);
              return value;
            },
            readBinding: async () => {
              const account = (await listMailAccounts(vaultId)).find((a) => a.id === id);
              if (!account || mailAccountKind(account) !== "imap") throw new PasswordChangeError("changed", service);
              return { kind: "imap" as const, host: account.host, port: account.port, user: account.user,
                smtpHost: account.smtpHost, smtpPort: account.smtpPort, sieveHost: account.sieveHost, sievePort: account.sievePort };
            },
            withPassword: (value, pass) => ({ ...value, pass }),
            verify: (_value, endpoint, pass) => checkMailLogin(endpoint, pass).then(() => {}),
          }));
        }
      }
      return targets;
    },
    activate: async () => {
      if (record.services.files?.provider === "webdav") await resumeProvider(vaultId);
      if (record.services.calendar && passwordServicesOf(record).includes("calendar")) await restartPimAccountAfterLogin(vaultId, record.services.calendar.pimAccountId);
      notifyMailChanged();
    },
  };
}
