import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, FolderOpen } from "lucide-react";
import { Button, EmptyState, errorText, ICON } from "@plainva/ui";
import type { VaultBootState } from "../hooks/useVaultBoot";
import { previousMobileVault, switchVault } from "../services/vaultService";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { getIndexBuild, subscribeIndexBuild } from "../services/indexBuild";
import { mActions } from "../services/mobileDialogs";

/**
 * What the app shows while it has no vault (issue 143).
 *
 * It used to show nothing: an empty container while the vault opened, and the
 * same empty container for good when the boot failed or never answered — a
 * person who connected a folder vault had a blank phone and no way out but to
 * clear the app's data. Now the boot says which vault it is opening and how
 * many files it has read, and always offers the way back: to the vault the
 * last switch came from, or — after a cold start, when there is none — to any
 * other registered vault. A boot that failed says why, with the same way back
 * and the way to try again.
 *
 * The desktop's twin is its loading screen (title, progress, "Cancel / close
 * vault", which returns to the start screen).
 */
export function VaultBootSurface({ boot: state }: { boot: VaultBootState }) {
  // "Ready" without a vault is the one render between the two state updates.
  const boot = state.kind === "ready" ? { kind: "opening" as const, vaultId: null, name: "" } : state;
  const { t } = useTranslation();
  const build = useSyncExternalStore(subscribeIndexBuild, getIndexBuild);
  const [back, setBack] = useState<{ previous: VaultEntry | null; others: VaultEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([previousMobileVault().catch(() => null), listVaults().catch(() => [] as VaultEntry[])]).then(([previous, all]) => {
      if (alive) setBack({ previous, others: all.filter((v) => v.id !== boot.vaultId) });
    });
    return () => { alive = false; };
  }, [boot.vaultId]);

  const nameOf = (entry: { name: string }) => entry.name || t("mobile.vaultLocal");
  const go = (id: string) => {
    setBusy(true);
    void switchVault(id).catch((e) => console.error("[boot] switch failed", e)).finally(() => setBusy(false));
  };
  const chooseOther = async () => {
    const picked = await mActions({
      title: t("mobile.vaults"),
      options: (back?.others ?? []).map((v) => ({ value: v.id, label: nameOf(v) })),
    });
    if (picked) go(picked);
  };

  const backAction = back?.previous ? (
    <Button data-testid="vault-boot-back" disabled={busy} onClick={() => go(back.previous!.id)} variant="tonal">
      {t("mobile.bootBackTo", { name: nameOf(back.previous) })}
    </Button>
  ) : back && back.others.length > 0 ? (
    <Button data-testid="vault-boot-other" disabled={busy} onClick={() => void chooseOther()} variant="tonal">
      {t("mobile.bootOtherVault")}
    </Button>
  ) : null;

  const read = build && build.vaultId === boot.vaultId ? build.done : 0;

  return (
    <div className="m-app">
      <div className="m-boot" data-state={boot.kind} data-testid="vault-boot">
        {boot.kind === "opening" ? (
          <EmptyState
            action={<div className="m-boot-actions">{backAction}</div>}
            icon={<FolderOpen size={ICON.empty} />}
            title={t("splash.loadingVault", { name: nameOf(boot) })}
          >
            <div className="m-progress" role="progressbar" aria-label={t("splash.loadingVault", { name: nameOf(boot) })}>
              <div className="m-progress-bar" data-indeterminate="true" />
            </div>
            {read > 0 && <p className="m-boot-count" data-testid="vault-boot-count">{t("mobile.bootFilesRead", { count: read })}</p>}
          </EmptyState>
        ) : (
          <EmptyState
            action={
              <div className="m-boot-actions">
                {backAction}
                {boot.vaultId && (
                  <Button data-testid="vault-boot-retry" disabled={busy} onClick={() => go(boot.vaultId!)} variant="ghost">
                    {t("sync.retryNow")}
                  </Button>
                )}
              </div>
            }
            icon={<AlertCircle size={ICON.empty} />}
            title={t("mobile.bootFailed", { name: nameOf(boot) })}
          >
            <span data-testid="vault-boot-reason">{errorText(boot.error)}</span>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
