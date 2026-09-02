import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingCard, SettingRow, Switch, type CommentNotificationLevel } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { Select } from "../Select";
import {
  DEFAULT_COMMENT_NOTIFICATION_SETTINGS,
  loadCommentNotificationSettings,
  saveCommentNotificationSettings,
  type CommentNotificationSettings as Settings,
} from "../../services/commentNotificationSettings";
import { drawCommentBaseline } from "../../services/commentNotifier";

/**
 * Remark notifications, in the content area beside the anchor setting (F2).
 *
 * Three rows, and the order is the argument: whether at all, about what, and
 * how much the message may say. The privacy switch sits HERE rather than in a
 * privacy area three levels down, because it is needed in the same moment the
 * notifications are switched on (§5, FB2) - a notification appears on a lock
 * screen, and that is the moment to decide what it may show there.
 *
 * Switching ON draws the baseline (FB3): everything that exists at that instant
 * counts as seen, so the first cycle afterwards reports what happened SINCE
 * rather than the backlog.
 */
export function CommentNotificationSettings() {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [settings, setSettings] = useState<Settings>(DEFAULT_COMMENT_NOTIFICATION_SETTINGS);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!vaultPath) return;
      const store = await getSettingsStore();
      const loaded = await loadCommentNotificationSettings(store, vaultPath);
      if (alive) setSettings(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  const persist = useCallback(
    async (next: Settings) => {
      if (!vaultPath) return;
      setSettings(next);
      const store = await getSettingsStore();
      await saveCommentNotificationSettings(store, vaultPath, next);
    },
    [vaultPath],
  );

  const onEnabled = useCallback(
    (enabled: boolean) => {
      void (async () => {
        // The baseline is drawn BEFORE the setting is stored, so no cycle can
        // slip between the two and report the backlog this is meant to prevent.
        if (!vaultPath) return;
        if (enabled) await drawCommentBaseline(vaultPath);
        await persist({ ...settings, enabled });
      })();
    },
    [persist, settings, vaultPath],
  );

  const levels: Array<{ value: CommentNotificationLevel; label: string; desc: string }> = [
    { value: "mentions", label: t("commentNotify.levelMentions"), desc: t("commentNotify.levelMentionsHint") },
    { value: "relevant", label: t("commentNotify.levelRelevant"), desc: t("commentNotify.levelRelevantHint") },
    { value: "all", label: t("commentNotify.levelAll"), desc: t("commentNotify.levelAllHint") },
  ];
  const activeLevel = levels.find((entry) => entry.value === settings.level) ?? levels[1];

  return (
    <SettingCard label={t("commentNotify.section")}>
      <SettingRow label={t("commentNotify.enable")} desc={t("commentNotify.enableHint")}>
        <Switch
          checked={settings.enabled}
          onChange={onEnabled}
          label={t("commentNotify.enable")}
        />
      </SettingRow>
      {settings.enabled ? (
        <>
          <SettingRow label={t("commentNotify.level")} desc={activeLevel.desc}>
            <Select
              ariaLabel={t("commentNotify.level")}
              value={settings.level}
              onChange={(value) => void persist({ ...settings, level: value as CommentNotificationLevel })}
              options={levels.map((entry) => ({ value: entry.value, label: entry.label }))}
              data-testid="comment-notify-level"
            />
          </SettingRow>
          <SettingRow label={t("commentNotify.preview")} desc={t("commentNotify.previewHint")}>
            <Switch
              checked={settings.preview}
              onChange={(preview) => void persist({ ...settings, preview })}
              label={t("commentNotify.preview")}
            />
          </SettingRow>
        </>
      ) : null}
    </SettingCard>
  );
}
