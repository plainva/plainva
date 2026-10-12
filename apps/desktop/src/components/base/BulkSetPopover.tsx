import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, ClickCatch, ICON, Select, TextInput, useFixedPopover } from "@plainva/ui";
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
  // The keyboard goes into the form once it has been placed (before that it is
  // hidden and takes no focus): Escape then closes it, also while a floating
  // window beside it would take the key otherwise.
  useEffect(() => {
    popRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
  }, [popRef]);

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
      {/* The press beside the form is caught and goes nowhere else. The
          catcher is the shared one: here it once was the bare class without a
          layer, lay under the floating windows, and a press into a note
          preview did not reach it. */}
      <ClickCatch onPress={onClose} popover={popRef} />
      <div
        className="pv-popover pv-popover--fixed pv-bulkset"
        ref={popRef}
        data-testid="base-bulkset"
        // The panel takes the focus a press on its own blank parts would
        // otherwise drop on the page — and with it the Escape below.
        tabIndex={-1}
        onKeyDown={(e) => {
          // A select list inside takes its own Escape first and stops it there.
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
          anchorRef.current?.focus();
        }}
      >
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
