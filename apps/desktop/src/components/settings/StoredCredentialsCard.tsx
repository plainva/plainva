import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SettingCard, SettingCardNote, SettingRow, toast } from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import {
  listStoredCredentials,
  removeStoredCredential,
  type StoredCredentialEntry,
} from "../../services/storedCredentials";

/**
 * "Stored access" (P5b, E2).
 *
 * The keychain accumulates and nothing ever showed what was in it. The entry
 * names alone are unreadable — `mail_fcb8f9ff-…_L2hvbWUvbWFyY28v…` says neither
 * which account nor which vault — so a user could not decide what was safe to
 * delete, and "forget this vault" cannot reach a vault that has already left
 * the list.
 *
 * Nothing here is automatic. Every removal is confirmed, one entry at a time,
 * and the confirmation names the vault it belongs to: this deletes a working
 * credential if the guess is wrong.
 */

const KIND_KEYS: Record<StoredCredentialEntry["kind"], string> = {
  files: "settings.storedAccessFiles",
  calendar: "settings.storedAccessCalendar",
  mail: "settings.storedAccessMail",
  account: "settings.storedAccessAccount",
  vault: "settings.storedAccessVault",
};

export const StoredCredentialsCard: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<StoredCredentialEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setEntries(await listStoredCredentials());
    } catch (e) {
      console.error("[storedCredentials] listing failed", e);
      toast.error(t("settings.storedAccessFailed"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const remove = useCallback(
    async (entry: StoredCredentialEntry) => {
      const ok = await appConfirm({
        title: t("settings.storedAccessRemove"),
        message: t("settings.storedAccessRemoveConfirm", { vault: entry.vaultPath }),
        confirmLabel: t("settings.storedAccessRemove"),
        kind: "danger",
      });
      if (!ok) return;
      try {
        await removeStoredCredential(entry.slot);
        setEntries((list) => (list ?? []).filter((e) => e.slot !== entry.slot));
      } catch (e) {
        console.error("[storedCredentials] removal failed", e);
        toast.error(t("settings.storedAccessFailed"));
      }
    },
    [t],
  );

  return (
    <SettingCard label={t("settings.storedAccess")}>
      <SettingRow label={t("settings.storedAccess")} desc={t("settings.storedAccessDesc")}>
        <Button variant="secondary" size="sm" onClick={load} disabled={busy}>
          {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
        </Button>
      </SettingRow>
      {entries !== null && (
        <SettingCardNote>
          {entries.length === 0 ? (
            t("settings.storedAccessEmpty")
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {entries.map((entry) => (
                <div
                  key={entry.slot}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.5rem",
                    justifyContent: "space-between",
                    overflowWrap: "anywhere",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--text-main)" }}>{t(KIND_KEYS[entry.kind])}</span>
                    {entry.detail ? <span style={{ color: "var(--text-faint)" }}> · {entry.detail}</span> : null}
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                      {entry.vaultPath}
                      {entry.orphaned ? ` — ${t("settings.storedAccessOrphan")}` : ""}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void remove(entry)}>
                    {t("settings.storedAccessRemove")}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: "0.5rem", fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>
            {t("settings.storedAccessLimit")}
          </div>
        </SettingCardNote>
      )}
    </SettingCard>
  );
};
