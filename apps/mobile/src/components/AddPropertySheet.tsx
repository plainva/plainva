import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PropertyNameInput, reservedPropertyName, type PropertyType, type PropertySuggestionSource } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { useSheetGuard } from "../hooks/useSheetGuard";

const TYPES: PropertyType[] = ["text", "number", "checkbox", "date", "datetime", "select", "status", "multiselect", "list", "tags", "link", "url", "email", "phone"];
export function AddPropertySheet({ source, columns, registry, existing, onAdd, onClose }: {
  source: PropertySuggestionSource | null; columns?: Record<string, { input?: string }>; registry: Record<string, PropertyType>;
  existing: string[]; onAdd: (name: string, type: PropertyType) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  // Typed and not yet saved is asked about (finding 2026-10-22).
  const close = useSheetGuard("add-property", name.trim() !== "", onClose);
  const key = name.trim();
  const valid = key !== "" && !reservedPropertyName(key) && !existing.some((s) => s.toLocaleLowerCase() === key.toLocaleLowerCase());
  return <div className="m-sheet-backdrop" onClick={close}>
    <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
      <SheetGrip onClose={close} /><p className="m-sheet-title">{t("editor.addProperty")}</p>
      <PropertyNameInput source={source} columns={columns} registry={registry} existing={existing}
        value={name} onChange={setName} onPick={(n, ty) => { setName(n); setType(ty); }} onClose={close} />
      <label className="m-row">{t("properties.fieldType")}<select className="pv-field pv-field--select" value={type}
        onChange={(e) => setType(e.target.value as PropertyType)}>
        {TYPES.map((ty) => <option key={ty} value={ty}>{t(`properties.type_${ty}`)}</option>)}
      </select></label>
      <button className="m-cell-commit" disabled={!valid} onClick={() => onAdd(key, type)}>{t("common.ok")}</button>
    </div>
  </div>;
}
