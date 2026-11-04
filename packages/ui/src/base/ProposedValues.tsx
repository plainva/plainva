import { Check, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { machineAuthorKind, machineAuthorSubject, type WorkspaceCommentRecord } from "@plainva/core";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { commentActionErrorKey } from "../lib/commentActionView";
import { errorText } from "../lib/errorText";
import { ICON } from "../lib/iconSizes";
import { propertyValueWords, type SuggestedProperty } from "../lib/propertySuggestion";
import { formatDateValue, splitMultiValue, type CuratedOption, type DateDisplayFormat } from "./propertyModel";
import { isEmptyPropertyValue } from "./writeProperty";
import type { ProposedCell, ProposedCellOutcome } from "./proposedCells";

/**
 * How a database shows the values somebody proposes for its entries (plan
 * KI-Harness P5-4), for both shells: the chip in a cell, the line above the
 * rows, and the words both use. What a proposal IS, and how it is decided,
 * lives in `proposedCells.ts`.
 */

/** What a column says about its values: enough to write a proposed one the way the column shows its own. */
export interface ProposedColumn {
  /** The column's name as the view shows it. */
  label: string;
  input?: string;
  options?: readonly CuratedOption[];
  dateFormat?: DateDisplayFormat;
  language: string;
}

/**
 * A value as a cell writes it in words: a date the way the view formats its
 * dates, an option by its label, a box for yes and no — so a proposed value
 * reads like the values beside it.
 */
export function proposedValueWords(value: unknown, column: ProposedColumn): string {
  if (isEmptyPropertyValue(value)) return "";
  const { input, options } = column;
  if (typeof value === "boolean") return value ? "☑" : "☐";
  if ((input === "date" || input === "datetime") && typeof value === "string") return formatDateValue(value, input === "datetime", column.language, column.dateFormat ?? "default");
  if (input === "select" || input === "status" || input === "multiselect") {
    const labelOf = (item: string) => options?.find((option) => option.value === item)?.label ?? item;
    return splitMultiValue(value).map(labelOf).join(", ");
  }
  return propertyValueWords(value);
}

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Who proposed it, as the user knows them: an assistant by its model; an app,
 * an agent or a script by the name it signed with, which the vault's comments
 * keep (`names`, by author id) — an id alone is a row of random letters, and
 * a script's is its folder.
 */
export function proposedBy(t: Translate, comment: WorkspaceCommentRecord, names?: ReadonlyMap<string, string>): string {
  const id = comment.authorMemberId;
  const kind = machineAuthorKind(id);
  if (kind === null) return t("database.proposedLabel");
  const subject = machineAuthorSubject(id) ?? id;
  const author = kind === "assistant" ? t("ai.suggestionAuthor", { model: subject }) : names?.get(id)?.trim() || (kind === "script" ? t("ai.scripts.author", { name: subject }) : subject);
  return t("database.proposedBy", { author });
}

/**
 * What to say after a decision from a database, in both shells' own toasts.
 * `done`: only where more than one value was asked about — a value decided in
 * its own cell shows there that it was. `failed`: the proposals that stay
 * where they are, and why — one that no longer fits its note says so in the
 * database's words, not in a text block's.
 */
export function proposedOutcomeWords(t: Translate, outcome: "applied" | "declined", result: ProposedCellOutcome, asked: number): { done: string | null; failed: string | null } {
  const done = asked > 1 && result.decided.length > 0 ? t(outcome === "applied" ? "database.proposedAccepted" : "database.proposedDeclined", { count: result.decided.length }) : null;
  if (result.failed.length === 0) return { done, failed: null };
  const count = result.failed.length;
  const message = result.error instanceof Error ? result.error.message : "";
  if (message === "comment-suggestion-orphan" || message === "comment-suggestion-overlap") return { done, failed: t("database.proposedNoFit", { count }) };
  const key = commentActionErrorKey(result.error);
  return { done, failed: t("database.proposedFailed", { count, reason: key ? t(key) : errorText(result.error) }) };
}

/** The proposal as the card of a suggestion shows a property: its name, what the cell says now, what it would say. */
export function proposedCellView(cell: ProposedCell, current: unknown, column: ProposedColumn): SuggestedProperty {
  return {
    key: column.label,
    before: proposedValueWords(current, column),
    after: cell.removed ? "" : proposedValueWords(cell.value, column),
    removed: cell.removed,
    added: isEmptyPropertyValue(current),
    stale: false,
  };
}

export interface ProposedValueChipProps {
  cell: ProposedCell;
  /** What the cell says now: a proposal that takes the value away shows it struck through. */
  current: unknown;
  column: ProposedColumn;
  /**
   * Opens the decision. With it the chip is a button (the desktop's cell);
   * without it a label, where the cell around it is what opens — the phone's
   * cell leads to its sheet, and a button in a button is no control at all.
   */
  onOpen?: (anchor: HTMLElement) => void;
  /** Placement only — the distance to what the cell says beside it. */
  className?: string;
  /** `md` where the chip itself is what a finger hits (a card on the phone's board); a cell's chip is the dense one. */
  size?: "sm" | "md";
}

/** The proposed value in its cell: tinted like an insertion — or, where the proposal takes the value away, the value struck through. */
export function ProposedValueChip({ cell, current, column, onOpen, className, size = "sm" }: ProposedValueChipProps) {
  const { t } = useTranslation();
  const words = proposedValueWords(cell.removed ? current : cell.value, column);
  const tip = cell.removed ? t("database.proposedRemoval", { column: column.label }) : t("database.proposedValue", { column: column.label, value: words });
  return (
    <Chip
      size={size}
      tone={cell.removed ? "removal" : "proposed"}
      icon={<Sparkles size={ICON.meta} aria-hidden="true" />}
      tip={tip}
      className={className}
      testId={`cell-proposed-${cell.column}`}
      onClick={
        onOpen
          ? (event) => {
              // The cell underneath starts editing on a click: this one is the chip's.
              event.stopPropagation();
              onOpen(event.currentTarget);
            }
          : undefined
      }
    >
      {words}
    </Chip>
  );
}

export interface ProposedValuesBarProps {
  /** How many values are proposed in what the view shows. */
  count: number;
  /** A decision is running: the buttons wait. */
  busy: boolean;
  onAcceptAll(): void;
  onDeclineAll(): void;
}

/**
 * The line above a database's rows: how many values are proposed in what the
 * view shows, and the two buttons that decide them all. Each value stays a
 * suggestion at its own note; "all" is one decision per note, one after the
 * other. Nothing is drawn while nothing is proposed.
 */
export function ProposedValuesBar({ count, busy, onAcceptAll, onDeclineAll }: ProposedValuesBarProps) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Banner
      kind="info"
      icon={Sparkles}
      testId="base-proposed-bar"
      actions={
        <>
          <Button size="sm" variant="ghost" disabled={busy} icon={<Check size={ICON.meta} aria-hidden="true" />} onClick={onAcceptAll} data-testid="base-proposed-accept-all">
            {t("comments.suggestApplyAll")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} icon={<X size={ICON.meta} aria-hidden="true" />} onClick={onDeclineAll} data-testid="base-proposed-decline-all">
            {t("comments.suggestDeclineAll")}
          </Button>
        </>
      }
    >
      {t("database.proposedCount", { count })}
    </Banner>
  );
}
