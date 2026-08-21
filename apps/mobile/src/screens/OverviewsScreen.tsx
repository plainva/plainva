import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, ListTree, RefreshCw } from "lucide-react";
import {
  adoptFileAsIndex,
  Button,
  EmptyState,
  GroupCard,
  ICON,
  Row,
  RowList,
  SectionLabel,
  collectFolderIndexInfos,
  folderIndexState,
  foldersMissingIndex,
  toast,
  type FolderIndexInfo,
  type FolderIndexState,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { writeOverview } from "../services/indexOverviews";
import { mConfirm } from "../services/mobileDialogs";
import type { MobileVault } from "../services/vaultService";

/**
 * The vault's OKF overviews, folder by folder (P6).
 *
 * The folder sheet answers "this folder, right now"; this is the other
 * entrance — the rare tidy-up pass across the whole vault. It sorts by where
 * something is MISSING rather than alphabetically, because an alphabetical
 * list of mostly-fine folders buries the handful that need attention.
 *
 * A folder whose index.md is the user's own is listed and left alone: no
 * action, just the fact. Adopting an existing note AS the overview is offered
 * only where there is no index.md yet and the folder holds a plausible
 * candidate — and it renames a file, so it asks first.
 */

type FolderRow = FolderIndexInfo & { state: FolderIndexState };

/** Missing first, then the user's own, then ours; root before the rest. */
function sortRows(rows: FolderRow[]): FolderRow[] {
  const rank = (r: FolderRow) => (r.state === "missing" ? 0 : r.state === "manual" ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.folder === "" ? -1 : b.folder === "" ? 1 : a.folder.localeCompare(b.folder)),
  );
}

export function OverviewsScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FolderRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!vault.queryService) return;
    const infos = await collectFolderIndexInfos({ queryService: vault.queryService, adapter: vault.files });
    const withState = await Promise.all(
      infos.map(async (info) => ({ ...info, state: await folderIndexState(vault.files, info.folder) })),
    );
    setRows(sortRows(withState));
  }, [vault]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<number>) => {
    setBusy(true);
    try {
      const n = await work();
      toast.success(t("indexMd.bulkDone", { count: n }));
      await load();
    } catch (e) {
      console.error("[mobile] overview run failed", e);
      toast.error(t("indexMd.generateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const generateOne = (folder: string) =>
    void run(async () => {
      await writeOverview(vault, folder);
      return 1;
    });

  const generateAllMissing = () =>
    void run(async () => {
      const missing = foldersMissingIndex(rows ?? []);
      // One at a time and tolerant per folder: a run that stops at the first
      // unreadable folder leaves the rest of the vault unexplained.
      let done = 0;
      for (const folder of missing) {
        try {
          await writeOverview(vault, folder);
          done++;
        } catch (e) {
          console.warn("[mobile] overview skipped", folder, e);
        }
      }
      return done;
    });

  const adopt = (row: FolderRow) =>
    void (async () => {
      const candidate = row.candidates[0];
      if (!candidate || !vault.queryService) return;
      const name = candidate.path.split("/").pop() ?? candidate.path;
      const ok = await mConfirm({
        title: t("indexMd.actionAdopt", { file: name }),
        message: t("indexMd.renameHint"),
      });
      if (!ok) return;
      await run(async () => {
        await adoptFileAsIndex({
          adapter: vault.files,
          queryService: vault.queryService!,
          candidatePath: candidate.path,
          folder: row.folder,
          prepare: false,
        });
        await vault.indexer?.indexVaultFull().catch(() => {});
        window.dispatchEvent(new CustomEvent("m-vault-changed"));
        return 1;
      });
    })();

  const missingCount = foldersMissingIndex(rows ?? []).length;

  return (
    <div className="m-screen">
      <AppBar onBack={onBack} title={t("indexMd.overviewsTitle")} />
      <div className="m-page">
        <p className="m-hint">{t("indexMd.overviewsIntro")}</p>

        {rows !== null && rows.length === 0 && (
          <EmptyState icon={<ListTree size={ICON.empty} />}>{t("indexMd.overviewsEmpty")}</EmptyState>
        )}

        {missingCount > 0 && (
          <GroupCard>
            <RowList>
              <Row
                data-testid="overviews-all-missing"
                disabled={busy}
                icon={<FolderPlus size={ICON.ui} />}
                onClick={generateAllMissing}
                title={t("indexMd.generateAllMissing", { count: missingCount })}
              />
            </RowList>
          </GroupCard>
        )}

        {rows !== null && rows.length > 0 && (
          <>
            <SectionLabel>{t("indexMd.overviewsTitle")}</SectionLabel>
            <GroupCard>
              <RowList>
                {rows.map((row) => (
                  <Row
                    data-testid={`overview-row-${row.folder || "root"}`}
                    disabled={busy}
                    end={
                      row.state === "manual" ? undefined : (
                        <Button
                          disabled={busy}
                          onClick={() => generateOne(row.folder)}
                          size="sm"
                          variant="ghost"
                        >
                          {t(row.state === "managed" ? "indexMd.refreshNow" : "indexMd.createOverview")}
                        </Button>
                      )
                    }
                    icon={row.state === "managed" ? <RefreshCw size={ICON.ui} /> : <ListTree size={ICON.ui} />}
                    key={row.folder || "(root)"}
                    onClick={row.state === "missing" && row.candidates.length > 0 ? () => adopt(row) : undefined}
                    subtitle={`${t("indexMd.fileCount", { count: row.fileCount })} · ${t(
                      row.state === "managed"
                        ? "indexMd.statusManaged"
                        : row.state === "manual"
                          ? "indexMd.statusManual"
                          : row.candidates.length > 0
                            ? "indexMd.statusMissingCandidate"
                            : "indexMd.statusMissing",
                    )}`}
                    title={row.folder || t("indexMd.rootFolder")}
                  />
                ))}
              </RowList>
            </GroupCard>
          </>
        )}
      </div>
    </div>
  );
}
