import React, { useState, useRef, useEffect } from "react";
import { useVault } from "../contexts/VaultContext";
import { FolderOpen, Cloud, ArrowRight, Folder, Plus, HardDrive, X, FilePlus2, CloudCog, Box, Server, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WebDavFolderPickerModal } from "./WebDavFolderPickerModal";
import { OnlineVaultSetup } from "./OnlineVaultSetup";
import { credentialManager } from "../services/CredentialManager";
import { open } from "@tauri-apps/plugin-dialog";
import { appConfirm } from "../services/appDialogs";
import { Checkbox } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { Modal } from "@plainva/ui";
import { forgetVaultData } from "../services/vaultForget";
import { toast } from "@plainva/ui";
import { PlainvaLogo } from "./PlainvaLogo";
import { WindowChromeStrip } from "./WindowControls";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import { PLAINVA_ONEDRIVE_CLIENT_ID, PLAINVA_DROPBOX_APP_KEY } from "@plainva/ui";
import { GDRIVE_BYO_GUIDE, ONEDRIVE_DROPBOX_BYO_GUIDE, userGuideUrl } from "../services/docsLinks";
import {
  getVaultTemplates,
  templatePreviewFolders,
  templatePreviewBases,
  scaffoldVaultTemplate,
  applyVaultTemplateSettings,
  isVaultFolderEmpty,
  type VaultTemplateDefinition,
} from "../services/vaultTemplates";

export const SplashScreen: React.FC = () => {
  const { selectVault, openVault, recentVaults, error, removeRecentVault, autoOpenLastVault, setAutoOpenLastVault } = useVault();
  const { t, i18n } = useTranslation();
  const [showWebDavForm, setShowWebDavForm] = useState(false);
  const [showCreateChooser, setShowCreateChooser] = useState(false);
  const [showOnlineChooser, setShowOnlineChooser] = useState(false);
  const [onlineSetupProvider, setOnlineSetupProvider] = useState<"drive" | "onedrive" | "dropbox" | "s3" | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  // Remove-recent dialog (E1 2026-07-09): list-only removal vs. forgetting all
  // per-vault app data; ZIP backups only via the explicit opt-in checkbox.
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [forgetZips, setForgetZips] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const getBasename = (path: string) => path.split(/[/\\]/).pop() || path;

  // Scroll-edge (UI 2.0): fade the recent-vaults list ONLY when it actually
  // overflows and isn't scrolled to the bottom, so the last (possibly hovered)
  // row is never obscured — maintainer report: the list looked cut off.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [listOverflow, setListOverflow] = useState(false);
  useEffect(() => {
    const el = listScrollRef.current;
    setListOverflow(!!el && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, [recentVaults.length]);

  const handleRemoveOnlyList = async () => {
    if (!removeTarget) return;
    const path = removeTarget;
    setRemoveTarget(null);
    await removeRecentVault(path);
  };

  const handleForgetAppData = async () => {
    if (!removeTarget) return;
    const path = removeTarget;
    setForgetting(true);
    try {
      const result = await forgetVaultData(path, { deleteZipBackups: forgetZips });
      await removeRecentVault(path);
      if (result.ok) {
        toast.info(t("splash.removeForgotten", { name: getBasename(path) }));
      } else {
        toast.warning(t("splash.removeForgetPartial", { name: getBasename(path), what: result.errors.join(", ") }));
      }
    } finally {
      setForgetting(false);
      setRemoveTarget(null);
    }
  };

  const handleWebDavNext = () => {
    if (url && user && pass) setShowPicker(true);
  };

  const handleWebDavFolderSelected = async (remoteUrl: string) => {
    setShowPicker(false);
    const localDir = await open({ directory: true, multiple: false, title: t("splash.selectLocalFolderTitle") });
    if (localDir && typeof localDir === "string") {
      await credentialManager.saveWebDavCredentials(localDir, { url: remoteUrl, user, pass });
      window.dispatchEvent(new CustomEvent("plainva-credentials-saved"));
      await openVault(localDir);
    }
  };

  /**
   * All four cloud providers now follow the WebDAV pattern (connect -> pick the
   * cloud folder -> pick/create the local folder -> open) via OnlineVaultSetup,
   * instead of the old "local folder first, then deep-link into Settings" flow.
   */
  const handleOnlineProvider = (provider: "drive" | "onedrive" | "dropbox" | "s3") => {
    setShowOnlineChooser(false);
    setOnlineSetupProvider(provider);
  };

  // Honest onboarding (P3.12): OAuth providers without a central app
  // registration need the user's OWN client id — the badge says so up front
  // instead of a connect button that silently dead-ends. Disappears by itself
  // once providerDefaults carries real ids (maintainer items M-A/M-B).
  const onlineProviders: { id: "webdav" | "drive" | "onedrive" | "dropbox" | "s3"; name: string; desc: string; Icon: React.ElementType; byo?: boolean }[] = [
    { id: "webdav", name: t("settings.providerWebDav"), desc: t("splash.providerWebDavDesc"), Icon: Cloud },
    { id: "drive", name: t("settings.providerDrive"), desc: t("splash.providerDriveDesc"), Icon: HardDrive, byo: true },
    { id: "onedrive", name: t("settings.providerOneDrive"), desc: t("splash.providerOneDriveDesc"), Icon: CloudCog, byo: !PLAINVA_ONEDRIVE_CLIENT_ID },
    { id: "dropbox", name: t("settings.providerDropbox"), desc: t("splash.providerDropboxDesc"), Icon: Box, byo: !PLAINVA_DROPBOX_APP_KEY },
    { id: "s3", name: t("settings.providerS3"), desc: t("splash.providerS3Desc"), Icon: Server },
  ];

  /**
   * "Create New Vault" chooser result: pick/create a folder in the OS dialog,
   * scaffold the template (or just the bundle-root index.md), then open. The
   * scaffolder never overwrites existing files; a non-empty folder needs one
   * confirmation.
   */
  const handleCreateVault = async (template: VaultTemplateDefinition | null) => {
    const selected = await open({ directory: true, multiple: false, title: t("splash.selectNewVaultFolderTitle") });
    if (!selected || typeof selected !== "string") return;
    setCreating(true);
    setCreateError(null);
    try {
      if (!(await isVaultFolderEmpty(selected))) {
        const proceed = await appConfirm({
          title: t("splash.createVault"),
          message: t("splash.folderNotEmptyConfirm", { name: getBasename(selected) }),
          kind: "warning",
        });
        if (!proceed) return;
      }
      const adapter = new TauriVaultAdapter(selected);
      await adapter.initialize();
      await scaffoldVaultTemplate({
        adapter,
        template,
        vaultName: getBasename(selected),
        subfoldersHeading: t("indexMd.subfoldersHeading"),
      });
      await applyVaultTemplateSettings(selected, template);
      await openVault(selected);
    } catch (e) {
      console.error("Vault scaffolding failed:", e);
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const templateCardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "12px 14px",
    textAlign: "left",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-lg)",
    background: "transparent",
    color: "var(--text-main)",
    cursor: "pointer",
    width: "100%",
  };

  return (
    <div style={{ position: "relative", display: "flex", height: "100vh", width: "100vw", background: "var(--bg-primary)", color: "var(--text-main)", overflow: "hidden", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      {/* No regular title bar here — keep the frameless window movable/closable. */}
      <WindowChromeStrip />
      <div style={{ width: "100%", maxWidth: "440px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "22px" }}>
            <PlainvaLogo size={76} glow />
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 8px" }}>{t("splash.title")}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "1rem", margin: "0 0 28px" }}>{t("splash.subtitle")}</p>
        </div>

        {(error || createError) && (
          <div style={{ padding: "1rem", background: "var(--error-bg)", color: "var(--error-text)", border: "1px solid var(--error-border)", borderRadius: "var(--radius-md)", marginBottom: "1.5rem", wordBreak: "break-all", display: "flex", gap: "0.5rem" }}>
            <strong>{t("dialogs.errorTitle")}:</strong> {error || createError}
          </div>
        )}

        {onlineSetupProvider ? (
          <OnlineVaultSetup
            provider={onlineSetupProvider}
            onBack={() => { setOnlineSetupProvider(null); setShowOnlineChooser(true); }}
          />
        ) : showCreateChooser ? (
          <>
            <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>{t("splash.createVault")}</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.9rem" }}>{t("splash.createVaultDesc")}</p>

            <div className="custom-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "330px", overflowY: "auto", marginBottom: "14px", paddingRight: "10px" }}>
              <button
                onClick={() => handleCreateVault(null)}
                disabled={creating}
                style={{ ...templateCardStyle, flexDirection: "row", alignItems: "center", gap: "11px", opacity: creating ? 0.6 : 1 }}
                onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--accent-color)"; }}
                onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-color)"; }}
              >
                <FilePlus2 size={18} color="var(--accent-color)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    {t("splash.emptyVault")}
                    <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 7px", borderRadius: "var(--radius-pill)", background: "var(--accent-color)", color: "var(--accent-on)" }}>
                      {t("splash.recommended", { defaultValue: "Empfohlen für den Einstieg" })}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{t("splash.emptyVaultDesc")}</div>
                </div>
              </button>

              {getVaultTemplates(i18n.language).map((def) => (
                <button
                  key={def.id}
                  onClick={() => handleCreateVault(def)}
                  disabled={creating}
                  style={{ ...templateCardStyle, opacity: creating ? 0.6 : 1 }}
                  onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--accent-color)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-color)"; }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{def.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{def.description}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {templatePreviewFolders(def).map((folder) => (
                      <span key={folder} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", color: "var(--text-faint)", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>
                        <Folder size={10} />{folder}
                      </span>
                    ))}
                    {templatePreviewBases(def).map((db) => (
                      <span key={db} title={t("splash.includesDatabases")} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", color: "var(--accent-color)", border: "1px solid var(--accent-color)", borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>
                        <Database size={10} />{db}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowCreateChooser(false)}
              disabled={creating}
              style={{ width: "100%", padding: "0.75rem", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", color: "var(--text-main)", cursor: "pointer" }}
            >
              {t("splash.back")}
            </button>
          </>
        ) : showOnlineChooser ? (
          <>
            <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>{t("splash.openOnlineVault")}</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "1rem", fontSize: "0.9rem" }}>{t("splash.onlineVaultDesc")}</p>

            <div className="custom-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "330px", overflowY: "auto", marginBottom: "14px", paddingRight: "10px" }}>
              {onlineProviders.map(({ id, name, desc, Icon, byo }) => (
                <button
                  key={id}
                  onClick={() => {
                    if (id === "webdav") {
                      setShowOnlineChooser(false);
                      setShowWebDavForm(true);
                    } else {
                      handleOnlineProvider(id);
                    }
                  }}
                  style={{ ...templateCardStyle, flexDirection: "row", alignItems: "center", gap: "11px" }}
                  onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--accent-color)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-color)"; }}
                >
                  <Icon size={18} color="var(--accent-color)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      {name}
                      {byo && (
                        <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--warning-text)", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-pill)", padding: "0 7px", lineHeight: 1.6 }}>
                          {t("splash.providerByoBadge")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{byo ? t("splash.providerByoDesc") : desc}</div>
                  </div>
                </button>
              ))}
            </div>

            {onlineProviders.some((p) => p.byo) && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "2px 2px 14px" }}>
                {t("splash.byoGuideHint", { defaultValue: "Anleitungen für eigene App-IDs:" })}{" "}
                {/* Links (not buttons): they leave the app for the handbook,
                    and the provider CARDS already own the button role here. */}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(userGuideUrl(GDRIVE_BYO_GUIDE))); }}
                  style={{ color: "var(--accent-color)", textDecoration: "underline" }}
                >
                  Google Drive
                </a>
                {" · "}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(userGuideUrl(ONEDRIVE_DROPBOX_BYO_GUIDE))); }}
                  style={{ color: "var(--accent-color)", textDecoration: "underline" }}
                >
                  OneDrive / Dropbox
                </a>
              </div>
            )}

            <button
              onClick={() => setShowOnlineChooser(false)}
              style={{ width: "100%", padding: "0.75rem", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", color: "var(--text-main)", cursor: "pointer" }}
            >
              {t("splash.back")}
            </button>
          </>
        ) : !showWebDavForm ? (
          <>
            {recentVaults.length > 0 && (
              <div style={{ border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-lg)", padding: "10px 10px 6px", marginBottom: "20px" }}>
                <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", margin: "2px 4px 8px" }}>{t("splash.recentVaults")}</div>
                <div className={listOverflow ? "pv-scroll-edge is-overflow" : "pv-scroll-edge"}>
                <div
                  ref={listScrollRef}
                  onScroll={(e) => { const el = e.currentTarget; setListOverflow(el.scrollTop + el.clientHeight < el.scrollHeight - 2); }}
                  className="custom-scrollbar"
                  style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "190px", overflowY: "auto", paddingRight: "10px" }}
                >
                  {recentVaults.map((path) => (
                    // One card per vault; the remove X sits INSIDE the card as the
                    // app's usual ghost icon button (pv-icon-btn) instead of a
                    // detached box next to the scrollbar.
                    <div
                      key={path}
                      style={{ display: "flex", alignItems: "center", border: "1px solid var(--border-color)", borderRadius: "var(--radius-lg)", background: "transparent" }}
                      onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--accent-color)"; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-color)"; }}
                    >
                      <button
                        onClick={() => openVault(path)}
                        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "11px", padding: "12px 14px", textAlign: "left", border: "none", borderRadius: "var(--radius-lg) 0 0 var(--radius-lg)", background: "transparent", color: "var(--text-main)", cursor: "pointer" }}
                      >
                        <Folder size={18} color="var(--accent-color)" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{getBasename(path)}</div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{path}</div>
                        </div>
                      </button>
                      <button
                        className="pv-icon-btn"
                        aria-label={t("splash.removeFromList")}
                        title={t("splash.removeFromListHint")}
                        onClick={() => { setForgetZips(false); setRemoveTarget(path); }}
                        style={{ marginRight: "8px" }}
                        onMouseOver={(e) => { e.currentTarget.style.color = "var(--error-text)"; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <button
                onClick={selectVault}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", height: 46, background: "var(--accent-color)", color: "var(--accent-on)", border: "none", borderRadius: "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-sm)", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--accent-color-hover)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "var(--accent-color)")}
              >
                <FolderOpen size={17} />{t("splash.openFolder", { defaultValue: "Ordner öffnen" })}
              </button>

              <button
                onClick={() => setShowOnlineChooser(true)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", height: 46, background: "var(--accent-container)", color: "var(--on-accent-container)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--accent-color) 24%, var(--bg-primary))")}
                onMouseOut={(e) => (e.currentTarget.style.background = "var(--accent-container)")}
              >
                <Cloud size={16} />{t("splash.openOnlineVault")}
              </button>

              <button
                onClick={() => { setCreateError(null); setShowCreateChooser(true); }}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", height: 46, background: "var(--accent-container)", color: "var(--on-accent-container)", border: "none", borderRadius: "var(--radius-sm) var(--radius-sm) var(--radius-lg) var(--radius-lg)", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--accent-color) 24%, var(--bg-primary))")}
                onMouseOut={(e) => (e.currentTarget.style.background = "var(--accent-container)")}
              >
                <Plus size={16} />{t("splash.createVault", { defaultValue: "Neuen Vault erstellen" })}
              </button>
            </div>

            <div style={{ marginTop: "16px", color: "var(--text-muted)" }}>
              <Checkbox
                checked={autoOpenLastVault}
                onChange={(e) => setAutoOpenLastVault(e.target.checked)}
              >
                {t("splash.autoOpenLastVault")}
              </Checkbox>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>{t("splash.connectToWebDav")}</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>{t("splash.connectToWebDavDesc")}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", background: "var(--bg-secondary)", padding: "1.5rem", borderRadius: "var(--radius-xl)", border: "1px solid var(--border-color)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>{t("splash.serverUrl")}</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://nextcloud.example.com/remote.php/webdav"
                  style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-main)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>{t("splash.username")}</label>
                <input value={user} onChange={(e) => setUser(e.target.value)}
                  style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-main)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>{t("splash.password")}</label>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                  style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-main)" }} />
              </div>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                <button onClick={() => { setShowWebDavForm(false); setShowOnlineChooser(true); }}
                  style={{ flex: 1, padding: "0.75rem", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", color: "var(--text-main)", cursor: "pointer" }}>
                  {t("splash.back")}
                </button>
                <button onClick={handleWebDavNext} disabled={!url || !user || !pass}
                  style={{ flex: 1, padding: "0.75rem", background: "var(--accent-color)", border: "none", borderRadius: "var(--radius-md)", color: "var(--accent-on)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", opacity: (!url || !user || !pass) ? 0.5 : 1 }}>
                  {t("splash.browseServer")} <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showPicker && (
        <WebDavFolderPickerModal initialUrl={url} user={user} pass={pass} onSelect={handleWebDavFolderSelected} onCancel={() => setShowPicker(false)} />
      )}
      {removeTarget !== null && (
        <Modal
          title={t("splash.removeDialogTitle")}
          onClose={() => { if (!forgetting) setRemoveTarget(null); }}
          size="md"
          footer={
            <>
              <Button onClick={() => setRemoveTarget(null)} disabled={forgetting}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => { void handleRemoveOnlyList(); }} disabled={forgetting} data-testid="splash-remove-list-only">
                {t("splash.removeOnlyList")}
              </Button>
              <Button variant="danger" onClick={() => { void handleForgetAppData(); }} disabled={forgetting} data-testid="splash-remove-forget">
                {t("splash.removeForget")}
              </Button>
            </>
          }
        >
          <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
            {t("splash.removeDialogBody", { name: getBasename(removeTarget) })}
          </p>
          <Checkbox checked={forgetZips} onChange={(e) => setForgetZips(e.target.checked)} disabled={forgetting}>
            {t("splash.removeForgetZips")}
          </Checkbox>
        </Modal>
      )}
    </div>
  );
};
