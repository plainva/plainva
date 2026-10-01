import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GroupCard, gistsStatusLine, Row, RowList, SectionLabel, Switch, useLocalGists, type AiSession } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";

/**
 * Settings → AI & automation → "Gists" on the phone (plan KI-Harness P2b-3):
 * the desktop card's switch and status in rows — written only by the model of
 * the profile "Local" on a server counted as local, off until chosen.
 */
export function MobileGistsSection({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const settings = useSyncExternalStore(session.subscribe, session.getState).settings;
  const { controller, state } = useLocalGists();
  const line = gistsStatusLine(t, state, i18n.language);
  const clear = async () => {
    if (await mConfirm({ title: t("ai.gists.clear"), message: t("ai.gists.clearConfirm"), confirmLabel: t("ai.gists.clear"), danger: true })) await controller?.clear();
  };
  return (
    <>
      <SectionLabel>{t("ai.gists.title")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            wrap
            title={t("ai.gists.show")}
            subtitle={t("ai.gists.showDesc")}
            end={<Switch checked={settings.gists} label={t("ai.gists.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, gists: on }))} />}
          />
          {line && <Row wrap title={line} />}
          {state?.kind === "on" && (
            <Row title={state.paused ? t("ai.semantic.resume") : t("ai.semantic.pause")} onClick={() => (state.paused ? controller?.resume() : controller?.pause())} data-testid="gists-pause" />
          )}
          {state?.kind === "on" && <Row title={t("ai.gists.clear")} onClick={() => void clear()} data-testid="gists-clear" />}
        </RowList>
      </GroupCard>
    </>
  );
}
