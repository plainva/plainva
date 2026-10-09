import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GroupCard, Row, RowList, SectionLabel, Switch, type AiSession } from "@plainva/ui";
import { systemIntentsAvailable } from "../platform/intentBridge";
import { getIntentDirectoryStatus, subscribeIntentDirectoryStatus, type IntentDirectoryStatus } from "../services/intentService";

/**
 * What the list holds right now, in one line — or why it holds nothing. A
 * person who switched this on should not have to guess what the system can
 * read; and a list that stays empty because the vault's rules have a mistake
 * in them looks, from Siri's side, exactly like a note that does not exist.
 */
function statusLine(t: (key: string, values?: Record<string, string>) => string, status: IntentDirectoryStatus): string | null {
  if (status.count > 0) return t("ai.system.known", { count: String(status.count) });
  if (status.why === "sealed") return t("ai.system.noneSealed");
  if (status.why === "rules") return t("ai.system.noneRules");
  if (status.why === "empty") return t("ai.system.noneEmpty");
  return null;
}

/**
 * Settings → AI & automation → "Siri & Shortcuts" on an iPhone or iPad (AI
 * harness P4.7): the one switch of the system's assistant.
 *
 * Capturing through Siri — a journal entry, a task — needs no switch: it
 * tells the system nothing, and the app writes it down when it next opens.
 * FINDING a note is different. For that the app keeps a list of titles where
 * the system can read it, and what the system does with a title is not
 * Plainva's to know. So the list exists only where this switch is on — off
 * until chosen, on this device —, it holds only notes the privacy rules allow
 * for both the cloud and web access, and never anything of an encrypted
 * workspace.
 *
 * Nothing is drawn where the platform has no such assistant (Android until
 * AppFunctions are public — parity catalog `ai-system-intents`).
 */
export function MobileSystemAssistantSection({ session }: { session: AiSession }) {
  const { t } = useTranslation();
  const settings = useSyncExternalStore(session.subscribe, session.getState).settings;
  const status = useSyncExternalStore(subscribeIntentDirectoryStatus, getIntentDirectoryStatus);
  if (!systemIntentsAvailable()) return null;
  // Fully local (plan KI-Harness P7): the list of titles is not kept — what the system does with a title is not Plainva's to know.
  const resting = settings.localOnly && settings.systemFind;
  const line = settings.systemFind && !resting ? statusLine((key, values) => t(key, values ?? {}), status) : null;
  return (
    <>
      <SectionLabel>{t("ai.system.title")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            wrap
            title={t("ai.system.find")}
            subtitle={t("ai.system.findDesc")}
            end={<Switch checked={settings.systemFind} label={t("ai.system.find")} onChange={(on) => void session.updateSettings((s) => ({ ...s, systemFind: on }))} />}
            data-testid="ai-system-find"
          />
          {line && <Row wrap title={line} data-testid="ai-system-status" />}
          {resting && <Row wrap title={t("ai.mode.restsHere")} data-testid="ai-rests-system" />}
        </RowList>
      </GroupCard>
      <p className="m-hint">{t("ai.system.captureHint")}</p>
    </>
  );
}
