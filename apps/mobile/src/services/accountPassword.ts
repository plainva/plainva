import { CalDavPimTarget, S3SyncTarget, WebDavSyncTarget } from "@plainva/core";
import { accountLoginBinding, assertEndpointConfirmedIn, confirmationEndpoint, createPasswordChangeJournal, mailboxEndpoints, createPasswordCredentialTarget, getPlatformServices, passwordServicesOf, PasswordChangeError, type CloudAccountRecord, type PasswordChangePorts, type PasswordChangeStatus, type PasswordChangeTarget } from "@plainva/ui";
import { getMailPassword, listMailAccounts, mailAccountKind, mailSecretKey, checkMailLogin } from "@plainva/ui/mail";
import { protectedSecrets } from "../platform/protectedSecrets";
import { allowHttpOrigin, webdavFetch } from "../adapters/webdavHttp";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { getStoredProvider, restartSyncIfActive, stopSyncForStep } from "./syncService";
import { storedProviderEndpoint } from "./fileSyncAccess";
import { syncProviderSlot } from "./syncSlot";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { restartPimAccountAfterLogin } from "./pim/pimService";
import { notifyMailChanged } from "./mail/mailRuntime";

/** The addresses a new password of the account goes to, each asked about first where unconfirmed (F57, O3). */
async function passwordAddresses(vaultId: string, record: CloudAccountRecord): Promise<Array<{ vaultKey: string; endpoint: string | null }>> {
  const endpoints: Array<string | null> = [];
  for (const service of passwordServicesOf(record)) {
    if (service === "files") endpoints.push(storedProviderEndpoint(await getStoredProvider(vaultId)));
    else if (service === "calendar") {
      const creds = await getPimCredentials(vaultId, record.services.calendar!.pimAccountId);
      if (creds?.kind === "caldav") endpoints.push(confirmationEndpoint(creds.url));
    } else {
      const account = (await listMailAccounts(vaultId)).find((a) => a.id === record.services.mail!.mailAccountId);
      if (account && mailAccountKind(account) === "imap") endpoints.push(...mailboxEndpoints(account));
    }
  }
  return endpoints.map((endpoint) => ({ vaultKey: vaultId, endpoint }));
}

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
    addresses: () => passwordAddresses(vaultId, record),
    targets: async () => {
      const targets: PasswordChangeTarget[] = [];
      for (const service of passwordServicesOf(record)) {
        if (service === "files" && record.services.files?.provider === "s3") targets.push(createPasswordCredentialTarget({
          service, key: syncProviderSlot(vaultId), store: protectedSecrets,
          read: async () => {
            const value = await getStoredProvider(vaultId);
            if (value && value.provider !== "s3") throw new PasswordChangeError("changed", service);
            return value;
          },
          readBinding: async () => ({ provider: "s3" }),
          withPassword: (value, secretAccessKey) => ({ ...value, creds: { ...value.creds, secretAccessKey } }),
          verify: async (value, _binding, secretAccessKey) => {
            // A password typed here never confirms the address it came with: that is asked first (F57, O3).
            await assertEndpointConfirmedIn(vaultId, confirmationEndpoint(value.creds.endpoint));
            void allowHttpOrigin(value.creds.endpoint);
            await new S3SyncTarget({ ...value.creds, secretAccessKey }, webdavFetch).listFolders("");
          },
          beforeWrite: async () => {
            // A step on the vault's sign-in: it stops that vault's sync where it is on screen, and nothing else.
            await stopSyncForStep({ vaultId });
          },
        }));
        else if (service === "files") targets.push(createPasswordCredentialTarget({
          service, key: syncProviderSlot(vaultId), store: protectedSecrets,
          read: async () => {
            const value = await getStoredProvider(vaultId);
            if (value && value.provider !== "webdav") throw new PasswordChangeError("changed", service);
            return value;
          },
          readBinding: async () => ({ provider: "webdav" }),
          withPassword: (value, pass) => ({ ...value, creds: { ...value.creds, pass } }),
          verify: async (value, _binding, pass) => {
            await assertEndpointConfirmedIn(vaultId, confirmationEndpoint(value.creds.url));
            void allowHttpOrigin(value.creds.url);
            await new WebDavSyncTarget({ ...value.creds, pass }, webdavFetch).listFolders("");
          },
          beforeWrite: async () => {
            // A step on the vault's sign-in: it stops that vault's sync where it is on screen, and nothing else.
            await stopSyncForStep({ vaultId });
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
              await assertEndpointConfirmedIn(vaultId, confirmationEndpoint(value.url));
              void allowHttpOrigin(value.url);
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
            verify: (_value, endpoint, pass) => assertEndpointConfirmedIn(vaultId, ...mailboxEndpoints(endpoint)).then(() => checkMailLogin(endpoint, pass)).then(() => {}),
          }));
        }
      }
      return targets;
    },
    activate: async () => {
      // The sync starts again through the one start: a new password never ends "Pause sync" (second review, B4a).
      if (record.services.files?.provider === "webdav" || record.services.files?.provider === "s3") await restartSyncIfActive(vaultId);
      if (record.services.calendar && passwordServicesOf(record).includes("calendar")) await restartPimAccountAfterLogin(vaultId, record.services.calendar.pimAccountId);
      notifyMailChanged();
    },
  };
}
