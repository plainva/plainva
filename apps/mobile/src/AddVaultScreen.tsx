import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "./hooks/useLeaveGuard";
import { ChevronRight, CloudOff, FolderOpen } from "lucide-react";
import { Banner, Button, EmptyState, GroupCard, RowList, accessProblemKey, filesTargetForFamily, foldMachineText, ICON, Row, Switch, TextInput, familyLabel, getVaultTemplates, isInsecurePublicUrl, serviceConnectionMessage, unionScope, type AccessResolution, type CloudProviderFamily, type OAuthFamily } from "@plainva/ui";
import { mSelect } from "./services/mobileDialogs";
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
import { deviceAccess } from "./services/accountSignIn";
import { AccountAccessSheet } from "./components/AccountAccessSheet";
import { getPimCredentials } from "./services/pim/pimCredentials";
import { loadCloudAccounts } from "./services/cloudAccountsStore";
import { useConnectionRun } from "./hooks/useConnectionRun";
import { reloadActiveMobileVault, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";
import { ConnectRunFooter, ConnectRunFrame } from "./components/ConnectRunFrame";
import { TransferReviewStep, useInlineTransferReview } from "./components/TransferReviewHost";
import { rememberConnectSecrets } from "./services/connectSecrets";
import { loadConnectQueue, runServices } from "./services/connectQueue";
import { runConsentScope } from "./services/connectConsent";
import { trimEndChars } from "@plainva/core";

type ProviderId = MobileSyncProvider["provider"];

const OAUTH_PROVIDERS: ReadonlySet<ProviderId> = new Set(["drive", "onedrive", "dropbox"]);

const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = [
  { value: "webdav", label: "WebDAV / Nextcloud" },
  { value: "s3", label: "S3 (AWS / R2 / MinIO …)" },
  { value: "drive", label: "Google Drive" },
  { value: "onedrive", label: "OneDrive" },
  { value: "dropbox", label: "Dropbox" },
];

/**
 * "Add cloud vault" screen (M3.6 vault-management rework): pure connect
 * form. Connecting creates a fresh, isolated vault container for that
 * cloud location and switches to it; per-vault actions (rename, pause,
 * delete) live on the vault detail screen.
 *
 * Create mode (2026-07-13, `createTemplateId` set — "" = empty vault): same
 * form, but the fresh container is scaffolded with the pre-picked structure
 * template before the first sync uploads it into the (new) cloud folder.
 */
export function AddVaultScreen({
  vault,
  onBack,
  createTemplateId,
  family,
}: {
  vault: MobileVault;
  onBack: () => void;
  createTemplateId?: string;
  /**
   * Set when the user came through the connect wizard and already picked a
   * provider there (S0a). The provider row then SHOWS that family instead of
   * asking again — the reported bug was that this screen started on "webdav"
   * regardless, so choosing Google led straight to a WebDAV form.
   */
  family?: CloudProviderFamily;
}) {
  const { t, i18n } = useTranslation();
  const connectionRun = useConnectionRun();
  const createMode = createTemplateId !== undefined;
  const runFiles = !createMode && family && connectionRun?.pending[0] === "files" ? connectionRun : null;
  const pendingReview = useInlineTransferReview(!!runFiles);
  // Only this run's review: one a replaced run left is answered by the host, never shown here.
  const review = pendingReview && (!pendingReview.runId || pendingReview.runId === runFiles?.id) ? pendingReview : null;
  // A family that cannot carry files never reaches this screen (the wizard only
  // offers the services FAMILY_SERVICES lists), so a null target here means the
  // user came in directly and picks the provider as before.
  const preset = family ? filesTargetForFamily(family) : null;
  const [runScope, setRunScope] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProviderId>(preset?.provider ?? "webdav");
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
  // Dropbox ships with a central Plainva registration, so its own app key
  // stays optional. Google Drive and OneDrive sign in with this device's
  // access, like every other sign-in (account sign-in plan K4b).
  const [ownAppId, setOwnAppId] = useState("");
  const accessFamily: OAuthFamily | null = provider === "drive" ? "google" : provider === "onedrive" ? "microsoft" : null;
  const [access, setAccess] = useState<AccessResolution | null>(null);
  const [accessSheet, setAccessSheet] = useState(false);
  useEffect(() => {
    if (!accessFamily) return;
    let alive = true;
    void deviceAccess(accessFamily).then((resolved) => { if (alive) setAccess(resolved); });
    return () => { alive = false; };
  }, [accessFamily]);
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
    setOwnAppId("");
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
    !!(webdav.url || webdav.user || webdav.pass || s3.bucket || s3.accessKeyId || s3.secretAccessKey || ownAppId),
    t("mobile.leaveCredentials", { defaultValue: "Die eingegebenen Zugangsdaten gehen verloren." }),
  );

  const connect = () => {
    setBusy(true);
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      // Opens the system browser; the redirect handler finishes the connect
      // (which creates and activates the new vault).
      // The cloud folder is chosen AFTER the browser returns a token (#10),
      // via the folder picker — there is no token to browse with beforehand.
      // In create mode the template id travels in the persisted transaction,
      // so it survives a cold start during consent.
      // Inside a multi-service run this ONE consent covers the whole account
      // (S0b3), so the services after it need none. Outside a run — the direct
      // "connect with cloud" entry — `runScope` is null and the provider's own
      // default scope applies, exactly as before.
      void (async () => {
        if (!createMode && connectionRun?.context && await beginStoredFilesConnection(connectionRun.context)) return;
        if (accessFamily) {
          const resolved = await deviceAccess(accessFamily);
          setAccess(resolved);
          if (!resolved.ok) { setAccessSheet(true); return; }
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
        clientId: ownAppId.trim() || undefined,
        ...(runScope ? { scope: runScope } : {}),
        ...(createMode ? { createTemplateId } : {}),
        serviceContext: connectionRun?.context,
        });
      })()
        .catch((e: unknown) => setError(e ?? "failed"))
        .finally(() => setBusy(false));
      return;
    }
    const p: MobileSyncProvider =
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
          };
    setBusy(false);
    setPickFor(p);
  };

  const connectAt = (p: MobileSyncProvider, folder: string) => {
    setPickFor(null);
    setBusy(true);
    // A suite (Nextcloud, Fastmail, …) asks for the same credentials at every
    // step of the run. Carried in memory only, never persisted (E4); the later
    // screens read it only when they were opened BY the run (they carry a
    // family), so a direct visit never sees a stale prefill.
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
    provider === "webdav"
      ? webdav.url.trim().length > 0
      : provider === "s3"
        ? s3.endpoint.trim().length > 0 &&
          s3.bucket.trim().length > 0 &&
          s3.accessKeyId.length > 0 &&
          s3.secretAccessKey.length > 0
        : true;

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
              {/* The desktop's form has had this switch from the start; the
                  phone's had none, so a store that only answers on the
                  bucket's own host (virtual-hosted style) could not be set up
                  here at all (Play feedback 2026-09-30). */}
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
      {accessSheet && accessFamily && (
        <AccountAccessSheet
          family={accessFamily}
          onCancel={() => setAccessSheet(false)}
          onSaved={() => { setAccessSheet(false); void deviceAccess(accessFamily).then(setAccess); }}
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

  // A step of the account setup (plan "Verbinden-Assistent", 2026-10-28;
  // device finding 2026-10-28): the frame of the setup and ONE question -
  // which folder. Provider and sign-in are settled by now (E5); the review of
  // what the copy does is the step's content (E4).
  if (runFiles && family) {
    const oauth = OAUTH_PROVIDERS.has(provider);
    return (
      <div className="m-page">
        <ConnectRunFrame
          run={runFiles}
          service="files"
          // The files service by its product name: "Google Drive", not "Google".
          heading={review ? t("connectRun.reviewHeading", { folder: review.folder }) : t("connectRun.filesHeading", { provider: oauth ? PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ?? familyLabel(family) : familyLabel(family) })}
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
              {!oauth && credentialFields}
              {oauth && (
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

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={createMode ? t("mobile.vaultCreateOnlineTitle") : t("mobile.vaultAdd")} />

      {!syncPossible(vault) ? needsIndex : (
        <div className="m-settings">
          <p className="m-hint">{t("mobile.syncCreatesVaultHint")}</p>
          {error !== null && <Banner kind="error" rounded>{serviceConnectionMessage(error, t)}</Banner>}
          {filesProgress && (
            <Banner kind="info" rounded>
              <span data-testid="files-connect-progress">
                {t(filesProgress.phase === "copying" ? "connection.filesCopying" : "connection.filesChecking")}
              </span>
            </Banner>
          )}

          {/* Came through the wizard: the provider is settled, so this states it
              rather than asking a second time. Suite families (Fastmail, Koofr,
              …) technically bind WebDAV, but the row names the FAMILY — showing
              "WebDAV" after someone tapped the Fastmail tile would be the same
              break in a quieter form. */}
          {family ? (
            <div className="m-row" data-testid="sync-provider-fixed">
              <span>{t("mobile.syncProvider")}</span>
              <span className="m-prop-val">{familyLabel(family)}</span>
            </div>
          ) : (
            <button
              className="m-row"
              onClick={() =>
                void mSelect({
                  title: t("mobile.syncProvider"),
                  options: PROVIDER_OPTIONS,
                  value: provider,
                }).then((v) => {
                  if (v !== null) setProvider(v as ProviderId);
                })
              }
            >
              <span>{t("mobile.syncProvider")}</span>
              <span className="m-prop-val">
                {PROVIDER_OPTIONS.find((o) => o.value === provider)?.label}
              </span>
              <ChevronRight className="m-chevron" size={ICON.head} />
            </button>
          )}

          {credentialFields}

          {accessFamily && (
            <Row
              data-testid="vault-access"
              title={t("accountAccess.lineLabel")}
              subtitle={!access ? "" : access.ok ? (access.access.source === "plainva" ? t("accountAccess.plainva") : t("accountAccess.ownLine", { id: access.access.clientId })) : t(accessProblemKey(access.problem))}
              end={<ChevronRight className="m-chevron" size={ICON.ui} />}
              onClick={() => setAccessSheet(true)}
              wrap
            />
          )}

          {provider === "dropbox" && (
            <label className="m-field">
              <span>{t("mobile.syncOwnAppKey")}</span>
              <TextInput onChange={(e) => setOwnAppId(e.target.value)} value={ownAppId} />
              <small className="m-hint">{t("mobile.syncOwnAppIdHint")}</small>
            </label>
          )}

          {OAUTH_PROVIDERS.has(provider) && (
            <p className="m-hint">{t("mobile.syncFolderAfterConnect")}</p>
          )}

          <div className="m-sync-actions">
            <Button variant="primary" disabled={busy || !!filesProgress || !canConnect} onClick={connect}>
              {t("mobile.syncConnect")}
            </Button>
          </div>
        </div>
      )}

      {sheets}
    </div>
  );
}
