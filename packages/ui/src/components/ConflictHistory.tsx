import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IVaultAdapter } from "@plainva/core";
import { compareLines } from "../lib/compareVersions";
import { LineCompare } from "./LineCompare";

/** Read-only ancestry, separate from the editable merge so inspecting an
 * older revision never discards edits made in the comparison itself. */
export function ConflictHistory({ files, path, copyPath, current, copy }: {
  files: IVaultAdapter; path: string; copyPath: string; current: string | null; copy: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ key: string; text: string }>>([]);
  const [reference, setReference] = useState(0);
  const [target, setTarget] = useState("copy");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void (async () => {
      const found = await files.getConflictSession?.(path);
      const session = found?.workingCopyPath === copyPath ? found : null;
      const values: Array<{ key: string; text: string }> = [];
      if (session?.baseText !== null && session?.baseText !== undefined) values.push({ key: "conflict.savedBase", text: session.baseText });
      if (session?.foreignCopySnapshot) values.push({ key: "conflict.foreignCopy", text: await files.readTextFile(session.foreignCopySnapshot) });
      if (!stale) { setRevisions(values); setReference(0); setFailed(false); }
    })().catch(() => { if (!stale) setFailed(true); });
    return () => { stale = true; };
  }, [files, path, copyPath, open, current, copy]);
  const before = revisions[reference]?.text, after = target === "copy" ? copy : current;
  const lines = useMemo(() => before !== undefined && after !== null ? compareLines(before, after) : null, [before, after]);
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="pv-conflict-history">
    <summary>{t("conflict.savedRevisions")}</summary>
    {open && (failed ? <p role="alert">{t("conflict.historyFailed")}</p> : revisions.length ? <>
      <div className="pv-conflict-history-pickers">
        <select className="pv-field pv-field--select" aria-label={t("conflict.savedRevisions")} value={reference} onChange={event => setReference(Number(event.target.value))}>
          {revisions.map((item, index) => <option key={item.key} value={index}>{t(item.key)}</option>)}
        </select>
        <select className="pv-field pv-field--select" aria-label={t("compare.title")} value={target} onChange={event => setTarget(event.target.value)}>
          <option value="copy">{t("compare.conflictCopy")}</option><option value="current">{t("compare.currentFile")}</option>
        </select>
      </div>
      {!lines && <p>{t("compare.countsUnavailable")}</p>}
      <LineCompare lines={lines} fallback={before} />
      {!lines && <><strong>{t(target === "copy" ? "compare.conflictCopy" : "compare.currentFile")}</strong><LineCompare lines={null} fallback={after} /></>}
    </> : <p>{t("conflict.noSavedBase")}</p>)}
  </details>;
}
