import { useTranslation } from "react-i18next";
import { computeColumnSummaries, isSummaryName, SUMMARY_NAMES } from "@plainva/core";
import { Select } from "../components/ui/Select";

/** The active custom formula remains visible even though it is not evaluated. */
export function ColumnSummarySelect({ columnLabel, value, onChange, compact }: {
  columnLabel: string;
  value: string;
  onChange: (value: string | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return <Select
    ariaLabel={t("database.summaryFor", { column: columnLabel })}
    value={value}
    onChange={(next) => onChange(next || null)}
    minWidth={0}
    compact={compact}
    options={[
      { value: "", label: t("database.summaryNone") },
      ...SUMMARY_NAMES.map((name) => ({ value: name, label: t(`database.summary_${name}`) })),
      ...(value && !isSummaryName(value) ? [{ value, label: t("database.summaryCustom", { name: value }) }] : []),
    ]}
  />;
}

/** A real table footer; selection and name columns retain their own cells. */
export function ColumnSummaryRow({ rows, columns, summaries, selection = false }: {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns: readonly string[];
  summaries?: Readonly<Record<string, string>>;
  selection?: boolean;
}) {
  const { t } = useTranslation();
  const values = computeColumnSummaries(rows, columns, summaries);
  if (!Object.keys(values).length) return null;
  return <tfoot className="pv-base-summary" data-testid="base-summary" aria-label={t("database.summary")}>
    <tr>
      {selection && <td className="pv-selcol" aria-hidden="true" />}
      {columns.map((column) => <td key={column}>
        {values[column] ? `${t(`database.summary_${values[column].name}`)} ${values[column].value}` : ""}
      </td>)}
    </tr>
  </tfoot>;
}
