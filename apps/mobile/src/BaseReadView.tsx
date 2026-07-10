import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseYaml } from "yaml";
import { ChevronLeft, Database } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { vaultOps, type MobileVault } from "./services/vaultService";

/**
 * Read-only .base rendering for mobile (M4/E8): folder-sourced databases
 * show as a simple table — row = note, columns = the first view's order
 * (frontmatter values as text). Editing, filters and the other view types
 * stay desktop-only for now; tapping a row opens the note.
 */

interface BaseRow {
  path: string;
  title: string;
  values: Record<string, string>;
}

const MAX_COLUMNS = 4;

function frontmatterOf(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  try {
    const parsed = parseYaml(m[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => cellText(x)).join(", ");
  return String(v).replace(/^\[\[(.*)\]\]$/, "$1");
};

export function BaseReadView({
  vault,
  path,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.base$/i, "");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<BaseRow[] | null>(null);
  const [noSource, setNoSource] = useState(false);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const raw = await vaultOps.read(vault, path);
      // Folder source ("file.folder == \"X\""): the one source kind the
      // mobile MVP renders. Tag/filter-only bases fall back to a hint.
      const folderMatch = /file\.folder\s*==\s*"([^"]+)"/.exec(raw);
      if (!folderMatch) {
        if (!stale) {
          setNoSource(true);
          setRows([]);
        }
        return;
      }
      const folder = folderMatch[1];
      let order: string[] = [];
      try {
        const cfg = parseYaml(raw) as {
          views?: Array<{ order?: string[] }>;
        };
        order = (cfg?.views?.[0]?.order ?? [])
          .map((key) => key.replace(/^note\./, ""))
          .filter((key) => key !== "file.name" && !key.startsWith("file."));
      } catch {
        /* unparseable extras — table still renders with the name column */
      }
      const cols = order.slice(0, MAX_COLUMNS);
      const listing = await vaultOps.listFolder(vault, folder);
      const out: BaseRow[] = [];
      for (const note of listing.notes) {
        if (/^(index|log)\.md$/i.test(note.path.split("/").pop()!)) continue;
        const text = await vaultOps.read(vault, note.path).catch(() => "");
        const fm = frontmatterOf(text);
        const values: Record<string, string> = {};
        for (const c of cols) values[c] = cellText(fm[c]);
        out.push({ path: note.path, title: note.title, values });
      }
      if (!stale) {
        setColumns(cols);
        setRows(out);
      }
    })();
    return () => {
      stale = true;
    };
  }, [vault, path]);

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{title}</h1>
      </header>
      <p className="m-hint">{t("mobile.baseReadOnly")}</p>
      {rows === null ? null : noSource ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.baseNoSource")}</EmptyState>
      ) : (
        <div className="m-basetable-wrap">
          <table className="m-basetable">
            <thead>
              <tr>
                <th>{t("mobile.baseName")}</th>
                {columns.map((c) => (
                  <th key={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path} onClick={() => onOpenNote(r.path)}>
                  <td>{r.title}</td>
                  {columns.map((c) => (
                    <td key={c}>{r.values[c]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
