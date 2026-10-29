import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "./hooks/useLeaveGuard";
import { ChevronRight, CloudOff, FolderOpen } from "lucide-react";
import { Banner, Button, EmptyState, GroupCard, RowList, filesTargetForFamily, foldMachineText, ICON, Row, Switch, TextInput, familyLabel, getVaultTemplates, isInsecurePublicUrl, unionScope, type CloudProviderFamily, type OAuthFamily } from "@plainva/ui";
import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import {
  connectProvider,
  createProviderFolder,
  createProviderVault,
  listProviderFolders,
  syncPossible,
  type MobileSyncProvider,
} from "./services/syncService";
import { CloudFolderPickerSheet } from "./components/CloudFolderPickerSheet";
import { beginOAuth, beginStoredFilesConnection, type OAuthProviderId } from "./services/oauthService";
import { FILES_CONNECT_PROGRESS_EVENT, filesConnectProgress, type FilesConnectProgress } from "./services/filesConnectProgress";
import { AccessUnavailableError, deviceAccess, dropboxDeviceKey } from "./services/accountSignIn";
import { AccountAccessSheet } from "./components/AccountAccessSheet";
import { getPimCredentials } from "./services/pim/pimCredentials";
import { loadCloudAccounts } from "./services/cloudAccountsStore";
import { useConnectionRun } from "./hooks/useConnectionRun";
import { reloadActiveMobileVault, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";
import { ConnectRunFooter, ConnectRunFrame } from "./components/ConnectRunFrame";
import { TransferReviewStep, useInlineTransferReview } from "./components/TransferReviewHost";
import { getConnectSecrets, rememberConnectSecrets } from "./services/connectSecrets";
import { loadConnectQueue, runServices } from "./services/connectQueue";
import { runConsentScope } from "./services/connectConsent";
import { trimEndChars } from "@plainva/core";

type ProviderId = MobileSyncProvider["provider"];

const OAUTH_PROVIDERS: ReadonlySet<ProviderId> = new Set(["drive", "onedrive", "dropbox"]);

/** The files service by its product name: "Google Drive", not "Google". */
const PRODUCT_NAME: Partial<Record<ProviderId, string>> = { drive: "Google Drive", onedrive: "OneDrive", dropbox: "Dropbox" };

/**
 * The files step of the account setup (plan "Verbinden-Assistent",
 * 2026-10-28; settings plan 2026-10-29): the setup's frame and ONE question -
 * which folder. The provider and its sign-in are settled before this step:
 * Google and Microsoft by the one sign-in, Dropbox by its consent started on
 * the services page, a provider with credentials or keys by the one form of
 * the sign-in step, whose proven credential this step reuses. Only a run
 * resumed after the app was gone - the credential lived in memory - asks for
 * it here again, the safe direction.
 *
 * "Connect with cloud" and "New vault in the cloud" are the connect assistant
 * with files ticked (E7); a new vault's template travels in the run and is
 * scaffolded into the fresh container before the first sync uploads it.
 */
export function AddVaultScreen({
  vault,
  onBack,
  createTemplateId: createTemplateProp,
  family,
}: {
  vault: MobileVault;
  onBack: () => void;
  createTemplateId?: string;
  /** The run's provider family (S0a): the step states it rather than asking again. */
  family?: CloudProviderFamily;
}) {
  const { t, i18n } = useTranslation();
  const connectionRun = useConnectionRun();
  const runFiles = family && connectionRun?.pending[0] === "files" ? connectionRun : null;
  const createTemplateId = runFiles?.createTemplateId ?? createTemplateProp;
  const createMode = createTemplateId !== undefined;
  const pendingReview = useInlineTransferReview(!!runFiles);
  // Only this run's review: one a replaced run left is answered by the host, never shown here.
  const review = pendingReview && (!pendingReview.runId || pendingReview.runId === runFiles?.id) ? pendingReview : null;
  const preset = family ? filesTargetForFamily(family) : null;
  const [runScope, setRunScope] = useState<string | null>(null);

  const provider: ProviderId = preset?.provider ?? "webdav";
  // What the sign-in step proved to work, for this provider (in memory, E4).
  const proven = (() => {
    const files = getConnectSecrets().request?.files;
    return files && files.provider === provider ? files : null;
  })();
  const [webdav, setWebdav] = useState<WebDavCredentials>({ url: preset?.webdavUrl ?? "", user: "", pass: "" });
  const [s3, setS3] = useState<S3Credentials>({
    endpoint: "",
    region: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    prefix: "",
    // Path-style is what most S3-compatible stores expect; the switch below
    // turns it off for the ones that only answer on the bucket's own host.
    forcePathStyle: true,
  });
  // Google Drive and OneDrive sign in with this device's access, Dropbox with
  // its app key (E6) - like every other sign-in.
  const accessFamily: OAuthFamily | null = provider === "drive" ? "google" : provider === "onedrive" ? "microsoft" : null;
  const [accessSheet, setAccessSheet] = useState<"google" | "microsoft" | "dropbox" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // After the folder pick the step goes on without the form (device finding
  // 2026-10-27): what it is doing is said here, and Connect waits for it.
  const [filesProgress, setFilesProgress] = useState<FilesConnectProgress | null>(() => filesConnectProgress());
  useEffect(() => {
    const read = () => setFilesProgress(filesConnectProgress());
    read();
    window.addEventListener(FILES_CONNECT_PROGRESS_EVENT, read);
    return () => window.removeEventListener(FILES_CONNECT_PROGRESS_EVENT, read);
  }, []);
  // Direct providers (WebDAV/S3) browse the cloud folder BEFORE connecting
  // (package I; the desktop 3-step flow). OAuth keeps its redirect picker.
  const [pickFor, setPickFor] = useState<MobileSyncProvider | null>(null);
  useEffect(() => {
    let alive = true;
    setRunScope(null);
    void loadConnectQueue().then(async (q) => {
      if (!alive || !q) return;
      const record = q.context.cloudAccountId ? (await loadCloudAccounts(q.context.vaultId)).find(r => r.id === q.context.cloudAccountId) : undefined;
      if (!alive) return;
      setRunScope(runConsentScope(q.family, runServices(q)));
      if (q.family !== "google" && q.family !== "microsoft" && record?.services.calendar) {
        const creds = await getPimCredentials(q.context.vaultId, record.services.calendar.pimAccountId);
        if (alive && creds?.kind === "caldav") setWebdav(old => ({ ...old, user: creds.user, pass: creds.pass, url: old.url || (/\/remote\.php\/dav(?:\/|$)/.test(creds.url) ? creds.url.replace(/\/remote\.php\/dav.*$/, `/remote.php/dav/files/${encodeURIComponent(creds.user)}`) : "") }));
      }
    });
    return () => {
      alive = false;
    };
  }, [connectionRun?.id]);

  // Credentials typed here are not stored until "connect"; a tap on the
  // navigation bar used to discard them — including a pasted S3 secret.
  useLeaveGuard(
    "vault-connect",
    !proven && !!(webdav.user || webdav.pass || s3.bucket || s3.accessKeyId || s3.secretAccessKey),
    t("mobile.leaveCredentials", { defaultValue: "Die eingegebenen Zugangsdaten gehen verloren." }),
  );

  const connect = () => {
    setBusy(true);
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      // Opens the system browser; the redirect handler finishes the connect
      // (which creates and activates the new vault). The cloud folder is
      // chosen AFTER the browser returns a token (#10), via the folder picker.
      // The template of a new vault travels in the persisted transaction, so
      // it survives a cold start during consent.
      void (async () => {
        if (connectionRun?.context && await beginStoredFilesConnection(connectionRun.context, createTemplateId)) return;
        if (accessFamily) {
          const resolved = await deviceAccess(accessFamily);
          if (!resolved.ok) { setAccessSheet(accessFamily); return; }
          await beginOAuth(provider as OAuthProviderId, {
            clientId: resolved.access.clientId,
            ...(resolved.access.clientSecret ? { clientSecret: resolved.access.clientSecret } : {}),
            // The identity scopes ride along: a new vault's sign-in becomes a card.
            scope: runScope ?? unionScope(accessFamily, ["files"]),
            access: resolved.access,
            ...(createMode ? { createTemplateId } : {}),
            serviceContext: connectionRun?.context,
          });
          return;
        }
        await beginOAuth(provider as OAuthProviderId, {
          clientId: await dropboxDeviceKey(),
          ...(runScope ? { scope: runScope } : {}),
          ...(createMode ? { createTemplateId } : {}),
          serviceContext: connectionRun?.context,
        });
      })()
        .catch((e: unknown) => {
          if (e instanceof AccessUnavailableError) setAccessSheet(e.family);
          else setError(e ?? "failed");
        })
        .finally(() => setBusy(false));
      return;
    }
    const p: MobileSyncProvider = proven ?? (
      provider === "webdav"
        ? { provider: "webdav", creds: { ...webdav, url: foldMachineText(webdav.url) } }
        : {
            provider: "s3",
            creds: {
              ...s3,
              // Addresses and key ids as a machine reads them: a keyboard
              // set to Japanese types them in full-width forms (lib/machineText.ts).
              endpoint: foldMachineText(s3.endpoint),
              region: foldMachineText(s3.region) || "us-east-1",
              bucket: foldMachineText(s3.bucket),
              accessKeyId: foldMachineText(s3.accessKeyId),
              prefix: s3.prefix?.trim() || undefined,
            },
          });
    setBusy(false);
    setPickFor(p);
  };

  const connectAt = (p: MobileSyncProvider, folder: string) => {
    setPickFor(null);
    setBusy(true);
    // The later screens of the run reuse the credential - in memory only (E4).
    if (p.provider === "webdav") {
      rememberConnectSecrets({ baseUrl: p.creds.url, user: p.creds.user, password: p.creds.pass });
    }
    const withRoot: MobileSyncProvider =
      p.provider === "webdav"
        ? {
            provider: "webdav",
            creds: {
              ...p.creds,
              url: folder
                ? trimEndChars(p.creds.url, "/") + "/" + folder.split("/").map(encodeURIComponent).join("/")
                : p.creds.url,
            },
          }
        : p.provider === "s3"
          ? { provider: "s3", creds: { ...p.creds, prefix: folder || p.creds.prefix } }
          : p;
    const run = createMode
      ? createProviderVault(vault, withRoot, {
          template: getVaultTemplates(i18n.language).find((d) => d.id === createTemplateId) ?? null,
          vaultName: folder.split("/").pop() || "Plainva",
          subfoldersHeading: t("indexMd.subfoldersHeading"),
        })
      : connectProvider(vault, withRoot);
    void run.catch((e: unknown) => setError(e ?? "failed")).finally(() => setBusy(false));
  };

  const canConnect =
    OAUTH_PROVIDERS.has(provider) || !!proven
      ? true
      : provider === "webdav"
        ? webdav.url.trim().length > 0
        : s3.endpoint.trim().length > 0 &&
          s3.bucket.trim().length > 0 &&
          s3.accessKeyId.length > 0 &&
          s3.secretAccessKey.length > 0;

  // Only for a run resumed after the app was gone: the credential the sign-in
  // step proved lived in memory and is asked for once more.
  const credentialFields = (
    <>
          {provider === "webdav" && (
            <>
              {isInsecurePublicUrl(webdav.url) && (
                <Banner kind="warning">{t("settings.insecureUrlWarning")}</Banner>
              )}
              <label className="m-field">
                <span>{t("mobile.syncUrl")}</span>
                <TextInput
                  purpose="address"
                  inputMode="url"
                  data-testid="sync-webdav-url"
                  onChange={(e) => setWebdav({ ...webdav, url: e.target.value })}
                  placeholder="https://cloud.example.com/remote.php/dav/files/user/vault"
                  value={webdav.url}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.syncUser")}</span>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => setWebdav({ ...webdav, user: e.target.value })}
                  value={webdav.user}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.syncPassword")}</span>
                <TextInput
                  onChange={(e) => setWebdav({ ...webdav, pass: e.target.value })}
                  type="password"
                  value={webdav.pass}
                />
              </label>
            </>
          )}

          {provider === "s3" && (
            <>
              {isInsecurePublicUrl(s3.endpoint) && (
                <Banner kind="warning">{t("settings.insecureUrlWarning")}</Banner>
              )}
              <label className="m-field">
                <span>{t("mobile.s3Endpoint")}</span>
                <TextInput
                  purpose="address"
                  inputMode="url"
                  data-testid="sync-s3-endpoint"
                  onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                  value={s3.endpoint}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Region")}</span>
                <TextInput
                  purpose="address"
                  onChange={(e) => setS3({ ...s3, region: e.target.value })}
                  placeholder="us-east-1 / auto"
                  value={s3.region}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Bucket")}</span>
                <TextInput
                  purpose="address"
                  data-testid="sync-s3-bucket"
                  onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                  value={s3.bucket}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3AccessKeyId")}</span>
                <TextInput
                  purpose="secret"
                  data-testid="sync-s3-key"
                  onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })}
                  value={s3.accessKeyId}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3SecretAccessKey")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })}
                  type="password"
                  value={s3.secretAccessKey}
                />
              </label>
              <label className="m-field">
                <span>{t("mobile.s3Prefix")}</span>
                <TextInput
                  onChange={(e) => setS3({ ...s3, prefix: e.target.value })}
                  value={s3.prefix ?? ""}
                />
              </label>
              {/* Path-style for stores that only answer on the bucket's own host (Play feedback 2026-09-30). */}
              <Row
                title={t("settings.s3PathStyle")}
                end={<Switch checked={s3.forcePathStyle !== false} label={t("settings.s3PathStyle")} onChange={(on) => setS3({ ...s3, forcePathStyle: on })} />}
              />
            </>
          )}
    </>
  );
  const sheets = (
    <>
      {pickFor && (
        <CloudFolderPickerSheet
          listFolders={(path) => listProviderFolders(pickFor, path)}
          createFolder={(path) => createProviderFolder(pickFor, path)}
          onClose={() => setPickFor(null)}
          onPick={(folder) => connectAt(pickFor, folder)}
          title={t("settings.browseFolders")}
        />
      )}
      {accessSheet && (
        <AccountAccessSheet
          family={accessSheet}
          onCancel={() => setAccessSheet(null)}
          onSaved={() => { setAccessSheet(null); connect(); }}
        />
      )}
    </>
  );
  /* NOT "coming in a later step": sync is shipped. The offline queue and
     the sync state live in the same index database, so a failed index
     build is what takes connecting with it (N7). */
  const needsIndex = (
        <EmptyState
          action={
            <Button data-testid="addvault-needs-index-retry" onClick={() => void reloadActiveMobileVault()} variant="tonal">
              {t("sync.retryNow")}
            </Button>
          }
          icon={<CloudOff size={ICON.head} />}
        >
          {t("mobile.needsIndex")}
        </EmptyState>
  );

  // Outside a run there is nothing to set up here: connecting starts in the assistant.
  if (!runFiles || !family) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("mobile.vaultAdd")} />
        <div className="m-settings">
          {!syncPossible(vault) ? needsIndex : <p className="m-hint">{t("mobile.vaultAddViaCloudAccounts")}</p>}
        </div>
      </div>
    );
  }

  const oauth = OAUTH_PROVIDERS.has(provider);
  // The folder is chosen with the sign-in that already happened: Google, Microsoft, Dropbox, or the proven credential.
  const folderRow = oauth || !!proven;
  return (
    <div className="m-page">
      <ConnectRunFrame
        run={runFiles}
        service="files"
        heading={review ? t("connectRun.reviewHeading", { folder: review.folder }) : t("connectRun.filesHeading", { provider: PRODUCT_NAME[provider] ?? familyLabel(family, runFiles.flavor) })}
        hint={review || filesProgress ? undefined : t("connectRun.filesHint")}
        onLeave={onBack}
        failure={error ?? undefined}
        hideOutcome={!!review || !!filesProgress}
        onRetry={busy ? undefined : connect}
        onSignIn={busy ? undefined : connect}
      >
        {!syncPossible(vault) ? needsIndex : review ? (
          <TransferReviewStep review={review} onOtherFolder={() => { void import("./services/accountVaultTransfer").then((m) => m.transfersSettled()).then(connect); }} />
        ) : filesProgress ? (
          <GroupCard>
            <RowList>
              <Row
                icon={<span className="m-actionspin" aria-hidden />}
                title={t(filesProgress.phase === "copying" ? "connectRun.copying" : "connectRun.checking")}
                data-testid="files-connect-progress"
              />
            </RowList>
          </GroupCard>
        ) : (
          <>
            {!folderRow && credentialFields}
            {folderRow && (
              <GroupCard>
                <RowList>
                  <Row
                    icon={<FolderOpen size={ICON.ui} />}
                    title={t("connectRun.folder")}
                    subtitle={t("connectRun.folderNone")}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={busy ? undefined : connect}
                    data-testid="connectrun-folder"
                  />
                </RowList>
              </GroupCard>
            )}
            <ConnectRunFooter
              run={runFiles}
              service="files"
              disabled={busy}
              primary={<Button variant="primary" disabled={busy || !canConnect} onClick={connect} data-testid="connectrun-choose-folder">{t("connectRun.chooseFolder")}</Button>}
            />
          </>
        )}
      </ConnectRunFrame>
      {sheets}
    </div>
  );
}
