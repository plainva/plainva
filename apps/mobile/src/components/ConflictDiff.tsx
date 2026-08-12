import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { collapseContext, lineDiff } from "@plainva/ui";
import { vaultOps, type MobileVault } from "../services/vaultService";

/** Read-only line diff between the conflict copy and the current note (G3). */
export function ConflictDiff({
  vault,
  conflictPath,
  originalPath,
}: {
  vault: MobileVault;
  conflictPath: string;
  originalPath: string;
}) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<ReturnType<typeof collapseContext> | null>(null);
  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        const [copy, original] = await Promise.all([
          vaultOps.read(vault, conflictPath),
          vaultOps.read(vault, originalPath),
        ]);
        const d = lineDiff(original, copy);
        if (!stale && d) setDiff(collapseContext(d, 2));
      } catch {
        /* one side unreadable: the sheet still offers the actions */
      }
    })();
    return () => {
      stale = true;
    };
  }, [vault, conflictPath, originalPath]);
  if (!diff) return null;
  return (
    <>
      <p className="m-sectionlabel m-sectionlabel--inset">
        {t("conflict.leftLabel")} / {t("conflict.rightLabel")}
      </p>
      <div className="m-diff">
        {diff.map((l, idx) =>
          l.type === "skip" ? (
            <div className="m-diff-skip" key={idx}>
              ... {l.count} ...
            </div>
          ) : (
            <div className={`m-diff-line is-${l.type}`} key={idx}>
              {l.text || " "}
            </div>
          ),
        )}
      </div>
    </>
  );
}
