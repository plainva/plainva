import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  GroupCard,
  ICON,
  IconButton,
  listTemplates,
  normalizeFolderPath,
  Row,
  RowList,
  SectionLabel,
  SettingField,
  TextInput,
  type FolderTemplateRule,
  type TypeTemplateRule,
} from "@plainva/ui";
import { FolderPickerSheet } from "./FolderPickerSheet";
import { mSelect } from "../services/mobileDialogs";
import type { MobileSettings } from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * Folder → template and note type → template rules (S39, P10).
 *
 * The RESOLUTION has been shared since the template engine (longest folder
 * path wins, folder beats type, an explicitly chosen template beats both) and
 * the rules already reached the phone through the settings profile — they
 * decided which template a new note started from here. Only the editing
 * surface was missing, so a rule could apply on this device and be
 * unreadable on it.
 *
 * Rules are DATA: a folder (or type) and a template path, nothing evaluated.
 */
export function TemplateRules({
  settings,
  onChange,
  vault,
}: {
  settings: MobileSettings;
  onChange: (patch: Partial<MobileSettings>) => void;
  vault: MobileVault;
}) {
  const { t } = useTranslation();
  const [pickFolderFor, setPickFolderFor] = useState<number | null>(null);

  /** The template files this vault offers, as a picker over their titles. */
  const pickTemplate = async (current: string): Promise<string | null> => {
    const items = await listTemplates(vault.adapter, settings.templateFolder).catch(() => []);
    return mSelect({
      title: t("settings.templateFolder"),
      options: [{ value: "", label: "—" }, ...items.map((it) => ({ value: it.path, label: it.title }))],
      value: current,
    });
  };

  const setFolderRules = (rules: FolderTemplateRule[]) => onChange({ folderTemplates: rules });
  const setTypeRules = (rules: TypeTemplateRule[]) => onChange({ typeTemplates: rules });

  return (
    <>
      {/* A rule is two ACTIONS stacked (its folder, then its template), so the
          row is a static field rather than a label: it labels no control. It
          lives in the card with everything else on this page — as a loose row
          it carried a left edge of its own. */}
      <SectionLabel>{t("settings.folderTemplates")}</SectionLabel>
      <GroupCard>
        <RowList>
          {settings.folderTemplates.map((rule, index) => (
            <SettingField
              action={
                <IconButton
                  label={t("common.delete")}
                  onClick={() => setFolderRules(settings.folderTemplates.filter((_, i) => i !== index))}
                >
                  <Trash2 size={ICON.ui} />
                </IconButton>
              }
              isStatic
              key={`folder-${index}`}
              label={
                <Button onClick={() => setPickFolderFor(index)} variant="ghost">
                  {rule.folder || t("database.folder")}
                </Button>
              }
            >
              <Button
                onClick={() => {
                  void pickTemplate(rule.template).then((picked) => {
                    if (picked === null) return;
                    setFolderRules(
                      settings.folderTemplates.map((r, i) => (i === index ? { ...r, template: picked } : r))
                    );
                  });
                }}
                variant="ghost"
              >
                {rule.template || "—"}
              </Button>
            </SettingField>
          ))}
          <Row
            icon={<Plus size={ICON.ui} />}
            onClick={() => setFolderRules([...settings.folderTemplates, { folder: "", template: "" }])}
            title={t("settings.addFolderTemplate")}
          />
        </RowList>
      </GroupCard>
      <p className="m-hint">{t("settings.folderTemplatesDesc")}</p>

      <SectionLabel>{t("settings.typeTemplates")}</SectionLabel>
      <GroupCard>
        <RowList>
          {settings.typeTemplates.map((rule, index) => (
            <SettingField
              action={
                <IconButton
                  label={t("common.delete")}
                  onClick={() => setTypeRules(settings.typeTemplates.filter((_, i) => i !== index))}
                >
                  <Trash2 size={ICON.ui} />
                </IconButton>
              }
              key={`type-${index}`}
              label={
                <TextInput
                  onChange={(e) =>
                    setTypeRules(
                      settings.typeTemplates.map((r, i) => (i === index ? { ...r, type: e.target.value } : r))
                    )
                  }
                  value={rule.type}
                />
              }
            >
              <Button
                onClick={() => {
                  void pickTemplate(rule.template).then((picked) => {
                    if (picked === null) return;
                    setTypeRules(
                      settings.typeTemplates.map((r, i) => (i === index ? { ...r, template: picked } : r))
                    );
                  });
                }}
                variant="ghost"
              >
                {rule.template || "—"}
              </Button>
            </SettingField>
          ))}
          <Row
            icon={<Plus size={ICON.ui} />}
            onClick={() => setTypeRules([...settings.typeTemplates, { type: "", template: "" }])}
            title={t("settings.addTypeTemplate")}
          />
        </RowList>
      </GroupCard>
      <p className="m-hint">{t("settings.typeTemplatesDesc")}</p>

      {pickFolderFor !== null && (
        <FolderPickerSheet
          onClose={() => setPickFolderFor(null)}
          onPick={(path) => {
            // Normalized on the way in, exactly as the resolver expects it —
            // otherwise a hand-typed and a picked folder would not match.
            const folder = normalizeFolderPath(path);
            setFolderRules(
              settings.folderTemplates.map((r, i) => (i === pickFolderFor ? { ...r, folder } : r))
            );
          }}
          title={t("settings.browseFolders")}
          vault={vault}
        />
      )}
    </>
  );
}
