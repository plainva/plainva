import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MEMORY_LIMITS, cleanMemoryText, type AiPolicyDimension, type MemoryEntry, type MemoryPlace } from "@plainva/core";
import type { AiMemoryState } from "./aiMemory";
import type { AiSession } from "./aiSession";
import { memoryProblemText } from "./memoryView";

/**
 * What both shells' memory surfaces share beyond the model (plan KI-Harness
 * P6): the budget's bar, and the two forms' state — an entry, a rule. The
 * fields themselves are each shell's own (a dialog here, a sheet there); what
 * they hold and when they may be saved is decided once.
 */

/** How full "always included" is: a bar and the count in words. */
export function MemoryMeter({ fill, label }: { fill: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  return (
    <span className="pv-memory-meter" data-testid="ai-memory-budget">
      <span className="pv-security-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className="pv-security-progress-bar" style={{ width: `${percent}%` }} />
      </span>
      <span>{label}</span>
    </span>
  );
}

type MemorySession = Pick<AiSession, "addMemory" | "editMemory">;

export interface MemoryEntryForm {
  /** The entry that is reworded; null for a new one. */
  editing: MemoryEntry | null;
  text: string;
  setText(text: string): void;
  /** Where a new entry goes. An entry that exists is moved from its row, not from this form. */
  place: MemoryPlace;
  setPlace(place: MemoryPlace): void;
  /** Kept from every cloud: only models on this device get it. */
  local: boolean;
  setLocal(on: boolean): void;
  /** The entry's rules cannot be read: it stays kept from everybody, and the form cannot change that. */
  locked: boolean;
  /** "42 of 500". */
  count: string;
  /** Characters "always included" still has room for, without this entry. */
  left: number;
  /** A new entry for "always included" that no longer fits there. */
  overBudget: boolean;
  ready: boolean;
  error: string | null;
  /** Writes it; true when the form can close. */
  save(): Promise<boolean>;
}

/** The form of one entry. Null where the entry to reword is not there (any more). */
export function useMemoryEntryForm(session: MemorySession | null, memory: AiMemoryState | null, id: string | null): MemoryEntryForm | null {
  const { t, i18n } = useTranslation();
  const editing = useMemo(() => (id && memory ? ([...memory.active, ...memory.long].find((entry) => entry.id === id) ?? null) : null), [id, memory]);
  const [text, setTextState] = useState(() => editing?.text ?? "");
  const [place, setPlace] = useState<MemoryPlace>(() => editing?.place ?? "active");
  const [local, setLocal] = useState(() => editing?.deny.includes("cloud") ?? false);
  const [error, setError] = useState<string | null>(null);
  if (!session || !memory || (id !== null && !editing)) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const cleaned = cleanMemoryText(text).text;
  const used = memory.budget.used - (editing?.place === "active" && !memory.budget.over.includes(editing.id) ? editing.text.length : 0);
  const left = Math.max(0, memory.budget.limit - used);
  const targetPlace = editing ? editing.place : place;
  const locked = editing?.unreadable === true;
  return {
    editing,
    text,
    // A change takes the last refusal with it: that was about what the field held before.
    setText: (next) => {
      setTextState(next);
      setError(null);
    },
    place,
    setPlace,
    local,
    setLocal,
    locked,
    count: t("ai.memory.form.count", { used: number.format(cleaned.length), limit: number.format(MEMORY_LIMITS.entryChars) }),
    left,
    overBudget: targetPlace === "active" && cleaned.length > left,
    ready: cleaned.length > 0 && cleaned.length <= MEMORY_LIMITS.entryChars,
    error,
    async save() {
      // An entry whose rules cannot be read keeps them all; one that can says exactly what the form says.
      const web = editing?.deny.includes("web") ?? false;
      const deny: AiPolicyDimension[] | undefined = locked ? undefined : [...(local ? (["cloud"] as const) : []), ...(web ? (["web"] as const) : [])];
      const result = editing ? await session.editMemory(editing.id, text, deny ? { deny } : {}) : await session.addMemory({ text, place, ...(deny ? { deny } : {}) });
      if (result.ok) return true;
      setError(memoryProblemText(t, result.reason));
      return false;
    },
  };
}

type RuleSession = Pick<AiSession, "addRule">;

export interface MemoryRuleForm {
  text: string;
  setText(text: string): void;
  count: string;
  ready: boolean;
  error: string | null;
  save(): Promise<boolean>;
}

/** The form of one rule: a line for the vault's standing instructions. */
export function useMemoryRuleForm(session: RuleSession | null): MemoryRuleForm | null {
  const { t, i18n } = useTranslation();
  const [text, setTextState] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const cleaned = cleanMemoryText(text).text;
  return {
    text,
    setText: (next) => {
      setTextState(next);
      setError(null);
    },
    count: t("ai.memory.form.count", { used: number.format(cleaned.length), limit: number.format(MEMORY_LIMITS.entryChars) }),
    ready: cleaned.length > 0 && cleaned.length <= MEMORY_LIMITS.entryChars,
    error,
    async save() {
      const result = await session.addRule(text);
      if (result.ok) return true;
      setError(result.reason === "too-large" ? t("ai.memory.rules.tooLarge") : memoryProblemText(t, result.reason));
      return false;
    },
  };
}
