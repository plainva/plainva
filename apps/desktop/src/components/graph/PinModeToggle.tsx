import { useTranslation } from "react-i18next";
import { Pin, PinOff } from "lucide-react";
import { ICON } from "@plainva/ui";

/**
 * Discreet pin-mode toggle placed top-right over a graph canvas. ON (default):
 * dragging a node remembers its position. OFF: drags are ephemeral, and turning
 * the mode off clears the pins of THIS view only (the caller wires that up).
 * Shared verbatim by the vault map, the base graph and the context graph so the
 * needle looks and behaves the same everywhere.
 */
export function PinModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = active
    ? t("graph.pinModeOn", { defaultValue: "Positionen werden gemerkt — klicken zum Verwerfen" })
    : t("graph.pinModeOff", { defaultValue: "Positionen werden nicht gemerkt — klicken zum Merken" });
  return (
    <button
      type="button"
      className="pv-iconbtn pv-iconbtn--sm"
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      data-testid="graph-pin-toggle"
      onClick={onToggle}
      style={{
        position: "absolute",
        top: "var(--space-2)",
        right: "var(--space-2)",
        zIndex: 5,
        opacity: active ? 0.85 : 0.45,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color-light)",
      }}
    >
      {active ? <Pin size={ICON.ui} /> : <PinOff size={ICON.ui} />}
    </button>
  );
}
