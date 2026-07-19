import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON, Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { TextInput, SelectField } from "@plainva/ui";

interface Props {
  viewName: string;
  requiredType: string;
  availableColumns: string[];
  onConfirm: (selectedColumn: string, isNew: boolean, dateType?: "date" | "datetime") => void;
  onCancel: () => void;
}

export function MissingRequirementDialog({ viewName, requiredType, availableColumns, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [selectedColumn, setSelectedColumn] = useState(availableColumns.length > 0 ? availableColumns[0] : "");
  const [newColumnName, setNewColumnName] = useState("");

  const isDateReq = requiredType === "date" || requiredType === "datetime";
  const [dateType, setDateType] = useState<"date" | "datetime">("date");

  const confirmDisabled = mode === 'new' ? !newColumnName.trim() : !selectedColumn;
  const handleConfirm = () => {
    const dt = isDateReq ? dateType : undefined;
    if (mode === 'new') {
      if (!newColumnName.trim()) return;
      onConfirm(newColumnName.trim(), true, dt);
    } else {
      if (!selectedColumn) return;
      onConfirm(selectedColumn, false, dt);
    }
  };

  return (
    <Modal
      onClose={onCancel}
      title={t("database.missingField", "Pflichtfeld fehlt")}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel", "Abbrechen")}</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={confirmDisabled}>
            {t("common.confirm", "Bestätigen")}
          </Button>
        </>
      }
    >
      <div className="pv-dialog-body">
        <AlertCircle size={ICON.head} className="pv-dialog-ic pv-dialog-ic--warning" aria-hidden />
        <div className="pv-dialog-text">
          <p className="pv-dialog-msg" style={{ color: "var(--text-muted)" }}>
            {isDateReq ? (
              <>{t("database.missingStartDateDesc", "Diese Ansicht ({{viewName}}) benötigt ein Startdatum-Feld.", { viewName })} </>
            ) : (
              <>{t("database.missingFieldDesc", "Diese Ansicht ({{viewName}}) benötigt ein Feld mit dem Format", { viewName })} <strong>{requiredType}</strong>. </>
            )}
            {t("database.missingFieldOptions", " Du kannst ein neues Feld anlegen oder ein bestehendes Feld umwandeln.")}
          </p>

          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--text-ui)" }}>
              <input type="radio" name="req-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
              {t("database.createNewField", "Neues Feld anlegen")}
            </label>
            {availableColumns.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--text-ui)" }}>
                <input type="radio" name="req-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} />
                {t("database.convertExistingField", "Bestehendes umwandeln")}
              </label>
            )}
          </div>

          {mode === 'new' ? (
            <TextInput
              autoFocus
              placeholder={t("database.newFieldName", "Name des neuen Feldes...")}
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
            />
          ) : (
            <SelectField value={selectedColumn} onChange={e => setSelectedColumn(e.target.value)}>
              {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectField>
          )}

          {isDateReq && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("database.dateFieldFormatLabel", "Format des Datumsfelds")}</span>
              <SelectField value={dateType} onChange={e => setDateType(e.target.value as "date" | "datetime")}>
                <option value="date">{t("database.typeDateOnly", "Nur Datum")}</option>
                <option value="datetime">{t("database.typeDateTime", "Datum & Uhrzeit")}</option>
              </SelectField>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
