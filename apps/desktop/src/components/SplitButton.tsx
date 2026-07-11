import { useRef, useState } from "react";
import { Columns2, Rows2, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu } from "./DropdownMenu";

export type SplitDirection = "vertical" | "horizontal";

/**
 * Editor-header control to split the editor area. Primary click = vertical
 * (side by side, the default); the caret opens a menu to pick vertical or
 * horizontal. Reused by the Editor and the BaseViewer headers.
 */
export function SplitButton({ onSplit, activeDirection }: { onSplit?: (direction: SplitDirection) => void; activeDirection?: SplitDirection }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);

  if (!onSplit) return null;

  return (
    <div className="pv-splitbtn">
      <button
        onClick={() => onSplit("vertical")}
        title={t("editor.splitVertical", { defaultValue: "Vertikal teilen (nebeneinander)" })}
        aria-label={t("editor.split", { defaultValue: "Editor teilen" })}
        className="pv-btn pv-btn--ghost pv-btn--sm"
      >
        <Columns2 size={16} />
      </button>
      <button
        ref={caretRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("editor.splitOptions", { defaultValue: "Teilungsrichtung wählen" })}
        title={t("editor.splitOptions", { defaultValue: "Teilungsrichtung wählen" })}
        className="pv-btn pv-btn--ghost pv-btn--sm"
      >
        <ChevronDown size={12} />
      </button>
      <DropdownMenu
        open={open}
        anchorRef={caretRef}
        onClose={() => setOpen(false)}
        align="right"
        minWidth={250}
        ariaLabel={t("editor.split", { defaultValue: "Editor teilen" })}
        items={[
          ...(activeDirection !== "vertical" ? [{ id: "v", label: t("editor.splitVertical", { defaultValue: "Vertikal teilen (nebeneinander)" }), icon: <Columns2 size={16} />, onSelect: () => onSplit("vertical") }] : []),
          ...(activeDirection !== "horizontal" ? [{ id: "h", label: t("editor.splitHorizontal", { defaultValue: "Horizontal teilen (übereinander)" }), icon: <Rows2 size={16} />, onSelect: () => onSplit("horizontal") }] : []),
        ]}
      />
    </div>
  );
}
