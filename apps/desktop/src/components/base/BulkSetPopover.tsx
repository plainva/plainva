import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, ICON, Select, TextInput, useFixedPopover } from "@plainva/ui";
import { Check } from "lucide-react";

/**
 * The popover that sets one column on the whole selection (P5, E3). Which
 * types it offers is decided in packages/ui, where mobile reads it too.
 */
export interface BulkSetColumn {
  key: string;
  label: string;
  input: string;
  options: string[];
}

export function BulkSetPopover({
  anchorRef,
  columns,
  count,
  onApply,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  columns: BulkSetColumn[];
  count: number;
  onApply: (column: string, value: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [col, setCol] = useState<string>(columns[0]?.key ?? "");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const chosen = columns.find((c) => c.key === col);
  const popRef = useFixedPopover(true, anchorRef, { minWidth: 260 });

  const value = () => {
    if (!chosen) return "";
    if (chosen.input === "checkbox") return checked;
    if (chosen.input === "number") {
      const n = Number(text);
      return text.trim() === "" ? "" : Number.isFinite(n) ? n : text;
    }
    return text;
  };

  return (
    <>
      <div className="pv-click-catch" onClick={onClose} />
      <div className="pv-popover pv-popover--fixed pv-bulkset" ref={popRef} data-testid="base-bulkset">
        <p className="pv-bulkset-head">{t("database.bulkSetTitle", { count })}</p>

        <Select
          value={col}
          onChange={(v) => { setCol(v); setText(""); setChecked(false); }}
          options={columns.map((c) => ({ value: c.key, label: c.label }))}
          ariaLabel={t("database.bulkSetColumn")}
          data-testid="base-bulkset-column"
        />

        {chosen?.input === "checkbox" ? (
          <Checkbox
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            data-testid="base-bulkset-check"
          >{chosen.label}</Checkbox>
        ) : chosen && (chosen.input === "select" || chosen.input === "status") && chosen.options.length > 0 ? (
          <Select
            value={text}
            onChange={setText}
            // An empty choice is how a value is CLEARED — the write path treats
            // an empty value as "remove the property", the same as a cell edit.
            options={[{ value: "", label: t("database.bulkSetClear") }, ...chosen.options.map((o) => ({ value: o, label: o }))]}
            ariaLabel={chosen.label}
            data-testid="base-bulkset-value"
          />
        ) : (
          <TextInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            type={chosen?.input === "number" ? "number" : chosen?.input === "date" ? "date" : chosen?.input === "datetime" ? "datetime-local" : chosen?.input === "email" ? "email" : "text"}
            placeholder={t("database.bulkSetClear")}
            aria-label={chosen?.label ?? ""}
            data-testid="base-bulkset-value"
          />
        )}

        <div className="pv-bulkset-foot">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            icon={<Check size={ICON.ui} />}
            disabled={!chosen}
            onClick={() => { if (chosen) onApply(chosen.key, value()); }}
            data-testid="base-bulkset-apply"
          >
            {t("database.bulkSetApply", { count })}
          </Button>
        </div>
      </div>
    </>
  );
}
