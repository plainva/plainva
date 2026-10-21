import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, ListTree, RefreshCw } from "lucide-react";
import {
  adoptFileAsIndex,
  adoptionSummary,
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
import { mConfirmOption } from "../services/mobileDialogs";
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
 *
 * That question carries the choice the desktop's dialog offers (finding
 * 2026-10-11): prepare the note for OKF on the way — its properties block
 * out, its wikilinks to Markdown links —, preset as it is there. The phone
 * adopted every note as it was and asked nothing, so a note adopted here had
 * to be prepared at a desktop. What was done is said in the words of the
 * desktop's result line (`adoptionSummary`).
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

  /** Runs one piece of work on the vault; what it answers is the notice shown when it is done. */
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await work());
      await load();
    } catch (e) {
      console.error("[mobile] overview run failed", e);
      toast.error(t("indexMd.generateFailed"));
    } finally {
      setBusy(false);
    }
  };
  const written = (count: number) => t("indexMd.bulkDone", { count });

  const generateOne = (folder: string) =>
    void run(async () => {
      await writeOverview(vault, folder);
      return written(1);
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
      return written(done);
    });

  const adopt = (row: FolderRow) =>
    void (async () => {
      const candidate = row.candidates[0];
      if (!candidate || !vault.queryService) return;
      const name = candidate.path.split("/").pop() ?? candidate.path;
      const answer = await mConfirmOption({
        title: t("indexMd.actionAdopt", { file: name }),
        message: t("indexMd.renameHint"),
        checkbox: { label: t("indexMd.prepareOption"), initial: true },
      });
      if (!answer.confirmed) return;
      await run(async () => {
        const result = await adoptFileAsIndex({
          adapter: vault.files,
          queryService: vault.queryService!,
          candidatePath: candidate.path,
          folder: row.folder,
          prepare: answer.checked,
        });
        await vault.indexer?.indexVaultFull("index.md generation").catch(() => {});
        window.dispatchEvent(new CustomEvent("m-vault-changed"));
        // Said as after any rename: a link that could not be followed still names the old file.
        if (result.linkUpdateFailed) toast.warning(t("dialogs.renameLinksFailed"));
        return adoptionSummary(t, name, result);
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
                {/* A row carries a button of its own and may lead somewhere itself
                    (`controls`): a tap on "Create overview" is not a tap on the row.
                    As a button it held that button inside a button. */}
                {rows.map((row) => (
                  <Row
                    controls
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
