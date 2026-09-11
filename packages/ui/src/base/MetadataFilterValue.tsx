import { useTranslation } from "react-i18next";
import { baseFilterKind, baseFilterValues } from "./baseFilterCatalog";
import { DocIcon } from "../components/DocIcon";
import { Select } from "../components/ui/Select";
import { ICON } from "../lib/iconSizes";

/** Searchable source-value picker. Unknown stored icons remain usable by name. */
export function MetadataFilterValue({ column, rows, value, onChange, compact }: {
  column: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const kind = baseFilterKind(column);
  return <Select
    ariaLabel={t("database.filterValue")}
    value={value}
    onChange={onChange}
    compact={compact}
    minWidth={0}
    searchPlaceholder={t("database.filterSearchValues")}
    options={[
      { value: "", label: t("database.selectValue") },
      ...baseFilterValues(rows, column, value).map((item) => ({
        value: item,
        label: item,
        ...(kind === "color" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(item) ? { swatch: item } : {}),
        ...(kind === "icon" ? { icon: <DocIcon icon={item} size={ICON.ui} /> } : {}),
      })),
    ]}
  />;
}
