import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Switch, toast, travellingAreas } from "@plainva/ui";
import { mPrompt } from "../services/mobileDialogs";
import { restartSync, syncNow } from "../services/syncService";
import {
  isMobilePassphraseEveryStart,
  isMobileSecretsSyncEnabled,
  isMobileSettingsSyncEnabled,
  lockMobileEncryption,
  mobileEncryptionStatus,
  setMobilePassphraseEveryStart,
  setMobileSecretsSyncEnabled,
  setMobileSettingsSyncEnabled,
  unlockMobileEncryption,
} from "../services/mobileSettingsSync";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * The three-step sync chain, as its own destination (mobile rework N4.3,
 * decision E3).
 *
 * It used to stand inline on the vault detail — some 170 lines of stepper
 * between the status card and the vault's own actions, on a screen whose
 * subject is the vault, not the settings profile. The detail names it in one
 * row now and this screen answers it.
 *
 * The order is the corrected one (plan P5): syncing settings and accounts
 * needs NO passphrase, only carrying sign-ins does — so the passphrase sits
 * BETWEEN them, not in front of them.
 */
export function SyncChainScreen({
  vaultId,
  activeVault,
  onBack,
  onSetupEncryption,
}: {
  vaultId: string;
  activeVault: MobileVault;
  onBack: () => void;
  /** The settings-key wizard is its own destination (S37). */
  onSetupEncryption: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [settingsSyncOn, setSettingsSyncOn] = useState(false);
  /** H2c: sign-in secrets — its own opt-in, and only while unlocked. */
  const [secretsSyncOn, setSecretsSyncOn] = useState(false);
  const [encryption, setEncryption] = useState<"none" | "locked" | "unlocked">("none");
  /** H2b: passphrase re-entry after every start (desktop parity). */
  const [everyStart, setEveryStart] = useState(false);

  useEffect(() => {
    const reload = () => {
      void isMobileSettingsSyncEnabled(vaultId).then(setSettingsSyncOn);
      void isMobileSecretsSyncEnabled(vaultId).then(setSecretsSyncOn);
      void mobileEncryptionStatus(activeVault).then(setEncryption);
      void isMobilePassphraseEveryStart(vaultId).then(setEveryStart);
    };
    reload();
    window.addEventListener("m-encryption-locked", reload);
    window.addEventListener("m-settings-changed", reload);
    return () => {
      window.removeEventListener("m-encryption-locked", reload);
      window.removeEventListener("m-settings-changed", reload);
    };
  }, [activeVault, vaultId]);

  return (
    <div className="m-page" data-testid="sync-chain">
      <AppBar onBack={onBack} title={t("settingsSync.chainLabel")} />
      <div className="m-settings">
      {/* Same chain as the desktop, same order (plan P5, corrected):
          syncing settings and accounts needs NO passphrase — only
          carrying sign-ins does. So the passphrase sits BETWEEN them. */}
            <p className="m-hint">{t("settingsSync.chainIntro")}</p>

      <div className="m-chain">
        {/* Sealed: another device set a passphrase, so the profile in the
            vault is encrypted and this device cannot read or write it
            until it unlocks. The switch stays on — nothing is wrong with
            it — but the step must not claim to be running. */}
        <div className={`m-chain-step ${settingsSyncOn && encryption === "locked" ? "is-todo" : settingsSyncOn ? "is-done" : "is-todo"}`}>
          <div className="m-chain-node">{settingsSyncOn && encryption !== "locked" ? "✓" : settingsSyncOn ? "!" : "1"}</div>
          <div className="m-chain-body">
            <div className="m-chain-head">
              <span className="m-chain-title">
                {t("settingsSync.step1")}
                {settingsSyncOn && encryption === "locked" && (
                  <span className="m-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>
                )}
              </span>
              <Switch
                checked={settingsSyncOn}
                disabled={busy}
                label={t("settingsSync.step1")}
                onChange={(next) => {
                  setBusy(true);
                  void setMobileSettingsSyncEnabled(vaultId, next)
                    .then(() => restartSync(activeVault))
                    .then(() => setSettingsSyncOn(next))
                    .finally(() => setBusy(false));
                }}
              />
            </div>
            <p className="m-chain-desc">
              {settingsSyncOn && encryption === "locked" ? t("settingsSync.step1Sealed") : t("settingsSync.step1Desc")}
            </p>
            {/* Generated from the shared field catalog, like the desktop.
                The phone carries fewer areas than the desktop does, and a
                chip list that claims otherwise is worse than none. */}
            <div className="m-chain-carries">
              {travellingAreas("mobile").map((area) => (
                <span className="m-chain-chip" key={area}>{t(`settingsSync.area_${area}`)}</span>
              ))}
              <span className="m-chain-chip is-excluded">{t("settingsSync.chipPasswords")}</span>
            </div>
          </div>
        </div>

        {/* Optional, and independent of step 1 — it exists for step 3. */}
        <div className={`m-chain-step ${encryption === "unlocked" ? "is-done" : ""}`}>
          <div className="m-chain-node">{encryption === "unlocked" ? "✓" : "2"}</div>
          <div className="m-chain-body">
            <div className="m-chain-head">
              <span className="m-chain-title">
                {t("settingsSync.step2")}
                {encryption !== "unlocked" && <span className="m-chain-chip">{t("settingsSync.step2Optional")}</span>}
              </span>
            </div>
            <p className="m-chain-desc">
              {encryption === "unlocked" ? t("settingsSync.unlockedBody") : t("settingsSync.step2Desc")}
            </p>
            {encryption === "none" && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={onSetupEncryption}
                data-testid="encryption-setup-open"
              >
                {t("encryption.setPassphrase")}
              </Button>
            )}
            {encryption === "locked" && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void mPrompt({ title: t("settingsSync.passphraseTitle"), placeholder: t("encryption.passphrase"), secure: true }).then(async ({ value, cancelled }) => {
                    if (cancelled || !value) return;
                    setBusy(true);
                    try {
                      await unlockMobileEncryption(activeVault, value);
                      await restartSync(activeVault);
                      setEncryption("unlocked");
                    } catch {
                      toast.warning(t("encryption.wrongPassphrase"));
                    } finally {
                      setBusy(false);
                    }
                  });
                }}
              >
                {t("encryption.enterPassphrase")}
              </Button>
            )}
            {encryption === "unlocked" && (
              <Button
                variant="tonal"
                disabled={busy}
                onClick={() => void lockMobileEncryption(vaultId).then(() => restartSync(activeVault)).then(() => setEncryption("locked"))}
              >
                {t("encryption.lock")}
              </Button>
            )}
            {encryption !== "none" && (
              <div className="m-row m-row--static">
                <span className="m-linestack">
                  {t("encryption.everyStart")}
                  <small>{t("encryption.everyStartDesc")}</small>
                </span>
                <Switch
                  checked={everyStart}
                  disabled={busy}
                  label={t("encryption.everyStart")}
                  onChange={(next) => {
                    setBusy(true);
                    void setMobilePassphraseEveryStart(vaultId, next)
                      .then(() => setEveryStart(next))
                      .then(() => mobileEncryptionStatus(activeVault))
                      .then(setEncryption)
                      .finally(() => setBusy(false));
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Needs BOTH: the accounts from step 1 and the key from step 2. */}
        <div className={`m-chain-step ${secretsSyncOn && settingsSyncOn ? "is-done" : !settingsSyncOn || encryption !== "unlocked" ? "is-locked" : ""}`}>
          <div className="m-chain-node">{secretsSyncOn && settingsSyncOn ? "✓" : "3"}</div>
          <div className="m-chain-body">
            <div className="m-chain-head">
              <span className="m-chain-title">
                {t("settingsSync.step3")}
                {!settingsSyncOn && <span className="m-chain-chip is-excluded">{t("settingsSync.needsStep1")}</span>}
                {settingsSyncOn && encryption !== "unlocked" && <span className="m-chain-chip is-excluded">{t("settingsSync.needsPassphrase")}</span>}
              </span>
              <Switch
                checked={secretsSyncOn && settingsSyncOn && encryption === "unlocked"}
                disabled={busy || !settingsSyncOn || encryption !== "unlocked"}
                label={t("settingsSync.step3")}
                onChange={(next) => {
                  setBusy(true);
                  void setMobileSecretsSyncEnabled(vaultId, next)
                    .then(() => restartSync(activeVault))
                    .then(() => setSecretsSyncOn(next))
                    .finally(() => setBusy(false));
                }}
              />
            </div>
            <p className="m-chain-desc">
              {!settingsSyncOn ? t("settingsSync.needsStep1Body") : t("settingsSync.step3Desc")}
            </p>
            {settingsSyncOn && <p className="m-chain-desc">{t("settingsSync.oauthNote")}</p>}
          </div>
        </div>
      </div>

      {settingsSyncOn && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            toast.info(t("settingsSync.pullStarted"));
            void syncNow();
          }}
        >
          {t("settingsSync.pullNow")}
        </Button>
      )}
      </div>
    </div>
  );
}
