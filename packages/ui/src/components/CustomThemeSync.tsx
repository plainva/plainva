import { useTranslation } from "react-i18next";
import { Banner, Button, GroupCard, Row, RowList, SectionLabel, SettingCard, SettingCardNote, SettingRow, Switch } from "./ui";
import { customThemeSpecForMode, type CustomThemeDesign } from "../lib/customThemeDesign";
import { customThemeVariantId } from "../lib/customThemeProfile";
import type { PersonalDesignStatus } from "../lib/personalDesignSync";

export interface CustomThemeSyncProps {
  status: PersonalDesignStatus | null;
  available: boolean;
  failed: boolean;
  busy: boolean;
  mobile?: boolean;
  setEnabled(enabled: boolean): void;
  choose(design: CustomThemeDesign): void;
}

/** Existing settings primitives on both shells; previews carry no device ids. */
export function CustomThemeSync(props: CustomThemeSyncProps) {
  const { t } = useTranslation();
  const variants = props.status?.profile?.variants ?? [];
  const toggle = <Switch label={t("settings.customThemeSyncEnabled")} checked={props.status?.enabled === true} disabled={!props.available || props.busy} onChange={props.setEnabled} />;
  const source = props.status?.sourceLabel ? t("settings.customThemeSyncSource", { name: props.status.sourceLabel }) : t("settings.customThemeSyncLocal");
  return <div data-testid="custom-theme-sync">
    {props.mobile ? <>
      <SectionLabel>{t("settings.customThemeSyncTitle")}</SectionLabel>
      <GroupCard>
        <RowList><Row wrap title={t("settings.customThemeSyncEnabled")} end={toggle} /></RowList>
        <div style={{ padding: "var(--space-3) var(--space-4)" }}>
          <p style={{ margin: 0 }}>{source}</p>
          <p style={{ marginBottom: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settings.customThemeSyncHint")}</p>
        </div>
      </GroupCard>
    </> : <SettingCard label={t("settings.customThemeSyncTitle")}>
      <SettingRow label={t("settings.customThemeSyncEnabled")} desc={t("settings.customThemeSyncHint")}>
        {toggle}
      </SettingRow>
      <SettingCardNote>{source}</SettingCardNote>
    </SettingCard>}
    {props.failed && <Banner kind="error" rounded>{t("settings.customThemeSyncFailed")}</Banner>}
    {props.status?.enabled && variants.length > 1 && <Banner kind="warning" rounded>
      <p>{t("settings.customThemeSyncConflict")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {variants.map((variant, index) => <Button key={customThemeVariantId(variant)} style={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "start" }} disabled={props.busy} onClick={() => props.choose(variant.design)}>
          <span aria-hidden="true" style={{ display: "inline-flex", gap: "var(--space-1)" }}>
            {(["light", "dark"] as const).map(mode => { const spec = customThemeSpecForMode(variant.design, mode); return <span key={mode} style={{ display: "inline-block", width: "var(--space-4)", height: "var(--space-4)", background: spec.background, border: `3px solid ${spec.accent}`, borderRadius: "var(--radius-xs)" }} />; })}
          </span>
          {t("settings.customThemeSyncChoose", { number: index + 1 })}
        </Button>)}
      </div>
    </Banner>}
  </div>;
}
