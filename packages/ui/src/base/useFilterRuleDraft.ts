import { useState } from "react";
import type { PropertyFilterRule } from "./filterExpr";

/** Keep an unfinished value comparison in the editor. Serializing `is ""`
 * immediately would turn it into `is empty` and remove its value picker. */
export function useFilterRuleDraft(stored: PropertyFilterRule, onCommit: (rule: PropertyFilterRule) => void) {
  const source = JSON.stringify(stored);
  const [pending, setPending] = useState<{ source: string; rule: PropertyFilterRule } | null>(null);
  const rule = pending?.source === source ? pending.rule : stored;
  const change = (next: PropertyFilterRule) => {
    if (next.op !== "empty" && next.op !== "notEmpty" && next.value === "") {
      setPending({ source, rule: next });
    } else {
      setPending(null);
      onCommit(next);
    }
  };
  return [rule, change] as const;
}
