import React, { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { assertEmptyRemoteVault, trimEndChars } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import { credentialManager } from "../services/CredentialManager";
import { authorizeDrive } from "../services/driveAuth";
import { authorizeOneDrive } from "../services/oneDriveAuth";
import { authorizeDropbox } from "../services/dropboxAuth";
import { cancelOAuthLoopback, oauthErrorText } from "../services/oauthLoopback";
import {
  buildWebDavTarget,
  buildDriveTarget,
  buildOneDriveTarget,
  buildDropboxTarget,
  buildS3Target,
  type S3TargetCreds,
} from "../services/syncTargets";
import { SyncFolderPickerModal } from "./SyncFolderPickerModal";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import {
  Banner,
  Button,
  CONNECT_PROVIDERS,
  FAMILY_SERVICES,
  ICON,
  OAuthAccessEditor,
  SearchField,
  SettingCardNote,
  SettingRow,
  WizardSteps,
  accessProblemKey,
  accessSummary,
  connectAccessPlan,
  connectFieldsComplete,
  foldMachineText,
  nextcloudEndpoints,
  plainvaGoogleClient,
  searchConnectProviders,
  shortClientId,
  shownConnectFields,
  suiteProvider,
  unionScope,
  type AccessFamily,
  type AccessResolution,
  type ConnectProvider,
  type DropboxAccessResolution,
  type StoredOAuthAccess,
  type WizardStepItem,
} from "@plainva/ui";
import { adoptOnlineVaultSignIn, deviceAccess, readDeviceAccess, saveDeviceAccess } from "../services/accountSignIn";
import type { ServiceRunStatus } from "../services/cloudAccountsActions";
import {
  scaffoldVaultTemplate,
  applyVaultTemplateSettings,
  isVaultFolderEmpty,
  type VaultTemplateDefinition,
} from "../services/vaultTemplates";
import { AccountMark, SERVICE_ICONS, familyLabel } from "./settings/cloudAccountsShared";
import { ConnectFieldsCard, ConnectOtherCard, ConnectSummaryCard, ServiceStatusCard, connectValue, failedServiceStatus, type ConnectValues } from "./settings/ConnectSignInStep";

// The freshly authorized (OAuth) / entered (WebDAV, S3) credentials, held in
// memory until the local vault folder is chosen. refreshToken is mutable so a
// rotation during folder browsing (OneDrive/Dropbox) is carried into the save.
type Connected =
  | { provider: "webdav"; url: string; user: string; pass: string }
  | { provider: "drive"; clientId: string; clientSecret: string; refreshToken: string }
  | { provider: "onedrive"; clientId: string; refreshToken: string }
  | { provider: "dropbox"; appKey: string; refreshToken: string }
  | { provider: "s3"; s3: S3TargetCreds };

interface Props {
  /**
   * "open" (default) connects to an EXISTING cloud vault; "create" additionally
   * scaffolds `template` into the chosen local folder BEFORE the credentials
   * are bound — the first sync cycle then uploads the fresh structure into the
   * (new) cloud folder (`enqueueLocalOnlyFiles` after the empty first pull).
   */
  mode?: "open" | "create";
  /** Create mode only: the structure template chosen up front (null = empty vault). */
  template?: VaultTemplateDefinition | null;
  onBack: () => void;
}

const ACTIONS: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" };

/**
 * Every provider that can carry a vault's files - the suites and Nextcloud
 * included. Read when the tiles draw, never while this module loads (C20).
 */
const fileProviders = () => CONNECT_PROVIDERS.filter((provider) => FAMILY_SERVICES[provider.family].includes("files"));

/**
 * "Vault in the cloud" from the start screen: the same assistant as
 * connecting an account in the settings (settings plan 2026-10-29, E7) - the
 * provider tiles with their search, the sign-in step drawn from
 * `connectAccessPlan` with its head, "Other sign-in" and the status line,
 * then the cloud folder and the local folder. What only this door does
 * stays: there is no vault yet, so the sign-in is held in memory and bound to
 * the local folder at the end, and a new vault is scaffolded into an empty
 * cloud folder.
 */
export const OnlineVaultSetup: React.FC<Props> = ({ mode = "open", template = null, onBack }) => {
  const { t } = useTranslation();
  const { openVault } = useVault();

  const [tile, setTile] = useState<ConnectProvider | null>(null);
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<ConnectValues>({});
  const [otherOpen, setOtherOpen] = useState(false);
  const family = tile?.family ?? null;
  const accessFamily: AccessFamily | null = family === "google" || family === "microsoft" || family === "dropbox" ? family : null;
  const [access, setAccess] = useState<AccessResolution | DropboxAccessResolution | null>(null);
  const [storedAccess, setStoredAccess] = useState<StoredOAuthAccess | null>(null);
  useEffect(() => {
    if (!accessFamily) return;
    let alive = true;
    void (async () => {
      const stored = await readDeviceAccess(accessFamily);
      const resolved = await deviceAccess(accessFamily);
      if (!alive) return;
      setStoredAccess(stored);
      setAccess(resolved);
      if (!resolved.ok) setOtherOpen(true);
    })();
    return () => { alive = false; };
  }, [accessFamily]);

  // A ref, not state: the folder-listing rotation callback mutates it without a
  // re-render, and the final save reads the latest value.
  const credsRef = useRef<Connected | null>(null);
  const [status, setStatus] = useState<ServiceRunStatus | undefined>(undefined);
  const connected = status?.state === "ok";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudFolder, setCloudFolder] = useState<string | null>(null);
  /** The picker's root, named when the sign-in succeeds: the server's host, the bucket, the drive. */
  const [rootLabel, setRootLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerName = family ? familyLabel(family, tile?.flavor) : "";
  const plan = family ? connectAccessPlan({ family, flavor: tile?.flavor, services: ["files"], providerName }) : null;
  const oauthKind = plan?.kind === "oauthDevice" || plan?.kind === "oauthAppKey";
  const otherShown = otherOpen || (!!accessFamily && !!access && !access.ok);
  const fields = plan ? shownConnectFields(plan, otherShown && !oauthKind) : [];
  const getBasename = (path: string) => path.split(/[/\\]/).pop() || path;
  const value = (id: keyof ConnectValues) => {
    const entry = [...(plan?.fields ?? []), ...(plan?.other?.fields ?? [])].find((f) => f.id === id);
    return (entry ? connectValue(values, entry) : (values[id] ?? "")).trim();
  };
  const address = (id: keyof ConnectValues) => foldMachineText(value(id));

  const pick = (def: ConnectProvider | null) => {
    setTile(def);
    setValues({});
    setOtherOpen(false);
    setAccess(null);
    setStatus(undefined);
    setError(null);
    credsRef.current = null;
  };

  /** The files address of a provider with credentials: Nextcloud derives it, a suite knows it, WebDAV is asked. */
  const webdavUrl = (): string => {
    if (!family) return "";
    const suite = suiteProvider(family);
    const endpointsOpen = otherShown && plan?.other?.holds === "endpoints";
    if (family === "webdav" && tile?.flavor === "nextcloud" && !endpointsOpen) return nextcloudEndpoints(address("server"), value("user"))?.files ?? "";
    if (suite && !endpointsOpen) return suite.endpoints.webdavUrl ?? "";
    return address("filesUrl");
  };

  // Step "sign in": the browser for Google, Microsoft and Dropbox, a probe of
  // the credentials or keys for the others - then the cloud folder picker.
  const handleConnect = async () => {
    if (!family) return;
    setBusy(true);
    setError(null);
    setStatus({ state: "pending" });
    try {
      if (family === "google" || family === "microsoft") {
        if (!access?.ok || !("mail" in access.access)) return;
        if (family === "google") {
          // The identity scopes ride along: the card is written from this consent.
          const creds = await authorizeDrive({ clientId: access.access.clientId, clientSecret: access.access.clientSecret ?? "", scope: unionScope("google", ["files"]) });
          credsRef.current = { provider: "drive", clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken };
        } else {
          const creds = await authorizeOneDrive({ clientId: access.access.clientId, scope: unionScope("microsoft", ["files"]) });
          credsRef.current = { provider: "onedrive", clientId: creds.clientId, refreshToken: creds.refreshToken };
        }
      } else if (family === "dropbox") {
        if (!access?.ok) return;
        const creds = await authorizeDropbox({ appKey: access.access.clientId });
        credsRef.current = { provider: "dropbox", ...creds };
      } else if (family === "s3") {
        const s3: S3TargetCreds = {
          endpoint: address("endpoint"),
          region: address("region") || "us-east-1",
          bucket: address("bucket"),
          accessKeyId: address("accessKeyId"),
          secretAccessKey: values.secret ?? "",
          forcePathStyle: value("pathStyle") !== "off",
        };
        // The keys are tried before "connected" is said - as every other provider's are.
        await buildS3Target(s3).listFolders("");
        credsRef.current = { provider: "s3", s3 };
      } else {
        const creds = { url: webdavUrl(), user: suiteProvider(family) ? value("email") : value("user"), pass: values.secret ?? "" };
        // Connection probe: a wrong host/credential pair (401, network, HTML
        // landing page) must surface HERE, not in the picker.
        await buildWebDavTarget(creds).listFolders("");
        credsRef.current = { provider: "webdav", ...creds };
      }
      const c = credsRef.current;
      setRootLabel(
        c?.provider === "webdav"
          ? (() => { try { return new URL(c.url).host || providerName; } catch { return providerName; } })()
          : c?.provider === "s3"
            ? c.s3.bucket || providerName
            : family === "google" ? "Google Drive" : family === "microsoft" ? "OneDrive" : providerName,
      );
      setStatus({ state: "ok" });
      setPickerOpen(true); // open the cloud folder picker right away
    } catch (e) {
      setStatus(failedServiceStatus(e, t, providerName));
    } finally {
      setBusy(false);
    }
  };

  // Cloud folder listing for the picker, from the in-memory credentials. A
  // OneDrive/Dropbox token rotation during browsing updates credsRef in place.
  const target = useCallback(() => {
    const c = credsRef.current;
    if (!c) return null;
    if (c.provider === "webdav") return buildWebDavTarget(c);
    if (c.provider === "drive") return buildDriveTarget(c);
    if (c.provider === "onedrive") return buildOneDriveTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; });
    if (c.provider === "dropbox") return buildDropboxTarget(c, (refreshToken) => { credsRef.current = { ...c, refreshToken }; });
    return buildS3Target(c.s3);
  }, []);
  const listFolders = useCallback((path: string): Promise<string[]> => target()?.listFolders(path) ?? Promise.resolve([]), [target]);
  // The picker's "new folder" row (2026-07-13) — the create flow's way to give
  // the fresh vault its own cloud folder; available while opening too (E6).
  const createFolderAt = useCallback((path: string): Promise<void> => target()?.createFolder(path) ?? Promise.resolve(), [target]);

  // Last step: pick/create the local folder, scaffold in create mode, bind the
  // credentials to it, open. Scaffolding runs BEFORE the credentials exist on
  // disk, so no sync can observe a half-written structure.
  const handlePickLocalAndOpen = async () => {
    const c = credsRef.current;
    if (!c) return;
    const localDir = await open({ directory: true, multiple: false, title: t("splash.selectLocalFolderTitle") });
    if (!localDir || typeof localDir !== "string") return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        if (!(await isVaultFolderEmpty(localDir))) throw new Error(t("splash.folderNotEmptyConfirm", { name: getBasename(localDir) }));
        const folder = cloudFolder?.trim() || undefined;
        const remote = c.provider === "webdav" ? buildWebDavTarget({ ...c, url: folder ? `${trimEndChars(c.url, "/")}/${folder.split("/").map(encodeURIComponent).join("/")}` : c.url })
          : c.provider === "drive" ? buildDriveTarget({ ...c, rootFolderName: folder })
          : c.provider === "onedrive" ? buildOneDriveTarget({ ...c, rootFolderName: folder }, token => { c.refreshToken = token; })
          : c.provider === "dropbox" ? buildDropboxTarget({ ...c, rootPath: folder ? `/${folder.replace(/^\/+/, "")}` : undefined }, token => { c.refreshToken = token; })
          : buildS3Target({ ...c.s3, prefix: folder });
        await assertEmptyRemoteVault(remote);
        const adapter = new TauriVaultAdapter(localDir);
        await adapter.initialize();
        await scaffoldVaultTemplate({ isNewVault: true,
          adapter,
          template,
          vaultName: getBasename(localDir),
          subfoldersHeading: t("indexMd.subfoldersHeading"),
          // Made for this new cloud folder: the template is what it is to hold.
          recordStarter: false,
        });
        await applyVaultTemplateSettings(localDir, template);
      }
      const folder = cloudFolder?.trim() || undefined;
      if (c.provider === "webdav") {
        const base = trimEndChars(c.url, "/");
        const url = folder ? `${base}/${folder.split("/").map(encodeURIComponent).join("/")}` : c.url;
        await credentialManager.saveWebDavCredentials(localDir, { url, user: c.user, pass: c.pass });
      } else if (c.provider === "drive") {
        await credentialManager.saveDriveCredentials(localDir, { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "onedrive") {
        await credentialManager.saveOneDriveCredentials(localDir, { clientId: c.clientId, refreshToken: c.refreshToken, rootFolderName: folder });
      } else if (c.provider === "dropbox") {
        await credentialManager.saveDropboxCredentials(localDir, { appKey: c.appKey, refreshToken: c.refreshToken, rootPath: folder ? `/${folder.replace(/^\/+/, "")}` : undefined });
      } else {
        await credentialManager.saveS3Credentials(localDir, { ...c.s3, prefix: folder });
      }
      // Google and Microsoft: the sign-in becomes the card's, with its identity,
      // before the vault opens (K4b). Nothing half-bound stays behind.
      if ((c.provider === "drive" || c.provider === "onedrive") && (family === "google" || family === "microsoft") && access?.ok && "mail" in access.access) {
        try {
          await adoptOnlineVaultSignIn(localDir, family, access as Extract<AccessResolution, { ok: true }>, c.refreshToken);
        } catch (error) {
          if (c.provider === "drive") await credentialManager.clearDriveCredentials(localDir);
          else await credentialManager.clearOneDriveCredentials(localDir);
          throw new Error(oauthErrorText(error), { cause: error });
        }
      }
      window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection: true } }));
      // Register the connection as a cloud account (files service) so the new
      // vault gates/greets correctly without visiting the settings first.
      await import("../services/cloudAccounts")
        .then((m) => m.refreshCloudAccounts(localDir, null))
        .catch(() => undefined);
      await openVault(localDir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stepState = (n: 1 | 2 | 3 | 4): WizardStepItem["state"] => {
    const at = !tile ? 1 : !connected ? 2 : 3;
    return n < at ? "done" : n === at ? "active" : "pending";
  };
  const steps = (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <WizardSteps
        label={t("connectRun.stepsLabel")}
        steps={[
          { key: "provider", label: tile ? providerName : t("cloudAccounts.stepProvider"), state: stepState(1) },
          { key: "signin", label: t("cloudAccounts.stepSignIn"), state: stepState(2) },
          { key: "folder", label: t("connectRun.stepFiles"), state: stepState(3) },
          { key: "open", label: t("cloudAccounts.finish"), state: stepState(4) },
        ]}
      />
    </div>
  );
  const heading = (
    <h2 style={{ fontSize: "var(--text-headline)", marginBottom: "var(--space-2)" }}>{mode === "create" ? t("splash.newVaultOnlineTitle") : t("splash.openOnlineVault")}</h2>
  );

  /* ---------- provider ---------- */
  if (!tile || !plan || !family) {
    const { visible } = searchConnectProviders(query, (p) => familyLabel(p.family, p.flavor), fileProviders());
    return (
      <div data-testid="online-setup">
        {heading}
        {steps}
        <SearchField
          value={query}
          onValueChange={setQuery}
          clearLabel={t("sidebar.clearSearch")}
          placeholder={t("cloudAccounts.searchProviders")}
          aria-label={t("cloudAccounts.searchProviders")}
          data-testid="online-provider-search"
          className="pv-provtile-search"
        />
        <div className="pv-provtile-grid">
          {visible.map((def) => (
            <button key={def.key} type="button" className="pv-provtile" onClick={() => pick(def)} data-testid={`online-provider-${def.key}`}>
              <AccountMark family={def.family} flavor={def.flavor} small />
              <span className="pv-provtile-name">{familyLabel(def.family, def.flavor)}</span>
              <span className="pv-provtile-caps"><SERVICE_ICONS.files size={ICON.meta} /></span>
            </button>
          ))}
        </div>
        {visible.length === 0 && <SettingCardNote>{t("cloudAccounts.searchNoProvider")}</SettingCardNote>}
        <div style={ACTIONS}>
          <Button variant="ghost" onClick={onBack}>{t("splash.back")}</Button>
        </div>
      </div>
    );
  }

  const headText = oauthKind
    ? access
      ? accessSummary(plan, access.ok ? { ok: true, source: access.access.source, id: shortClientId(access.access.clientId) } : { ok: false, problemKey: accessProblemKey(access.problem) })
      : null
    : plan.summary;

  return (
    <div data-testid="online-setup">
      {heading}
      {steps}
      {error && <Banner kind="error" rounded>{error}</Banner>}
      <ConnectSummaryCard family={family} flavor={tile.flavor} services={["files"]} line={headText ? t(headText.key, headText.values) : ""} />
      {!connected && (
        <>
          <ConnectFieldsCard plan={plan} fields={fields} values={values} disabled={busy} onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))} />
          <ConnectOtherCard plan={plan} open={otherShown} disabled={busy} onToggle={() => setOtherOpen(!otherShown)} />
          {otherShown && accessFamily && access && (
            <OAuthAccessEditor
              family={accessFamily}
              platform="desktop"
              value={storedAccess}
              plainvaAvailable={accessFamily !== "google" || !!plainvaGoogleClient(import.meta.env as unknown as Record<string, unknown>, "desktop")}
              onSave={async (next) => {
                await saveDeviceAccess(accessFamily, next);
                setStoredAccess(next);
                const resolved = await deviceAccess(accessFamily);
                setAccess(resolved);
                if (resolved.ok) setOtherOpen(false);
              }}
              onCancel={access.ok ? () => setOtherOpen(false) : undefined}
            />
          )}
        </>
      )}
      <ServiceStatusCard services={["files"]} status={status ? { files: status } : {}} waitingKey={plan.waitingKey}>
        {connected && (
          <SettingRow label={t("splash.cloudFolderLabel")} desc={cloudFolder ? `${rootLabel} / ${cloudFolder}` : t("splash.cloudFolderRoot", { root: rootLabel })}>
            <Button variant="secondary" size="sm" icon={<Cloud size={ICON.meta} />} onClick={() => setPickerOpen(true)} disabled={busy} data-testid="online-choose-folder">
              {t("settings.browseFolders")}
            </Button>
          </SettingRow>
        )}
        {connected && mode === "create" && <SettingCardNote>{t("splash.createTemplateHint", { name: template?.name ?? t("splash.emptyVault") })}</SettingCardNote>}
      </ServiceStatusCard>

      <div style={ACTIONS}>
        {!connected && (
          // While an OAuth wait is running, "back" would leave it pending for
          // its full three minutes and hold the port: the same button aborts it (N1/S1).
          <Button variant="ghost" onClick={busy && oauthKind ? () => void cancelOAuthLoopback() : () => pick(null)} disabled={busy && !oauthKind}>
            {busy && oauthKind ? t("common.cancel") : t("splash.back")}
          </Button>
        )}
        {!connected && (
          <Button
            variant="primary"
            disabled={busy || (oauthKind && !access?.ok) || !connectFieldsComplete(fields, values)}
            onClick={() => void handleConnect()}
            data-testid="online-connect"
          >
            {busy ? t("splash.connecting") : status?.state === "error" ? t("cloudAccounts.retry") : t(plan.button.key, plan.button.values)}
          </Button>
        )}
        {connected && (
          <>
            <Button variant="ghost" onClick={onBack} disabled={busy}>{t("common.cancel")}</Button>
            <Button variant="primary" icon={<FolderOpen size={ICON.meta} />} onClick={() => void handlePickLocalAndOpen()} disabled={busy} data-testid="online-pick-local">
              {t("splash.pickLocalAndOpen")}
            </Button>
          </>
        )}
      </div>

      {pickerOpen && (
        <SyncFolderPickerModal
          listFolders={listFolders}
          createFolder={createFolderAt}
          rootLabel={rootLabel}
          allowRoot
          onSelect={(picked) => { setCloudFolder(picked); setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
};
