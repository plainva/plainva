import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Segmented, compareLines, compareStats, lineCount, type CompareLine } from "@plainva/ui";

/**
 * The phone's half of the ONE comparison surface (feedback round 2026-09-01,
 * P2; mockup "Zwei Fassungen auf 375 Pixeln"). Same rule as the desktop
 * `CompareModal`: the note's current text is the LEFT side (here: the top
 * card), the other version — an older snapshot or the sync's conflict copy —
 * is the RIGHT side. Side by side does not fit a phone, so the differences
 * are stacked: a red line (only in the note, lost if the other version is
 * taken) directly above the green line that replaces it. Two more tabs show
 * each version on its own, whole.
 *
 * What the phone deliberately does NOT have is the desktop's line-by-line
 * merge — an arrow per chunk is a mouse gesture (parity catalog:
 * `compare-merge`). Here you take one version whole, or keep both.
 */
export interface CompareSideMeta {
  /** e.g. "In der Notiz" */
  title: string;
  /** e.g. "Von diesem Gerät · heute, 14:32" */
  subtitle: string;
}

export function CompareVersions({
  inNote,
  other,
  noteMeta,
  otherMeta,
  cost,
  actions,
  hint,
}: {
  /** The note's current text (left side). */
  inNote: string;
  /** The other version (right side). */
  other: string;
  noteMeta: CompareSideMeta;
  otherMeta: CompareSideMeta;
  /** Sentence for the footer, built by the caller from `compareStats` ("+4 kommen hinzu, −2 gehen verloren"). */
  cost?: (stats: { added: number; removed: number; hunks: number; same: number }) => string;
  actions: ReactNode;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"diff" | "note" | "other">("diff");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const lines = useMemo(() => compareLines(inNote, other), [inNote, other]);
  const stats = useMemo(() => compareStats(inNote, other), [inNote, other]);
  const full = useMemo(() => (lines === null ? null : expandSkips(inNote, other, lines, expanded)), [inNote, other, lines, expanded]);

  const meta = (m: CompareSideMeta, text: string) => (
    <div className="m-compare-side">
      <span className="m-compare-side-title">{m.title}</span>
      <span className="m-compare-side-sub">{m.subtitle}</span>
      <span className="m-compare-side-sub">{t("compare.sizeLines", { size: sizeOf(text), lines: lineCount(text) })}</span>
    </div>
  );

  return (
    <div className="m-compare">
      <div className="m-compare-sides">
        {meta(noteMeta, inNote)}
        {meta(otherMeta, other)}
      </div>
      <Segmented
        options={[
          { value: "diff", label: t("compare.tabDiff") },
          { value: "note", label: t("compare.tabNote") },
          { value: "other", label: t("compare.tabOther") },
        ]}
        value={tab}
        onChange={setTab}
        size="sm"
      />
      {tab === "note" && <pre className="m-version-preview">{inNote}</pre>}
      {tab === "other" && <pre className="m-version-preview">{other}</pre>}
      {tab === "diff" && (full === null ? (
        // Too large: said, not swallowed — the other two tabs still work.
        <p className="m-hint" data-testid="compare-too-large">{t("compare.tooLarge")}</p>
      ) : stats && stats.hunks === 0 ? (
        <p className="m-hint">{t("compare.identical")}</p>
      ) : (
        <div className="m-diff" data-testid="compare-diff">
          {full.map((l, idx) =>
            l.type === "skip" ? (
              <button className="m-diff-skip" key={idx} type="button" onClick={() => setExpanded((s) => new Set(s).add(l.index))}>
                {t("compare.sameLines", { n: l.count })} · {t("compare.showLines")}
              </button>
            ) : (
              <div className={`m-diff-line is-${l.type}`} key={idx}>{l.text || " "}</div>
            ),
          )}
        </div>
      ))}
      <div className="m-compare-footer">
        {stats && stats.hunks > 0 && (
          <p className="m-compare-stats">
            {t("compare.stats", { hunks: stats.hunks, same: stats.same })}
            {cost ? <><br />{cost(stats)}</> : null}
          </p>
        )}
        {hint && <p className="m-hint">{hint}</p>}
        <div className="m-compare-actions">{actions}</div>
      </div>
    </div>
  );
}

type FullLine = { type: "same" | "add" | "del"; text: string } | { type: "skip"; count: number; index: number };

/**
 * Re-expands the collapsed identical runs the reader tapped. `compareLines`
 * folds them to `{skip, count}`; to show them we need the actual lines, which
 * the folded shape no longer carries — so the run's lines are re-read from
 * the note (a skip is by definition text both sides share).
 */
function expandSkips(inNote: string, other: string, lines: CompareLine[], expanded: Set<number>): FullLine[] {
  const out: FullLine[] = [];
  const noteLines = inNote.replace(/\r\n/g, "\n").split("\n");
  let notePos = 0;
  let skipIndex = 0;
  for (const l of lines) {
    if (l.type === "skip") {
      const idx = skipIndex++;
      if (expanded.has(idx)) {
        for (let i = 0; i < l.count; i++) out.push({ type: "same", text: noteLines[notePos + i] ?? "" });
      } else {
        out.push({ type: "skip", count: l.count, index: idx });
      }
      notePos += l.count;
    } else {
      out.push(l);
      if (l.type !== "add") notePos++;
    }
  }
  void other;
  return out;
}

function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
