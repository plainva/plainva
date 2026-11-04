import type { CompareLine } from "../lib/compareVersions";

/**
 * A comparison of two texts as one block (`compareLines`): lines only on the
 * right side tinted as added, lines only on the left as removed, long
 * unchanged runs folded. One rendering for the conflict history and the
 * skills workshop's "what changed" (plan KI-Harness P3-5). Without lines —
 * the texts were too large to compare — it shows `fallback` as it is.
 */
export function LineCompare({ lines, fallback, testId }: { lines: CompareLine[] | null; fallback?: string | null; testId?: string }) {
  return (
    <pre className="pv-linecompare" data-testid={testId}>
      {lines
        ? lines.map((line, index) => (
            <span key={index} className={`pv-linecompare-line--${line.type}`}>
              {line.type === "skip" ? `… ${line.count} …` : `${line.type === "add" ? "+" : line.type === "del" ? "−" : " "} ${line.text}`}
            </span>
          ))
        : fallback}
    </pre>
  );
}
