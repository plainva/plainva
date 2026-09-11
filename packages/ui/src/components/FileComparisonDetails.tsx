import { useTranslation } from "react-i18next";
import { frontmatterKeys, readFrontmatterPath, readTaskNoteIdentity } from "@plainva/core";
import { Button } from "./ui/Button";
import { GroupCard } from "./ui/GroupedRows";
import { toast } from "../services/toastStore";

/** Full, wrapping paths; no hover or truncated text is needed to identify a file. */
export function FileComparisonDetails({ vault, originalPath, copyPath, original, copy, onReveal, compact = false }: {
  vault: string; originalPath: string; copyPath: string; original?: string | null; copy?: string | null; onReveal: (path: string) => void; compact?: boolean;
}) {
  const { t } = useTranslation();
  const details = (path: string, title: string, content?: string | null) => {
    const anchor = content ? readTaskNoteIdentity(content) : null;
    const fields = (anchor ? frontmatterKeys(content!).map(key => [key, readFrontmatterPath(content!, [key])] as const) : []).filter(([key, value]) => !["type", "title"].includes(key) && value !== null && ["string", "boolean", "number"].includes(typeof value));
    return <GroupCard><div className="pv-comparison-file">
      <strong>{title}</strong><strong>{path.split(/[/\\]/).pop()}</strong><span>{path}</span>
      {anchor && <><span>{content!.match(/^#\s+(.+)$/m)?.[1]}</span>{fields.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}<span>{t("compare.taskList")}: {anchor.list}</span></>}
      <div className="pv-comparison-actions"><Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(path).then(() => toast.success(t("fileTree.pathCopied"))).catch(() => toast.error(t("connection.clipboardFailed"))); }}>{t("fileTree.copyPath")}</Button><Button size="sm" variant="ghost" onClick={() => onReveal(path)}>{t("compare.revealFolder")}</Button></div>
    </div></GroupCard>;
  };
  const files = <div className="pv-comparison-files">{details(originalPath, t("compare.currentFile"), original)}{details(copyPath, t("compare.conflictCopy"), copy)}</div>;
  return <div className="pv-comparison-context"><strong>{vault}</strong>{compact ? <details><summary>{originalPath.split("/").pop()} · {copyPath.split("/").pop()}</summary>{files}</details> : files}</div>;
}
