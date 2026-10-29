import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LinkStylePreview,
  NOTE_LINK_STYLES,
  WEB_LINK_STYLES,
  DEFAULT_NOTE_LINK_STYLE,
  DEFAULT_WEB_LINK_STYLE,
  SettingRow,
  SettingCardNote,
  type NoteLinkStyle,
  type WebLinkStyle,
} from "@plainva/ui";
import { Select } from "../Select";
import { getStoredLinkStyle, setStoredLinkStyle } from "../../services/linkStyle";

const STYLE_LABEL: Record<NoteLinkStyle, string> = {
  underline: "settings.linkStyleUnderline",
  tint: "settings.linkStyleTint",
  color: "settings.linkStyleColor",
  subtle: "settings.linkStyleSubtle",
};

/**
 * Appearance -> Links & tags (maintainer, 2026-10-23): how a link to a note and a
 * link to the web look on this device, with a sentence that shows the choice
 * as notes draw it. The phone has the same two choices (AppearanceScreen).
 */
export const LinkStyleSettings: React.FC = () => {
  const { t } = useTranslation();
  const [note, setNote] = useState<NoteLinkStyle>(DEFAULT_NOTE_LINK_STYLE);
  const [web, setWeb] = useState<WebLinkStyle>(DEFAULT_WEB_LINK_STYLE);
  useEffect(() => {
    let alive = true;
    void getStoredLinkStyle().then((stored) => {
      if (!alive) return;
      setNote(stored.note);
      setWeb(stored.web);
    });
    return () => { alive = false; };
  }, []);
  const choose = (nextNote: NoteLinkStyle, nextWeb: WebLinkStyle) => {
    setNote(nextNote);
    setWeb(nextWeb);
    void setStoredLinkStyle(nextNote, nextWeb);
  };
  return (
    <>
      <SettingRow label={t("settings.noteLinkStyle")} info={t("settings.noteLinkStyleDesc")}>
        <div style={{ width: "100%" }}>
          <Select
            ariaLabel={t("settings.noteLinkStyle")}
            value={note}
            onChange={(value) => choose(value as NoteLinkStyle, web)}
            data-testid="note-link-style"
            options={NOTE_LINK_STYLES.map((style) => ({ value: style, label: t(STYLE_LABEL[style]) }))}
          />
        </div>
      </SettingRow>
      <SettingRow label={t("settings.webLinkStyle")}>
        <div style={{ width: "100%" }}>
          <Select
            ariaLabel={t("settings.webLinkStyle")}
            value={web}
            onChange={(value) => choose(note, value as WebLinkStyle)}
            data-testid="web-link-style"
            options={WEB_LINK_STYLES.map((style) => ({ value: style, label: t(STYLE_LABEL[style]) }))}
          />
        </div>
      </SettingRow>
      <SettingCardNote>
        <LinkStylePreview />
      </SettingCardNote>
    </>
  );
};
