import { Check, Minus } from "lucide-react";
import { cx } from "./cx";
import { ICON } from "../../lib/iconSizes";

export interface WizardStepItem {
  key: string;
  label: string;
  state: "done" | "active" | "pending" | "skipped";
}

export interface WizardStepsProps {
  steps: readonly WizardStepItem[];
  /** "row": number and label side by side, arrows between (the desktop's dialog). "stacked": equal columns, the label under its number (a phone's width). */
  layout?: "row" | "stacked";
  label: string;
  testId?: string;
}

/**
 * The numbered steps of a setup (`.pv-wizsteps`): the active step's number is a
 * primary-accent disc, a done step is a check on the accent-container pair, a
 * skipped one a dash in a dashed ring. One component for both shells, so the
 * desktop's connect dialog and the phone's account setup count and name their
 * steps the same way (plan "Verbinden-Assistent", E1).
 */
export function WizardSteps({ steps, layout = "row", label, testId }: WizardStepsProps) {
  return (
    <ol className={cx("pv-wizsteps", layout === "stacked" && "pv-wizsteps--stacked")} aria-label={label} data-testid={testId}>
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={cx("pv-wizstep", step.state === "active" && "is-active", step.state === "done" && "is-done", step.state === "skipped" && "is-skipped")}
          aria-current={step.state === "active" ? "step" : undefined}
          data-state={step.state}
        >
          {layout === "row" && index > 0 && <span className="pv-wizstep-arrow" aria-hidden="true">›</span>}
          <span className="pv-wizstep-num">
            {step.state === "done" ? <Check size={ICON.meta} aria-hidden="true" /> : step.state === "skipped" ? <Minus size={ICON.meta} aria-hidden="true" /> : index + 1}
          </span>
          <span className="pv-wizstep-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
