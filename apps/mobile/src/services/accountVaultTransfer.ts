import { commitVaultTransfer, planVaultTransfer, PimCacheRepository, refreshDriveAccessToken, refreshOneDriveAccessToken, refreshDropboxAccessToken, type ISyncTarget } from "@plainva/core";
import { assertConnectionIdentity, getPlatformServices, parseGoogleUserInfo, parseMicrosoftMe, verifiedProviderIdentityKey, type CloudAccountRecord, type ServiceConnectionContext, type VerifiedProviderIdentity } from "@plainva/ui";
import { getMailPassword, getMailRefreshToken, listMailAccounts, mailAccountKind, saveMailAccount, saveMicrosoftMailAccount } from "@plainva/ui/mail";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { webdavFetch } from "../adapters/webdavHttp";
import { reviewVaultTransfer } from "../components/TransferReviewHost";
import { fileGrantProbe, getAccountToken, saveAccountToken } from "./accountBroker";
import { bindRunTokenToAccount } from "./connectConsent";
import { runServices } from "./connectQueue";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { finishConnectVault, loadConnectQueue, outcomeBelongsToRun, prepareConnectVault, recordConnectOutcome } from "./connectQueue";
import { copyProfilePreferences } from "./profileImportJournal";
import { getPimCredentials, savePimCredentials } from "./pim/pimCredentials";
import { syncProviderSlot, type MobileSyncProvider } from "./syncSlot";
import { readSyncRootFolder } from "./syncRootFolder";
import { addVault, getActiveVaultEntry, getVaultEntry, listVaults, newVaultId } from "./vaultRegistry";
import { noteSaver, openPreparedVaultDatabase, switchVault, type MobileVault } from "./vaultService";

/** Destination identity excludes tokens and local labels. */
export function fileDestinationKey(p: MobileSyncProvider, identity?: VerifiedProviderIdentity): string | null {
  if (p.provider === "drive" || p.provider === "onedrive") return identity ? JSON.stringify([p.provider, verifiedProviderIdentityKey(identity), p.creds.rootFolderName || "Plainva"]) : null;
  if (p.provider === "webdav") return JSON.stringify([p.provider, p.creds.url.replace(/\/+$/, ""), p.creds.user]);
  if (p.provider === "s3") return JSON.stringify([p.provider, p.creds.endpoint.replace(/\/+$/, ""), p.creds.bucket, p.creds.prefix || "", p.creds.accessKeyId]);
  if (p.provider === "dropbox") return identity ? JSON.stringify([p.provider, verifiedProviderIdentityKey(identity), p.creds.rootPath || "/"]) : null;
  return null;
}

async function verifyIdentity(p: MobileSyncProvider, context: ServiceConnectionContext, record?: CloudAccountRecord) {
  if (p.provider === "dropbox") {
    const token = await refreshDropboxAccessToken(p.creds, webdavFetch);
    const response = await webdavFetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" }, body: "null" });
    if (!response.ok) throw new Error("identityUnavailable");
    const body = await response.json() as { account_id?: string; email?: string };
    if (!body.account_id) throw new Error("identityUnavailable");
    const identity = { issuer: "dropbox", subject: body.account_id };
    assertConnectionIdentity(context.expectedIdentity ?? record?.verifiedProviderIdentity, identity);
    return { identity, label: body.email };
  }
  if (p.provider !== "drive" && p.provider !== "onedrive") return undefined;
  const probe = !p.creds.refreshToken && record ? await fileGrantProbe(context.vaultId, record.id, p.provider === "drive" ? "google" : "microsoft", p.creds) : null;
  const tok = probe ? { accessToken: await probe.getAccessToken() } : p.provider === "drive" ? await refreshDriveAccessToken({ ...p.creds, clientSecret: p.creds.clientSecret ?? "" }, webdavFetch) : await refreshOneDriveAccessToken(p.creds, webdavFetch);
  if ("refreshToken" in tok && tok.refreshToken) {
    p.creds.refreshToken = tok.refreshToken;
    const { persistPendingConnect } = await import("./oauthService");
    await persistPendingConnect(p);
  }
  const res = await webdavFetch(p.provider === "drive" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${tok.accessToken}` } });
  if (!res.ok) throw new Error("identityUnavailable");
  const profile = p.provider === "drive" ? parseGoogleUserInfo(await res.json()) : parseMicrosoftMe(await res.json());
  assertConnectionIdentity(context.expectedIdentity ?? record?.verifiedProviderIdentity, profile?.identity ?? null);
  if (!record?.verifiedProviderIdentity && record?.label.includes("@") && record.label.trim().toLowerCase() !== profile?.label?.trim().toLowerCase()) throw new Error("wrongAccount");
  return profile!;
}

/** Copies into an isolated, resumable target. Source services and files remain
 * usable throughout; no cloud writes occur until review and storage succeed. */
const transfers = new Map<string, Promise<void>>();
export function connectAccountFiles(v: MobileVault, p: MobileSyncProvider, context: ServiceConnectionContext, createRemote: () => Promise<ISyncTarget>, name: string): Promise<void> {
  const key = context.runId ?? context.vaultId;
  const existing = transfers.get(key);
  if (existing) return existing;
  const transfer = transferAccountFiles(v, p, context, createRemote, name).finally(() => { transfers.delete(key); });
  transfers.set(key, transfer);
  return transfer;
}

async function transferAccountFiles(v: MobileVault, p: MobileSyncProvider, context: ServiceConnectionContext, createRemote: () => Promise<ISyncTarget>, name: string): Promise<void> {
  if (v.vaultId !== context.vaultId || (await getActiveVaultEntry()).id !== context.vaultId || !v.db) throw new Error("accountChanged");
  const run = await loadConnectQueue();
  if (!run || !outcomeBelongsToRun(run, context, "files")) throw new Error("accountChanged");
  const records = await loadCloudAccounts(v.vaultId);
  const selected = records.find(r => r.id === context.cloudAccountId);
  if (context.cloudAccountId && !selected) throw new Error("accountChanged");
  const profile = await verifyIdentity(p, context, selected);
  const remote = await createRemote();
  if (await remote.download(".pvws/genesis.pvgen")) throw new Error("pair-required");
  const key = fileDestinationKey(p, profile?.identity);
  const secrets = getPlatformServices().credentials;
  let id = run.preparedVaultId;
  if (!id && key) {
    const matches: string[] = [];
    for (const entry of await listVaults()) {
      if (entry.id === v.vaultId || entry.external) continue;
      const stored = await secrets.readSecret<MobileSyncProvider>(syncProviderSlot(entry.id));
      if (stored?.provider === "drive" || stored?.provider === "onedrive") stored.creds.rootFolderName = await readSyncRootFolder(entry.id, stored.provider, stored) || undefined;
      if (stored?.provider === "dropbox") stored.creds.rootPath = await readSyncRootFolder(entry.id, stored.provider, stored) || undefined;
      const binding = (await loadCloudAccounts(entry.id)).find(r => r.services.files?.provider === p.provider);
      if (stored && fileDestinationKey(stored, binding?.verifiedProviderIdentity) === key) matches.push(entry.id);
    }
    if (matches.length > 1) throw new Error("transfer_ambiguous_destination");
    id = matches[0];
  }
  id ??= newVaultId();
  await prepareConnectVault(context, id, key ?? undefined);
  const existing = await getVaultEntry(id);
  const target = new CapacitorVaultAdapter(`vaults/${id}`);
  await target.initialize();
  await noteSaver.flushAll();
  const plan = await planVaultTransfer(v.adapter, remote, target);
  // Encrypted workspaces must be opened through their pairing flow, never
  // copied as raw ciphertext into an ordinary connection.
  if ([...plan.etags.keys()].some(path => path.startsWith(".pvws/"))) throw new Error("pair-required");
  if (!await reviewVaultTransfer(plan, (await getActiveVaultEntry()).name, existing?.name ?? name)) {
    await recordConnectOutcome(context, "files", { state: "cancelled" });
    return;
  }
  const currentRun = await loadConnectQueue();
  if ((await getActiveVaultEntry()).id !== v.vaultId || !currentRun || !outcomeBelongsToRun(currentRun, context, "files")) throw new Error("accountChanged");
  const targetRecords = await loadCloudAccounts(id);
  const fileRecord = targetRecords.find(r => r.services.files?.provider === p.provider);
  const accountId = fileRecord?.id ?? selected?.id ?? crypto.randomUUID();
  const combined = new Map(targetRecords.map(r => [r.id, r]));
  for (const record of records) {
    const nextId = record.id === selected?.id ? accountId : record.id;
    const old = combined.get(nextId);
    const services = { ...record.services }; delete services.files;
    if (old && ((old.services.calendar && services.calendar && old.services.calendar.pimAccountId !== services.calendar.pimAccountId) || (old.services.mail && services.mail && old.services.mail.mailAccountId !== services.mail.mailAccountId))) throw new Error("transfer_binding_collision");
    combined.set(nextId, { ...record, ...old, id: nextId, services: { ...services, ...old?.services } });
  }
  const base = combined.get(accountId);
  combined.set(accountId, { ...base, id: accountId, family: run.family, label: profile?.label ?? base?.label ?? name, ...(profile ? { verifiedProviderIdentity: profile.identity } : {}), services: { ...base?.services, files: { provider: p.provider } } });
  const sourceCache = new PimCacheRepository(v.db);
  const db = await openPreparedVaultDatabase(id);
  try {
    const cache = new PimCacheRepository(db);
    const existingPim = await cache.listAccounts();
    const accounts = await sourceCache.listAccounts();
    const mailAccounts = await listMailAccounts(v.vaultId);
    const existingMail = await listMailAccounts(id);
    // Validate binding collisions before copying anything.
    for (const row of accounts) { const old = existingPim.find(a => a.id === row.id); if (old && JSON.stringify(old) !== JSON.stringify(row)) throw new Error("transfer_binding_collision"); }
    for (const mail of mailAccounts) { const old = existingMail.find(a => a.id === mail.id); if (old && JSON.stringify(old) !== JSON.stringify(mail)) throw new Error("transfer_binding_collision"); }
    await commitVaultTransfer(plan, v.adapter, target, remote);
    for (const row of accounts) {
      const creds = await getPimCredentials(v.vaultId, row.id);
      if (creds) await savePimCredentials(id, row.id, creds);
      if (!existingPim.some(a => a.id === row.id)) await cache.restoreAccount(await sourceCache.snapshotAccount(row.id));
    }
    for (const mail of mailAccounts) {
      if (mailAccountKind(mail) === "microsoft") await saveMicrosoftMailAccount(id, mail, await getMailRefreshToken(v.vaultId, mail.id) ?? "");
      else await saveMailAccount(id, mail, await getMailPassword(v.vaultId, mail.id) ?? "");
    }
    for (const record of records) { const token = await getAccountToken(v.vaultId, record.id); if (token) await saveAccountToken(id, record.id === selected?.id ? accountId : record.id, token); }
    if (!existing) await copyProfilePreferences(v, id, target);
    await saveCloudAccounts(id, [...combined.values()]);
    if (JSON.stringify(await loadCloudAccounts(id)) !== JSON.stringify([...combined.values()])) throw new Error("storageFailed");
    await secrets.writeSecret(syncProviderSlot(id), p);
    if (JSON.stringify(await secrets.readSecret(syncProviderSlot(id))) !== JSON.stringify(p)) throw new Error("storageFailed");
    await bindRunTokenToAccount(id, run.family, runServices(run));
  } finally { await db.close(); }
  if (!existing) await addVault({ id, name, provider: p.provider });
  await finishConnectVault(context, id, accountId);
  await switchVault(id);
  window.dispatchEvent(new Event("m-connect-run-changed"));
}
